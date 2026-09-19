/* ============================================================
   HUACHENG ELITE — Coach & Admin console · Schedule / My classes
   ------------------------------------------------------------
   A week of dated classes: seven day columns on wider screens,
   a day-by-day agenda on phones. Every class shows where it is
   in its day (Upcoming / Now / Passed) and, once it has started,
   whether attendance is marked.

   Coaches get "My classes": only the classes they teach, a
   Today strip, and the few actions a coach needs (block, reopen,
   delete one date). The admin sees every class, filters by coach,
   adds one-off classes and changes coaches.

     #schedule?week=YYYY-MM-DD&coach=all|Coach A&deleted=1
     (coach is admin-only — coaches always see their own classes)

   Per-date class actions live here and are shared with the
   class drawer and the Today view:

     Admin.blockClass(key)        Admin.unblockClass(key)
     Admin.deleteClass(key[, { scope: "series" }])
     Admin.restoreClass(key)
     Admin.substituteCoach(key)                       (admin)
     Admin.addOneOff([{ date, time, programmeId, coach,
                        duration, capacity, note,
                        mode: "one" | "many", groupName }])  (admin)

   "Several dates (camp)" adds one-off sessions on many dates under one
   name (HC.db.addOneOffs); they can be deleted together from a date on.
   ============================================================ */
(function () {
  "use strict";

  var HC = window.HC;
  var Admin = window.Admin;
  if (!HC || !HC.db || !Admin || !Admin.registerView) return;
  var db = HC.db;
  var esc = Admin.esc;
  var fmt = Admin.fmt;
  var h = Admin.h;
  var icon = Admin.icon;
  var plural = Admin.plural;

  var PHONE_QUERY = "(max-width: 760px)";
  var LAST_START = 21 * 60 + 30;   // latest start the time picker offers
  var CLOSING = 22 * 60;           // classes must finish by 10pm
  var DURATIONS = [45, 60, 75, 90, 120];
  var BOOKING_WEEKS = 3;           // the parent portal books this week + 3 more (app.js WEEKS_AHEAD)
  var LOOK_BACK = 7;               // days the Today strip checks for attendance still to mark
  var GRID_GAP = 6;                // px between day columns (matches .sch-week)
  var BLOCK_REASONS = ["Coach unavailable", "Coach unwell", "Competition / event duty", "Studio maintenance", "Other"];
  var LEGEND = [
    ["open", "Open"], ["nearly", "Nearly full"], ["full", "Full"], ["blocked", "Blocked"],
    ["leave", "Coach on leave"], ["oneoff", "One-off"], ["cover", "Cover"], ["removed", "Deleted"]
  ];

  // UI state that must survive re-renders
  var ui = {
    week: null,      // week last rendered (to keep horizontal scroll / skip the entrance animation)
    layout: null,    // "grid" | "agenda"
    menu: null,      // { key, btnId } while a card menu is open
    showPast: false  // phones: earlier days of this week are folded away
  };

  /* ============================================================
     SMALL HELPERS
     ============================================================ */
  function today() { return db.todayISO(); }

  function nowMin() {
    var d = new Date();
    return d.getHours() * 60 + d.getMinutes();
  }

  function isIso(v) { return /^\d{4}-\d{2}-\d{2}$/.test(String(v || "")); }

  function coachMode() { return !Admin.isAdmin(); }

  function myCoach() { return Admin.staff ? Admin.staff.coach : null; }

  // coaches that can be filtered on (active + anyone still on the timetable)
  function isTimetableCoach(v) { return !!v && db.coachNames().indexOf(v) >= 0; }

  // coaches that can be given a class
  function isActiveCoach(v) {
    return !!v && db.coaches().some(function (c) { return c.coach === v; });
  }

  function firstActiveCoach() {
    var list = db.coaches();
    return list.length ? list[0].coach : "";
  }

  function safeId(s) { return String(s).replace(/[^A-Za-z0-9_-]/g, "-"); }

  // a phrase that must not break across lines ("Coach A", "4:00 PM – 5:15 PM")
  function nw(text) { return '<span class="nowrap">' + esc(text) + "</span>"; }

  function isPhone() {
    try { return !!(window.matchMedia && window.matchMedia(PHONE_QUERY).matches); }
    catch (e) { return false; }
  }

  // Can a one-off still be added on this date? (today only while a start slot is left)
  function canAdd(iso) {
    var t = today();
    return iso > t || (iso === t && nowMin() < LAST_START - 15);
  }

  // The first day parents can book a date: the portal shows this week and three more.
  function bookableFrom(iso) { return db.addDays(db.weekStart(iso), -7 * BOOKING_WEEKS); }

  function lengthLabel(min) {
    var hr = Math.floor(min / 60), m = min % 60;
    return (hr ? hr + " hr" : "") + (hr && m ? " " : "") + (m ? m + " min" : "");
  }

  // Calendar-style range for narrow columns: "4 – 5:15 PM", "10 – 11 AM".
  // Returns HTML: each half stays on one line, so a wrap only happens at the dash.
  function shortRange(occ) {
    var a = fmt.time(occ.time).replace(":00 ", " ");
    var b = fmt.time(occ.endTime).replace(":00 ", " ");
    if (a.slice(-2) === b.slice(-2)) a = a.slice(0, -3);
    return '<span class="sch-t">' + esc(a) + " –</span> " + '<span class="sch-t">' + esc(b) + "</span>";
  }

  function fillState(occ) {
    if (occ.spotsLeft <= 0) return "full";
    if (occ.spotsLeft <= Math.max(2, Math.ceil(occ.capacity * 0.2))) return "nearly";
    return "open";
  }

  // one colour per card: status beats one-off beats cover beats how full it is
  function cardState(occ) {
    if (occ.status === "removed") return "removed";
    if (occ.status === "blocked") return occ.blockKind === "leave" ? "leave" : "blocked";
    if (occ.oneOff) return "oneoff";
    if (occ.substituted) return "cover";
    return fillState(occ);
  }

  // Upcoming / Now / Passed (blocked and deleted classes show that instead)
  function statusChip(occ) {
    if (occ.status === "removed" && occ.removedScope === "series") {
      return h.chip("Weekly class deleted", "removed chip--state", occ.reason);
    }
    return h.stateChip(occ);
  }

  // the chips that add to the status: one-off, cover, full
  function extraChips(occ) {
    var out = [];
    if (occ.groupId) {
      var g = groupOf(occ.groupId);
      var n = sessionNumber(g, occ.key);
      out.push(h.chip(groupLabel(occ), "oneoff chip--group",
        g && n ? "Session " + n + " of " + g.total + " · " + occ.groupName : occ.groupName));
    } else if (occ.oneOff) out.push(h.chip("One-off", "oneoff", occ.note));
    if (occ.substituted) {
      out.push(h.chip("Cover for " + occ.originalCoach, "sub",
        who(occ.coach) === "You" ? "You're covering this date" : occ.coach + " is covering this date"));
    }
    if (occ.status === "open" && occ.spotsLeft === 0 && !occ.ended) out.push(h.chip("Full", "warn"));
    return out.join("");
  }

  function needsMarking(occ) { return h.attendance(occ).key === "todo"; }

  // One-off sessions created together (a camp). Cached while a view renders —
  // every card of a camp asks for the same group.
  var groupCache = null;
  function groupOf(id) {
    if (!id) return null;
    if (groupCache && Object.prototype.hasOwnProperty.call(groupCache, id)) return groupCache[id];
    var g = db.oneOffGroup(id);
    if (groupCache) groupCache[id] = g;
    return g;
  }

  // 3 for the third session of its group (deleted sessions keep their number)
  function sessionNumber(g, key) {
    for (var i = 0; g && i < g.sessions.length; i++) {
      if (g.sessions[i].key === key) return i + 1;
    }
    return 0;
  }

  // this session and every later one of its group that can still be deleted
  function groupTargets(occ) {
    var g = groupOf(occ.groupId);
    if (!g) return [];
    return g.sessions.filter(function (o) {
      return o.status !== "removed" && !o.started && (o.date > occ.date || (o.date === occ.date && o.time >= occ.time));
    });
  }

  // "June Boot Camp · 3/15"
  function groupLabel(occ) {
    var g = groupOf(occ.groupId);
    var n = sessionNumber(g, occ.key);
    return (occ.groupName || "Camp") + (g && n ? " · " + n + "/" + g.total : "");
  }

  function openClashes(date, time, duration, coach, ignoreKey) {
    return db.clashes(date, time, duration, coach, ignoreKey).filter(function (o) { return o.status === "open"; });
  }

  function clashList(list) {
    return list.map(function (o) {
      return "<strong>" + esc(o.name) + "</strong> (" + nw(fmt.timeRange(o)) + ")";
    }).join(", ");
  }

  function refundText(n, cost) {
    return "<strong>" + esc(plural(n, "booked student")) + "</strong> will be removed, refunded " +
      esc(plural(cost, "credit")) + (n === 1 ? "" : " each") + " and notified.";
  }

  // modal subtitle: what + when + who (each part stays whole when the line wraps)
  function occSub(occ) {
    return '<span class="sch-msub"><strong>' + esc(occ.name) + "</strong>" +
      "<span>" + nw(fmt.date(occ.date, "full")) + " · " + nw(fmt.timeRange(occ)) + " · " + nw(occ.coach) + "</span></span>";
  }

  // "you" for the signed-in coach, the coach's name otherwise
  function who(coach) {
    return coachMode() && coach === myCoach() ? "You" : coach;
  }

  function scheduleName() { return Admin.navLabel("schedule") || "Schedule"; }

  /* ============================================================
     PARAMS
     ============================================================ */
  function readParams(params) {
    params = params || {};
    var coach;
    if (coachMode()) coach = myCoach();   // a coach's calendar only holds their own classes
    else coach = params.coach !== "all" && isTimetableCoach(params.coach) ? params.coach : "all";
    return {
      week: db.weekStart(isIso(params.week) ? params.week : today()),
      coach: coach,
      deleted: params.deleted === "1"
    };
  }

  function setCoach(value) {
    closeMenu(false);
    Admin.setParams({ coach: value === "all" ? "" : value });
  }

  function firstAddDay(dates) {
    for (var i = 0; i < dates.length; i++) {
      if (canAdd(dates[i].iso)) return dates[i].iso;
    }
    return null;
  }

  // the coach's next class that hasn't started (from a date, up to four weeks on)
  function nextClass(coach, from) {
    for (var i = 0; i < 28; i++) {
      var d = db.addDays(from, i);
      var hit = db.occurrencesForDate(d, { coach: coach }).filter(function (o) {
        return o.status === "open" && !o.started;
      })[0];
      if (hit) return hit;
    }
    return null;
  }

  // earlier classes (the last week, not today) whose register isn't finished
  function earlierToMark(coach) {
    var t = today();
    var out = [];
    for (var i = LOOK_BACK; i >= 1; i--) {
      out = out.concat(db.occurrencesForDate(db.addDays(t, -i), { coach: coach }).filter(needsMarking));
    }
    return out;
  }

  /* ============================================================
     VIEW
     ============================================================ */
  Admin.registerView("schedule", { render: renderView });

  function renderView(el, params) {
    groupCache = {};
    try { paintView(el, params); }
    finally { groupCache = null; }
  }

  function paintView(el, params) {
    var st = readParams(params);
    var coachView = coachMode();
    var phone = isPhone();
    var dates = db.weekDates(st.week);
    var from = dates[0].iso, to = dates[6].iso;
    var coach = st.coach === "all" ? undefined : st.coach;
    var thisWeek = st.week === db.weekStart(today());

    var leaveByDate = {};
    db.leaves(coach ? { coach: coach, from: from, to: to } : { from: from, to: to }).forEach(function (l) {
      (leaveByDate[l.date] = leaveByDate[l.date] || []).push(l);
    });

    var totals = { classes: 0, booked: 0, places: 0, blocked: 0, oneOff: 0, removed: 0, toMark: 0 };
    var days = dates.map(function (d) {
      var all = db.occurrencesForDate(d.iso, { includeRemoved: true, coach: coach });
      var live = all.filter(function (o) { return o.status !== "removed"; });
      totals.classes += live.length;
      totals.removed += all.length - live.length;
      live.forEach(function (o) {
        if (o.status === "open") { totals.booked += o.booked; totals.places += o.capacity; }
        else totals.blocked++;
        if (o.oneOff) totals.oneOff++;
        if (needsMarking(o) && Admin.can("manage", o)) totals.toMark++;
      });
      return {
        d: d,
        list: st.deleted ? all : live,
        count: live.length,
        removed: all.length - live.length,
        leaves: leaveByDate[d.iso] || []
      };
    });
    var shown = days.reduce(function (n, x) { return n + x.list.length; }, 0);

    // keep the horizontal scroll when only the data changed
    var layout = phone ? "agenda" : "grid";
    var wasHere = !!el.querySelector(".sch");
    var same = wasHere && ui.week === st.week && ui.layout === layout;
    var oldScroll = el.querySelector(".sch-scroll");
    var keepLeft = same && oldScroll ? oldScroll.scrollLeft : null;

    el.innerHTML =
      '<div class="sch' + (coachView ? " sch--coach" : " sch--admin") + (same ? "" : " sch--enter") + '">' +
        headHtml(dates) +
        toolbarHtml(st, totals) +
        (coachView && thisWeek && !phone ? todayHtml(st.coach) : "") +
        (shown
          ? infoHtml(st, totals, phone) + (phone ? agendaHtml(days, st) : gridHtml(days, dates))
          : emptyHtml(st, totals, dates)) +
      "</div>";

    ui.week = st.week;
    ui.layout = layout;
    bind(el);

    var scroller = el.querySelector(".sch-scroll");
    if (scroller) {
      if (keepLeft != null) scroller.scrollLeft = keepLeft;
      else scrollToToday(scroller);
      updateEdges(scroller);
    }
    reanchorMenu();
  }

  // Start the week grid on today — snapped to a whole column, never half a day.
  function scrollToToday(scroller) {
    var max = scroller.scrollWidth - scroller.clientWidth;
    var todayCol = scroller.querySelector(".sch-day.is-today");
    if (!todayCol || max <= 1) return;
    var pad = 0;
    try { pad = parseFloat(window.getComputedStyle(scroller).paddingLeft) || 0; } catch (e) {}
    var want = todayCol.offsetLeft - pad;
    var left = 0;
    // the last column start that is on or before today and still reachable
    // (the end padding may leave max scroll a few px short of a column edge)
    scroller.querySelectorAll(".sch-day").forEach(function (col) {
      var x = col.offsetLeft - pad;
      if (x <= want + 1 && x <= max + pad + 1) left = x;
    });
    scroller.scrollLeft = Math.max(0, Math.min(left, max));
  }

  // fade + arrow on the side(s) where more days are hidden
  function updateEdges(scroller) {
    var wrap = scroller.parentNode;
    if (!wrap || !wrap.classList || !wrap.classList.contains("sch-scrollwrap")) return;
    var max = scroller.scrollWidth - scroller.clientWidth;
    var left = max > 1 && scroller.scrollLeft > 2;
    var right = max > 1 && scroller.scrollLeft < max - 2;
    wrap.classList.toggle("can-left", left);
    wrap.classList.toggle("can-right", right);
    var prev = wrap.querySelector("[data-sch-edge='-1']");
    var next = wrap.querySelector("[data-sch-edge='1']");
    if (prev) prev.hidden = !left;
    if (next) next.hidden = !right;
  }

  /* ---------- head + toolbar ---------- */
  function headHtml(dates) {
    var admin = Admin.can("oneoff");
    var first = admin ? firstAddDay(dates) : null;
    return h.pageHead({
      title: scheduleName(),
      sub: esc(coachMode()
        ? "Your week at a glance — tap a class to take attendance."
        : "Block, delete or add classes for a specific date — changes show in the parent portal straight away."),
      actions: admin
        ? '<button type="button" class="btn btn--primary" id="schAdd"' + (first ? ' data-date="' + first + '"' : "") + ">" +
            icon("plus") + "Add one-off class</button>"
        : ""
    });
  }

  function toolbarHtml(st, totals) {
    var right = "";
    if (!coachMode()) {
      right +=
        '<label class="sch-coach" for="schCoach"><span class="sr-only">Show classes for</span>' +
          icon("user") +
          '<select class="input" id="schCoach">' + h.coachOptions(st.coach, true, { timetable: true }) + "</select>" +
        "</label>";
    }
    // coaches only see the switch when there's something deleted to show
    if (!coachMode() || st.deleted || totals.removed > 0) {
      right +=
        '<label class="check sch-deleted" for="schDeleted" title="Deleted classes can be restored from their menu">' +
          '<input type="checkbox" id="schDeleted"' + (st.deleted ? " checked" : "") + " />" +
          "<span>Show deleted</span>" +
        "</label>";
    }
    return '<div class="toolbar sch-toolbar">' +
        '<div class="toolbar__group sch-toolbar__week">' + h.weekNav(st.week) + "</div>" +
        (right ? '<div class="toolbar__group sch-filters">' + right + "</div>" : "") +
      "</div>";
  }

  /* ---------- Today strip (coaches, this week, wider screens) ---------- */
  function todayHtml(coach) {
    var t = today();
    var list = db.occurrencesForDate(t, { coach: coach });
    var todo = earlierToMark(coach);
    var count = list.length ? plural(list.length, "class", "classes") : "No classes";
    var body;
    if (list.length) {
      body = '<ul class="sch-tb__list">' + list.map(todayItem).join("") + "</ul>";
    } else {
      var next = nextClass(coach, db.addDays(t, 1));
      body = '<p class="sch-tb__none">Nothing on today.' +
        (next
          ? ' Your next class: <button type="button" class="sch-link" data-open-class="' + esc(next.key) + '">' +
              esc(next.name) + ", " + nw(fmt.date(next.date) + " · " + fmt.time(next.time)) + "</button>."
          : "") +
        "</p>";
    }
    var todoHtml = "";
    if (todo.length) {
      var shownTodo = todo.slice(0, 3);
      todoHtml = '<p class="sch-tb__todo">' + icon("alert") + "<span><strong>Attendance still to mark:</strong> " +
        shownTodo.map(function (o) {
          return '<button type="button" class="sch-link" data-open-class="' + esc(o.key) + '">' +
            esc(o.name) + ", " + nw(fmt.date(o.date)) + "</button>";
        }).join(", ") +
        (todo.length > shownTodo.length ? " and " + (todo.length - shownTodo.length) + " more" : "") +
        "</span></p>";
    }
    return '<section class="sch-tb" id="schToday" aria-labelledby="schTodayTitle">' +
        '<header class="sch-tb__head">' +
          '<h2 class="sch-tb__title" id="schTodayTitle">Today <span class="sch-tb__date">' + esc(HC.dayNames[db.dayIndex(t)] + " " + fmt.date(t, "day")) + "</span></h2>" +
          '<p class="sch-tb__count">' + esc(count) + "</p>" +
        "</header>" +
        body + todoHtml +
      "</section>";
  }

  function todayItem(occ) {
    var cs = h.classState(occ);
    var badge = h.attendanceBadge(occ);
    var extra = badge ||
      (occ.status === "open" ? '<span class="sch-tb__booked">' + esc(occ.booked + "/" + occ.capacity + " booked") + "</span>" : "");
    return '<li class="sch-tb__item sch-tb__item--' + cs.key + '">' +
        '<button type="button" class="sch-tb__btn" data-open-class="' + esc(occ.key) + '" aria-label="' + esc(ariaFor(occ)) + '">' +
          '<span class="sch-tb__time">' + esc(fmt.timeRange(occ)) + "</span>" +
          '<span class="sch-tb__name">' + esc(occ.name) + "</span>" +
          '<span class="sch-tb__meta">' + statusChip(occ) + extra + "</span>" +
        "</button>" +
      "</li>";
  }

  /* ---------- week summary + colour key ---------- */
  function infoHtml(st, t, phone) {
    var bits = [];
    bits.push("<span><b>" + t.classes + "</b> " + (t.classes === 1 ? "class" : "classes") + "</span>");
    if (t.places) bits.push("<span><b>" + t.booked + "</b>/" + t.places + " places booked</span>");
    if (t.blocked) bits.push('<span class="is-warn"><b>' + t.blocked + "</b> blocked</span>");
    if (t.oneOff) bits.push('<span class="is-jade"><b>' + t.oneOff + "</b> one-off</span>");
    if (t.toMark) {
      bits.push('<span class="is-alert"><b>' + t.toMark + "</b> " + (t.toMark === 1 ? "class needs" : "classes need") + " attendance</span>");
    }
    if (t.removed) {
      bits.push('<span class="is-muted"><b>' + t.removed + "</b> deleted" + (st.deleted ? "" : " (hidden)") + "</span>");
    }
    var legend = '<div class="legend sch-legend">' + LEGEND.map(function (l) {
      return '<span><i class="sch-sw sch-sw--' + l[0] + '" aria-hidden="true"></i>' + esc(l[1]) + "</span>";
    }).join("") + "</div>";

    // coaches: the chips say it in words, so the colour key stays folded
    return '<div class="sch-info">' +
        '<p class="sch-summary" aria-label="This week">' + bits.join("") + "</p>" +
        (phone || coachMode()
          ? '<details class="sch-key"><summary>Colour key</summary>' + legend + "</details>"
          : '<div class="sch-key" aria-label="Colour key">' + legend + "</div>") +
      "</div>";
  }

  /* ---------- week grid ---------- */
  function gridHtml(days, dates) {
    var label = "Classes from " + fmt.date(dates[0].iso) + " to " + fmt.date(dates[6].iso);
    return '<div class="sch-scrollwrap">' +
        '<button type="button" class="sch-edge sch-edge--prev" data-sch-edge="-1" tabindex="-1" aria-hidden="true" title="Earlier days" hidden>' +
          icon("chevron-left") + "</button>" +
        '<div class="sch-scroll" id="schScroll" role="region" tabindex="0" aria-label="' + esc(label) + '">' +
          '<div class="sch-week">' +
            days.map(function (x, i) { return dayColumn(x, i); }).join("") +
          "</div>" +
        "</div>" +
        '<button type="button" class="sch-edge sch-edge--next" data-sch-edge="1" tabindex="-1" aria-hidden="true" title="Later days" hidden>' +
          icon("chevron-right") + "</button>" +
      "</div>";
  }

  function dayColumn(x, i) {
    var d = x.d;
    var headId = "schDay-" + d.iso;
    return '<section class="sch-day' + (d.isToday ? " is-today" : "") + (d.isPast ? " is-past" : "") +
        '" style="--i:' + i + '" aria-labelledby="' + headId + '" data-date="' + d.iso + '">' +
        '<header class="sch-day__head">' +
          '<h2 class="sch-day__when" id="' + headId + '">' +
            '<span class="sch-day__dow">' + esc(d.short) +
              (d.isToday ? ' <span class="sch-day__today">Today</span>' : "") + "</span> " +
            '<span class="sch-day__date"><span class="sch-day__num">' + d.date + "</span> " +
              '<span class="sch-day__mon">' + esc(d.month) + "</span></span>" +
          "</h2>" +
          addButton(d) +
          '<p class="sch-day__count">' + esc(countLabel(x)) + "</p>" +
          leaveChips(x) +
        "</header>" +
        '<div class="sch-day__list">' +
          (x.list.length
            ? x.list.map(function (o) { return cardHtml(o, "grid"); }).join("")
            : '<div class="sch-day__none" aria-hidden="true"></div>') +
        "</div>" +
      "</section>";
  }

  function countLabel(x) {
    var s = x.count ? plural(x.count, "class", "classes") : "No classes";
    if (x.removed && x.list.length > x.count) s += " · " + x.removed + " deleted";
    return s;
  }

  function leaveChips(x) {
    if (!x.leaves.length) return "";
    return '<div class="sch-day__leave">' + x.leaves.map(function (l) {
      var you = who(l.coach) === "You";
      return h.chip(you ? "You're on leave" : l.coach + " on leave", "leave", l.reason || "On leave");
    }).join("") + "</div>";
  }

  function addButton(d) {
    if (!Admin.can("oneoff") || !canAdd(d.iso)) return "";
    var label = "Add a one-off class on " + fmt.date(d.iso);
    return '<button type="button" class="sch-day__add" id="schAdd-' + d.iso + '" data-sch-add="' + d.iso +
      '" aria-label="' + esc(label) + '" title="' + esc(label) + '">' + icon("plus") + "</button>";
  }

  /* ---------- agenda (phones) ---------- */
  function agendaHtml(days, st) {
    // On this week, start at today: earlier days fold behind one toggle.
    var thisWeek = days.some(function (x) { return x.d.isToday; });
    var past = thisWeek ? days.filter(function (x) { return x.d.isPast && x.list.length; }) : [];
    var fold = past.length > 0 && !ui.showPast;
    var toggle = "";
    if (past.length) {
      var n = 0, todo = 0;
      past.forEach(function (x) {
        n += x.list.length;
        todo += x.list.filter(needsMarking).length;
      });
      var span = past[0].d.short + (past.length > 1 ? " – " + past[past.length - 1].d.short : "");
      toggle = '<button type="button" class="sch-earlier" id="schEarlier" aria-expanded="' + !fold + '">' +
          '<span class="sch-earlier__text">' +
            '<span class="sch-earlier__t">' + (fold ? "Show earlier this week" : "Hide earlier days") + "</span>" +
            '<span class="sch-earlier__d">' + esc(span + " · " + plural(n, "class", "classes")) +
              (todo ? ' · <span class="sch-earlier__todo">' + esc(todo === 1 ? "1 needs attendance" : todo + " need attendance") + "</span>" : "") +
            "</span>" +
          "</span>" +
          icon("chevron-down", fold ? "" : "is-flipped") +
        "</button>";
    }
    var out = days.map(function (x, i) {
      var d = x.d;
      if (fold && d.isPast) return "";
      if (!x.list.length && !d.isToday) return "";
      var headId = "schDay-" + d.iso;
      return '<section class="sch-aday' + (d.isToday ? " is-today" : "") + (d.isPast ? " is-past" : "") +
          '" style="--i:' + i + '" aria-labelledby="' + headId + '" data-date="' + d.iso + '">' +
          '<header class="sch-aday__head">' +
            '<span class="sch-aday__cal" aria-hidden="true"><span>' + esc(d.short) + "</span><b>" + d.date + "</b></span>" +
            '<div class="sch-aday__text">' +
              '<h2 class="sch-aday__title" id="' + headId + '">' + esc(d.isToday ? "Today" : d.name) +
                ' <span class="sch-aday__date">' + esc(d.date + " " + d.month) + "</span></h2>" +
              '<p class="sch-aday__sub">' + esc(countLabel(x)) + "</p>" +
            "</div>" +
            addButton(d) +
          "</header>" +
          leaveChips(x) +
          (x.list.length
            ? '<div class="sch-aday__list">' + x.list.map(function (o) { return cardHtml(o, "agenda"); }).join("") + "</div>"
            : '<p class="sch-aday__none">' + (coachMode() ? "No classes for you today." : "No classes today.") + "</p>") +
        "</section>";
    }).join("");
    return '<div class="sch-agenda">' + toggle + out + "</div>";
  }

  /* ---------- class card ----------
     time · class name · coach (admin) · booked bar · status + attendance */
  function cardHtml(occ, layout) {
    var state = cardState(occ);
    var fill = fillState(occ);
    var cs = h.classState(occ);
    var badge = h.attendanceBadge(occ);
    var menu = hasMenu(occ);
    var cls = "sch-card sch-card--" + state +
      " sch-fill--" + (occ.status === "open" ? fill : "none") +
      " sch-state--" + cs.key +
      (occ.ended ? " is-done" : "") + (cs.key === "now" ? " is-live" : "") +
      (needsMarking(occ) ? " needs-att" : "") + (menu ? " has-menu" : "");

    var body =
      '<button type="button" class="sch-card__open" data-open-class="' + esc(occ.key) + '" aria-label="' + esc(ariaFor(occ)) + '">' +
        '<span class="sch-card__name">' + esc(occ.name) + "</span>" +
      "</button>";
    if (!coachMode() || occ.coach !== myCoach()) body += '<p class="sch-card__coach">' + esc(occ.coach) + "</p>";

    if (occ.status === "open") {
      var pct = occ.capacity ? Math.min(100, Math.round((occ.booked / occ.capacity) * 100)) : 0;
      body += '<div class="sch-cap" title="' + esc(occ.booked + " of " + occ.capacity + " places booked") + '">' +
          '<span class="sch-cap__bar"><i style="width:' + pct + '%"></i></span>' +
          '<span class="sch-cap__n"><b>' + occ.booked + "</b>/" + occ.capacity + "</span>" +
        "</div>";
    } else {
      var why = occ.reason || (occ.blockKind === "leave" ? "Coach on leave" : "");
      if (why) body += '<p class="sch-card__reason">' + esc(why) + "</p>";
    }
    if (occ.oneOff && occ.note && occ.note !== occ.groupName) body += '<p class="sch-card__note">' + esc(occ.note) + "</p>";

    body += '<div class="sch-card__foot">' +
        '<span class="chips sch-card__chips">' + statusChip(occ) + extraChips(occ) + "</span>" +
        (badge ? '<span class="sch-card__att">' + badge + "</span>" : "") +
      "</div>";

    return '<article class="' + cls + '" data-open-class="' + esc(occ.key) + '">' +
        timeHtml(occ, layout) +
        '<div class="sch-card__body">' + body + "</div>" +
        (menu ? moreButton(occ) : "") +
      "</article>";
  }

  function timeHtml(occ, layout) {
    if (layout === "agenda") {
      return '<p class="sch-card__time sch-card__time--stack"><b>' + esc(fmt.time(occ.time)) + "</b>" +
        "<span>" + esc(fmt.time(occ.endTime)) + "</span></p>";
    }
    return '<p class="sch-card__time"><span>' + shortRange(occ) + "</span></p>";
  }

  function ariaFor(occ) {
    var parts = [occ.name, fmt.date(occ.date), fmt.time(occ.time) + " to " + fmt.time(occ.endTime)];
    if (!coachMode() || occ.coach !== myCoach()) parts.push(occ.coach);
    var cs = h.classState(occ);
    if (occ.status === "removed") parts.push(occ.removedScope === "series" ? "weekly class deleted" : "deleted");
    else if (occ.status === "blocked") parts.push(occ.blockKind === "leave" ? "closed, coach on leave" : "blocked");
    else {
      parts.push(cs.key === "now" ? "happening now" : cs.label.toLowerCase());
      parts.push(occ.booked + " of " + occ.capacity + " booked" + (occ.spotsLeft === 0 ? ", full" : ""));
    }
    if (occ.groupId) {
      var g = groupOf(occ.groupId);
      var n = sessionNumber(g, occ.key);
      parts.push((g && n ? "session " + n + " of " + g.total + ", " : "") + occ.groupName);
    } else if (occ.oneOff) parts.push("one-off class");
    if (occ.substituted) parts.push((who(occ.coach) === "You" ? "you're covering for " : "covering for ") + occ.originalCoach);
    var att = h.attendance(occ);
    if (att.key === "done" || att.key === "todo") parts.push(att.label);
    return parts.join(", ");
  }

  function moreButton(occ) {
    return '<button type="button" class="sch-more" id="schMore-' + safeId(occ.key) + '" data-sch-more="' + esc(occ.key) +
      '" aria-haspopup="menu" aria-expanded="false" aria-controls="schMenu" aria-label="' +
      esc("Actions for " + occ.name + ", " + fmt.date(occ.date) + " " + fmt.time(occ.time)) + '">' +
      icon("more") + "</button>";
  }

  /* ---------- empty week ---------- */
  function emptyHtml(st, totals, dates) {
    var mine = coachMode();
    var forWho = mine ? " for you" : st.coach === "all" ? "" : " for " + st.coach;
    var range = fmt.date(dates[0].iso, "day") + " and " + fmt.date(dates[6].iso, "day");
    var first = Admin.can("oneoff") ? firstAddDay(dates) : null;
    var btns = [];
    if (totals.removed && !st.deleted) {
      btns.push('<button type="button" class="btn btn--ghost btn--sm" data-sch-showdeleted>' + icon("undo") +
        "Show " + esc(plural(totals.removed, "deleted class", "deleted classes")) + "</button>");
    }
    if (!mine && st.coach !== "all") {
      btns.push('<button type="button" class="btn btn--ghost btn--sm" data-sch-coach="all">Show all coaches</button>');
    }
    if (mine) {
      var after = db.addDays(dates[6].iso, 1);
      var next = nextClass(st.coach, after > today() ? after : today());
      if (next && db.weekStart(next.date) !== st.week) {
        btns.push('<button type="button" class="btn btn--quiet btn--sm" data-sch-week="' + db.weekStart(next.date) + '">' +
          icon("calendar") + "Go to your next class · " + esc(fmt.date(next.date)) + "</button>");
      }
    }
    if (first) {
      btns.push('<button type="button" class="btn btn--quiet btn--sm" data-sch-add="' + first + '">' + icon("plus") + "Add a one-off class</button>");
    }
    return '<div class="sch-empty">' + h.empty("calendar",
      mine ? "You have no classes this week" : "No classes this week",
      esc("Nothing is scheduled" + forWho + " between " + range + ".") +
        (totals.removed && !st.deleted ? " " + esc(plural(totals.removed, "deleted class is", "deleted classes are")) + " hidden." : "") +
        (first ? " Pick another week, or add a one-off class." : " Pick another week to see more."),
      btns.length ? '<div class="btn-row sch-empty__actions">' + btns.join("") + "</div>" : "") + "</div>";
  }

  /* ---------- listeners (fresh elements every render) ---------- */
  function bind(el) {
    var navIds = ["schWeekPrev", "schWeekNext", "schWeekToday"];
    el.querySelectorAll(".weeknav [data-week]").forEach(function (b, i) {
      if (navIds[i]) b.id = navIds[i];
      b.addEventListener("click", function () {
        var hadFocus = document.activeElement === b;
        closeMenu(false);
        Admin.setParams({ week: b.getAttribute("data-week") });
        // "Today" disappears once we're on this week — keep keyboard users in the navigator
        if (hadFocus && !document.getElementById(b.id)) focusById("schWeekNext");
      });
    });
    el.querySelectorAll("[data-sch-week]").forEach(function (b) {
      b.addEventListener("click", function () {
        closeMenu(false);
        Admin.setParams({ week: b.getAttribute("data-sch-week") });
        focusById("schWeekNext");
      });
    });

    el.querySelectorAll("[data-sch-coach]").forEach(function (b) {
      b.addEventListener("click", function () { setCoach(b.getAttribute("data-sch-coach")); });
    });
    var sel = el.querySelector("#schCoach");
    if (sel) sel.addEventListener("change", function () { setCoach(sel.value); });

    var del = el.querySelector("#schDeleted");
    if (del) {
      del.addEventListener("change", function () {
        var hadFocus = document.activeElement === del;
        closeMenu(false);
        Admin.setParams({ deleted: del.checked ? "1" : "" });
        // a coach's switch goes away once nothing deleted is left to show
        if (hadFocus && !document.getElementById("schDeleted")) focusById("schWeekNext");
      });
    }
    el.querySelectorAll("[data-sch-showdeleted]").forEach(function (b) {
      b.addEventListener("click", function () { Admin.setParams({ deleted: "1" }); });
    });

    var add = el.querySelector("#schAdd");
    if (add) {
      add.addEventListener("click", function () {
        var st = readParams(Admin.params());
        Admin.addOneOff({ date: add.getAttribute("data-date") || "", coach: st.coach !== "all" ? st.coach : "" });
      });
    }
    el.querySelectorAll("[data-sch-add]").forEach(function (b) {
      b.addEventListener("click", function () {
        var st = readParams(Admin.params());
        Admin.addOneOff({ date: b.getAttribute("data-sch-add"), coach: st.coach !== "all" ? st.coach : "" });
      });
    });

    el.querySelectorAll("[data-sch-more]").forEach(function (b) {
      b.addEventListener("click", function (e) {
        // the card behind opens the class drawer — this button must not
        e.preventDefault();
        e.stopPropagation();
        if (ui.menu && ui.menu.btnId === b.id) closeMenu(true);
        else openMenu(b);
      });
      b.addEventListener("keydown", function (e) {
        if ((e.key === "ArrowDown" || e.key === "ArrowUp") && !(ui.menu && ui.menu.btnId === b.id)) {
          e.preventDefault();
          openMenu(b, e.key === "ArrowUp");
        }
      });
    });

    var earlier = el.querySelector("#schEarlier");
    if (earlier) {
      earlier.addEventListener("click", function () {
        ui.showPast = !ui.showPast;
        closeMenu(false);
        Admin.setParams({});
      });
    }

    var scroller = el.querySelector(".sch-scroll");
    if (scroller) {
      scroller.addEventListener("scroll", function () {
        closeMenu(false);
        updateEdges(scroller);
      });
      el.querySelectorAll("[data-sch-edge]").forEach(function (b) {
        b.addEventListener("click", function () {
          var col = scroller.querySelector(".sch-day");
          var step = (col ? col.offsetWidth : 160) + GRID_GAP;
          var left = scroller.scrollLeft + step * (+b.getAttribute("data-sch-edge"));
          try { scroller.scrollTo({ left: left, behavior: "smooth" }); }
          catch (e) { scroller.scrollLeft = left; }
        });
      });
    }
  }

  function focusById(id) {
    var el = document.getElementById(id);
    if (el) { try { el.focus({ preventScroll: true }); } catch (e) {} }
  }

  /* ============================================================
     CARD MENU — one shared popover on <body>, so the scrolling
     week grid never clips it.
     ============================================================ */
  var menuEl = null;

  function getMenu() {
    if (menuEl && document.body.contains(menuEl)) return menuEl;
    menuEl = document.createElement("div");
    menuEl.className = "sch-menu";
    menuEl.id = "schMenu";
    menuEl.setAttribute("role", "menu");
    menuEl.hidden = true;
    menuEl.addEventListener("click", onMenuClick);
    menuEl.addEventListener("keydown", onMenuKey);
    document.body.appendChild(menuEl);
    return menuEl;
  }

  // Admins see every action (greyed out with the reason when it can't be used).
  // Coaches get only what they can do right now: view, block / reopen, delete this date.
  function menuItems(occ) {
    var admin = !coachMode();
    var startedHint = occ.ended ? "Class has ended" : "Class has started";
    var main = [];
    var danger = [];

    if (occ.status === "removed") {
      var series = occ.removedScope === "series";
      var restore = { act: "restore", ic: "undo", label: series ? "Restore weekly class" : "Restore class" };
      if (occ.ended) { restore.hint = "Class has ended"; restore.disabled = true; }
      else if (series && !Admin.can("series")) { restore.hint = "Only an admin can restore this"; restore.disabled = true; }
      else restore.hint = series ? "Brings back every following week" : "Opens it for booking again";
      if (admin || !restore.disabled) main.push(restore);
    } else {
      if (occ.status === "open") {
        if (!occ.started) main.push({ act: "block", ic: "ban", label: "Block class", hint: "Stop parents booking this date" });
        else if (admin) main.push({ act: "block", ic: "ban", label: "Block class", hint: startedHint, disabled: true });
      } else if (!occ.ended) {
        main.push(occ.blockKind === "manual"
          ? { act: "unblock", ic: "undo", label: "Reopen class", hint: "Let parents book again" }
          : { act: "unblock", ic: "leave", label: "Reopen class…", hint: "Closed while the coach is on leave" });
      } else if (admin) {
        main.push({ act: "unblock", ic: occ.blockKind === "manual" ? "undo" : "leave", label: "Reopen class", hint: "Class has ended", disabled: true });
      }
      if (Admin.can("substitute")) {
        main.push(occ.started
          ? { act: "coach", ic: "swap", label: "Change coach…", hint: startedHint, disabled: true }
          : { act: "coach", ic: "swap", label: "Change coach…",
              hint: occ.templateId ? "For this date or every week" : "For " + fmt.date(occ.date) });
      }
      if (!occ.started) {
        danger.push({ act: "delete", ic: "trash", label: "Delete this date…", hint: "Only " + fmt.date(occ.date), danger: true });
      } else if (admin) {
        danger.push({ act: "delete", ic: "trash", label: "Delete this date…", hint: startedHint, disabled: true, danger: true });
      }
      if (Admin.can("oneoff") && occ.groupId && !occ.started) {
        var later = groupTargets(occ).length - 1;
        if (later > 0) {
          danger.push({ act: "group", ic: "trash", label: "Delete this and later sessions…",
            hint: plural(later + 1, "session") + " of " + occ.groupName, danger: true });
        }
      }
      if (Admin.can("series") && occ.templateId) {
        danger.push(occ.started
          ? { act: "series", ic: "trash", label: "Delete this and later weeks…", hint: startedHint, disabled: true, danger: true }
          : { act: "series", ic: "trash", label: "Delete this and later weeks…", hint: "Stops the weekly class from " + fmt.date(occ.date), danger: true });
      }
    }

    var items = [{ act: "open", ic: "users", label: "View class & students" }];
    if (main.length) items = items.concat(["sep"], main);
    if (danger.length) items = items.concat(["sep"], danger);
    return items;
  }

  // a ⋯ button only when there's more to do than open the class
  function hasMenu(occ) {
    if (!Admin.can("manage", occ)) return false;
    return menuItems(occ).some(function (it) { return it !== "sep" && it.act !== "open"; });
  }

  function paintMenu(occ, btn) {
    var m = getMenu();
    m.setAttribute("aria-label", "Actions for " + occ.name + ", " + fmt.date(occ.date));
    m.innerHTML =
      '<p class="sch-menu__head" aria-hidden="true"><strong>' + esc(occ.name) + "</strong>" +
        "<span>" + esc(fmt.date(occ.date) + " · " + fmt.time(occ.time)) + "</span></p>" +
      menuItems(occ).map(function (it) {
        if (it === "sep") return '<div class="sch-menu__sep" role="separator"></div>';
        return '<button type="button" role="menuitem" tabindex="-1" class="sch-menu__item' + (it.danger ? " sch-menu__item--danger" : "") +
            '" data-sch-act="' + it.act + '"' + (it.disabled ? ' aria-disabled="true"' : "") + ">" +
            icon(it.ic) +
            '<span class="sch-menu__text"><span class="sch-menu__label">' + esc(it.label) + "</span>" +
              (it.hint ? '<span class="sch-menu__hint">' + esc(it.hint) + "</span>" : "") +
            "</span>" +
          "</button>";
      }).join("");
    m.hidden = false;
    placeMenu(m, btn);
  }

  function placeMenu(m, btn) {
    // phones: a sheet above the tab bar instead of a popover
    var sheet = isPhone();
    m.classList.toggle("is-sheet", sheet);
    if (sheet) {
      m.style.left = "";
      m.style.top = "";
      m.classList.remove("is-up");
      return;
    }
    var r = btn.getBoundingClientRect();
    var vw = window.innerWidth || document.documentElement.clientWidth;
    var vh = window.innerHeight || document.documentElement.clientHeight;
    var bottom = vh - 8;
    var mw = m.offsetWidth || 250;
    var mh = m.offsetHeight || 0;
    var left = Math.max(8, Math.min(r.right - mw, vw - mw - 8));
    var top = r.bottom + 6;
    var up = top + mh > bottom && r.top - mh - 6 > 8;
    if (up) top = r.top - mh - 6;
    m.style.left = Math.round(left) + "px";
    m.style.top = Math.round(Math.max(8, top)) + "px";
    m.classList.toggle("is-up", up);
  }

  function menuButtons() {
    return menuEl ? Array.prototype.slice.call(menuEl.querySelectorAll("[role=menuitem]")) : [];
  }

  function openMenu(btn, fromEnd) {
    var key = btn.getAttribute("data-sch-more");
    var occ = db.occurrence(key);
    if (!occ) return;
    closeMenu(false);
    ui.menu = { key: key, btnId: btn.id };
    btn.setAttribute("aria-expanded", "true");
    paintMenu(occ, btn);
    var items = menuButtons();
    var target = fromEnd ? items[items.length - 1] : items[0];
    if (target) { try { target.focus({ preventScroll: true }); } catch (e) {} }
  }

  function closeMenu(focusButton) {
    if (!ui.menu) return;
    var btn = document.getElementById(ui.menu.btnId);
    ui.menu = null;
    if (menuEl) { menuEl.hidden = true; menuEl.innerHTML = ""; }
    if (btn) {
      btn.setAttribute("aria-expanded", "false");
      if (focusButton) { try { btn.focus({ preventScroll: true }); } catch (e) {} }
    }
  }

  // After a re-render the card buttons are new elements: re-attach or close.
  function reanchorMenu() {
    if (!ui.menu) return;
    var btn = document.getElementById(ui.menu.btnId);
    var occ = btn && db.occurrence(ui.menu.key);
    if (!btn || !occ || !hasMenu(occ)) { closeMenu(false); return; }
    var focused = document.activeElement;
    var act = focused && menuEl && menuEl.contains(focused) ? focused.getAttribute("data-sch-act") : null;
    btn.setAttribute("aria-expanded", "true");
    paintMenu(occ, btn);
    if (act) {
      var again = menuEl.querySelector('[data-sch-act="' + act + '"]');
      if (again) { try { again.focus({ preventScroll: true }); } catch (e) {} }
    }
  }

  function onMenuClick(e) {
    var it = e.target.closest("[data-sch-act]");
    if (!it || !ui.menu) return;
    e.preventDefault();
    if (it.getAttribute("aria-disabled") === "true") return;
    var key = ui.menu.key;
    var act = it.getAttribute("data-sch-act");
    closeMenu(true);
    switch (act) {
      case "open": if (Admin.openClass) Admin.openClass(key); break;
      case "block": Admin.blockClass(key); break;
      case "unblock": Admin.unblockClass(key); break;
      case "delete": Admin.deleteClass(key); break;
      case "series": Admin.deleteClass(key, { scope: "series" }); break;
      case "group": Admin.deleteClass(key, { scope: "group" }); break;
      case "restore": Admin.restoreClass(key); break;
      case "coach": Admin.substituteCoach(key); break;
    }
  }

  function onMenuKey(e) {
    var items = menuButtons();
    if (!items.length) return;
    var i = items.indexOf(document.activeElement);
    var next = null;
    if (e.key === "ArrowDown") next = items[(i + 1) % items.length];
    else if (e.key === "ArrowUp") next = items[(i - 1 + items.length) % items.length];
    else if (e.key === "Home") next = items[0];
    else if (e.key === "End") next = items[items.length - 1];
    else if (e.key === "Tab") { e.preventDefault(); closeMenu(true); return; }
    if (next) {
      e.preventDefault();
      try { next.focus({ preventScroll: true }); } catch (err) {}
    }
  }

  // Registered before the core boots, so Escape closes the menu without
  // also closing an open drawer.
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && ui.menu) {
      e.preventDefault();
      e.stopImmediatePropagation();
      closeMenu(true);
    }
  });
  // capture: close on any outside click, even ones other handlers stop
  document.addEventListener("click", function (e) {
    if (!ui.menu) return;
    if (menuEl && menuEl.contains(e.target)) return;
    var btn = document.getElementById(ui.menu.btnId);
    if (btn && btn.contains(e.target)) return;
    closeMenu(false);
  }, true);
  // keep the menu beside its button when the window resizes (phones do this a lot)
  window.addEventListener("resize", function () {
    var scroller = document.querySelector(".sch-scroll");
    if (scroller) updateEdges(scroller);
    if (!ui.menu) return;
    var btn = document.getElementById(ui.menu.btnId);
    if (btn && menuEl && !menuEl.hidden) placeMenu(menuEl, btn);
    else closeMenu(false);
  });
  window.addEventListener("scroll", function (e) {
    if (ui.menu && !(menuEl && e.target instanceof Node && menuEl.contains(e.target))) closeMenu(false);
  }, true);
  window.addEventListener("hashchange", function () { closeMenu(false); });

  // switch between week grid and agenda when the screen crosses the phone size
  if (window.matchMedia) {
    try {
      var mq = window.matchMedia(PHONE_QUERY);
      var onMq = function () {
        closeMenu(false);
        if (Admin.currentView && Admin.currentView() === "schedule") Admin.refresh();
      };
      if (mq.addEventListener) mq.addEventListener("change", onMq);
      else if (mq.addListener) mq.addListener(onMq);
    } catch (e) { /* no media queries — the grid scrolls instead */ }
  }

  /* ============================================================
     SHARED MODAL BITS
     ============================================================ */
  function setErr(card, id, msg) {
    var input = card.querySelector("#" + id);
    var err = card.querySelector("#" + id + "Err");
    if (input) {
      input.classList.toggle("invalid", !!msg);
      if (msg) input.setAttribute("aria-invalid", "true");
      else input.removeAttribute("aria-invalid");
    }
    if (err) err.textContent = msg || "";
  }

  function formErr(card, msg) {
    var p = card.querySelector(".sch-form-error");
    if (p) p.textContent = msg || "";
  }

  function errSlot(id) {
    return '<p class="field-error form-error" id="' + id + 'Err" aria-live="polite"></p>';
  }

  // links to other pages inside a modal: close the modal, let the core navigate
  function bindGoLinks(card) {
    card.querySelectorAll("[data-go]").forEach(function (b) {
      b.addEventListener("click", function () { Admin.closeModal(); });
    });
  }

  // Return focus to whatever launched the modal (card menu button, drawer button…)
  function rememberFocus() {
    var a = document.activeElement;
    var id = a && a.id && a !== document.body ? a.id : null;
    return function () {
      if (!id) return;
      setTimeout(function () {
        if (Admin.modalOpen()) return;
        var a2 = document.activeElement;
        if (a2 && a2 !== document.body && document.body.contains(a2)) return;
        focusById(id);
      }, 0);
    };
  }

  function findOcc(key) {
    var occ = key ? db.occurrence(key) : null;
    if (!occ) Admin.toast("warn", "That class couldn't be found — it may have just changed.");
    return occ;
  }

  function mayManage(occ) {
    if (Admin.can("manage", occ)) return true;
    Admin.toast("warn", "You can only change your own classes.");
    return false;
  }

  function notStarted(occ, tail) {
    if (!occ.started) return true;
    Admin.toast("info", "This class has already " + (occ.ended ? "ended" : "started") + " — " + tail + ".");
    return false;
  }

  function choice(name, value, title, desc, checked) {
    var id = name + "-" + value;
    return '<label class="choice" for="' + id + '">' +
        '<input type="radio" name="' + name + '" id="' + id + '" value="' + value + '"' + (checked ? " checked" : "") + " />" +
        '<span><span class="choice__t">' + esc(title) + '</span><span class="choice__d">' + esc(desc) + "</span></span>" +
      "</label>";
  }

  function refundedTail(n) {
    return n > 0 ? " — " + plural(n, "student") + " refunded and notified (coach on leave)." : ".";
  }

  /* ============================================================
     BLOCK / REOPEN
     ============================================================ */
  Admin.blockClass = function (key) {
    var occ = findOcc(key);
    if (!occ || !mayManage(occ)) return;
    if (occ.status === "removed") { Admin.toast("info", "This class has been deleted."); return; }
    if (occ.status === "blocked") {
      Admin.toast("info", occ.blockKind === "leave"
        ? occ.coach + " is on leave that day — this class is already closed."
        : "This class is already blocked.");
      return;
    }
    if (!notStarted(occ, "it can't be blocked now")) return;

    var focusBack = rememberFocus();
    var n = occ.booked;
    var you = who(occ.coach) === "You";
    Admin.openModal({
      title: "Block this class?",
      sub: occSub(occ),
      body:
        '<form class="sch-form" id="schBlockForm" novalidate>' +
          '<div class="field">' +
            '<label for="schBlockReason">Why is it unavailable?</label>' +
            '<select id="schBlockReason">' + h.options(BLOCK_REASONS) + "</select>" +
          "</div>" +
          '<div class="field">' +
            '<label for="schBlockNote">Details <span class="field__opt">(optional)</span></label>' +
            '<input type="text" id="schBlockNote" maxlength="140" autocomplete="off" placeholder="e.g. Back on Thursday" aria-describedby="schBlockNoteErr" />' +
            errSlot("schBlockNote") +
          "</div>" +
          h.notice(n ? "warn" : "info",
            "<p>" + (n ? refundText(n, occ.cost) : "No one has booked this class yet.") +
            " Parents will see this class as unavailable.</p>") +
          '<p class="sch-aside">' + icon("leave") + "<span>" +
            (you ? "Away the whole day? " : "Is " + esc(occ.coach) + " away the whole day? ") +
            '<button type="button" class="sch-link" data-go="leave" data-params="' +
              esc(JSON.stringify({ add: "1", date: occ.date, coach: occ.coach })) + '">Book leave instead</button>' +
            " — it closes every class that day in one go.</span></p>" +
          '<p class="field-error form-error sch-form-error" role="alert"></p>' +
        "</form>",
      actions:
        '<button type="button" class="btn btn--ghost" data-close>Keep it open</button>' +
        '<button type="submit" form="schBlockForm" class="btn btn--danger-solid" id="schBlockGo">' + icon("ban") + "Block class</button>",
      onClose: focusBack,
      onOpen: function (card) {
        var form = card.querySelector("#schBlockForm");
        var reason = card.querySelector("#schBlockReason");
        var note = card.querySelector("#schBlockNote");
        bindGoLinks(card);
        reason.addEventListener("change", function () {
          setErr(card, "schBlockNote", "");
          note.placeholder = reason.value === "Other" ? "What's happening? (required)" : "e.g. Back on Thursday";
        });
        note.addEventListener("input", function () { setErr(card, "schBlockNote", ""); });
        form.addEventListener("submit", function (e) {
          e.preventDefault();
          var r = reason.value;
          var extra = note.value.trim();
          if (r === "Other" && !extra) {
            setErr(card, "schBlockNote", "Add a few words so everyone knows why.");
            note.focus();
            return;
          }
          var now = db.occurrence(key);
          if (!now || now.status !== "open" || now.started || !Admin.can("manage", now)) {
            formErr(card, "This class has changed in the meantime — close this window and check it again.");
            return;
          }
          var res = db.blockOccurrence(key, { by: Admin.by(), reason: r + (extra ? " — " + extra : "") });
          var msg = res.ok ? (res.refunded
            ? "Class blocked — " + plural(res.refunded, "student") + " refunded and notified."
            : "Class blocked — parents can't book it now.") : null;
          if (!Admin.check(res, msg)) { formErr(card, res.error); return; }
          Admin.closeModal();
        });
      }
    });
  };

  Admin.unblockClass = function (key) {
    var occ = findOcc(key);
    if (!occ || !mayManage(occ)) return;
    if (occ.status !== "blocked") { Admin.toast("info", "This class isn't blocked."); return; }
    if (occ.ended) { Admin.toast("info", "This class has already ended."); return; }
    var focusBack = rememberFocus();

    if (occ.blockKind === "leave") {
      var canSwap = Admin.can("substitute") && !occ.started;
      var lv = db.leaveFor(occ.coach, occ.date);
      var you = who(occ.coach) === "You";
      Admin.openModal({
        title: "Closed for leave",
        sub: occSub(occ),
        size: "sm",
        body: h.notice("info",
          "<p><strong>" + (you ? "You're" : esc(occ.coach) + " is") + " on leave on " + esc(fmt.date(occ.date, "long")) + "</strong>" +
            (lv && lv.reason ? " (" + esc(lv.reason) + ")" : "") + ", so every class " + (you ? "you teach" : "they teach") + " that day is closed.</p>" +
          "<p>To reopen this class, cancel the leave on the Leave page" +
            (canSwap ? " — or hand the class to another coach." : ".") + "</p>"),
        actions:
          '<button type="button" class="btn btn--ghost" data-close>Close</button>' +
          (canSwap ? '<button type="button" class="btn btn--ghost" id="schLeaveSwap">' + icon("swap") + "Change coach</button>" : "") +
          '<button type="button" class="btn btn--primary" id="schLeaveGo" data-go="leave">' + icon("leave") + "Go to Leave</button>",
        onClose: focusBack,
        onOpen: function (card) {
          bindGoLinks(card);
          var swap = card.querySelector("#schLeaveSwap");
          if (swap) {
            swap.addEventListener("click", function () {
              Admin.closeModal();
              Admin.substituteCoach(key);
            });
          }
        }
      });
      return;
    }

    Admin.confirm({
      title: "Reopen this class?",
      sub: occSub(occ),
      body:
        "<p>Parents will be able to book <strong>" + esc(occ.name) + "</strong> on " + esc(fmt.date(occ.date, "long")) + " again.</p>" +
        "<p>Students removed when it was blocked aren't added back — their credits were refunded, so they'll need to book again.</p>",
      confirmLabel: "Reopen class"
    }).then(function (yes) {
      if (yes) {
        var res = db.unblockOccurrence(key, { by: Admin.by() });
        Admin.check(res, "Class reopened — parents can book it again.");
      }
      focusBack();
    });
  };

  /* ============================================================
     DELETE / RESTORE
     ============================================================ */
  function seriesImpact(occ) {
    var dates = {};
    var list = db.bookings({ status: "booked", from: occ.date }).filter(function (b) {
      return b.templateId === occ.templateId;
    });
    list.forEach(function (b) { dates[b.date] = 1; });
    return { bookings: list.length, dates: Object.keys(dates).length };
  }

  // first date of a deleted weekly run (walks back week by week)
  function seriesStart(occ) {
    var d = occ.date;
    for (var i = 0; i < 520; i++) {
      var prev = db.occurrence(db.occKey(db.addDays(d, -7), occ.templateId));
      if (!prev || prev.status !== "removed" || prev.removedScope !== "series") break;
      d = prev.date;
    }
    return d;
  }

  Admin.deleteClass = function (key, opts) {
    opts = opts || {};
    var occ = findOcc(key);
    if (!occ || !mayManage(occ)) return;
    if (occ.status === "removed") { Admin.toast("info", "This class is already deleted."); return; }
    if (!notStarted(occ, "it can't be deleted now")) return;
    var seriesOk = !!occ.templateId && Admin.can("series");
    if (opts.scope === "series" && !seriesOk) {
      Admin.toast("warn", occ.templateId
        ? "Only an admin can delete a weekly class."
        : "One-off classes don't repeat — there's no weekly class to delete.");
      return;
    }

    // camps: this session and the later ones, together (admin)
    var groupList = occ.groupId && Admin.can("oneoff") ? groupTargets(occ) : [];
    var groupOk = groupList.length > 1;
    if (opts.scope === "group" && !groupOk) {
      Admin.toast("warn", !occ.groupId ? "This class isn't part of a group of sessions."
        : !Admin.can("oneoff") ? "Only an admin can delete several sessions at once."
        : "There are no later sessions — delete this date on its own.");
      return;
    }

    var focusBack = rememberFocus();
    var scope = opts.scope === "series" || opts.scope === "group" ? opts.scope : "one";
    var impact = seriesOk ? seriesImpact(occ) : null;
    var groupLast = groupOk ? groupList[groupList.length - 1] : null;
    var dayName = HC.dayNames[occ.day];
    var when = fmt.time(occ.time);
    var date = fmt.date(occ.date);
    var SERIES_LABEL = "Delete this and later weeks";

    Admin.openModal({
      title: "Delete class",
      sub: occSub(occ),
      body:
        '<form class="sch-form" id="schDelForm" novalidate>' +
          '<fieldset class="sch-fieldset">' +
            '<legend class="field__label">What should be deleted?</legend>' +
            '<div class="choices">' +
              choice("schScope", "one", "Only " + date,
                occ.groupId ? "The other sessions of " + occ.groupName + " stay as they are."
                  : occ.oneOff ? "This one-off class won't run." : "The weekly class carries on as usual on other dates.",
                scope === "one") +
              (groupOk ? choice("schScope", "group",
                "This and the " + plural(groupList.length - 1, "later session") + " of " + occ.groupName,
                "Every session from " + date + " to " + fmt.date(groupLast.date) + ". Earlier sessions stay.",
                scope === "group") : "") +
              (seriesOk ? choice("schScope", "series", "This and later weeks",
                "Every " + dayName + " at " + when + ", from " + date + " onwards.", scope === "series") : "") +
            "</div>" +
          "</fieldset>" +
          (occ.templateId && !seriesOk
            ? '<p class="field__hint sch-hint">Need to stop this weekly class for good? Ask the studio admin.</p>' : "") +
          '<div class="field">' +
            '<label for="schDelReason">Reason <span class="field__opt">(optional)</span></label>' +
            '<input type="text" id="schDelReason" maxlength="140" autocomplete="off" placeholder="e.g. Hall booked for grading" />' +
          "</div>" +
          '<div id="schDelImpact" aria-live="polite"></div>' +
          '<p class="sch-aside">' + icon("undo") + '<span id="schDelUndo"></span></p>' +
          '<p class="field-error form-error sch-form-error" role="alert"></p>' +
        "</form>",
      actions:
        '<button type="button" class="btn btn--ghost" data-close>Keep class</button>' +
        '<button type="submit" form="schDelForm" class="btn btn--danger-solid" id="schDelGo">' + icon("trash") + "Delete class</button>",
      onClose: focusBack,
      onOpen: function (card) {
        var form = card.querySelector("#schDelForm");
        var box = card.querySelector("#schDelImpact");
        var go = card.querySelector("#schDelGo");

        function current() {
          var r = card.querySelector('input[name="schScope"]:checked');
          if (r && r.value === "series" && seriesOk) return "series";
          if (r && r.value === "group" && groupOk) return "group";
          return "one";
        }

        function paint() {
          var s = current();
          var n = occ.booked;
          card.querySelector("#schDelUndo").textContent = "Changed your mind? Tick “Show deleted” on " + scheduleName() +
            (s === "group" ? " to restore sessions one at a time." : " to restore it.");
          if (s === "series") {
            box.innerHTML = h.notice("warn",
              "<p><strong>This changes the weekly timetable.</strong> " + esc(occ.name) + " stops running every " +
                esc(dayName) + " at " + esc(when) + " from " + esc(date) + ".</p>" +
              "<p>" + (impact.bookings
                ? "<strong>" + esc(plural(impact.bookings, "booked student")) + "</strong> across " +
                  esc(plural(impact.dates, "date")) + " will be refunded and notified."
                : "No upcoming bookings are affected.") + "</p>");
            go.innerHTML = icon("trash") + SERIES_LABEL;
          } else if (s === "group") {
            var nb = 0, withB = 0;
            groupList.forEach(function (o) { nb += o.booked; if (o.booked) withB++; });
            box.innerHTML = h.notice(nb ? "warn" : "info",
              "<p><strong>" + esc(plural(groupList.length, "session")) + "</strong> of " + esc(occ.groupName) +
                " will be deleted — " + nw(date) + " to " + nw(fmt.date(groupLast.date)) + ".</p>" +
              "<p>" + (nb
                ? "<strong>" + esc(plural(nb, "booked student")) + "</strong> across " + esc(plural(withB, "session")) +
                  " will be refunded and notified."
                : "No one has booked these sessions yet.") + "</p>");
            go.innerHTML = icon("trash") + esc("Delete " + plural(groupList.length, "session"));
          } else {
            box.innerHTML = h.notice(n ? "warn" : "info",
              "<p>" + (n
                ? "<strong>" + esc(plural(n, "booked student")) + "</strong> will be refunded " + esc(plural(occ.cost, "credit")) +
                  (n === 1 ? "" : " each") + " and notified."
                : "No one has booked this date yet.") +
              " Parents won't see this class on " + esc(date) + " any more.</p>");
            go.innerHTML = icon("trash") + "Delete class";
          }
        }

        card.querySelectorAll('input[name="schScope"]').forEach(function (r) {
          r.addEventListener("change", paint);
        });
        paint();
        // the core focuses the first field; start on the chosen option instead
        if (scope !== "one") {
          setTimeout(function () {
            var chosen = card.querySelector("#schScope-" + scope);
            if (chosen && Admin.modalOpen()) chosen.focus();
          }, 0);
        }

        form.addEventListener("submit", function (e) {
          e.preventDefault();
          var s = current();
          var now = db.occurrence(key);
          if (!now || now.status === "removed" || now.started || !Admin.can("manage", now)) {
            formErr(card, "This class has changed in the meantime — close this window and check it again.");
            return;
          }
          var res = db.removeOccurrence(key, {
            by: Admin.by(), scope: s, reason: card.querySelector("#schDelReason").value.trim()
          });
          var msg = res.ok
            ? (s === "series" ? "Weekly class deleted from " + date + " onwards"
              : s === "group" ? "Deleted " + plural(res.sessions || 0, "session") + " of " + occ.groupName + " from " + date
              : "Class deleted for " + date) +
              (res.refunded ? " — " + plural(res.refunded, "student") + " refunded and notified." : ".")
            : null;
          if (!Admin.check(res, msg)) { formErr(card, res.error); return; }
          Admin.closeModal();
        });
      }
    });
  };

  Admin.restoreClass = function (key) {
    var occ = findOcc(key);
    if (!occ || !mayManage(occ)) return;
    if (occ.status !== "removed") { Admin.toast("info", "This class isn't deleted."); return; }
    var series = occ.removedScope === "series";
    if (series && !Admin.can("series")) { Admin.toast("warn", "Only an admin can restore a weekly class."); return; }
    if (occ.ended) { Admin.toast("info", "This class has already ended — there's nothing to restore."); return; }

    var focusBack = rememberFocus();
    var lv = db.leaveFor(occ.coach, occ.date);
    var body = series
      ? "<p><strong>" + esc(occ.name) + "</strong> will run every " + esc(HC.dayNames[occ.day]) + " at " + esc(fmt.time(occ.time)) +
        " again — every week from " + esc(fmt.date(seriesStart(occ), "full")) + " onwards comes back.</p>"
      : "<p><strong>" + esc(occ.name) + "</strong> on " + esc(fmt.date(occ.date, "long")) +
        " goes back on the timetable and opens for booking.</p>";
    body += "<p>Bookings refunded when it was deleted aren't brought back — parents will need to book again.</p>";
    if (lv) {
      body += h.notice("warn", "<p>" + esc(occ.coach) + " is on leave on " + esc(fmt.date(occ.date)) +
        ", so this date stays closed until the leave is cancelled.</p>");
    }

    Admin.confirm({
      title: series ? "Restore the weekly class?" : "Restore this class?",
      sub: occSub(occ),
      body: body,
      confirmLabel: series ? "Restore weekly class" : "Restore class"
    }).then(function (yes) {
      if (yes) {
        var res = db.restoreOccurrence(key, { by: Admin.by() });
        var after = res.ok ? db.occurrence(key) : null;
        var msg;
        if (after && after.status === "removed") {
          // the weekly class is back, but this date was also deleted on its own
          msg = (series ? "Weekly class restored — " : "Class restored — ") + fmt.date(after.date) +
            " is still deleted on its own" + (after.reason ? " (" + after.reason + ")" : "") +
            ". Restore it again to reopen that date.";
        } else if (after && after.status === "blocked") {
          msg = (series ? "Weekly class restored" : "Class restored") + " — still closed while " + after.coach + " is on leave.";
        } else {
          msg = (series ? "Weekly class restored" : "Class restored") + " — parents can book it again.";
        }
        Admin.check(res, msg);
      }
      focusBack();
    });
  };

  /* ============================================================
     CHANGE COACH (admin) — one date, or every week from a date
     ============================================================ */
  // other dates of this weekly class (after `from`) already covered by someone
  function laterCovers(occ, weeks) {
    var out = [];
    for (var i = 1; i <= weeks; i++) {
      var o = db.occurrence(db.occKey(db.addDays(occ.date, 7 * i), occ.templateId));
      if (o && o.substituted && o.status !== "removed") out.push(o);
    }
    return out;
  }

  // weekly classes this coach already teaches that overlap this slot
  function weeklyClashes(coach, occ) {
    var s = db.toMinutes(occ.time), e = s + occ.duration;
    return db.weeklyClassesFor(coach, occ.date).filter(function (w) {
      if (w.templateId === occ.templateId || w.day !== occ.day) return false;
      var ws = db.toMinutes(w.time), we = ws + w.duration;
      return s < we && ws < e;
    });
  }

  Admin.substituteCoach = function (key) {
    var occ = findOcc(key);
    if (!occ) return;
    if (!Admin.can("substitute")) { Admin.toast("warn", "Only an admin can change the coach."); return; }
    if (occ.status === "removed") { Admin.toast("info", "This class has been deleted."); return; }
    if (!notStarted(occ, "the coach can't be changed now")) return;

    var focusBack = rememberFocus();
    var weekly = !!occ.templateId;
    var date = fmt.date(occ.date);
    var dayName = HC.dayNames[occ.day];

    Admin.openModal({
      title: "Change coach",
      sub: occSub(occ),
      body:
        '<form class="sch-form" id="schSubForm" novalidate>' +
          '<div class="field">' +
            '<label for="schSubCoach">Who’s taking this class?</label>' +
            '<select id="schSubCoach">' + h.coachOptions(occ.coach) + "</select>" +
          "</div>" +
          (weekly
            ? '<fieldset class="sch-fieldset sch-fieldset--gap">' +
                '<legend class="field__label">For which dates?</legend>' +
                '<div class="choices">' +
                  choice("schSubScope", "one", "Only " + date,
                    "A cover for this date. The weekly class stays with " + occ.originalCoach + ".", true) +
                  choice("schSubScope", "weekly", "Every week from " + date,
                    "The new coach takes over every " + dayName + " at " + fmt.time(occ.time) + " from this date on.", false) +
                "</div>" +
              "</fieldset>"
            : '<p class="field__hint">One-off class — only ' + esc(date) + " is affected.</p>") +
          '<div id="schSubCheck" aria-live="polite"></div>' +
          '<p class="field-error form-error sch-form-error" role="alert"></p>' +
        "</form>",
      actions:
        '<button type="button" class="btn btn--ghost" data-close>Cancel</button>' +
        '<button type="submit" form="schSubForm" class="btn btn--primary" id="schSubGo">' + icon("swap") + "Change coach</button>",
      onClose: focusBack,
      onOpen: function (card) {
        var form = card.querySelector("#schSubForm");
        var sel = card.querySelector("#schSubCoach");
        var box = card.querySelector("#schSubCheck");
        var go = card.querySelector("#schSubGo");

        // mark the weekly timetable's coach in the list
        Array.prototype.forEach.call(sel.options, function (o) {
          if (o.value === occ.originalCoach && weekly) o.textContent += " (timetabled)";
        });

        function scope() {
          var r = card.querySelector('input[name="schSubScope"]:checked');
          return weekly && r && r.value === "weekly" ? "weekly" : "one";
        }

        function paintOne(c, out) {
          var lv = db.leaveFor(c, occ.date);
          var cl = openClashes(occ.date, occ.time, occ.duration, c, key);
          if (lv) {
            out.push(h.notice("warn", "<p><strong>" + esc(c) + " is on leave that day</strong>" +
              (lv.reason ? " (" + esc(lv.reason) + ")" : "") + ". The class will stay closed" +
              (occ.booked ? " and " + refundText(occ.booked, occ.cost).replace(" will be removed,", " will be") : ".") + "</p>"));
          }
          if (cl.length) {
            out.push(h.notice("warn", "<p><strong>Timetable clash</strong> — " + esc(c) + " already teaches " + clashList(cl) + " that day.</p>"));
          }
          if (!lv && occ.blockKind === "leave") {
            out.push(h.notice("ok", "<p>The class reopens for booking because " + esc(c) + " isn’t on leave.</p>"));
          } else if (!lv && !cl.length) {
            out.push(h.notice("ok", "<p>" + esc(c) + " is free at this time." +
              (c === occ.originalCoach ? " The class goes back to its timetabled coach." : "") + "</p>"));
          }
        }

        function paintWeekly(c, out) {
          var leaves = db.leaves({ coach: c, from: occ.date }).filter(function (l) { return db.dayIndex(l.date) === occ.day; });
          if (leaves.length) {
            var hit = 0;
            leaves.forEach(function (l) {
              hit += db.bookings({ occKey: db.occKey(l.date, occ.templateId), status: "booked" }).length;
            });
            out.push(h.notice("warn", "<p><strong>" + esc(c) + " is on leave on " +
              leaves.map(function (l) { return nw(fmt.date(l.date)); }).join(", ") + "</strong>. " +
              (leaves.length === 1 ? "That date stays" : "Those dates stay") + " closed" +
              (hit ? " and " + "<strong>" + esc(plural(hit, "booked student")) + "</strong> will be refunded and notified." : ".") + "</p>"));
          }
          var wk = weeklyClashes(c, occ);
          var cl = openClashes(occ.date, occ.time, occ.duration, c, key).filter(function (o) {
            return !wk.some(function (w) { return w.templateId === o.templateId; });
          });
          if (wk.length) {
            out.push(h.notice("warn", "<p><strong>Timetable clash</strong> — " + esc(c) + " already teaches " +
              wk.map(function (w) {
                return "<strong>" + esc(w.name) + "</strong> (" + nw(fmt.time(w.time)) + ")";
              }).join(", ") + " every " + esc(dayName) + ".</p>"));
          }
          if (cl.length) {
            out.push(h.notice("warn", "<p><strong>Clash on " + esc(date) + "</strong> — " + esc(c) + " also teaches " + clashList(cl) + ".</p>"));
          }
          var notes = [];
          if (occ.substituted && occ.coach !== c) {
            notes.push("The cover arranged for " + esc(date) + " (" + esc(occ.coach) + ") is replaced — " + esc(c) + " takes that date too.");
          }
          var covers = laterCovers(occ, 12).filter(function (o) { return o.coach !== c; });
          if (covers.length) {
            notes.push("Covers already arranged on " + covers.map(function (o) { return nw(fmt.date(o.date)) + " (" + esc(o.coach) + ")"; }).join(", ") +
              " stay as they are.");
          }
          if (occ.blockKind === "manual") notes.push(esc(date) + " stays blocked until you reopen it.");
          if (!leaves.length && !wk.length && !cl.length) {
            out.push(h.notice("ok", "<p>From " + esc(date) + ", " + esc(c) + " teaches this class every " + esc(dayName) +
              ". Students stay booked.</p>"));
          }
          if (notes.length) out.push(h.notice("info", notes.map(function (n) { return "<p>" + n + "</p>"; }).join("")));
        }

        function paint() {
          var c = sel.value;
          var s = scope();
          var out = [];
          var same = s === "weekly" ? c === occ.originalCoach : c === occ.coach;
          if (same) {
            out.push(h.notice("info", s === "weekly"
              ? "<p>" + esc(c) + " already teaches this class every week." +
                (occ.substituted ? " To hand back only " + esc(date) + ", choose “Only " + esc(date) + "”." : " Pick another coach to hand it over.") + "</p>"
              : "<p>" + esc(c) + " is already taking this class. Pick another coach to arrange cover.</p>"));
          } else if (s === "weekly") {
            paintWeekly(c, out);
          } else {
            paintOne(c, out);
          }
          if (s === "one" && !same && occ.blockKind === "manual") {
            out.push(h.notice("info", "<p>The class stays blocked until you reopen it.</p>"));
          }
          box.innerHTML = out.join("");
          go.disabled = same;
          go.innerHTML = icon("swap") + (s === "weekly"
            ? "Hand over every week"
            : !same && c === occ.originalCoach ? "Give back to " + esc(c) : "Change coach");
          formErr(card, "");
        }

        sel.addEventListener("change", paint);
        card.querySelectorAll('input[name="schSubScope"]').forEach(function (r) {
          r.addEventListener("change", paint);
        });
        paint();

        form.addEventListener("submit", function (e) {
          e.preventDefault();
          var c = sel.value;
          var s = scope();
          var now = db.occurrence(key);
          if (!now || now.status === "removed" || now.started) {
            formErr(card, "This class has changed in the meantime — close this window and check it again.");
            return;
          }
          if (!isActiveCoach(c)) { formErr(card, "Choose an active coach."); return; }
          var res, msg;
          if (s === "weekly") {
            if (c === now.originalCoach) { formErr(card, c + " already teaches this class every week."); return; }
            res = db.assignWeeklyClass(now.templateId, c, { by: Admin.by(), from: now.date });
            var refunded = res.ok ? res.refunded || 0 : 0;
            if (res.ok) {
              // this date follows the new weekly coach, even if someone was covering it
              var after = db.occurrence(key);
              if (after && after.substituted && after.coach !== c) {
                var sub = db.substituteCoach(key, null, { by: Admin.by() });
                if (sub.ok) refunded += sub.refunded || 0;
              }
            }
            msg = c + " now teaches " + now.name + " every " + dayName + " from " + fmt.date(now.date) + refundedTail(refunded);
          } else {
            if (c === now.coach) { formErr(card, c + " is already taking this class."); return; }
            var back = c === now.originalCoach;
            res = db.substituteCoach(key, back ? null : c, { by: Admin.by() });
            msg = (back
              ? now.name + " on " + fmt.date(now.date) + " is back with " + c
              : c + " is now covering " + now.name + " on " + fmt.date(now.date)) +
              refundedTail(res.ok ? res.refunded || 0 : 0);
          }
          if (!Admin.check(res, msg)) { formErr(card, res.error); return; }
          Admin.closeModal();
        });
      }
    });
  };

  /* ============================================================
     ADD A ONE-OFF CLASS (admin)
     ============================================================ */
  // the programme this coach teaches most often (a sensible first choice)
  function usualProgramme(coach) {
    var counts = {};
    db.weeklyClassesFor(coach, today()).forEach(function (w) {
      counts[w.programmeId] = (counts[w.programmeId] || 0) + 1;
    });
    var best = null;
    HC.programmes.forEach(function (p) {
      if (counts[p.id] && (!best || counts[p.id] > counts[best.id])) best = p;
    });
    return best || HC.programmes[0];
  }

  function suggestTime(date) {
    if (date !== today()) return "16:00";
    var m = Math.ceil((nowMin() + 30) / 15) * 15;
    return db.fromMinutes(Math.max(10 * 60, Math.min(LAST_START, m)));
  }

  function durationOptions(selected) {
    var list = DURATIONS.slice();
    if (list.indexOf(selected) < 0) {
      list.push(selected);
      list.sort(function (a, b) { return a - b; });
    }
    return h.options(list.map(function (m) { return { value: String(m), label: lengthLabel(m) }; }), String(selected));
  }

  function capHint(p) {
    return "Up to " + p.maxSize + " students";
  }

  // "Several dates (camp)"
  var MAX_RANGES = 6;
  var MAX_SESSIONS = 60;          // HC.db.addOneOffs adds at most 60 at once
  var RANGE_DAYS = 93;            // … and reads at most 93 days per range
  var WEEKDAYS_DEFAULT = [0, 1, 2, 3, 4];
  var SUB_ONE = "Runs on one date only — it won’t repeat weekly. Parents can book classes up to four weeks ahead.";
  var SUB_MANY = "Sessions on several dates under one name — like a holiday boot camp. They don’t repeat weekly.";

  // "Mon 5" — a day inside a range whose label already names the month
  function shortDay(iso) { return HC.dayShort[db.dayIndex(iso)] + " " + (+iso.slice(8, 10)); }

  function rangeLabel(r) {
    return r.to && r.to > r.from ? fmt.date(r.from, "day") + " – " + fmt.date(r.to, "day") : fmt.date(r.from);
  }

  // a session that would start in the past (today: once its start time has gone)
  function sessionPassed(date, time) {
    var t = today();
    return date < t || (date === t && /^\d{2}:\d{2}$/.test(time) && db.toMinutes(time) <= nowMin());
  }

  // "Mon 14 Sep, Tue 15 Sep and 3 more"
  function dateList(list, max) {
    max = max || 3;
    var shown = list.slice(0, max).map(function (d) { return fmt.date(d); }).join(", ");
    return shown + (list.length > max ? " and " + (list.length - max) + " more" : "");
  }

  Admin.addOneOff = function (prefill) {
    prefill = prefill || {};
    if (!Admin.staff) return;
    if (!Admin.can("oneoff")) {
      Admin.toast("warn", "One-off classes are added by the studio admin.");
      return;
    }
    if (!db.coaches().length) {
      Admin.toast("warn", "Add a coach first — every class needs one.");
      return;
    }

    var t = today();
    var date = isIso(prefill.date) && prefill.date >= t ? prefill.date : t;
    if (date === t && !canAdd(t)) date = db.addDays(t, 1);
    var coach = isActiveCoach(prefill.coach) ? prefill.coach : firstActiveCoach();
    var prog = HC.getProgramme(prefill.programmeId) || usualProgramme(coach);
    var dur = DURATIONS.indexOf(+prefill.duration) >= 0 ? +prefill.duration : (prog.duration || 60);
    var cap = +prefill.capacity >= 1 ? Math.min(Math.floor(+prefill.capacity), prog.maxSize) : prog.maxSize;
    var time = /^\d{2}:\d{2}$/.test(prefill.time || "") ? prefill.time : suggestTime(date);
    var focusBack = rememberFocus();

    var dayChips = HC.dayShort.map(function (d, i) {
      var on = WEEKDAYS_DEFAULT.indexOf(i) >= 0;
      return '<button type="button" class="sch-wday" id="schOoDay-' + i + '" data-wd="' + i + '" aria-pressed="' + on + '"' +
        ' aria-label="' + esc(HC.dayNames[i]) + '" disabled>' + esc(d) + "</button>";
    }).join("");

    Admin.openModal({
      title: "Add a one-off class",
      sub: esc(SUB_ONE),
      body:
        '<form class="sch-form sch-oo" id="schOoForm" novalidate data-mode="one">' +
          '<div class="sch-oo__mode">' +
            '<div class="seg" role="group" aria-label="How many dates?">' +
              '<button type="button" id="schOoModeOne" data-oo-mode="one" aria-pressed="true">One date</button>' +
              '<button type="button" id="schOoModeMany" data-oo-mode="many" aria-pressed="false">Several dates (camp)</button>' +
            "</div>" +
          "</div>" +
          '<div class="sch-many" id="schOoMany" hidden>' +
            '<div class="field">' +
              '<label for="schOoName">Name <span class="field__opt">(parents see this)</span></label>' +
              '<input type="text" id="schOoName" maxlength="60" autocomplete="off" placeholder="e.g. June Boot Camp"' +
                ' aria-describedby="schOoNameErr" disabled />' +
              errSlot("schOoName") +
            "</div>" +
            '<fieldset class="sch-fieldset sch-fieldset--gap">' +
              '<legend class="field__label">Dates</legend>' +
              '<div class="sch-ranges" id="schOoRanges"></div>' +
              '<button type="button" class="btn btn--quiet btn--sm sch-addrange" id="schOoAddRange" disabled>' +
                icon("plus") + "Add another date range</button>" +
              errSlot("schOoRanges") +
            "</fieldset>" +
            '<fieldset class="sch-fieldset sch-fieldset--gap">' +
              '<legend class="field__label">On these days</legend>' +
              '<div class="sch-wdays" id="schOoDays" role="group" aria-label="Days of the week" aria-describedby="schOoDaysErr">' +
                dayChips + "</div>" +
              errSlot("schOoDays") +
            "</fieldset>" +
          "</div>" +
          '<div class="field-row sch-oo__when">' +
            '<div class="field" id="schOoDateField">' +
              '<label for="schOoDate">Date</label>' +
              '<input type="date" id="schOoDate" min="' + t + '" value="' + date + '" required aria-describedby="schOoDateErr" />' +
              errSlot("schOoDate") +
            "</div>" +
            '<div class="field">' +
              '<label for="schOoTime">Start time</label>' +
              '<select id="schOoTime" aria-describedby="schOoTimeErr">' + h.timeOptions(time) + "</select>" +
              errSlot("schOoTime") +
            "</div>" +
          "</div>" +
          '<div class="field">' +
            '<label for="schOoProg">Programme</label>' +
            '<select id="schOoProg" aria-describedby="schOoProgErr">' + h.programmeOptions(prog.id) + "</select>" +
            errSlot("schOoProg") +
          "</div>" +
          '<div class="field-row">' +
            '<div class="field">' +
              '<label for="schOoDur">Length</label>' +
              '<select id="schOoDur" aria-describedby="schOoDurErr">' + durationOptions(dur) + "</select>" +
              errSlot("schOoDur") +
            "</div>" +
            '<div class="field">' +
              '<label for="schOoCap">Places</label>' +
              '<input type="number" id="schOoCap" min="1" max="' + prog.maxSize + '" step="1" inputmode="numeric" value="' + cap +
                '" aria-describedby="schOoCapHint schOoCapErr" />' +
              '<p class="field__hint" id="schOoCapHint">' + esc(capHint(prog)) + "</p>" +
              errSlot("schOoCap") +
            "</div>" +
          "</div>" +
          '<div class="field">' +
            '<label for="schOoCoach">Coach</label>' +
            '<select id="schOoCoach" aria-describedby="schOoCoachErr">' + h.coachOptions(coach) + "</select>" +
            errSlot("schOoCoach") +
          "</div>" +
          '<div class="field">' +
            '<label for="schOoNote">Note for parents <span class="field__opt">(optional)</span></label>' +
            '<input type="text" id="schOoNote" maxlength="120" autocomplete="off" placeholder="e.g. Extra competition prep"' +
              (prefill.note ? ' value="' + esc(prefill.note) + '"' : "") + ' aria-describedby="schOoNoteHint" />' +
            '<p class="field__hint" id="schOoNoteHint">Shown with the class when parents book.</p>' +
          "</div>" +
          '<div class="sch-check" id="schOoCheck" aria-live="polite"></div>' +
          '<p class="field-error form-error sch-form-error" role="alert"></p>' +
        "</form>",
      actions:
        '<button type="button" class="btn btn--ghost" data-close>Cancel</button>' +
        '<button type="submit" form="schOoForm" class="btn btn--primary" id="schOoGo">' + icon("plus") + "Add class</button>",
      onClose: focusBack,
      onOpen: function (card) {
        var form = card.querySelector("#schOoForm");
        var dateEl = card.querySelector("#schOoDate");
        var timeEl = card.querySelector("#schOoTime");
        var progEl = card.querySelector("#schOoProg");
        var durEl = card.querySelector("#schOoDur");
        var capEl = card.querySelector("#schOoCap");
        var coachEl = card.querySelector("#schOoCoach");
        var noteEl = card.querySelector("#schOoNote");
        var box = card.querySelector("#schOoCheck");
        var go = card.querySelector("#schOoGo");
        var subEl = card.querySelector(".modal__sub");
        var manyEl = card.querySelector("#schOoMany");
        var dateField = card.querySelector("#schOoDateField");
        var nameEl = card.querySelector("#schOoName");
        var rangesEl = card.querySelector("#schOoRanges");
        var addRangeEl = card.querySelector("#schOoAddRange");
        var daysEl = card.querySelector("#schOoDays");
        var FIELDS = ["schOoDate", "schOoTime", "schOoProg", "schOoDur", "schOoCap", "schOoCoach"];

        var mode = "one";
        var rid = 1;
        var ranges = [{ id: 1, from: date, to: db.addDays(date, 4) }];
        var wdays = WEEKDAYS_DEFAULT.slice();

        function read() {
          return {
            date: dateEl.value,
            time: timeEl.value,
            programmeId: progEl.value,
            duration: +durEl.value,
            capacity: String(capEl.value).trim(),
            coach: coachEl.value,
            note: noteEl.value.trim(),
            name: nameEl.value.trim()
          };
        }

        /* ---------- one date (as before) ---------- */
        function paintOne() {
          var d = read();
          var out = [];
          if (isIso(d.date) && /^\d{2}:\d{2}$/.test(d.time)) {
            var start = db.toMinutes(d.time);
            var end = start + d.duration;
            out.push('<p class="sch-preview">' + icon("calendar") + "<span>" +
              nw(fmt.date(d.date, "full")) + " · " + nw(fmt.time(d.time) + " – " + fmt.time(db.fromMinutes(end))) +
              " · " + nw(d.coach) + "</span></p>");
            if (end > CLOSING) {
              out.push(h.notice("warn", "<p><strong>Runs past 10:00 PM.</strong> Classes must finish by closing time — choose an earlier start or a shorter class.</p>"));
            }
            if (d.date < today()) {
              out.push(h.notice("warn", "<p><strong>That date has passed.</strong> One-off classes can only be added from today onwards.</p>"));
            } else {
              if (d.date === today() && start <= nowMin()) {
                out.push(h.notice("warn", "<p><strong>That time has already passed today.</strong> Pick a later start time.</p>"));
              }
              var lv = db.leaveFor(d.coach, d.date);
              if (lv) {
                out.push(h.notice("warn", "<p><strong>" + esc(d.coach) + " is on leave that day.</strong> " +
                  "The class would stay closed to bookings until the leave is cancelled.</p>"));
              }
              var cl = openClashes(d.date, d.time, d.duration, d.coach);
              if (cl.length) {
                out.push(h.notice("warn", "<p><strong>Clashes with " + esc(d.coach) + "’s classes</strong> — " +
                  clashList(cl) + ".</p>"));
              }
              var opens = bookableFrom(d.date);
              if (!lv && opens > today()) {
                out.push(h.notice("info", "<p><strong>Parents can book it from " + esc(fmt.date(opens)) + ".</strong> " +
                  "The parent portal opens bookings four weeks ahead.</p>"));
              }
            }
          }
          box.innerHTML = out.join("");
        }

        /* ---------- several dates ---------- */
        // Every date the ranges + days give, each under the first range that holds it.
        function plan() {
          var d = read();
          var seen = {};
          var groups = [];
          var all = [];
          ranges.forEach(function (r) {
            var dates = [];
            if (wdays.length && isIso(r.from) && (!r.to || (isIso(r.to) && r.to >= r.from))) {
              dates = db.datesFromRanges([{ from: r.from, to: r.to || r.from }], wdays).filter(function (x) {
                if (seen[x]) return false;
                seen[x] = 1;
                return true;
              });
            }
            groups.push({ range: r, dates: dates });
            all = all.concat(dates);
          });
          all.sort();
          return {
            groups: groups,
            all: all,
            past: all.filter(function (x) { return sessionPassed(x, d.time); }),
            valid: all.filter(function (x) { return !sessionPassed(x, d.time); })
          };
        }

        function paintMany() {
          var d = read();
          var p = plan();
          var out = [];
          if (!p.all.length) {
            box.innerHTML = h.notice("info", "<p>" + (wdays.length
              ? "None of these dates fall on the days you picked."
              : "Pick at least one day of the week.") + "</p>");
            return;
          }
          var start = db.toMinutes(d.time);
          var end = start + d.duration;
          var pastSet = {}, leaveSet = {}, clashMap = {};
          p.past.forEach(function (x) { pastSet[x] = 1; });
          var clashDates = [], leaveDates = [];
          p.valid.slice(0, 120).forEach(function (x) {
            if (db.leaveFor(d.coach, x)) { leaveSet[x] = 1; leaveDates.push(x); }
            var cl = openClashes(x, d.time, d.duration, d.coach);
            if (cl.length) { clashMap[x] = cl; clashDates.push(x); }
          });

          var chips = function (x) {
            var cls = "sch-camp__d", title = fmt.date(x, "full");
            if (pastSet[x]) { cls += " is-past"; title += " — already passed, skipped"; }
            else if (leaveSet[x]) { cls += " is-warn"; title += " — " + d.coach + " is on leave"; }
            else if (clashMap[x]) { cls += " is-warn"; title += " — clashes with " + clashMap[x].map(function (o) { return o.name; }).join(", "); }
            return '<span class="' + cls + '" title="' + esc(title) + '">' + esc(shortDay(x)) + "</span>";
          };

          var first = p.valid[0], last = p.valid[p.valid.length - 1];
          out.push('<div class="sch-camp">' +
            '<p class="sch-camp__sum">' + icon("calendar") + "<span><strong>" +
              (p.valid.length ? "Creates " + esc(plural(p.valid.length, "session")) : "No sessions to create") + "</strong>" +
              (p.valid.length ? " · " + nw(fmt.date(first)) + (last !== first ? " – " + nw(fmt.date(last)) : "") : "") +
            "</span></p>" +
            '<p class="sch-camp__meta">' + nw(fmt.time(d.time) + " – " + fmt.time(db.fromMinutes(end))) + " · " + nw(d.coach) + "</p>" +
            '<ul class="sch-camp__list">' + p.groups.map(function (g) {
              if (!g.dates.length) return "";
              return "<li>" +
                  '<span class="sch-camp__range">' + esc(rangeLabel(g.range)) + " · " + esc(plural(g.dates.length, "day")) + "</span>" +
                  '<span class="sch-camp__dates">' + g.dates.map(chips).join("") + "</span>" +
                "</li>";
            }).join("") + "</ul>" +
          "</div>");

          if (p.valid.length > MAX_SESSIONS) {
            out.push(h.notice("warn", "<p><strong>That’s " + p.valid.length + " sessions</strong> — you can add up to " + MAX_SESSIONS +
              " at a time. Shorten the dates or pick fewer days.</p>"));
          }
          if (end > CLOSING) {
            out.push(h.notice("warn", "<p><strong>Runs past 10:00 PM.</strong> Classes must finish by closing time — choose an earlier start or a shorter class.</p>"));
          }
          if (p.past.length) {
            out.push(h.notice("warn", "<p><strong>" + esc(plural(p.past.length, "date has", "dates have")) + " already passed</strong> — " +
              (p.past.length === 1 ? "it" : "they") + " will be skipped: " + esc(dateList(p.past)) + ".</p>"));
          }
          if (leaveDates.length) {
            out.push(h.notice("warn", "<p><strong>" + esc(d.coach) + " is on leave on " + esc(dateList(leaveDates, 4)) + ".</strong> " +
              (leaveDates.length === 1 ? "That session stays" : "Those sessions stay") + " closed until the leave is cancelled.</p>"));
          }
          if (clashDates.length) {
            var shown = clashDates.slice(0, 5);
            out.push(h.notice("warn", "<p><strong>Clashes with " + esc(d.coach) + "’s classes on " +
              esc(plural(clashDates.length, "date")) + ":</strong></p>" +
              '<ul class="sch-camp__clashes">' + shown.map(function (x) {
                return "<li>" + nw(fmt.date(x)) + " — " + clashList(clashMap[x]) + "</li>";
              }).join("") +
              (clashDates.length > shown.length ? "<li>and " + (clashDates.length - shown.length) + " more</li>" : "") + "</ul>"));
          }
          var later = p.valid.filter(function (x) { return bookableFrom(x) > today(); });
          if (later.length) {
            out.push(h.notice("info", "<p>" + (later.length === p.valid.length
              ? "<strong>Parents can book from " + esc(fmt.date(bookableFrom(first))) + ".</strong> "
              : "Sessions from " + esc(fmt.date(later[0])) + " open for booking later. ") +
              "The parent portal opens bookings four weeks ahead.</p>"));
          }
          box.innerHTML = out.join("");
        }

        function paint() {
          if (mode === "many") paintMany(); else paintOne();
          var label = "Add class";
          if (mode === "many") {
            var n = plan().valid.length;
            label = n >= 1 && n <= MAX_SESSIONS ? "Add " + plural(n, "session") : "Add sessions";
          }
          go.innerHTML = icon("plus") + esc(label);
        }

        function paintRanges(focusId) {
          var off = mode !== "many" ? " disabled" : "";
          rangesEl.innerHTML = ranges.map(function (r, i) {
            var many = ranges.length > 1;
            var sr = many ? '<span class="sr-only">Date range ' + (i + 1) + ": </span>" : "";
            return '<div class="sch-range" data-range="' + r.id + '">' +
                '<div class="field">' +
                  '<label for="schOoFrom-' + r.id + '">' + sr + "From</label>" +
                  '<input type="date" id="schOoFrom-' + r.id + '" data-range-from="' + r.id + '" min="' + t + '" value="' + esc(r.from) + '"' + off + " />" +
                "</div>" +
                '<div class="field">' +
                  '<label for="schOoTo-' + r.id + '">' + sr + "To</label>" +
                  '<input type="date" id="schOoTo-' + r.id + '" data-range-to="' + r.id + '" min="' + t + '" value="' + esc(r.to) + '"' + off + " />" +
                "</div>" +
                (many
                  ? '<button type="button" class="btn btn--icon btn--ghost btn--sm sch-range__x" data-range-remove="' + r.id +
                      '" aria-label="Remove date range ' + (i + 1) + '" title="Remove"' + off + ">" + icon("x") + "</button>"
                  : "") +
              "</div>";
          }).join("");
          addRangeEl.hidden = ranges.length >= MAX_RANGES;
          if (focusId) focusById(focusId);
        }

        function rangeById(id) {
          for (var i = 0; i < ranges.length; i++) if (String(ranges[i].id) === String(id)) return ranges[i];
          return null;
        }

        function clearRangeErr() {
          rangesEl.querySelectorAll(".invalid").forEach(function (x) {
            x.classList.remove("invalid");
            x.removeAttribute("aria-invalid");
          });
          card.querySelector("#schOoRangesErr").textContent = "";
        }

        function onRangeEdit(e) {
          var el = e.target;
          var r = rangeById(el.getAttribute("data-range-from") || el.getAttribute("data-range-to"));
          if (!r) return;
          if (el.hasAttribute("data-range-from")) {
            r.from = el.value;
            // keep the range the right way round while its start moves
            if (isIso(r.from) && isIso(r.to) && r.to < r.from) {
              r.to = r.from;
              var toEl = card.querySelector("#schOoTo-" + r.id);
              if (toEl) toEl.value = r.to;
            }
          } else {
            r.to = el.value;
          }
          clearRangeErr();
          formErr(card, "");
          paint();
        }

        function setMode(m) {
          mode = m === "many" ? "many" : "one";
          form.setAttribute("data-mode", mode);
          card.querySelectorAll("[data-oo-mode]").forEach(function (b) {
            b.setAttribute("aria-pressed", String(b.getAttribute("data-oo-mode") === mode));
          });
          manyEl.hidden = mode !== "many";
          dateField.hidden = mode === "many";
          // hidden fields are disabled too, so nothing out of sight takes focus or is sent
          manyEl.querySelectorAll("input, button").forEach(function (x) { x.disabled = mode !== "many"; });
          dateEl.disabled = mode === "many";
          if (subEl) subEl.innerHTML = esc(mode === "many" ? SUB_MANY : SUB_ONE);
          card.querySelector("#schOoNoteHint").textContent = mode === "many"
            ? "Shown with every session. Leave it empty to show the name."
            : "Shown with the class when parents book.";
          FIELDS.concat(["schOoName", "schOoDays"]).forEach(function (id) { setErr(card, id, ""); });
          clearRangeErr();
          formErr(card, "");
          paint();
        }

        function clear(id) { setErr(card, id, ""); formErr(card, ""); }

        card.querySelectorAll("[data-oo-mode]").forEach(function (b) {
          b.addEventListener("click", function () { setMode(b.getAttribute("data-oo-mode")); });
        });
        nameEl.addEventListener("input", function () { clear("schOoName"); });
        rangesEl.addEventListener("input", onRangeEdit);
        rangesEl.addEventListener("change", onRangeEdit);
        rangesEl.addEventListener("click", function (e) {
          var x = e.target.closest("[data-range-remove]");
          if (!x) return;
          var id = x.getAttribute("data-range-remove");
          var at = -1;
          ranges.forEach(function (r, i) { if (String(r.id) === id) at = i; });
          if (at < 0 || ranges.length < 2) return;
          ranges.splice(at, 1);
          clearRangeErr();
          paintRanges("schOoFrom-" + ranges[Math.max(0, at - 1)].id);
          paint();
        });
        addRangeEl.addEventListener("click", function () {
          if (ranges.length >= MAX_RANGES) return;
          var last = ranges[ranges.length - 1];
          var base = isIso(last.from) ? last.from : date;
          // a good guess: the same days one week after the last range
          var next = { id: ++rid, from: db.addDays(base, 7), to: isIso(last.to) ? db.addDays(last.to, 7) : "" };
          ranges.push(next);
          clearRangeErr();
          paintRanges("schOoFrom-" + next.id);
          if (ranges.length >= MAX_RANGES) focusById("schOoFrom-" + next.id);
          paint();
        });
        daysEl.addEventListener("click", function (e) {
          var b = e.target.closest("[data-wd]");
          if (!b) return;
          var i = +b.getAttribute("data-wd");
          var at = wdays.indexOf(i);
          if (at >= 0) wdays.splice(at, 1); else wdays.push(i);
          wdays.sort();
          b.setAttribute("aria-pressed", String(at < 0));
          clear("schOoDays");
          clearRangeErr();
          paint();
        });

        dateEl.addEventListener("input", function () { clear("schOoDate"); clear("schOoTime"); paint(); });
        dateEl.addEventListener("change", paint);
        timeEl.addEventListener("change", function () { clear("schOoTime"); clear("schOoDur"); paint(); });
        durEl.addEventListener("change", function () { clear("schOoDur"); paint(); });
        capEl.addEventListener("input", function () { clear("schOoCap"); });
        coachEl.addEventListener("change", function () { clear("schOoCoach"); paint(); });
        progEl.addEventListener("change", function () {
          var p = HC.getProgramme(progEl.value);
          clear("schOoProg");
          if (!p) return;
          // a new programme brings its own length and class-size limit
          durEl.innerHTML = durationOptions(p.duration || 60);
          capEl.value = p.maxSize;
          capEl.max = p.maxSize;
          card.querySelector("#schOoCapHint").textContent = capHint(p);
          clear("schOoCap");
          clear("schOoDur");
          paint();
        });
        paintRanges();
        if (prefill.groupName) nameEl.value = String(prefill.groupName);
        if (prefill.mode === "many") setMode("many");
        else paint();

        // the fields both modes share
        function commonErrors(d, p, errs) {
          if (!/^\d{2}:\d{2}$/.test(d.time)) errs.schOoTime = "Choose a start time.";
          else if (db.toMinutes(d.time) + d.duration > CLOSING) {
            errs.schOoDur = "Ends at " + fmt.time(db.fromMinutes(db.toMinutes(d.time) + d.duration)) + " — classes must finish by 10:00 PM.";
          }
          if (!p) errs.schOoProg = "Choose a programme.";
          else if (!/^\d+$/.test(d.capacity) || +d.capacity < 1 || +d.capacity > p.maxSize) {
            errs.schOoCap = "Enter a number from 1 to " + p.maxSize + ".";
          }
          if (!isActiveCoach(d.coach)) errs.schOoCoach = "Choose a coach.";
        }

        function showErrors(errs, order) {
          var firstBad = null;
          order.forEach(function (id) {
            setErr(card, id, errs[id] || "");
            if (errs[id] && !firstBad) firstBad = id;
          });
          return firstBad;
        }

        // show the new classes where they live
        function jumpTo(iso, coachName) {
          if (Admin.currentView() !== "schedule") return;
          var shown = readParams(Admin.params()).coach;
          var patch = { week: db.weekStart(iso) };
          if (shown !== "all" && shown !== coachName) patch.coach = "";
          Admin.setParams(patch);
        }

        function submitMany() {
          var d = read();
          var p = HC.getProgramme(d.programmeId);
          var errs = {};
          var badRange = null;
          if (!d.name) errs.schOoName = "Give the sessions a name, e.g. June Boot Camp.";
          ranges.forEach(function (r) {
            if (badRange) return;
            if (!isIso(r.from)) badRange = { id: "schOoFrom-" + r.id, msg: "Choose a start date for each date range." };
            else if (r.to && !isIso(r.to)) badRange = { id: "schOoTo-" + r.id, msg: "Choose an end date, or leave it empty for one day." };
            else if (r.to && r.to < r.from) badRange = { id: "schOoTo-" + r.id, msg: "A date range can’t end before it starts." };
            else if (r.to && db.daysBetween(r.from, r.to) >= RANGE_DAYS) {
              badRange = { id: "schOoTo-" + r.id, msg: "Keep each date range under 13 weeks." };
            }
          });
          if (!wdays.length) errs.schOoDays = "Pick at least one day.";
          var pl = plan();
          if (!badRange && wdays.length) {
            var focusFirst = "schOoFrom-" + ranges[0].id;
            if (!pl.all.length) badRange = { id: focusFirst, msg: "None of these dates fall on the days you picked." };
            else if (!pl.valid.length) badRange = { id: focusFirst, msg: "All of these dates have passed — choose later dates." };
            else if (pl.valid.length > MAX_SESSIONS) {
              badRange = { id: focusFirst, msg: "That’s " + pl.valid.length + " sessions — add at most " + MAX_SESSIONS + " at a time." };
            }
          }
          commonErrors(d, p, errs);

          clearRangeErr();
          if (badRange) {
            var bad = card.querySelector("#" + badRange.id);
            if (bad) { bad.classList.add("invalid"); bad.setAttribute("aria-invalid", "true"); }
            card.querySelector("#schOoRangesErr").textContent = badRange.msg;
          }
          var firstBad = showErrors(errs, ["schOoName", "schOoDays", "schOoTime", "schOoProg", "schOoDur", "schOoCap", "schOoCoach"]);
          if (firstBad || badRange) {
            formErr(card, "");
            if (errs.schOoName) focusById("schOoName");
            else if (badRange) focusById(badRange.id);
            else if (firstBad === "schOoDays") focusById("schOoDay-0");
            else focusById(firstBad);
            return;
          }

          var res = db.addOneOffs({
            dates: pl.valid, time: d.time, programmeId: p.id, coach: d.coach,
            capacity: +d.capacity, duration: d.duration, groupName: d.name, note: d.note
          }, { by: Admin.by() });
          var msg = null;
          if (res.ok) {
            var skipped = pl.past.concat((res.skipped || []).map(function (x) { return x.date; })).sort();
            var closed = res.keys.filter(function (k) {
              var o = db.occurrence(k);
              return o && o.status === "blocked";
            }).length;
            msg = d.name + " added — " + plural(res.keys.length, "session") + "." +
              (skipped.length ? " " + plural(skipped.length, "date was", "dates were") + " skipped (" + dateList(skipped) + ")." : "") +
              (closed ? " " + plural(closed, "session stays", "sessions stay") + " closed while " + d.coach + " is on leave." : "");
          }
          if (!Admin.check(res, msg)) { formErr(card, res.error); return; }
          Admin.closeModal();
          jumpTo(res.keys[0].slice(0, 10), d.coach);
        }

        function submitOne() {
          var d = read();
          var p = HC.getProgramme(d.programmeId);
          var tNow = today();
          var errs = {};
          if (!isIso(d.date)) errs.schOoDate = "Choose a date.";
          else if (d.date < tNow) errs.schOoDate = "Choose today or a later date.";
          if (!/^\d{2}:\d{2}$/.test(d.time)) errs.schOoTime = "Choose a start time.";
          else if (d.date === tNow && db.toMinutes(d.time) <= nowMin()) errs.schOoTime = "That time has already passed.";
          else if (db.toMinutes(d.time) + d.duration > CLOSING) {
            errs.schOoDur = "Ends at " + fmt.time(db.fromMinutes(db.toMinutes(d.time) + d.duration)) + " — classes must finish by 10:00 PM.";
          }
          if (!p) errs.schOoProg = "Choose a programme.";
          else if (!/^\d+$/.test(d.capacity) || +d.capacity < 1 || +d.capacity > p.maxSize) {
            errs.schOoCap = "Enter a number from 1 to " + p.maxSize + ".";
          }
          if (!isActiveCoach(d.coach)) errs.schOoCoach = "Choose a coach.";

          var firstBad = showErrors(errs, FIELDS);
          if (firstBad) {
            formErr(card, "");
            focusById(firstBad);
            return;
          }

          var res = db.addOneOff({
            date: d.date, time: d.time, programmeId: p.id, coach: d.coach,
            capacity: +d.capacity, duration: d.duration, note: d.note
          }, { by: Admin.by() });
          var made = res.ok ? db.occurrence(res.key) : null;
          var msg = null;
          if (made) {
            var opens = bookableFrom(made.date);
            msg = made.name + " added on " + fmt.date(made.date) + " at " + fmt.time(made.time) +
              (made.status === "blocked" ? " — closed for now while " + made.coach + " is on leave."
                : opens > today() ? " — parents can book it from " + fmt.date(opens) + "."
                : " — parents can book it now.");
          }
          if (!Admin.check(res, msg)) { formErr(card, res.error); return; }
          Admin.closeModal();
          jumpTo(d.date, d.coach);
          if (Admin.openClass) Admin.openClass(res.key);
        }

        form.addEventListener("submit", function (e) {
          e.preventDefault();
          if (!Admin.can("oneoff")) { formErr(card, "One-off classes are added by the studio admin."); return; }
          if (mode === "many") submitMany(); else submitOne();
        });
      }
    });
  };
})();
