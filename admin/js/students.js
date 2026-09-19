/* ============================================================
   HUACHENG ELITE — Coach & Admin console · students
   ------------------------------------------------------------
   THE list of every student with their family's credits and
   status (it replaces the old "All families" table on Reports),
   the student profile drawer and the staff "book a child" modal.
   Credits are ONE shared pool per family: siblings book from the
   same balance, so every credit figure here is the family's.

   Exposes:
     Admin.openStudent(childId, tab)   tab: overview|classes|credits|notes|family
     Admin.openFamily(familyId, childId?)
     Admin.bookChildModal(childId)

   The list is driven by URL params (all optional), so other
   views can deep-link, e.g. Admin.go("students", { credit: "dormant" }):
     q       search text (name / parent / email / phone)
     level   Junior | Elite | Competitive
     prog    programme id (matches the child's usual classes)
     credit  all | holding | low | none | negative | dormant
             — filters students by their family's pool
             (coaches: all | low | none | negative)
     days    dormant threshold in days (default 21, as on Reports)
     sort    name | credits | unutilised (admin) | last | rate
     all     "1" → a coach sees every student, not only their own
   ============================================================ */
(function () {
  "use strict";

  var HC = window.HC;
  var Admin = window.Admin;
  if (!Admin || !Admin.db) { console.warn("[students] core.js must load first"); return; }
  var db = Admin.db;
  var esc = Admin.esc;
  var h = Admin.h;
  var fmt = Admin.fmt;

  var MINE_WEEKS = 6;       // "my students": booked with me in the last 6 weeks or upcoming
  var LOW_RATE = 75;        // attendance % flagged as low
  var BOOK_WEEKS = 4;       // booking modal: this week + next 3
  var DORMANT_DAYS = 21;    // same default as Reports; ?days= overrides it
  var dormantDays = DORMANT_DAYS;
  var LOW_CREDITS = 2;      // 1–2 credits left counts as low
  var LEDGER_PAGE = 25;     // Credits tab rows before "Show all"

  // dir: the aria-sort direction of that order
  var SORTS = [
    { value: "name", label: "Name (A–Z)", dir: "ascending" },
    { value: "credits", label: "Credits (lowest first)", dir: "ascending" },
    { value: "unutilised", label: "Unutilised (highest first)", dir: "descending", admin: true },
    { value: "last", label: "Last class (most recent)", dir: "descending" },
    { value: "rate", label: "Attendance (lowest first)", dir: "ascending" }
  ];

  // coach: offered to coaches too · hidden: only shown while active (deep links)
  var CREDIT_FILTERS = [
    { id: "all", label: "All", coach: true, test: function () { return true; } },
    { id: "holding", label: "Holding credits", title: "Credits available or already booked",
      test: function (r) { return r.unutilised > 0; } },
    { id: "low", label: "Low (1–2)", coach: true, title: "1 or 2 credits left",
      test: function (r) { return r.available >= 1 && r.available <= LOW_CREDITS; } },
    { id: "none", label: "None or negative", coach: true, title: "No credits left to book with",
      test: function (r) { return r.available <= 0; } },
    { id: "dormant", label: "Dormant", title: "", // label + title follow the threshold (setDormantDays)
      test: function (r) { return r.dormant; } },
    { id: "negative", label: "Negative balance", coach: true, hidden: true, title: "Owes credits",
      test: function (r) { return r.available < 0; } }
  ];

  var TABS = [
    { id: "overview", label: "Overview" },
    { id: "classes", label: "Classes" },
    { id: "credits", label: "Credits" },
    { id: "notes", label: "Notes" },
    { id: "family", label: "Family" }
  ];

  // compact programme names for tables and chips
  var SHORT = {
    "tots": "Tots",
    "wushu-jr": "Wushu Jr",
    "wushu-elite": "Wushu Elite",
    "flips-jr": "Flips Jr",
    "flips-elite": "Flips Elite",
    "cond-jr": "Conditioning Jr",
    "cond-elite": "Conditioning Elite",
    "competitive": "Competitive"
  };

  var LEDGER_TYPES = { purchase: "Purchase", booking: "Booking", refund: "Refund", manual: "Manual adjustment", trial: "Free trial" };

  var NOTES_HINT = "Remarks are written by coaches.";

  /* ============================================================
     HELPERS
     ============================================================ */
  function progName(id) { var p = HC.getProgramme(id); return p ? p.name : String(id || "Class"); }
  function progShort(id) { return SHORT[id] || progName(id); }
  function firstName(name) { return String(name || "").trim().split(/\s+/)[0] || String(name || ""); }
  function ageText(ch) { return ch.age === "" || ch.age == null ? "Age not set" : "Age " + ch.age; }
  function byName(a, b) { return a.name.localeCompare(b.name); }
  function possessive(name) { return name + "'s"; }
  function creditWord(n) { return Math.abs(n) === 1 ? "credit" : "credits"; }

  function tabValid(tab) {
    return TABS.some(function (t) { return t.id === tab; });
  }

  // occurrence() rebuilds its object on every call — memoise per render pass
  function occCache() {
    var memo = {};
    return function (key) {
      if (!Object.prototype.hasOwnProperty.call(memo, key)) memo[key] = db.occurrence(key);
      return memo[key];
    };
  }

  function nowMinutes() { var d = new Date(); return d.getHours() * 60 + d.getMinutes(); }

  function bookingStarted(b, o) {
    if (o) return o.started;
    var t = db.todayISO();
    return b.date < t || (b.date === t && nowMinutes() >= db.toMinutes(b.time));
  }

  /* Remarks are the coach's job. A class remark belongs to that class's
     coach; a general note to the coach who wrote it. Admins read only. */
  function canWriteNote(n) {
    if (!n || Admin.isAdmin() || !Admin.staff) return false;
    if (n.occKey) {
      var o = db.occurrence(n.occKey);
      return !!o && Admin.can("notes", o);
    }
    return n.by === Admin.by();
  }
  function canAddGeneralNote() { return !!Admin.staff && !Admin.isAdmin(); }
  function noteOwner(n) {
    var o = n && n.occKey ? db.occurrence(n.occKey) : null;
    return o ? o.coach : db.actorName(n && n.by);
  }

  function focusId(id) {
    var el = document.getElementById(id);
    if (el) { try { el.focus({ preventScroll: true }); } catch (e) {} }
  }

  function safeId(str) { return String(str).replace(/[^\w-]/g, "_"); }

  function telHref(phone) { return "tel:" + String(phone || "").replace(/[^\d+]/g, ""); }

  /* ---------- credits (one shared pool per family) ---------- */
  function creditReport() { return db.creditReport({ dormantDays: dormantDays }); }

  function setDormantDays(days) {
    var d = parseInt(days, 10);
    dormantDays = d >= 1 && d <= 365 && String(d) === String(days) ? d : DORMANT_DAYS;
    var f = CREDIT_FILTERS.filter(function (x) { return x.id === "dormant"; })[0];
    f.label = "Dormant (" + dormantDays + "+ days)";
    f.title = "Holding credits, nothing booked and no class in over " + dormantDays + " days";
    return dormantDays;
  }
  setDormantDays(DORMANT_DAYS);

  // "Jane Tan's family" — how the console names a shared pool
  function familyLabel(f) { return f && f.parentName ? possessive(f.parentName) + " family" : "This family"; }

  // "Ethan", "Ethan & Chloe", "Ethan, Chloe & Max"
  function nameList(kids) {
    var n = kids.map(function (k) { return firstName(k.name); });
    return n.length < 2 ? n.join("") : n.slice(0, -1).join(", ") + " & " + n[n.length - 1];
  }

  // one family's creditReport row (a fallback for a family the report can't find)
  function familyRow(familyId) {
    var r = db.creditReport({ dormantDays: DORMANT_DAYS }).rows.filter(function (x) { return x.family.id === familyId; })[0];
    if (r) return r;
    var bal = db.balance(familyId);
    return {
      family: db.family(familyId) || {}, children: db.children(familyId), available: bal, reserved: 0, reservedTotal: 0,
      unpaid: 0, upcoming: 0, unutilised: Math.max(0, bal), unitPrice: 0, estValue: 0,
      lastPurchase: null, lastClass: null, idleDays: 0, dormant: false, trialOnly: false
    };
  }

  // the latest credit added to the family pool (purchase, trial or a manual top-up)
  function lastTopUp(familyId) {
    return db.ledger({ familyId: familyId }).filter(function (l) {
      return l.delta > 0 && (l.type === "purchase" || l.type === "trial" || l.type === "manual");
    })[0] || null;
  }

  // chips describe the FAMILY pool (the same on every sibling's row)
  function statuses(r) {
    var out = [];
    var who = familyLabel(r.family);
    if (r.available < 0) {
      out.push({ label: "Negative balance", kind: "blocked", title: who + " owes " + Admin.plural(-r.available, "credit") });
    } else if (r.available === 0) {
      out.push({ label: "No credits", kind: "muted", title: who + " has no credits left to book with" });
    } else if (r.available <= LOW_CREDITS) {
      out.push({ label: "Low credits", kind: "low", title: who + " has only " + Admin.plural(r.available, "credit") + " left" });
    }
    if (r.dormant) out.push({ label: "Dormant", kind: "warn", title: who + " holds credits, has nothing booked and no class in over " + dormantDays + " days" });
    if (r.trialOnly) out.push({ label: "Trial only", kind: "info", title: "Only the free trial credit — no paid purchases yet" });
    return out;
  }

  function statusChips(r) {
    var list = statuses(r);
    if (!list.length) return "";
    return '<span class="chips stu-status">' + list.map(function (s) {
      return '<span class="chip chip--' + s.kind + ' stu-st" title="' + esc(s.title) + '">' + esc(s.label) + "</span>";
    }).join("") + "</span>";
  }

  // where: "row" (table) or "card" — both layouts are in the page, so ids must differ
  // where: "row" | "card" — ids stay unique because the table and cards are both in the page
  function adjustButtons(r, where) {
    if (!Admin.can("credits") || !Admin.adjustCreditsModal) return "";
    var fam = esc(r.family.id), label = familyLabel(r.family);
    var pre = where === "card" ? "stuCardAdj" : "stuAdj";
    var key = esc(safeId(r.child.id));
    return '<span class="stu-adj">' +
      '<button type="button" class="btn btn--ghost btn--xs stu-adj__btn" id="' + pre + "D-" + key + '" data-stu-adjust="deduct" data-family="' + fam + '"' +
        ' aria-label="' + esc("Deduct credits from " + label) + '" title="' + esc("Deduct from " + label + "’s credits") + '">' +
        Admin.icon("minus") + '<span class="stu-adj__t">Deduct</span></button>' +
      '<button type="button" class="btn btn--ghost btn--xs stu-adj__btn" id="' + pre + "A-" + key + '" data-stu-adjust="add" data-family="' + fam + '"' +
        ' aria-label="' + esc("Add credits to " + label) + '" title="' + esc("Add to " + label + "’s credits") + '">' +
        Admin.icon("plus") + '<span class="stu-adj__t">Add</span></button>' +
    "</span>";
  }

  /* ============================================================
     STUDENT LIST
     ============================================================ */
  function sortsFor() { return SORTS.filter(function (s) { return !s.admin || Admin.isAdmin(); }); }
  function creditFilters() { return CREDIT_FILTERS.filter(function (f) { return f.coach || Admin.isAdmin(); }); }
  function creditFilter(id) { return creditFilters().filter(function (f) { return f.id === id; })[0] || CREDIT_FILTERS[0]; }

  function listState(params) {
    var days = setDormantDays(params.days);
    return {
      days: days,
      q: params.q || "",
      level: db.levels.indexOf(params.level) >= 0 ? params.level : "all",
      prog: params.prog && HC.getProgramme(params.prog) ? params.prog : "all",
      credit: creditFilters().some(function (f) { return f.id === params.credit; }) ? params.credit : "all",
      sort: sortsFor().some(function (s) { return s.value === params.sort; }) ? params.sort : "name",
      mine: !Admin.isAdmin() && params.all !== "1"
    };
  }

  // name / parent / email / phone, plus phone digits typed without spaces ("91234501")
  function matcher(q) {
    q = String(q || "").trim().toLowerCase();
    var digits = q.replace(/[\s+()-]/g, "");
    var phoneQ = /^\d{3,}$/.test(digits) ? digits : "";
    return function (r) {
      if (!q) return true;
      var f = r.family || {};
      if ([r.child.name, f.parentName, f.email, f.phone].join(" ").toLowerCase().indexOf(q) >= 0) return true;
      return !!phoneQ && String(f.phone || "").replace(/\D/g, "").indexOf(phoneQ) >= 0;
    };
  }

  // children with a live booking in a class this coach currently takes
  function myStudentIds() {
    var coach = Admin.staff && Admin.staff.coach;
    var ids = {};
    if (!coach) return ids;
    var occ = occCache();
    db.bookings({ from: db.addDays(db.todayISO(), -MINE_WEEKS * 7) }).forEach(function (b) {
      if (ids[b.childId]) return;
      var o = occ(b.occKey);
      if (o && o.coach === coach) ids[b.childId] = true;
    });
    return ids;
  }

  var SORTERS = {
    name: function () { return 0; },
    credits: function (a, b) { return a.available - b.available; },
    unutilised: function (a, b) { return b.unutilised - a.unutilised; },
    last: function (a, b) { return (b.lastClass || "").localeCompare(a.lastClass || ""); }, // never attended sinks
    rate: function (a, b) {
      var x = a.stats.rate, y = b.stats.rate;
      if (x == null || y == null) return (x == null ? 1 : 0) - (y == null ? 1 : 0);
      return x - y;
    }
  };

  /* One row per active student, carrying their FAMILY's credit figures
     (available, reserved, unutilised, estValue, dormant, trialOnly…).
     lastClass / idleDays are overridden with the child's own. */
  function studentRows() {
    var today = db.todayISO();
    var out = [];
    creditReport().rows.forEach(function (fr) {
      fr.children.forEach(function (ch) {
        var last = db.pastBookings({ childId: ch.id })[0] || null;
        out.push(Object.assign({}, fr, {
          child: ch,
          family: fr.family || {},
          siblings: fr.children.filter(function (k) { return k.id !== ch.id; }),
          famLastClass: fr.lastClass,
          lastClass: last ? last.date : null,
          idleDays: last ? db.daysBetween(last.date, today) : null
        }));
      });
    });
    return out;
  }

  // all = every student · base = after search / level / programme / mine · rows = + credit filter (on the family pool)
  function listRows(st) {
    var all = studentRows();
    var mineIds = st.mine ? myStudentIds() : null;
    var match = matcher(st.q);
    var base = all.filter(function (r) {
      var c = r.child;
      if (st.level !== "all" && c.level !== st.level) return false;
      if (st.prog !== "all" && (c.programmes || []).indexOf(st.prog) < 0) return false;
      if (mineIds && !mineIds[c.id]) return false;
      return match(r);
    });
    var rows = base.filter(creditFilter(st.credit).test).map(function (r) {
      return Object.assign({}, r, {
        family: r.family || {},
        stats: db.attendanceStats(r.child.id),
        next: db.upcomingBookings({ childId: r.child.id })[0] || null
      });
    });
    rows.sort(function (a, b) { return SORTERS[st.sort](a, b) || byName(a.child, b.child); });
    return { all: all, base: base, rows: rows };
  }

  function renderList(el, params) {
    var st = listState(params);
    var isAdmin = Admin.isAdmin();
    var data = listRows(st);
    var fams = {};
    data.all.forEach(function (r) { fams[r.child.familyId] = true; });
    var total = data.all.length;
    var rows = data.rows;

    var narrowed = !!String(st.q).trim() || st.level !== "all" || st.prog !== "all" || st.mine || st.credit !== "all";
    var count = !narrowed
      ? "Showing all " + Admin.plural(total, "student")
      : "Showing " + rows.length + " of " + Admin.plural(total, "student") +
        (st.credit !== "all" ? " · " + creditFilter(st.credit).label.toLowerCase() : "") +
        (st.mine ? " · only students in your classes" : "");

    el.innerHTML =
      h.pageHead({
        title: "Students",
        sub: esc(Admin.plural(total, "student") + " across " +
          Admin.plural(Object.keys(fams).length, "family", "families") +
          (isAdmin ? " · siblings share their family's credits" : "")),
        actions: isAdmin
          ? '<button type="button" class="btn btn--ghost btn--sm" id="stuExport">' + Admin.icon("download") + "Export CSV</button>"
          : ""
      }) +
      toolbarHtml(st) +
      creditBarHtml(st, data.base) +
      '<div class="stu-list" id="stuList">' +
        (isAdmin ? summaryHtml(rows) : "") +
        '<p class="stu-count" id="stuCount">' + esc(count) + "</p>" +
        (rows.length ? tableHtml(rows, st) + cardsHtml(rows) : listEmptyHtml(st)) +
      "</div>";

    bindList(el);
  }

  function toolbarHtml(st) {
    var levels = ["all"].concat(db.levels);
    var progs = [{ value: "all", label: "All programmes" }].concat(HC.programmes.map(function (p) {
      return { value: p.id, label: p.name };
    }));
    return '<div class="toolbar stu-toolbar">' +
        '<div class="toolbar__group stu-toolbar__find">' +
          '<div class="search stu-search">' + Admin.icon("search") +
            '<label class="sr-only" for="stuSearch">Search students</label>' +
            '<input type="search" id="stuSearch" placeholder="Search name, parent, email or phone" autocomplete="off" spellcheck="false" value="' + esc(st.q) + '" />' +
          "</div>" +
          (Admin.isAdmin() ? "" :
            '<label class="check stu-mine" title="Students booked into your classes in the last ' + MINE_WEEKS + ' weeks, or coming up">' +
              '<input type="checkbox" id="stuMine"' + (st.mine ? " checked" : "") + " /> <span>Only my students</span></label>") +
        "</div>" +
        '<div class="toolbar__group stu-toolbar__filters">' +
          '<div class="seg stu-seg" role="group" aria-label="Filter by level">' +
            levels.map(function (l) {
              return '<button type="button" id="stuLevel-' + l + '" data-level="' + l + '" aria-pressed="' + (st.level === l) + '">' +
                (l === "all" ? "All levels" : esc(l)) + "</button>";
            }).join("") +
          "</div>" +
          '<label class="sr-only" for="stuProg">Programme</label>' +
          '<select class="input stu-select" id="stuProg">' + h.options(progs, st.prog) + "</select>" +
          '<label class="sr-only" for="stuSort">Sort by</label>' +
          '<select class="input stu-select" id="stuSort">' + h.options(sortsFor(), st.sort) + "</select>" +
        "</div>" +
      "</div>";
  }

  // counts reflect the other filters, so each button says what it would show
  function creditBarHtml(st, base) {
    var list = creditFilters().filter(function (f) { return !f.hidden || f.id === st.credit; });
    return '<div class="stu-credbar">' +
        '<span class="stu-credbar__k" id="stuCreditLbl">' + Admin.icon("wallet") + "Credits</span>" +
        '<div class="seg stu-seg stu-credseg" role="group" aria-labelledby="stuCreditLbl">' +
          list.map(function (f) {
            var n = base.filter(f.test).length;
            return '<button type="button" id="stuCredit-' + f.id + '" data-credit="' + f.id + '" aria-pressed="' + (st.credit === f.id) + '"' +
              (f.title ? ' title="' + esc(f.title) + '"' : "") + ">" +
              esc(f.label) + '<span class="stu-seg__n">' + n + "</span></button>";
          }).join("") +
        "</div>" +
      "</div>";
  }

  // admin: credit totals for the FAMILIES of the students shown — siblings
  // share one pool, so each family is counted once
  function summaryHtml(rows) {
    var s = { available: 0, reserved: 0, unutilised: 0, estValue: 0, negative: 0, families: 0 };
    var seen = {};
    rows.forEach(function (r) {
      if (seen[r.family.id]) return;
      seen[r.family.id] = true;
      s.families++;
      s.available += Math.max(0, r.available);
      s.reserved += r.reserved;
      s.unutilised += r.unutilised;
      s.estValue += r.estValue;
      if (r.available < 0) s.negative++;
    });
    var cells = [
      ["Families", s.families, Admin.plural(rows.length, "student") + " shown"],
      ["Available", s.available, s.negative ? Admin.plural(s.negative, "family", "families") + " negative, counted as 0" : "ready to book"],
      ["Booked", s.reserved, "held for upcoming classes"],
      ["Unutilised", s.unutilised, "available + booked"],
      ["Est. value", fmt.money(s.estValue), "at each family's paid rate"]
    ];
    var label = "Family credit totals: " + Admin.plural(s.families, "family", "families") + " · " + Admin.plural(rows.length, "student") +
      " (siblings share one pool, counted once)";
    return '<dl class="stu-sum" aria-label="' + esc(label) + '" title="' + esc(label) + '">' + cells.map(function (c, i) {
      return '<div class="stu-sum__cell' + (i === 3 ? " is-key" : "") + '">' +
        '<dt class="stu-sum__k">' + esc(c[0]) + "</dt>" +
        '<dd class="stu-sum__v">' + esc(c[1]) + "</dd>" +
        '<dd class="stu-sum__d">' + esc(c[2]) + "</dd></div>";
    }).join("") + "</dl>";
  }

  function usualShort(ch) {
    return (ch.programmes || []).map(progShort).join(", ");
  }

  function rateHtml(s) {
    if (s.rate == null) return '<span class="muted">—</span>';
    return '<span class="stu-rate' + (s.rate < LOW_RATE ? " stu-rate--low" : "") + '">' + s.rate + "%</span>";
  }

  function medicalFlag(ch) {
    return ch.medical ? ' <span class="stu-med" title="' + esc("Medical: " + ch.medical) + '">' +
      Admin.icon("heart") + '<span class="sr-only">Has a medical note</span></span>' : "";
  }

  // inTable: the level is repeated for narrow admin tables that hide the Level column
  function whoSub(r, inTable) {
    return esc(ageText(r.child)) +
      (inTable ? '<span class="stu-lvl-inline"> · ' + esc(r.child.level) + "</span>" : "") +
      esc(" · " + (r.family.parentName || "No parent")) + medicalFlag(r.child);
  }

  function bookedText(r) {
    var parts = [];
    if (r.reserved) parts.push(r.reserved + " booked");
    if (r.unpaid) parts.push(r.unpaid + " unpaid");
    return parts.join(" · ");
  }

  // under the family pool: who it's shared with, else what's booked
  function creditSub(r) {
    return r.siblings && r.siblings.length ? "shared with " + nameList(r.siblings) : bookedText(r);
  }

  function poolTitle(r) {
    var t = familyLabel(r.family) + "’s credits";
    if (r.siblings && r.siblings.length) t += ", shared by " + nameList([r.child].concat(r.siblings));
    return t + (bookedText(r) ? " · " + bookedText(r) : "");
  }

  function idleText(r) {
    return r.idleDays >= 2 ? r.idleDays + " days idle" : "";
  }

  function lastHtml(r) {
    if (!r.lastClass) return '<span class="muted nowrap">No classes yet</span>';
    var idle = idleText(r);
    return '<div class="cell-main nowrap">' + esc(fmt.date(r.lastClass, "relative")) + "</div>" +
      (idle ? '<div class="cell-sub nowrap' + (r.dormant ? " stu-idle--dormant" : "") + '">' + esc(idle) + "</div>" : "");
  }

  function nextHtml(r) {
    if (!r.next) return '<span class="muted nowrap">None booked</span>';
    return '<div class="cell-main nowrap">' + esc(fmt.date(r.next.date, "relative")) + "</div>" +
      '<div class="cell-sub"><span class="nowrap">' + esc(fmt.time(r.next.time)) + '</span> · <span class="nowrap">' +
        esc(progShort(r.next.programmeId)) + "</span></div>";
  }

  function tableHtml(rows, st) {
    var isAdmin = Admin.isAdmin();
    var canAdjust = Admin.can("credits") && !!Admin.adjustCreditsModal;
    // sortable headers mirror the "Sort by" select
    function th(label, key, cls) {
      var c = cls ? ' class="' + cls + '"' : "";
      if (!key) return '<th scope="col"' + c + ">" + label + "</th>";
      var def = SORTS.filter(function (s) { return s.value === key; })[0];
      var on = st.sort === key;
      return '<th scope="col"' + c + (on ? ' aria-sort="' + def.dir + '"' : "") + ">" +
        '<button type="button" class="sort stu-sort' + (on ? " is-on" : "") + '" id="stuSortBy-' + key + '" data-stu-sort="' + key + '"' +
          ' title="' + esc("Sort by " + def.label.toLowerCase()) + '">' +
          label + Admin.icon("chevron-down") + "</button></th>";
    }
    return '<div class="card stu-flush stu-table' + (isAdmin ? " stu-table--admin" : "") + '">' +
      '<div class="tbl-wrap"><table class="tbl">' +
        '<caption class="sr-only">Students with their family’s credits, attendance and status</caption>' +
        "<thead><tr>" +
          th("Student", "name") + th("Level", null, "stu-c-level") + th("Credits", "credits", "num") +
          (isAdmin ? th("Unutilised", "unutilised", "num") + th("Est. value", null, "num") : "") +
          th("Attendance", "rate", "num") + th("Last class", "last") + th("Next class") + th("Status") +
          (canAdjust ? th('Adjust<span class="sr-only"> credits</span>', null, "stu-c-act") : "") +
        "</tr></thead><tbody>" +
        rows.map(function (r) {
          var ch = r.child;
          var sub = creditSub(r);
          var usual = usualShort(ch);
          var famTip = r.siblings.length ? ' title="' + esc("Family total — shared by " + nameList([ch].concat(r.siblings))) + '"' : "";
          return '<tr class="is-link' + (r.dormant ? " is-dormant" : "") + '" data-open-student="' + esc(ch.id) + '">' +
            '<td class="stu-c-who">' +
              '<button type="button" class="person stu-person" data-open-student="' + esc(ch.id) + '"' +
                ' title="' + esc(ch.name + " · " + ageText(ch) + " · " + ch.level + " · Parent: " + (r.family.parentName || "—")) + '">' +
                h.avatar(ch.name) +
                '<span class="person__text"><span class="person__name">' + esc(ch.name) + "</span>" +
                '<span class="person__sub">' + whoSub(r, true) + "</span></span>" +
              "</button>" +
            "</td>" +
            '<td class="stu-c-level">' + h.levelChip(ch.level) +
              (usual ? '<div class="cell-sub stu-usual stu-hide-md" title="Usual classes">' + esc(usual) + "</div>" : "") + "</td>" +
            '<td class="num stu-c-cred" title="' + esc(poolTitle(r)) + '">' + h.credits(r.available) +
              (sub ? '<div class="cell-sub stu-cred-sub' + (r.siblings.length ? " is-shared" : "") + '">' + esc(sub) + "</div>" : "") + "</td>" +
            (isAdmin
              ? '<td class="num"' + famTip + '><span class="stu-unut">' + r.unutilised + "</span></td>" +
                '<td class="num nowrap"' + famTip + ">" + esc(fmt.money(r.estValue)) + "</td>"
              : "") +
            '<td class="num">' + rateHtml(r.stats) +
              (r.stats.classes ? '<div class="cell-sub nowrap">' + esc(Admin.plural(r.stats.classes, "class", "classes")) + "</div>" : "") + "</td>" +
            '<td class="stu-c-when">' + lastHtml(r) + "</td>" +
            '<td class="stu-c-when">' + nextHtml(r) + "</td>" +
            '<td class="stu-c-status">' + statusChips(r) + "</td>" +
            (canAdjust ? '<td class="stu-c-act">' + adjustButtons(r, "row") + "</td>" : "") +
          "</tr>";
        }).join("") +
        "</tbody></table></div></div>";
  }

  // phone / tablet layout: one card per student
  function cardsHtml(rows) {
    var isAdmin = Admin.isAdmin();
    return '<ul class="stu-cards">' + rows.map(function (r) {
      var ch = r.child;
      var sub = creditSub(r);
      var when = [
        r.lastClass ? "Last: " + fmt.date(r.lastClass, "relative") + (idleText(r) ? " (" + idleText(r) + ")" : "") : "No classes yet",
        r.next ? "Next: " + fmt.date(r.next.date, "relative") + ", " + fmt.time(r.next.time) : "Nothing booked"
      ];
      var adjust = adjustButtons(r, "card");
      return '<li class="stu-card' + (r.dormant ? " is-dormant" : "") + '">' +
        '<button type="button" class="stu-card__main" data-open-student="' + esc(ch.id) + '">' +
          '<span class="stu-card__top">' + h.avatar(ch.name) +
            '<span class="person__text"><span class="person__name">' + esc(ch.name) + "</span>" +
            '<span class="person__sub">' + whoSub(r) + "</span></span>" +
            '<span class="stu-card__cred" title="' + esc(poolTitle(r)) + '">' + h.credits(r.available) +
              '<span class="stu-card__credk">' + esc(sub || "family " + creditWord(r.available)) + "</span></span>" +
          "</span>" +
          '<span class="stu-card__meta">' + h.levelChip(ch.level) +
            '<span class="stu-card__rate">' + rateHtml(r.stats) + (r.stats.rate != null ? " attendance" : "") + "</span>" +
            statusChips(r) +
          "</span>" +
          '<span class="stu-card__when">' + esc(when.join(" · ")) + "</span>" +
        "</button>" +
        (isAdmin
          ? '<div class="stu-card__foot"><span class="stu-card__figs">Family · Unutilised <strong>' + r.unutilised + "</strong>" +
              ' · Est. <strong>' + esc(fmt.money(r.estValue)) + "</strong></span>" + adjust + "</div>"
          : "") +
      "</li>";
    }).join("") + "</ul>";
  }

  function listEmptyHtml(st) {
    var actions = [];
    var filtered = String(st.q).trim() || st.level !== "all" || st.prog !== "all";
    if (filtered || st.credit !== "all") {
      actions.push('<button type="button" class="btn btn--ghost btn--sm" id="stuClear">Clear search &amp; filters</button>');
    }
    if (st.mine) {
      actions.push('<button type="button" class="btn btn--quiet btn--sm" id="stuShowAll">Show all students</button>');
    }
    var desc = st.mine ? "No students in your recent or upcoming classes match. Try the full list."
      : !filtered && st.credit === "dormant" ? "Everyone holding credits has booked a class or attended one in the last " + st.days + " days."
      : !filtered && st.credit === "negative" ? "No student owes credits right now."
      : !filtered && st.credit !== "all" ? "No students fall under this credit filter right now."
      : "Try a different name, email or phone number, or loosen the filters.";
    return h.empty("users", "No students found", esc(desc),
      actions.length ? '<div class="btn-row stu-empty-actions">' + actions.join("") + "</div>" : "");
  }

  // Listeners go on elements this render just created, so re-renders never stack them.
  function bindList(el) {
    var search = el.querySelector("#stuSearch");
    if (search) search.addEventListener("input", function () { Admin.setParams({ q: search.value }); });
    var mine = el.querySelector("#stuMine");
    if (mine) mine.addEventListener("change", function () { Admin.setParams({ all: mine.checked ? "" : "1" }); });
    el.querySelectorAll("[data-level]").forEach(function (b) {
      b.addEventListener("click", function () {
        var l = b.getAttribute("data-level");
        Admin.setParams({ level: l === "all" ? "" : l });
      });
    });
    el.querySelectorAll("[data-credit]").forEach(function (b) {
      b.addEventListener("click", function () {
        var c = b.getAttribute("data-credit");
        Admin.setParams({ credit: c === "all" ? "" : c });
        focusId("stuCredit-" + c);
      });
    });
    var prog = el.querySelector("#stuProg");
    if (prog) prog.addEventListener("change", function () { Admin.setParams({ prog: prog.value === "all" ? "" : prog.value }); });
    var sort = el.querySelector("#stuSort");
    if (sort) sort.addEventListener("change", function () { Admin.setParams({ sort: sort.value === "name" ? "" : sort.value }); });
    el.querySelectorAll("[data-stu-sort]").forEach(function (b) {
      b.addEventListener("click", function () {
        var k = b.getAttribute("data-stu-sort");
        Admin.setParams({ sort: k === "name" ? "" : k });
      });
    });
    var clear = el.querySelector("#stuClear");
    if (clear) {
      clear.addEventListener("click", function () {
        Admin.setParams({ q: "", level: "", prog: "", credit: "", days: "" });
        focusId("stuSearch");
      });
    }
    var showAll = el.querySelector("#stuShowAll");
    if (showAll) {
      showAll.addEventListener("click", function () {
        Admin.setParams({ all: "1" });
        focusId("stuMine");
      });
    }
    var exp = el.querySelector("#stuExport");
    if (exp) exp.addEventListener("click", exportCsv);
    var list = el.querySelector("#stuList");
    if (list) {
      list.addEventListener("click", function (e) {
        var b = e.target.closest("[data-stu-adjust]");
        if (!b) return;
        // the button sits inside a row that opens the student
        e.preventDefault();
        e.stopPropagation();
        if (!Admin.can("credits") || !Admin.adjustCreditsModal) {
          Admin.toast("warn", "Only the studio admin can adjust credits.");
          return;
        }
        Admin.adjustCreditsModal(b.getAttribute("data-family"), b.getAttribute("data-stu-adjust"));
      });
    }
  }

  /* ---------- CSV export (admin) ---------- */
  function csvCell(v, text) {
    var s = v == null ? "" : String(v);
    if (text && /^[=+\-@\t\r]/.test(s)) s = "'" + s; // spreadsheet formula guard
    return /[",\r\n]/.test(s) || /^\s|\s$/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function buildCsv(rows) {
    // credit columns are the FAMILY pool — siblings repeat the same figures
    var head = ["Student", "Age", "Level", "Parent", "Email", "Phone", "Shares credits with",
      "Family credits available", "Family credits booked", "Family unutilised", "Family est. value (S$)",
      "Avg price per credit (S$)", "Attendance %", "Last class", "Idle days", "Next class", "Family credit status"];
    var lines = [head.map(function (x) { return csvCell(x); }).join(",")];
    rows.forEach(function (r) {
      var f = r.family || {};
      lines.push([
        csvCell(r.child.name, true), csvCell(r.child.age), csvCell(r.child.level),
        csvCell(f.parentName, true), csvCell(f.email, true), csvCell(f.phone, true),
        csvCell(r.siblings.map(function (k) { return k.name; }).join("; "), true),
        csvCell(r.available), csvCell(r.reserved), csvCell(r.unutilised),
        csvCell(r.estValue.toFixed(2)), csvCell(r.unitPrice.toFixed(2)),
        csvCell(r.stats.rate == null ? "" : r.stats.rate),
        csvCell(r.lastClass || ""), csvCell(r.idleDays == null ? "" : r.idleDays),
        csvCell(r.next ? r.next.date + " " + r.next.time : ""),
        csvCell(statuses(r).map(function (s) { return s.label; }).join("; "))
      ].join(","));
    });
    return lines.join("\r\n") + "\r\n";
  }

  function exportCsv() {
    if (!Admin.isAdmin()) return;
    var rows = listRows(listState(Admin.params())).rows;
    var U = window.URL || window.webkitURL;
    if (typeof window.Blob === "undefined" || !U || typeof U.createObjectURL !== "function") {
      Admin.toast("warn", "This browser can’t save files. Try Chrome, Safari or Edge.");
      return;
    }
    if (!rows.length) { Admin.toast("warn", "No students to export — clear the filters first."); return; }
    var name = "huacheng-students-" + db.todayISO() + ".csv";
    var blob = new window.Blob(["﻿" + buildCsv(rows)], { type: "text/csv;charset=utf-8" });
    var url = U.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.hidden = true;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      if (a.parentNode) a.parentNode.removeChild(a);
      if (typeof U.revokeObjectURL === "function") U.revokeObjectURL(url);
    }, 1000);
    Admin.toast("ok", "Exported " + Admin.plural(rows.length, "student") + " to " + name);
  }

  Admin.registerView("students", { render: renderList });

  /* ============================================================
     STUDENT PROFILE DRAWER
     ============================================================ */
  // ledgerScope: "family" (whole family's history) | "child" (this child's bookings and refunds)
  var prof = { childId: null, familyId: null, tab: "overview", ledgerAll: false, ledgerScope: "family" };

  Admin.openStudent = function (childId, tab) {
    var ch = db.child(childId);
    if (!ch) { Admin.toast("warn", "Student not found."); return; }
    if (prof.childId !== ch.id) prof.ledgerAll = false;
    if (prof.familyId !== ch.familyId) prof.ledgerScope = "family";
    prof.childId = ch.id;
    prof.familyId = ch.familyId;
    prof.tab = tabValid(tab) ? tab : "overview";
    showProfile();
  };

  /* A parent link sits in a child's row (class roster, credits log…). Remember
     the last one clicked so openFamily keeps that child in view (UX-6), even
     when the caller only passes the family id. */
  var famClick = null;
  document.addEventListener("click", function (e) {
    var f = e.target && e.target.closest && e.target.closest("[data-open-family]");
    famClick = f ? { el: f, at: Date.now() } : null;
  }, true);

  function childFromClick(familyId) {
    var c = famClick;
    famClick = null;
    if (!c || Date.now() - c.at > 1500) return null;
    var id = c.el.getAttribute("data-child") || c.el.getAttribute("data-child-id");
    if (!id) {
      var row = c.el.closest("[data-child], li, tr, .row, article");
      if (row && row.getAttribute("data-child")) id = row.getAttribute("data-child");
      else {
        var link = row && row.querySelector("[data-open-student]");
        id = link && link.getAttribute("data-open-student");
      }
    }
    var ch = id && db.child(id);
    return ch && ch.familyId === familyId ? ch.id : null;
  }

  Admin.openFamily = function (familyId, childId) {
    var f = db.family(familyId);
    if (!f) { Admin.toast("warn", "Family account not found."); return; }
    var pick = childId && db.child(childId);
    if (!pick || pick.familyId !== f.id) pick = db.child(childFromClick(f.id));
    if (!pick) pick = db.children(f.id)[0] || null;
    if (pick) { Admin.openStudent(pick.id, "family"); return; }
    prof.childId = null;
    prof.familyId = f.id;
    prof.tab = "family";
    showProfile();
  };

  function showProfile() {
    bindDrawerOnce();
    Admin.openDrawer({ wide: true, head: profileHead, render: renderProfile });
  }

  function switchTab(tab) {
    if (!tabValid(tab) || !prof.childId) return;
    prof.tab = tab;
    showProfile(); // repaints from the top
    focusId("stuTab-" + tab);
  }

  function profileHead() {
    var ch = prof.childId ? db.child(prof.childId) : null;
    if (!ch) {
      var fam = db.family(prof.familyId);
      return {
        title: fam ? possessive(fam.parentName) + " family" : "Student not found",
        sub: fam ? "<span>Family account · no active children</span>" : ""
      };
    }
    var f = db.family(ch.familyId) || {};
    var dot = '<span class="stu-dot" aria-hidden="true">·</span>';
    var parts = [
      "<span>" + esc(ageText(ch)) + "</span>",
      h.levelChip(ch.level),
      '<button type="button" class="stu-sublink" data-stu-tab="family">' + esc(possessive(f.parentName || "Unknown") + " family") + "</button>"
    ];
    if (ch.medical) parts.push(h.chip("Medical", "warn", ch.medical));
    if (ch.active === false) parts.push(h.chip("Inactive", "muted"));
    return { title: ch.name, sub: parts.join(dot) };
  }

  function renderProfile(body) {
    var ch = prof.childId ? db.child(prof.childId) : null;
    if (!ch) {
      var f = db.family(prof.familyId);
      body.innerHTML = f ? familyHtml(f, null)
        : h.empty("users", "Student not found", "This student may have been removed.");
      return;
    }
    var occ = occCache();
    var counts = {
      classes: db.bookings({ childId: ch.id, includeCancelled: true }).length,
      notes: db.notes({ childId: ch.id }).length
    };
    var panel =
      prof.tab === "classes" ? classesHtml(ch, occ) :
      prof.tab === "credits" ? creditsTabHtml(ch) :
      prof.tab === "notes" ? notesTabHtml(ch, occ) :
      prof.tab === "family" ? familyHtml(db.family(ch.familyId), ch) :
      overviewHtml(ch, occ);
    body.innerHTML = tabsHtml(counts, db.balance(ch.familyId)) +
      '<div class="stu-panel" role="tabpanel" id="stuPanel" aria-labelledby="stuTab-' + prof.tab + '">' + panel + "</div>";
  }

  function tabsHtml(counts, bal) {
    return '<div class="tabs stu-tabs" role="tablist" aria-label="Student profile">' +
      TABS.map(function (t) {
        var on = t.id === prof.tab;
        var n = counts[t.id];
        var badge = n != null ? '<span class="count">' + n + "</span>"
          : t.id === "credits" ? '<span class="count stu-tabcred' + (bal < 0 ? " is-neg" : "") + '" aria-label="' + esc(Admin.plural(bal, "family credit")) + '">' +
              '<span aria-hidden="true">◆' + (bal < 0 ? "−" + Math.abs(bal) : bal) + "</span></span>"
          : "";
        return '<button type="button" role="tab" id="stuTab-' + t.id + '" data-stu-tab="' + t.id + '"' +
          ' aria-selected="' + on + '" aria-controls="stuPanel" tabindex="' + (on ? "0" : "-1") + '">' +
          esc(t.label) + badge + "</button>";
      }).join("") + "</div>";
  }

  function section(title, inner, aside) {
    return '<section class="drawer__section stu-section">' +
      '<h3 class="drawer__section-title"><span>' + esc(title) + "</span>" + (aside || "") + "</h3>" +
      inner + "</section>";
  }

  function notesHint() {
    return '<p class="stu-hint">' + Admin.icon("info") + "<span>" + esc(NOTES_HINT) + " You can read them all here.</span></p>";
  }

  /* ---------- credits card (overview + credits tab) ---------- */
  function adjustBtn(f) {
    if (!Admin.isAdmin()) return "";
    return Admin.adjustCreditsModal
      ? '<button type="button" class="btn btn--ghost btn--sm stu-credit__adj" id="stuAdjust" data-stu-act="adjust" data-family="' + esc(f.id) + '"' +
          ' aria-label="' + esc("Adjust credits for " + familyLabel(f)) + '">' + Admin.icon("wallet") + "Adjust credits</button>"
      : '<button type="button" class="btn btn--ghost btn--sm stu-credit__adj" disabled title="Credit adjustments are not available yet">' + Admin.icon("wallet") + "Adjust credits</button>";
  }

  // The family's ONE shared pool. withLink: a link to the Credits tab (needs a child in view).
  function creditCardHtml(f, withLink) {
    var r = familyRow(f.id);
    var isAdmin = Admin.isAdmin();
    var kids = r.children || [];
    var top = lastTopUp(f.id);
    var booked = r.reservedTotal ? Admin.plural(r.reservedTotal, "credit") + " · " + Admin.plural(r.upcoming, "class", "classes") : "Nothing booked";
    if (r.reservedTotal && kids.length > 1) {
      booked += " (" + kids.map(function (k) {
        return firstName(k.name) + " " + db.upcomingBookings({ childId: k.id }).length;
      }).join(", ") + ")";
    }
    var facts = [
      ["Booked, not yet used", booked],
      ["Last top-up", top ? fmt.date(top.at.slice(0, 10), "relative") + " · +" + top.delta + " (" + (LEDGER_TYPES[top.type] || top.type).toLowerCase() + ")" : "None yet"]
    ];
    if (isAdmin) facts.push(["Est. value", fmt.money(r.estValue) + (r.unutilised ? " · " + Admin.plural(r.unutilised, "credit") + " unused" : "")]);
    return '<div class="stu-credit' + (r.available < 0 ? " is-neg" : "") + '">' +
      '<div class="stu-credit__main">' +
        '<p class="stat__k">Family credits</p>' +
        '<p class="stu-credit__n">' + h.credits(r.available) +
          '<span class="stu-credit__unit">' + creditWord(r.available) + " available</span></p>" +
        '<p class="stu-credit__who">' + esc(familyLabel(f) + (kids.length > 1 ? " · shared by " + nameList(kids) : "")) + "</p>" +
        (r.available < 0 ? '<p class="stu-credit__warn">' + esc("Owes " + Admin.plural(-r.available, "credit") + " — follow up on payment.") + "</p>" : "") +
        (isAdmin ? "" : '<p class="stu-credit__hint">Only admins can adjust credits.</p>') +
      "</div>" +
      '<dl class="stu-credit__facts">' + facts.map(function (x) {
        return "<div><dt>" + esc(x[0]) + "</dt><dd>" + esc(x[1]) + "</dd></div>";
      }).join("") + "</dl>" +
      '<div class="stu-credit__acts">' + adjustBtn(f) +
        (withLink ? '<button type="button" class="btn btn--quiet btn--sm" data-stu-tab="credits">Family credit history' + Admin.icon("chevron-right") + "</button>" : "") +
      "</div>" +
    "</div>";
  }

  /* ---------- overview ---------- */
  function overviewHtml(ch, occ) {
    var s = db.attendanceStats(ch.id);
    var upcoming = db.upcomingBookings({ childId: ch.id });
    var notes = db.notes({ childId: ch.id });
    var canBook = ch.active !== false;

    var actions = '<div class="btn-row stu-actions">' +
      '<button type="button" class="btn btn--primary btn--sm" data-stu-act="book"' +
        (canBook ? "" : ' disabled title="This student is inactive"') + ">" + Admin.icon("plus") + "Book into a class</button>" +
      (canAddGeneralNote() ? '<button type="button" class="btn btn--ghost btn--sm" data-stu-act="add-note">' + Admin.icon("note") + "Add note</button>" : "") +
    "</div>";

    var upHtml = upcoming.length
      ? '<div class="card stu-flush"><div class="rows">' + upcoming.slice(0, 5).map(function (b) {
          return upcomingRow(b, occ(b.occKey));
        }).join("") + "</div></div>"
      : h.empty("calendar", "No upcoming classes", esc(firstName(ch.name) + " isn't booked into anything yet."));

    var more = upcoming.length > 5
      ? '<button type="button" class="btn btn--quiet btn--xs" data-stu-tab="classes">All ' + upcoming.length + " upcoming</button>" : "";

    var notesHtml = notes.length
      ? '<div class="stu-notes">' + notes.slice(0, 3).map(function (n) { return noteHtml(n, occ, false); }).join("") + "</div>"
      : '<p class="muted stu-none">No remarks yet.</p>';
    var allNotes = notes.length > 3
      ? '<button type="button" class="btn btn--quiet btn--xs" data-stu-tab="notes">View all ' + notes.length + "</button>" : "";

    var usual = ch.programmes && ch.programmes.length
      ? '<div class="chips">' + ch.programmes.map(function (id) {
          var p = HC.getProgramme(id);
          return h.chip(progName(id), p ? String(p.level).toLowerCase() : "muted");
        }).join("") + "</div>"
      : '<p class="muted stu-none">None set.</p>';

    var medical = ch.medical
      ? h.notice("warn", "<p>" + esc(ch.medical) + "</p>")
      : '<p class="muted stu-none">Nothing recorded.</p>';

    return actions +
      section("Credits", creditCardHtml(db.family(ch.familyId) || { id: ch.familyId }, true)) +
      section("Attendance", statsHtml(s)) +
      section("Next classes", upHtml, more) +
      section("Latest remarks", (Admin.isAdmin() ? notesHint() : "") + notesHtml, allNotes) +
      '<div class="grid-2 stu-grid">' +
        section("Usual classes", usual) +
        section("Medical note", medical) +
      "</div>";
  }

  function statsHtml(s) {
    function stat(k, v, d, cls) {
      return '<div class="stat' + (cls ? " " + cls : "") + '"><p class="stat__k">' + esc(k) + "</p>" +
        '<p class="stat__v">' + v + "</p>" + (d ? '<p class="stat__d">' + esc(d) + "</p>" : "") + "</div>";
    }
    return '<div class="stats stu-stats">' +
      stat("Classes", s.classes, s.unmarked ? s.unmarked + " not marked" : "so far") +
      stat("Present", s.present) +
      stat("Late", s.late) +
      stat("Absent", s.absent) +
      stat("Attendance", s.rate == null ? "—" : s.rate + "<small>%</small>",
        s.rate == null ? "nothing marked yet" : "present or late",
        s.rate != null && s.rate < LOW_RATE ? "stat--alert" : "") +
    "</div>";
  }

  function extraOccChips(o) {
    if (!o) return "";
    var out = [];
    if (o.oneOff) out.push(h.chip("One-off", "oneoff", o.note));
    if (o.substituted) out.push(h.chip("Cover: " + o.coach, "sub", "Timetabled coach: " + o.originalCoach));
    return out.join("");
  }

  function upcomingRow(b, o) {
    return '<button type="button" class="row stu-uprow" data-open-class="' + esc(b.occKey) + '">' +
      '<span class="stu-when"><strong>' + esc(fmt.date(b.date, "relative")) + "</strong>" +
        "<span>" + esc(fmt.time(b.time)) + "</span></span>" +
      '<span class="row__main"><span class="row__title">' + esc(progName(b.programmeId)) + "</span>" +
        '<span class="row__meta">' + esc(o ? fmt.timeRange(o) + " · " + o.coach : fmt.date(b.date, "full")) + "</span></span>" +
      '<span class="row__aside chips">' + extraOccChips(o) + (b.cost === 0 ? h.chip("No charge", "muted") : "") + "</span>" +
    "</button>";
  }

  /* ---------- classes ---------- */
  function classesHtml(ch, occ) {
    var list = db.bookings({ childId: ch.id, includeCancelled: true, desc: true });
    var head = '<div class="btn-row stu-actions">' +
      '<button type="button" class="btn btn--primary btn--sm" data-stu-act="book"' +
        (ch.active === false ? ' disabled title="This student is inactive"' : "") + ">" + Admin.icon("plus") + "Book into a class</button></div>";
    if (!list.length) {
      return head + h.empty("calendar", "No classes yet", esc(firstName(ch.name) + " hasn't been booked into any classes."));
    }
    var upcoming = [], past = [];
    list.forEach(function (b) { (bookingStarted(b, occ(b.occKey)) ? past : upcoming).push(b); });
    upcoming.reverse(); // soonest first
    var cancelled = list.filter(function (b) { return b.status === "cancelled"; }).length;
    var summary = '<p class="stu-count">' + esc(Admin.plural(upcoming.filter(active).length, "upcoming class", "upcoming classes") + " · " +
      Admin.plural(past.filter(active).length, "past class", "past classes") +
      (cancelled ? " · " + cancelled + " cancelled" : "")) + "</p>";
    return head + summary +
      (upcoming.length ? section("Upcoming", '<div class="card stu-flush stu-crows">' + upcoming.map(function (b) { return classRow(b, ch, occ); }).join("") + "</div>") : "") +
      (past.length ? section("Past", '<div class="card stu-flush stu-crows">' + past.map(function (b) { return classRow(b, ch, occ); }).join("") + "</div>") : "");
  }

  function active(b) { return b.status === "booked"; }

  function classRow(b, ch, occ) {
    var o = occ(b.occKey);
    var started = bookingStarted(b, o);
    var cancelled = b.status === "cancelled";
    var canManage = !!o && Admin.can("manage", o);
    var canRemark = !!o && Admin.can("notes", o);
    var note = db.noteForBooking(b.id);
    var status = "";

    if (cancelled) {
      status = h.chip(b.cancelKind === "removed" ? "Removed" : "Cancelled", "muted") +
        (b.refunded ? h.chip("Refunded", "ok") : b.cost > 0 ? h.chip("No refund", "warn") : "");
    } else if (!started) {
      status = h.chip("Upcoming", "open");
    } else if (canManage) {
      status = attToggle(b, ch);
    } else {
      status = h.attendanceChip(b.attendance);
    }

    var noteBtn = "";
    if (note) {
      noteBtn = canWriteNote(note)
        ? '<button type="button" class="btn btn--icon btn--sm btn--ghost stu-notebtn has-note" id="stuNoteB-' + esc(b.id) + '" data-stu-act="edit-note" data-note="' + esc(note.id) + '" aria-label="Edit remark for this class" title="Edit remark">' + Admin.icon("note") + "</button>"
        : '<span class="stu-noteflag" title="' + esc("Remark by " + db.actorName(note.by) + (note.shared ? " (shared with parent)" : " (staff only)")) + '">' + Admin.icon("note") + '<span class="sr-only">Has a coach remark</span></span>';
    } else if (!cancelled && started && canRemark) {
      noteBtn = '<button type="button" class="btn btn--icon btn--sm btn--ghost stu-notebtn" id="stuNoteB-' + esc(b.id) + '" data-stu-act="note-booking" data-booking="' + esc(b.id) + '" aria-label="Add remark for this class" title="Add remark">' + Admin.icon("note") + "</button>";
    }

    return '<div class="stu-crow is-link' + (cancelled ? " is-cancelled" : "") + '" data-open-class="' + esc(b.occKey) + '">' +
      '<div class="stu-when"><strong>' + esc(fmt.date(b.date)) + "</strong><span>" + esc(fmt.time(b.time)) + "</span></div>" +
      '<div class="stu-crow__main">' +
        '<button type="button" class="stu-link stu-crow__title" data-open-class="' + esc(b.occKey) + '">' + esc(progName(b.programmeId)) + "</button>" +
        '<div class="stu-crow__meta">' + esc(o ? o.coach : "") + extraOccChips(o) +
          (b.cost === 0 && !cancelled ? h.chip("No charge", "muted") : "") + "</div>" +
        (cancelled && b.cancelReason ? '<div class="stu-crow__reason">' + esc(b.cancelReason) + "</div>" : "") +
      "</div>" +
      '<div class="stu-crow__aside">' + status + noteBtn + "</div>" +
    "</div>";
  }

  function attToggle(b, ch) {
    return '<div class="att" role="group" aria-label="' + esc("Attendance for " + ch.name + ", " + fmt.date(b.date)) + '">' +
      db.attendanceStatuses.map(function (a) {
        var on = b.attendance === a.id;
        return '<button type="button" id="stuAtt-' + esc(b.id) + "-" + a.id + '" data-att="' + a.id + '" data-stu-att="' + a.id + '" data-booking="' + esc(b.id) + '"' +
          ' aria-pressed="' + on + '" title="' + (on ? "Marked " + a.label.toLowerCase() + " — click to clear" : "Mark " + a.label.toLowerCase()) + '">' +
          esc(a.label) + "</button>";
      }).join("") + "</div>";
  }

  /* ---------- credits tab: the FAMILY's history ---------- */
  // booking / refund reasons end with " · <child name>" — the child chip says it instead
  function ledgerText(l, kid) {
    var t = String(l.reason || LEDGER_TYPES[l.type] || "");
    if (!kid) return t;
    var tail = " · " + kid.name;
    return t.slice(-tail.length) === tail ? t.slice(0, -tail.length) : t;
  }

  function creditsTabHtml(ch) {
    var f = db.family(ch.familyId) || { id: ch.familyId, parentName: "" };
    var kids = {};
    db.children(f.id, { includeInactive: true }).forEach(function (k) { kids[k.id] = k; });
    var all = db.ledgerWithBalance(f.id);
    var mineOnly = prof.ledgerScope === "child";
    var list = mineOnly ? all.filter(function (l) { return l.childId === ch.id; }) : all;
    var shown = prof.ledgerAll ? list : list.slice(0, LEDGER_PAGE);
    var isAdmin = Admin.isAdmin();
    var name = firstName(ch.name);
    var nMine = all.filter(function (l) { return l.childId === ch.id; }).length;

    var scope = '<div class="stu-ledger-bar">' +
      '<div class="seg stu-seg" role="group" aria-label="Show credit history for">' +
        '<button type="button" id="stuLedgerScope-family" data-stu-act="ledger-scope" data-scope="family" aria-pressed="' + !mineOnly + '">' +
          'Whole family<span class="stu-seg__n">' + all.length + "</span></button>" +
        '<button type="button" id="stuLedgerScope-child" data-stu-act="ledger-scope" data-scope="child" aria-pressed="' + mineOnly + '">' +
          esc(name + " only") + '<span class="stu-seg__n">' + nMine + "</span></button>" +
      "</div>" +
      (mineOnly ? '<p class="stu-hint stu-hint--inline">' + Admin.icon("info") + "<span>" +
        esc(possessive(name) + " bookings and refunds. Purchases and adjustments go to the whole family.") + "</span></p>" : "") +
    "</div>";

    var table = list.length
      ? '<div class="card stu-flush"><div class="tbl-wrap"><table class="tbl stu-ledger">' +
          '<caption class="sr-only">' + esc(familyLabel(f) + " credit history" + (mineOnly ? ", " + possessive(ch.name) + " entries only" : "") + ", newest first") + "</caption>" +
          '<thead><tr><th scope="col">Date</th><th scope="col">Description</th><th scope="col" class="num">Change</th><th scope="col" class="num">Family balance</th></tr></thead><tbody>' +
          shown.map(function (l) {
            var manual = l.type === "manual";
            var kid = l.childId ? kids[l.childId] : null;
            var sub = [LEDGER_TYPES[l.type] || l.type, (manual ? "by " : "") + db.actorName(l.by)];
            if (isAdmin && l.amount > 0) sub.push(fmt.money(l.amount) + " paid");
            var chip = kid
              ? '<span class="chip chip--' + (kid.id === ch.id ? "info" : "muted") + ' stu-ledger__kid" title="' + esc(kid.name) + '">' + esc(firstName(kid.name)) + "</span>"
              : "";
            return '<tr class="stu-ledger__row is-' + esc(l.type) + '">' +
              '<td class="nowrap">' + esc(fmt.date(l.at.slice(0, 10), "relative")) + '<div class="cell-sub">' + esc(fmt.time(l.at.slice(11, 16) || "00:00")) + "</div></td>" +
              "<td>" + chip + '<span class="stu-ledger__what">' + esc(ledgerText(l, kid)) + "</span>" +
                (l.note ? '<div class="stu-ledger__note">“' + esc(l.note) + "”</div>" : "") +
                '<div class="cell-sub">' +
                  // phones hide the date column, so repeat it here
                  '<span class="stu-ledger__when">' + esc(fmt.stamp(l.at)) + " · </span>" +
                  esc(sub.join(" · ")) + "</div></td>" +
              '<td class="num"><span class="stu-delta ' + (l.delta < 0 ? "is-neg" : "is-pos") + '">' + esc(fmt.signed(l.delta)) + "</span></td>" +
              '<td class="num">' + h.credits(l.balanceAfter) + "</td>" +
            "</tr>";
          }).join("") +
        "</tbody></table></div></div>" +
        (list.length > shown.length
          ? '<div class="stu-more"><button type="button" class="btn btn--quiet btn--sm" id="stuLedgerAll" data-stu-act="ledger-all">Show all ' + list.length + " entries</button></div>"
          : "")
      : mineOnly
        ? h.empty("wallet", "Nothing for " + name + " yet", esc(name + " hasn't used any of the family's credits yet."), "", "sm")
        : h.empty("wallet", "No credit activity yet", esc(familyLabel(f) + " hasn't bought, used or been given any credits."), "", "sm");
    return section("Balance", creditCardHtml(f, false)) +
      section("Family credit history", scope + table,
        list.length ? '<span class="stu-section__n">' + esc(Admin.plural(list.length, "entry", "entries")) + "</span>" : "");
  }

  /* ---------- notes (remarks) ---------- */
  function notesTabHtml(ch, occ) {
    var list = db.notes({ childId: ch.id });
    var add = canAddGeneralNote()
      ? '<button type="button" class="btn btn--ghost btn--sm" data-stu-act="add-note">' + Admin.icon("plus") + "Add note</button>" : "";
    var hint = Admin.isAdmin() ? notesHint() : "";
    if (!list.length) {
      return (add ? '<div class="btn-row stu-actions">' + add + "</div>" : "") + hint +
        h.empty("note", "No remarks yet", esc("Coaches' ratings and feedback on " + possessive(firstName(ch.name)) + " classes will show here."));
    }
    var shared = list.filter(function (n) { return n.shared; }).length;
    return '<div class="stu-notes-head"><p class="stu-count">' +
        esc(Admin.plural(list.length, "remark") + " · " + shared + " shared with parent") + "</p>" + add + "</div>" + hint +
      '<div class="stu-notes stu-timeline">' + list.map(function (n) { return noteHtml(n, occ, true); }).join("") + "</div>";
  }

  function noteHtml(n, occ, withActions) {
    var o = n.occKey ? occ(n.occKey) : null;
    var where = n.occKey
      ? '<button type="button" class="stu-link" data-open-class="' + esc(n.occKey) + '">' +
          esc(progName(n.programmeId) + (o ? " · " + fmt.time(o.time) : "")) + "</button>"
      : '<span class="muted">General note</span>';
    var actions = "";
    if (withActions && canWriteNote(n)) {
      actions = '<span class="btn-row stu-note__actions">' +
        '<button type="button" class="btn btn--quiet btn--xs" id="stuNoteEdit-' + esc(n.id) + '" data-stu-act="edit-note" data-note="' + esc(n.id) + '">' + Admin.icon("edit") + "Edit</button>" +
        '<button type="button" class="btn btn--quiet btn--xs stu-danger" id="stuNoteDel-' + esc(n.id) + '" data-stu-act="delete-note" data-note="' + esc(n.id) + '">' + Admin.icon("trash") + "Delete</button>" +
      "</span>";
    }
    return '<article class="stu-note">' +
      '<header class="stu-note__head">' +
        '<span class="stu-note__date">' + esc(fmt.date(n.date, "full")) + "</span>" + where +
        '<span class="stu-note__vis">' + (n.shared ? h.chip("Shared", "ok", "Visible to the parent") : h.chip("Staff only", "muted", "Not visible to the parent")) + "</span>" +
      "</header>" +
      (n.rating ? '<div class="stu-note__rating">' + h.rating(n.rating) + "</div>" : "") +
      (n.text ? '<p class="stu-note__text">' + esc(n.text) + "</p>" : "") +
      '<footer class="stu-note__foot"><span>' + esc(db.actorName(n.by) + " · " + fmt.stamp(n.at) +
        (n.updatedAt ? " · edited" + (n.updatedBy && n.updatedBy !== n.by ? " by " + db.actorName(n.updatedBy) : "") : "")) + "</span>" +
        actions +
      "</footer>" +
    "</article>";
  }

  /* ---------- family: contact, the shared credit pool (once), children ---------- */
  function familyHtml(f, ch) {
    if (!f) return h.empty("users", "Family account not found", "");
    var isAdmin = Admin.isAdmin();
    var since = f.createdAt ? fmt.date(f.createdAt.slice(0, 10), "full") : "—";
    var kids = db.children(f.id);

    var parent = '<div class="card stu-fam">' +
      '<div class="stu-fam__who">' + h.avatar(f.parentName, "lg") +
        '<div class="person__text"><p class="stu-fam__name">' + esc(f.parentName) + "</p>" +
        '<p class="person__sub">Parent · account since ' + esc(since) + "</p></div>" +
      "</div>" +
      '<dl class="kv stu-fam__kv">' +
        "<dt>Email</dt><dd>" + (f.email ? '<a class="stu-link" href="mailto:' + esc(f.email) + '">' + esc(f.email) + "</a>" : "—") + "</dd>" +
        "<dt>Phone</dt><dd>" + (f.phone ? '<a class="stu-link" href="' + esc(telHref(f.phone)) + '">' + esc(f.phone) + "</a>" : "—") + "</dd>" +
      "</dl>" +
    "</div>";

    var kidsHtml = kids.length
      ? '<div class="card stu-flush"><div class="rows">' + kids.map(function (k) {
          var current = ch && k.id === ch.id;
          var meta = [ageText(k), k.level].concat(k.programmes && k.programmes.length ? [k.programmes.map(progShort).join(", ")] : []);
          var next = db.upcomingBookings({ childId: k.id }).length;
          var inner = h.avatar(k.name, "sm") +
            '<span class="row__main"><span class="row__title">' + esc(k.name) + "</span>" +
            '<span class="row__meta">' + esc(meta.join(" · ")) + "</span></span>";
          var upc = '<span class="stu-kid__next">' + esc(next ? Admin.plural(next, "class", "classes") + " booked" : "Nothing booked") + "</span>";
          if (current) {
            return '<div class="row stu-kid is-current">' + inner +
              '<span class="row__aside">' + upc + h.chip("Viewing", "info") +
                '<button type="button" class="btn btn--ghost btn--xs" id="stuEditChild" data-stu-act="edit-child">' + Admin.icon("edit") + "Edit details</button>" +
              "</span></div>";
          }
          return '<button type="button" class="row stu-kid" data-open-student="' + esc(k.id) + '">' + inner +
            '<span class="row__aside">' + upc + Admin.icon("chevron-right") + "</span></button>";
        }).join("") + "</div></div>"
      : '<p class="muted stu-none">No active children on this account.</p>';

    var addChild = isAdmin
      ? '<button type="button" class="btn btn--quiet btn--xs" id="stuAddChild" data-stu-act="add-child" data-family="' + esc(f.id) + '">' + Admin.icon("plus") + "Add child</button>"
      : "";

    return section("Parent / guardian", parent) +
      section("Credits", creditCardHtml(f, !!ch)) +
      section("Children", kidsHtml, addChild);
  }

  /* ============================================================
     DRAWER EVENTS — one delegated listener on #drawer, since the
     drawer body is repainted on every data change
     ============================================================ */
  var drawerBound = false;

  function bindDrawerOnce() {
    if (drawerBound) return;
    var d = document.getElementById("drawer");
    if (!d) return;
    drawerBound = true;
    d.addEventListener("click", onDrawerClick);
    d.addEventListener("keydown", onDrawerKey);
  }

  function onDrawerClick(e) {
    var t = e.target.closest("[data-stu-tab], [data-stu-att], [data-stu-act]");
    if (!t || t.disabled) return;
    // these sit inside class rows: keep the core from also opening the class
    e.stopPropagation();
    e.preventDefault();

    if (t.hasAttribute("data-stu-tab")) { switchTab(t.getAttribute("data-stu-tab")); return; }
    if (t.hasAttribute("data-stu-att")) { toggleAttendance(t.getAttribute("data-booking"), t.getAttribute("data-stu-att")); return; }

    var n;
    switch (t.getAttribute("data-stu-act")) {
      case "book":
        Admin.bookChildModal(prof.childId);
        break;
      case "add-note":
        if (!canAddGeneralNote()) { Admin.toast("info", NOTES_HINT); return; }
        openNoteModal({ childId: prof.childId });
        break;
      case "note-booking":
        noteForBookingModal(t.getAttribute("data-booking"));
        break;
      case "edit-note":
        n = findNote(t.getAttribute("data-note"));
        if (!n) return;
        if (!canWriteNote(n)) { Admin.toast("warn", "Only " + noteOwner(n) + " can edit this remark."); return; }
        openNoteModal({ childId: n.childId, note: n });
        break;
      case "delete-note":
        deleteNote(t.getAttribute("data-note"));
        break;
      case "edit-child":
        openChildModal({ child: db.child(prof.childId) });
        break;
      case "add-child":
        if (!Admin.isAdmin()) return;
        openChildModal({ familyId: t.getAttribute("data-family") });
        break;
      case "adjust":
        if (!Admin.can("credits") || !Admin.adjustCreditsModal) { Admin.toast("warn", "Only the studio admin can adjust credits."); return; }
        Admin.adjustCreditsModal(t.getAttribute("data-family") || prof.familyId);
        break;
      case "ledger-scope":
        prof.ledgerScope = t.getAttribute("data-scope") === "child" ? "child" : "family";
        prof.ledgerAll = false;
        Admin.refresh();
        focusId("stuLedgerScope-" + prof.ledgerScope);
        break;
      case "ledger-all":
        prof.ledgerAll = true;
        Admin.refresh();
        break;
    }
  }

  // arrow keys move between profile tabs
  function onDrawerKey(e) {
    var t = e.target.closest && e.target.closest('[role="tab"][data-stu-tab]');
    if (!t) return;
    var i = TABS.map(function (x) { return x.id; }).indexOf(prof.tab);
    var next = null;
    if (e.key === "ArrowRight") next = TABS[(i + 1) % TABS.length];
    else if (e.key === "ArrowLeft") next = TABS[(i + TABS.length - 1) % TABS.length];
    else if (e.key === "Home") next = TABS[0];
    else if (e.key === "End") next = TABS[TABS.length - 1];
    if (!next) return;
    e.preventDefault();
    switchTab(next.id);
  }

  function toggleAttendance(bookingId, status) {
    var b = db.booking(bookingId);
    if (!b || b.status !== "booked") return;
    var o = db.occurrence(b.occKey);
    if (!o || !Admin.can("manage", o)) {
      Admin.toast("warn", "Only " + (o ? o.coach : "the class coach") + " or an admin can mark this class.");
      return;
    }
    if (!o.started) { Admin.toast("warn", "Attendance opens once the class starts."); return; }
    var next = b.attendance === status ? null : status;
    var ch = db.child(b.childId);
    var who = ch ? firstName(ch.name) : "Student";
    Admin.check(db.setAttendance(b.id, next, { by: Admin.by() }),
      next ? who + " marked " + next + "." : "Attendance cleared for " + who + ".");
  }

  function findNote(id) {
    return db.notes({}).filter(function (n) { return n.id === id; })[0] || null;
  }

  function noteForBookingModal(bookingId) {
    var b = db.booking(bookingId);
    if (!b) return;
    var o = db.occurrence(b.occKey);
    var existing = db.noteForBooking(b.id);
    if (existing) {
      if (!canWriteNote(existing)) { Admin.toast("warn", "Only " + noteOwner(existing) + " can edit this remark."); return; }
      openNoteModal({ childId: b.childId, note: existing });
      return;
    }
    if (!o || !Admin.can("notes", o)) {
      Admin.toast("warn", Admin.isAdmin() ? "Remarks are written by the class coach." : "Only " + (o ? o.coach : "the class coach") + " can add remarks for this class.");
      return;
    }
    openNoteModal({ childId: b.childId, booking: b });
  }

  function deleteNote(id) {
    var n = findNote(id);
    if (!n) return;
    if (!canWriteNote(n)) { Admin.toast("warn", "Only " + noteOwner(n) + " can delete this remark."); return; }
    var ch = db.child(n.childId);
    var f = ch && db.family(ch.familyId);
    var body = n.shared
      ? "<p>This note was shared, so it will also disappear from " + esc(f ? possessive(f.parentName) : "the parent's") + " portal.</p>"
      : "<p>This note is staff-only, so the parent never saw it.</p>";
    Admin.confirm({
      title: "Delete this note?",
      body: body + "<p>This can't be undone.</p>",
      confirmLabel: "Delete note",
      danger: true
    }).then(function (yes) {
      if (!yes) return;
      Admin.check(db.deleteNote(id, { by: Admin.by() }), "Note deleted.");
    });
  }

  /* ============================================================
     NOTE MODAL — add (general or class) / edit
     opts: { childId, note?, booking? }
     ============================================================ */
  function openNoteModal(opts) {
    var ch = db.child(opts.childId);
    if (!ch) return;
    var n = opts.note || null;
    // remarks are the coach's job (see canWriteNote)
    if (n ? !canWriteNote(n) : opts.booking ? !Admin.can("notes", db.occurrence(opts.booking.occKey)) : !canAddGeneralNote()) {
      Admin.toast("warn", NOTES_HINT);
      return;
    }
    var bookingId = n ? n.bookingId : opts.booking ? opts.booking.id : null;
    var b = bookingId ? db.booking(bookingId) : null;
    var rating = n && n.rating ? n.rating : "";
    var context = b
      ? progName(b.programmeId) + " · " + fmt.date(b.date, "full") + " " + fmt.time(b.time)
      : "General note — not linked to a class";

    var scale = [{ v: "", label: "No rating" }].concat(db.noteScale);
    var body =
      '<form id="stuNoteForm" novalidate>' +
        '<p class="stu-modal-context">' + Admin.icon(b ? "calendar" : "note") + "<span>" + esc(context) + "</span></p>" +
        '<fieldset class="field stu-fieldset">' +
          '<legend class="field__label">Rating <span class="field__opt">(optional)</span></legend>' +
          '<div class="rate-pick">' + scale.map(function (s) {
            return '<label><input type="radio" name="stuNoteRating" id="stuNoteRating-' + (s.v || 0) + '" value="' + s.v + '"' +
              (String(s.v) === String(rating) ? " checked" : "") + " />" +
              (s.v ? '<span class="stu-rate-n" aria-hidden="true">' + s.v + "</span>" : "") + esc(s.label) + "</label>";
          }).join("") + "</div>" +
        "</fieldset>" +
        '<div class="field">' +
          '<label for="stuNoteText">Note</label>' +
          '<textarea id="stuNoteText" rows="4" maxlength="1000" placeholder="What went well, what to work on next…">' + esc(n ? n.text : "") + "</textarea>" +
          '<p class="field-error" id="stuNoteErr" role="alert"></p>' +
        "</div>" +
        '<label class="check stu-share"><input type="checkbox" id="stuNoteShared"' + (n && n.shared ? " checked" : "") + " />" +
          "<span><strong>Share with " + esc(firstName((db.family(ch.familyId) || {}).parentName || "the parent")) + "</strong> — shows in the parent portal. Leave unticked to keep it staff-only.</span></label>" +
        '<button type="submit" hidden tabindex="-1" aria-hidden="true"></button>' +
      "</form>";

    Admin.openModal({
      title: (n ? (n.occKey ? "Edit remark" : "Edit note") : b ? "Add remark" : "Add note") + " · " + ch.name,
      body: body,
      actions:
        '<button type="button" class="btn btn--ghost" data-close>Cancel</button>' +
        '<button type="button" class="btn btn--primary" id="stuNoteSave">' + (n ? "Save changes" : "Save note") + "</button>",
      onOpen: function (card) {
        var form = card.querySelector("#stuNoteForm");
        var text = card.querySelector("#stuNoteText");
        var err = card.querySelector("#stuNoteErr");
        function save(e) {
          if (e) e.preventDefault();
          var picked = form.querySelector('input[name="stuNoteRating"]:checked');
          var r = picked && picked.value ? +picked.value : null;
          var value = text.value.trim();
          if (!value && !r) {
            text.classList.add("invalid");
            text.setAttribute("aria-invalid", "true");
            err.textContent = "Add a rating or write a note.";
            text.focus();
            return;
          }
          var res = db.saveNote({
            id: n ? n.id : undefined,
            childId: ch.id,
            bookingId: bookingId,
            rating: r,
            text: value,
            shared: card.querySelector("#stuNoteShared").checked
          }, { by: Admin.by() });
          if (!res.ok) { err.textContent = res.error; }
          if (Admin.check(res, n ? "Note updated." : "Note added for " + firstName(ch.name) + ".")) Admin.closeModal();
        }
        form.addEventListener("submit", save);
        card.querySelector("#stuNoteSave").addEventListener("click", save);
        text.addEventListener("input", function () {
          text.classList.remove("invalid");
          text.removeAttribute("aria-invalid");
          err.textContent = "";
        });
        form.querySelectorAll('input[name="stuNoteRating"]').forEach(function (r) {
          r.addEventListener("change", function () { if (r.value) { err.textContent = ""; text.classList.remove("invalid"); } });
        });
        setTimeout(function () { if (document.activeElement !== text && card.contains(text)) text.focus(); }, 0);
      }
    });
  }

  /* ============================================================
     CHILD MODAL — edit (staff) / add to a family (admin)
     opts: { child } | { familyId }
     ============================================================ */
  function openChildModal(opts) {
    var c = opts.child || null;
    var familyId = c ? c.familyId : opts.familyId;
    var f = db.family(familyId);
    if (!f || (opts.child === null)) return;
    var data = c || { name: "", age: "", level: "Junior", programmes: [], medical: "" };

    var body =
      '<form id="stuChildForm" novalidate>' +
        '<div class="field-row">' +
          '<div class="field"><label for="stuChildName">Name</label>' +
            '<input type="text" id="stuChildName" autocomplete="off" maxlength="80" value="' + esc(data.name) + '" />' +
            '<p class="field-error" id="stuChildNameErr" role="alert"></p></div>' +
          '<div class="field"><label for="stuChildAge">Age <span class="field__opt">(optional)</span></label>' +
            '<input type="number" id="stuChildAge" inputmode="numeric" min="3" max="99" step="1" value="' + esc(data.age) + '" />' +
            '<p class="field-error" id="stuChildAgeErr" role="alert"></p></div>' +
        "</div>" +
        '<div class="field"><label for="stuChildLevel">Level</label>' +
          '<select id="stuChildLevel">' + h.options(db.levels, data.level) + "</select>" +
          '<p class="field__hint">Used for level checks when booking classes.</p></div>' +
        '<fieldset class="field stu-fieldset">' +
          '<legend class="field__label">Usual classes <span class="field__opt">(optional)</span></legend>' +
          '<div class="stu-progs">' + HC.programmes.map(function (p) {
            return '<label class="check"><input type="checkbox" name="stuChildProg" value="' + esc(p.id) + '"' +
              (data.programmes.indexOf(p.id) >= 0 ? " checked" : "") + " />" +
              '<span class="stu-prog"><span class="stu-prog__name">' + esc(p.name) + "</span>" +
              '<span class="stu-prog__lvl">' + esc(p.level) + "</span></span></label>";
          }).join("") + "</div>" +
          '<p class="field__hint stu-prog-hint" id="stuChildProgHint"></p>' +
        "</fieldset>" +
        '<div class="field"><label for="stuChildMedical">Medical note <span class="field__opt">(optional)</span></label>' +
          '<textarea id="stuChildMedical" rows="3" maxlength="500" placeholder="Allergies, conditions or anything coaches should know">' + esc(data.medical) + "</textarea></div>" +
        '<div id="stuChildFormErr"></div>' +
        '<button type="submit" hidden tabindex="-1" aria-hidden="true"></button>' +
      "</form>";

    Admin.openModal({
      title: c ? "Edit " + c.name : "Add a child",
      sub: c ? esc(possessive(f.parentName) + " family") : esc("New child on " + possessive(f.parentName) + " account"),
      body: body,
      actions:
        '<button type="button" class="btn btn--ghost" data-close>Cancel</button>' +
        '<button type="button" class="btn btn--primary" id="stuChildSave">' + (c ? "Save changes" : "Add child") + "</button>",
      onOpen: function (card) {
        var form = card.querySelector("#stuChildForm");
        var name = card.querySelector("#stuChildName");
        var age = card.querySelector("#stuChildAge");
        var level = card.querySelector("#stuChildLevel");
        var hint = card.querySelector("#stuChildProgHint");
        var formErr = card.querySelector("#stuChildFormErr");

        function checkedProgs() {
          return Array.prototype.map.call(form.querySelectorAll('input[name="stuChildProg"]:checked'), function (i) { return i.value; });
        }
        function paintHint() {
          var who = { level: level.value };
          var off = checkedProgs().map(HC.getProgramme).filter(function (p) { return p && !db.levelFits(who, p); });
          hint.textContent = off.length
            ? "Heads-up: " + off.map(function (p) { return p.name; }).join(", ") + (off.length === 1 ? " isn't" : " aren't") + " a " + level.value + " class."
            : "";
        }
        function setErr(input, id, msg) {
          input.classList.toggle("invalid", !!msg);
          if (msg) input.setAttribute("aria-invalid", "true"); else input.removeAttribute("aria-invalid");
          card.querySelector("#" + id).textContent = msg || "";
        }
        function save(e) {
          if (e) e.preventDefault();
          formErr.innerHTML = "";
          var nm = name.value.trim();
          var ag = String(age.value).trim();
          var bad = null;
          setErr(name, "stuChildNameErr", nm ? "" : "Enter the child's name.");
          if (!nm) bad = bad || name;
          var agOk = ag === "" || (/^\d+$/.test(ag) && +ag >= 3 && +ag <= 99);
          setErr(age, "stuChildAgeErr", agOk ? "" : "Use a whole number from 3 to 99.");
          if (!agOk) bad = bad || age;
          if (bad) { bad.focus(); return; }
          var payload = {
            name: nm,
            age: ag === "" ? "" : +ag,
            level: level.value,
            programmes: checkedProgs(),
            medical: card.querySelector("#stuChildMedical").value
          };
          var res = c
            ? db.updateChild(c.id, payload, { by: Admin.by() })
            : db.addChild(f.id, payload, { by: Admin.by() });
          if (!res.ok) formErr.innerHTML = h.notice("warn", esc(res.error));
          if (Admin.check(res, c ? "Saved changes to " + nm + "." : nm + " added to " + possessive(f.parentName) + " family.")) {
            Admin.closeModal();
          }
        }
        form.addEventListener("submit", save);
        card.querySelector("#stuChildSave").addEventListener("click", save);
        name.addEventListener("input", function () { if (name.value.trim()) setErr(name, "stuChildNameErr", ""); });
        age.addEventListener("input", function () { setErr(age, "stuChildAgeErr", ""); });
        level.addEventListener("change", paintHint);
        form.querySelectorAll('input[name="stuChildProg"]').forEach(function (i) { i.addEventListener("change", paintHint); });
        paintHint();
      }
    });
  }

  /* ============================================================
     BOOK A CHILD INTO A CLASS (staff)
     Stays open after each booking so several can be added.
     ============================================================ */
  var bk = null;
  var bkUnsub = null;

  function bookWeeks() {
    var ws = db.weekStart(db.todayISO());
    var out = [];
    for (var i = 0; i < BOOK_WEEKS; i++) out.push(db.addDays(ws, i * 7));
    return out;
  }

  // open, not started, and (for coaches) a class they run
  function bookCandidates(week) {
    return db.occurrencesForWeek(week).filter(function (o) {
      return o.status === "open" && !o.started && Admin.can("manage", o);
    });
  }

  function hasActiveBooking(key, childId) {
    return db.bookings({ occKey: key }).some(function (b) { return b.childId === childId; });
  }

  Admin.bookChildModal = function (childId) {
    var ch = db.child(childId);
    if (!ch || ch.active === false) { Admin.toast("warn", "Student not found."); return; }
    var weeks = bookWeeks();
    bk = {
      childId: ch.id, weeks: weeks, week: weeks[0], key: null, showFull: false,
      charge: true, allowNegative: false, allowFull: false,
      booked: [], error: "", invalid: null
    };
    // late on a Sunday there is nothing left this week — start on the next one
    if (!bookCandidates(bk.week).length) bk.week = weeks[1];

    Admin.openModal({
      title: "Book " + ch.name,
      sub: '<span id="stuBookSub"></span>',
      size: "lg",
      body: '<div class="stu-book" id="stuBook"></div>',
      actions:
        '<button type="button" class="btn btn--ghost" data-close>Done</button>' +
        '<button type="button" class="btn btn--primary" id="stuBookSubmit" disabled>Book class</button>',
      onOpen: function (card) {
        var root = card.querySelector("#stuBook");
        root.addEventListener("click", onBookClick);
        root.addEventListener("change", onBookChange);
        card.querySelector("#stuBookSubmit").addEventListener("click", submitBook);
        if (bkUnsub) bkUnsub();
        bkUnsub = db.onChange(function () { paintBook(); });
        paintBook();
      },
      onClose: stopBook
    });
  };

  function stopBook() {
    if (bkUnsub) { bkUnsub(); bkUnsub = null; }
    bk = null;
  }

  function paintBook() {
    var root = document.getElementById("stuBook");
    // another modal replaced ours without closing it — stop listening
    if (!root || !bk) { stopBook(); return; }
    var ch = db.child(bk.childId);
    if (!ch) { Admin.closeModal(); return; }
    var sel = bk.key ? db.occurrence(bk.key) : null;
    if (sel && (sel.status !== "open" || sel.started)) { bk.key = null; sel = null; }

    var f = db.family(ch.familyId) || {};
    var bal = db.balance(ch.familyId); // the family's shared pool
    var sub = document.getElementById("stuBookSub");
    if (sub) {
      sub.innerHTML = esc(ch.level + " · " + familyLabel(f) + " has ") + h.credits(bal) + " " + esc(creditWord(bal));
    }
    Admin.keepFocus(root, function () { root.innerHTML = bookHtml(ch, sel, bal); });

    var btn = document.getElementById("stuBookSubmit");
    if (btn) {
      btn.disabled = !sel;
      btn.textContent = sel ? "Book " + firstName(ch.name) : "Book class";
      btn.title = sel ? "" : "Pick a class first";
    }
  }

  function bookHtml(ch, sel, bal) {
    var today = db.todayISO();
    var thisWeek = db.weekStart(today);
    var weekEnd = db.addDays(bk.week, 6);
    var all = bookCandidates(bk.week);
    var shown = all.filter(function (o) {
      return bk.showFull || o.spotsLeft > 0 || o.key === bk.key || hasActiveBooking(o.key, ch.id);
    });
    var hiddenFull = all.length - shown.length;

    var done = bk.booked.length
      ? '<div class="notice notice--ok stu-book__done" id="stuBookDone" tabindex="-1" role="status">' + Admin.icon("check") + "<div>" +
          "<p><strong>" + esc(firstName(ch.name) + " is booked in.") + "</strong> Pick another class or press Done.</p>" +
          '<ul class="stu-book__donelist">' + bk.booked.map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("") + "</ul>" +
        "</div></div>"
      : "";

    var seg = '<div class="seg stu-seg" role="group" aria-label="Choose week">' + bk.weeks.map(function (w, i) {
      var rel = i === 0 ? "this week" : i === 1 ? "next week" : "in " + i + " weeks";
      return '<button type="button" id="stuBkWeek-' + i + '" data-stu-week="' + w + '" aria-pressed="' + (w === bk.week) + '"' +
        ' aria-label="' + esc("Week of " + fmt.date(w, "day") + ", " + rel) + '"' + (w === bk.week ? " autofocus" : "") + ">" +
        (i === 0 ? "This week" : esc(fmt.date(w, "day"))) + "</button>";
    }).join("") + "</div>";

    var bar = '<div class="stu-book__bar">' + seg +
      '<label class="check"><input type="checkbox" id="stuBkShowFull"' + (bk.showFull ? " checked" : "") + " /> <span>Show full classes</span></label>" +
    "</div>" +
    '<p class="stu-book__range">' + esc(fmt.date(bk.week, "day") + " – " + fmt.date(weekEnd, "day") +
      (bk.week === thisWeek ? " · remaining this week" : "") + " · " + Admin.plural(shown.length, "class", "classes") +
      (hiddenFull ? " · " + hiddenFull + " full hidden" : "") +
      (Admin.isAdmin() ? "" : " · your classes only")) + "</p>";

    var list;
    if (!shown.length) {
      var why = all.length
        ? "Every class this week is full. Tick “Show full classes” to add over capacity."
        : Admin.isAdmin() ? "No open classes left in this week." : "You have no open classes left in this week.";
      list = h.empty("calendar", "Nothing to book", esc(why));
      list = list.replace('class="empty"', 'class="empty empty--sm"');
    } else {
      var days = [];
      var byDate = {};
      shown.forEach(function (o) {
        if (!byDate[o.date]) { byDate[o.date] = []; days.push(o.date); }
        byDate[o.date].push(o);
      });
      list = '<fieldset class="stu-book__list"><legend class="sr-only">Classes</legend>' +
        days.map(function (d) {
          return '<div class="stu-book__day"><p class="stu-book__dayname">' + esc(fmt.date(d, "relative") === fmt.date(d) ? fmt.date(d) : fmt.date(d, "relative") + " · " + fmt.date(d)) + "</p>" +
            '<div class="choices">' + byDate[d].map(function (o) { return choiceHtml(o, ch); }).join("") + "</div></div>";
        }).join("") +
      "</fieldset>";
    }

    return done + bar + '<div class="stu-book__scroll">' + list + "</div>" + optionsHtml(ch, sel, bal);
  }

  function choiceHtml(o, ch) {
    var booked = hasActiveBooking(o.key, ch.id);
    var full = o.spotsLeft <= 0;
    var fits = db.levelFits(ch, o.programme);
    var usual = (ch.programmes || []).indexOf(o.programmeId) >= 0;
    var chips = [];
    if (booked) chips.push(h.chip("Already booked", "info"));
    if (full) chips.push(h.chip("Full", "warn"));
    if (usual) chips.push(h.chip("Usual class", "ok"));
    if (!fits) {
      chips.push(h.chip(o.level + " class · " + firstName(ch.name) + " is " + ch.level, "warn",
        "Level check only — you can still book it"));
    }
    if (o.oneOff) chips.push(h.chip("One-off", "oneoff", o.note));
    if (o.substituted) chips.push(h.chip("Cover", "sub", o.coach + " covering for " + o.originalCoach));
    var spots = full
      ? "Full · " + o.booked + " of " + o.capacity
      : Admin.plural(o.spotsLeft, "spot") + " left of " + o.capacity;
    return '<label class="choice stu-choice' + (booked ? " is-booked" : "") + '">' +
      '<input type="radio" name="stuBookOcc" id="stuBk-' + safeId(o.key) + '" value="' + esc(o.key) + '"' +
        (o.key === bk.key && !booked ? " checked" : "") + (booked ? " disabled" : "") + " />" +
      '<span class="stu-choice__body">' +
        '<span class="choice__t">' + esc(fmt.timeRange(o) + " · " + o.name) + "</span>" +
        '<span class="choice__d">' + esc(o.coach + " · " + spots) + "</span>" +
        (chips.length ? '<span class="chips stu-choice__chips">' + chips.join("") + "</span>" : "") +
      "</span>" +
    "</label>";
  }

  function optionsHtml(ch, sel, bal) {
    if (!sel) {
      return '<div class="stu-book__opts"><p class="muted">Pick a class above to see the booking options.</p>' +
        (bk.error ? h.notice("warn", esc(bk.error)) : "") + "</div>";
    }
    var canCredits = Admin.can("credits");
    var charge = canCredits ? bk.charge : true;
    var needNeg = charge && bal < sel.cost;
    var full = sel.spotsLeft <= 0;
    var after = bal - (charge ? sel.cost : 0);
    var name = firstName(ch.name);
    var f = db.family(ch.familyId) || {};

    var out = '<div class="stu-book__opts">' +
      '<p class="stu-book__summary">' + Admin.icon("calendar") + "<span><strong>" + esc(name) + "</strong> → " +
        esc(sel.name + ", " + fmt.date(sel.date, "full") + ", " + fmt.timeRange(sel) + " with " + sel.coach) + "</span></p>" +
      '<label class="check"><input type="checkbox" id="stuBkCharge"' + (charge ? " checked" : "") + (canCredits ? "" : " disabled") + " />" +
        "<span><strong>Deduct " + esc(Admin.plural(sel.cost, "credit")) + "</strong> from the family credits — " + h.credits(bal) + " → " + h.credits(after) +
        (canCredits ? "" : '<br /><span class="field__hint">Only admins can book without deducting credits.</span>') + "</span></label>";

    if (needNeg) {
      out += '<label class="check stu-must' + (bk.invalid === "stuBkNeg" ? " is-invalid" : "") + '"><input type="checkbox" id="stuBkNeg"' + (bk.allowNegative ? " checked" : "") + " />" +
        "<span><strong>Allow negative balance</strong> — " + esc(familyLabel(f) + " has " + Admin.plural(bal, "credit") +
        ", so this takes the family to " + after + ". Follow up with " + (f.parentName || "the parent") + " about payment.") + "</span></label>";
    }
    if (full) {
      out += '<label class="check stu-must' + (bk.invalid === "stuBkOver" ? " is-invalid" : "") + '"><input type="checkbox" id="stuBkOver"' + (bk.allowFull ? " checked" : "") + " />" +
        "<span><strong>Add over capacity</strong> — " + esc("this class is full (" + sel.booked + " of " + sel.capacity + "); " + name + " would make it " + (sel.booked + 1) + ".") + "</span></label>";
    }
    if (!db.levelFits(ch, sel.programme)) {
      out += h.notice("info", esc("Level check: " + sel.name + " is a " + sel.level + " class and " + name + " is " + ch.level + ". You can still book it."));
    }
    if (bk.error) out += h.notice("warn", esc(bk.error));
    return out + "</div>";
  }

  function onBookClick(e) {
    var w = e.target.closest("[data-stu-week]");
    if (!w || !bk) return;
    var week = w.getAttribute("data-stu-week");
    if (week === bk.week) return;
    bk.week = week;
    bk.key = null;
    bk.error = "";
    bk.invalid = null;
    paintBook();
  }

  function onBookChange(e) {
    if (!bk) return;
    var t = e.target;
    if (t.name === "stuBookOcc") {
      bk.key = t.value;
      bk.allowNegative = false;
      bk.allowFull = false;
      bk.error = "";
      bk.invalid = null;
    } else if (t.id === "stuBkShowFull") {
      bk.showFull = t.checked;
    } else if (t.id === "stuBkCharge") {
      bk.charge = t.checked;
    } else if (t.id === "stuBkNeg") {
      bk.allowNegative = t.checked;
      if (t.checked && bk.invalid === "stuBkNeg") { bk.invalid = null; bk.error = ""; }
    } else if (t.id === "stuBkOver") {
      bk.allowFull = t.checked;
      if (t.checked && bk.invalid === "stuBkOver") { bk.invalid = null; bk.error = ""; }
    } else {
      return;
    }
    paintBook();
    if (t.name === "stuBookOcc") revealBookOptions();
  }

  // On phones the options sit below the class list: bring them into view after a pick.
  // (The sheet's Book button is sticky, see students.css.) Runs after paintBook,
  // which replaces the markup.
  function revealBookOptions() {
    var phone = window.matchMedia && window.matchMedia("(max-width: 760px)").matches;
    if (!phone) return;
    var o = document.querySelector("#stuBook .stu-book__opts");
    if (o && o.scrollIntoView) {
      try { o.scrollIntoView({ block: "nearest", behavior: "smooth" }); } catch (e) { o.scrollIntoView(false); }
    }
  }

  function submitBook() {
    if (!bk) return;
    var ch = db.child(bk.childId);
    var sel = bk.key ? db.occurrence(bk.key) : null;
    if (!ch) return;
    bk.error = "";
    bk.invalid = null;
    if (!sel) { bk.error = "Pick a class first."; paintBook(); return; }
    var charge = Admin.can("credits") ? bk.charge : true;
    var needNeg = charge && db.balance(ch.familyId) < sel.cost;
    var needFull = sel.spotsLeft <= 0;
    if (needNeg && !bk.allowNegative) {
      bk.error = "Not enough family credits — tick “Allow negative balance” to book anyway.";
      bk.invalid = "stuBkNeg";
      paintBook();
      focusId("stuBkNeg");
      return;
    }
    if (needFull && !bk.allowFull) {
      bk.error = "This class is full — tick “Add over capacity” to book anyway.";
      bk.invalid = "stuBkOver";
      paintBook();
      focusId("stuBkOver");
      return;
    }
    var res = db.book(sel.key, ch.id, {
      by: Admin.by(),
      source: "staff",
      charge: charge,
      allowNegative: needNeg && bk.allowNegative,
      allowFull: needFull && bk.allowFull
    });
    if (!bk) return; // modal closed during the change broadcast
    if (!Admin.check(res, firstName(ch.name) + " booked into " + sel.name + " · " + fmt.date(sel.date) + ".")) {
      bk.error = res.error || "Couldn't book this class.";
      paintBook();
      return;
    }
    bk.booked.push(sel.name + " · " + fmt.date(sel.date, "full") + ", " + fmt.time(sel.time) +
      (charge ? " · " + Admin.plural(sel.cost, "credit") + " deducted" : " · no credit charged"));
    bk.key = null;
    bk.allowNegative = false;
    bk.allowFull = false;
    paintBook();
    focusId("stuBookDone");
  }
})();
