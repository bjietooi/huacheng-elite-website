/* ============================================================
   HUACHENG ELITE — Coach & Admin console · Today (admin only)
   ------------------------------------------------------------
   The studio at a glance: today's classes with their status and
   attendance, what needs a look, the week ahead and recent
   changes. Coaches don't have this view — the core sends them
   to "My classes".

   Pure render from HC.db — every interaction goes through the
   core's delegated [data-go] / [data-open-class] /
   [data-open-family] handlers, except "Add one-off class".
   Credits are one pool per family, so balances are per family.
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

  var ACTIVITY_LIMIT = 8;
  var LIST_LIMIT = 6;      // rows per "Needs attention" group
  var OFF_DAYS = 14;       // blocked / leave look-ahead
  var FULL_DAYS = 7;       // full-class look-ahead
  var AHEAD_DAYS = 7;      // "Coming up"

  /* ---------- small helpers ---------- */
  function greeting() {
    var hr = new Date().getHours();
    // after midnight still reads as the evening before
    return hr < 5 ? "Good evening" : hr < 12 ? "Good morning" : hr < 18 ? "Good afternoon" : "Good evening";
  }

  // First word of the name — but keep generic names ("Studio Admin",
  // "Coach A") whole so the greeting never reads "Good morning, Studio".
  function firstName(name) {
    var parts = String(name || "").trim().split(/\s+/);
    if (parts.length > 1 && /^(coach|studio|head)$/i.test(parts[0])) return parts.join(" ");
    return parts[0] || "there";
  }

  function bookedLabel(occ) {
    return occ.booked + "/" + occ.capacity + " booked";
  }

  function when(occ) {
    return fmt.date(occ.date, "relative") + " · " + fmt.time(occ.time);
  }

  // data-params attribute for the core's [data-go] handler
  function params(obj) {
    return ' data-params="' + esc(JSON.stringify(obj)) + '"';
  }

  function card(title, sub, body, extraClass, headAside) {
    return '<section class="card today-card' + (extraClass ? " " + extraClass : "") + '">' +
        '<div class="card__head">' +
          "<div>" +
            '<h2 class="card__title">' + esc(title) + "</h2>" +
            (sub ? '<p class="card__sub">' + sub + "</p>" : "") +
          "</div>" +
          (headAside || "") +
        "</div>" +
        body +
      "</section>";
  }

  // A clickable list row (the whole row is one button). Inner parts are
  // spans because a <button> may only hold phrasing content.
  function linkRow(attrs, lead, title, meta, aside, extraClass) {
    return '<button type="button" class="row today-row' + (extraClass ? " " + extraClass : "") + '" ' + attrs + ">" +
        lead +
        '<span class="row__main">' +
          '<span class="row__title">' + title + "</span>" +
          (meta ? '<span class="row__meta">' + meta + "</span>" : "") +
        "</span>" +
        (aside ? '<span class="row__aside">' + aside + "</span>" : "") +
      "</button>";
  }

  function badge(iconName, kind) {
    return '<span class="today-badge today-badge--' + kind + '">' + Admin.icon(iconName) + "</span>";
  }

  function canAddOneOff() {
    return Admin.can("oneoff") && typeof Admin.addOneOff === "function";
  }

  /* ============================================================
     DATA
     ============================================================ */
  function collect() {
    var today = db.todayISO();
    var todays = db.occurrencesForDate(today, { includeRemoved: true });
    var open = todays.filter(function (o) { return o.status === "open"; });

    // classes that have started with students still to mark — yesterday first
    var toMark = [];
    [db.addDays(today, -1), today].forEach(function (d) {
      db.occurrencesForDate(d).forEach(function (o) {
        if (h.attendance(o).key === "todo") toMark.push(o);
      });
    });

    return {
      today: today,
      todays: todays,
      open: open,
      toMark: toMark,
      unmarked: toMark.reduce(function (n, o) { return n + o.unmarked; }, 0),
      expected: open.reduce(function (n, o) { return n + o.booked; }, 0),
      places: open.reduce(function (n, o) { return n + o.capacity; }, 0),
      // the credit report walks the whole ledger — build it once per render
      report: db.creditReport()
    };
  }

  /* ============================================================
     HEAD + STATS
     ============================================================ */
  function renderHead(d) {
    var n = d.open.length;
    var next = d.open.filter(function (o) { return !o.started; })[0];
    var sub = n
      ? esc(Admin.plural(n, "class", "classes")) + " across the studio today"
      : "No classes running at the studio today";
    if (next) {
      sub += ' <span class="today-next"><span class="today-next__sep">· </span>Next: ' +
        esc(next.name) + " at " + esc(fmt.time(next.time)) + " with " + esc(next.coach) + "</span>";
    }

    var actions = "";
    if (canAddOneOff()) {
      actions += '<button type="button" class="btn btn--ghost btn--sm" id="todayAddOneOff">' +
        Admin.icon("plus") + "Add one-off class</button>";
    }
    actions +=
      '<a class="btn btn--ghost btn--sm" href="#leave?add=1" data-go="leave"' + params({ add: "1" }) + ' id="todayBookLeave">' +
        Admin.icon("leave") + "Book leave</a>" +
      '<a class="btn btn--ghost btn--sm" href="#students" data-go="students" id="todayFindStudent">' +
        Admin.icon("search") + "Find a student</a>";

    return h.pageHead({
      eyebrow: fmt.date(d.today, "long"),
      title: greeting() + ", " + firstName(Admin.staff.name),
      sub: sub,
      actions: actions
    });
  }

  // wrap: optional clickable element, e.g. { tag: "a", attrs: 'href="#reports" data-go="reports"' }
  function stat(k, v, desc, cls, wrap) {
    var tag = wrap ? wrap.tag : "div";
    return "<" + tag + ' class="stat' + (cls ? " " + cls : "") + (wrap ? " today-stat-link" : "") + '"' +
        (wrap ? " " + wrap.attrs : "") + ">" +
        '<span class="stat__k">' + esc(k) + "</span>" +
        '<span class="stat__v">' + esc(v) + "</span>" +
        (desc ? '<span class="stat__d">' + desc + "</span>" : "") +
      "</" + tag + ">";
  }

  function renderStats(d) {
    var toRun = d.open.filter(function (o) { return !o.ended; }).length;
    var blocked = d.todays.filter(function (o) { return o.status === "blocked"; }).length;

    var classesDesc = !d.open.length ? (blocked ? "" : "Nothing scheduled")
      : toRun ? esc(toRun + " still to run") : "All finished";
    if (blocked) classesDesc += (classesDesc ? " · " : "") + esc(blocked + " blocked");

    var pct = d.places ? Math.round((d.expected / d.places) * 100) : 0;
    var expectedDesc = d.places ? esc("of " + Admin.plural(d.places, "place") + " · " + pct + "% full") : "No open places today";

    // the tile jumps straight into the oldest class still to mark
    var first = d.toMark[0];
    var markDesc = "All attendance marked";
    var markWrap = null;
    if (first) {
      markDesc = esc("in " + Admin.plural(d.toMark.length, "class", "classes") + " · yesterday & today") +
        ' <span class="today-stat__go">Start marking →</span>';
      markWrap = {
        tag: "button",
        attrs: 'type="button" data-open-class="' + esc(first.key) + '" id="todayMarkTile" aria-label="' +
          esc(Admin.plural(d.unmarked, "student") + " still to mark. Open " + first.name + ", " +
            fmt.date(first.date, "relative") + " " + fmt.time(first.time)) + '"'
      };
    }

    var t = d.report.totals;
    var credWrap = {
      tag: "a",
      attrs: 'href="#reports" data-go="reports" id="todayCreditsTile" aria-label="' +
        esc(Admin.plural(t.unutilised, "unutilised credit") + ", about " + fmt.money(t.estValue) + ". Open Reports") + '"'
    };

    return '<div class="stats today-stats">' +
        stat("Classes today", String(d.open.length), classesDesc) +
        stat("Students expected", String(d.expected), expectedDesc) +
        stat("To mark", String(d.unmarked), markDesc, d.unmarked ? "stat--alert" : "", markWrap) +
        stat("Unutilised credits", String(t.unutilised),
          esc("≈ " + fmt.money(t.estValue) + " across " + Admin.plural(t.familiesWithCredits, "family", "families")) +
            ' <span class="today-stat__go">View reports →</span>', "stat--ink", credWrap) +
      "</div>";
  }

  /* ============================================================
     TODAY'S CLASSES
     ============================================================ */
  function classRow(occ) {
    var state = h.classState(occ);
    var att = h.attendance(occ);
    var off = occ.status !== "open";

    var meta = [esc(occ.coach)];
    if (off) { if (occ.reason) meta.push(esc(occ.reason)); }
    else meta.push(esc(bookedLabel(occ)));
    var attBadge = off ? "" : h.attendanceBadge(occ);
    if (attBadge) meta.push(attBadge);

    // open classes: Upcoming / Now / Passed; others already carry their status chip
    var chips = off ? h.occChips(occ) : h.stateChip(occ) + h.occChips(occ);
    var take = att.key === "todo";
    var btn = take
      ? '<span class="btn btn--primary btn--xs">Take attendance</span>'
      : '<span class="btn btn--ghost btn--xs">Open</span>';

    var lead = '<span class="today-time">' +
        "<strong>" + esc(fmt.time(occ.time)) + "</strong>" +
        "<span>" + esc(fmt.time(occ.endTime)) + "</span>" +
      "</span>";

    var label = [occ.name, fmt.timeRange(occ), occ.coach, state.label];
    if (att.label) label.push(att.label);
    label.push(take ? "take attendance" : "open class");

    return linkRow(
      'data-open-class="' + esc(occ.key) + '" id="todayOcc-' + esc(occ.key.replace(/[^\w-]/g, "_")) + '"' +
        ' aria-label="' + esc(label.join(", ")) + '"',
      lead,
      esc(occ.name) + ' <span class="chips">' + chips + "</span>",
      meta.join(" · "),
      btn,
      "today-class today-class--" + state.key
    );
  }

  function renderClasses(d) {
    var body = d.todays.length
      ? '<div class="rows card__body--flush">' + d.todays.map(classRow).join("") + "</div>"
      : '<div class="card__body">' + h.empty("calendar", "No classes today", "Nothing is scheduled at the studio today.") + "</div>";
    var aside = '<a class="btn btn--quiet btn--sm" href="#schedule" data-go="schedule">Full schedule' +
      Admin.icon("chevron-right") + "</a>";
    return card("Today's classes", esc(fmt.date(d.today, "full")), body, "today-card--classes", aside);
  }

  /* ============================================================
     NEEDS ATTENTION — small groups, each capped at LIST_LIMIT rows
     ============================================================ */
  // more: { attrs, label } for the "and N more" link
  function group(id, title, rows, more) {
    if (!rows.length) return "";
    var extra = rows.length - LIST_LIMIT;
    return '<div class="today-attn-group" id="todayAttn-' + id + '">' +
        '<h3 class="today-attn-group__title">' + esc(title) + '<span class="count">' + rows.length + "</span></h3>" +
        '<div class="rows">' + rows.slice(0, LIST_LIMIT).join("") + "</div>" +
        (extra > 0
          ? '<a class="today-more" ' + more.attrs + ">" + esc("and " + extra + " more") +
              '<span class="today-more__hint">' + esc(more.label) + "</span>" + Admin.icon("chevron-right") + "</a>"
          : "") +
      "</div>";
  }

  function markRows(d) {
    return d.toMark.map(function (o) {
      return linkRow(
        'data-open-class="' + esc(o.key) + '" aria-label="' +
          esc("Take attendance for " + o.name + ", " + fmt.date(o.date, "relative") + " " + fmt.time(o.time) +
            ", " + o.coach + " — " + h.attendance(o).label) + '"',
        badge("check", "warn"),
        esc(o.name) + " " + h.attendanceBadge(o),
        esc(when(o) + " · " + o.coach),
        '<span class="btn btn--primary btn--xs">' + Admin.icon("check") + "Take attendance</span>",
        "today-attn today-attn--mark"
      );
    });
  }

  // The leave entry that closed a class — a coach can be off several times a day.
  function leaveOf(occ) {
    var list = db.leavesOn(occ.coach, occ.date);
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === occ.leaveId) return list[i];
    }
    return null;
  }

  // blocked classes and coach leave (whole days or single time windows), in date order
  function offRows(d, ahead) {
    var items = [];
    var spells = {};
    ahead.forEach(function (o) {
      if (o.status !== "blocked") return;
      if (o.blockKind === "leave") {
        var k = o.leaveId || o.coach + "|" + o.date;
        if (!spells[k]) {
          var lv = leaveOf(o);
          var win = o.leaveWindow;
          spells[k] = {
            coach: o.coach, date: o.date, count: 0, id: lv ? lv.id : "",
            allDay: lv ? lv.allDay : !win,
            label: lv ? db.leaveLabel(lv) : win ? fmt.time(win.from) + " – " + fmt.time(win.to) : "All day",
            reason: lv ? lv.reason : ""
          };
          items.push({ sort: o.date + " " + (win ? win.from : "00:00"), spell: spells[k] });
        }
        spells[k].count++;
        return;
      }
      items.push({
        sort: o.date + " " + o.time,
        html: linkRow(
          'data-open-class="' + esc(o.key) + '"',
          badge("ban", "blocked"),
          "Blocked · " + esc(o.name),
          esc(fmt.date(o.date) + " " + fmt.time(o.time) + " · " + o.coach) + (o.reason ? " · " + esc(o.reason) : ""),
          h.chip("FYI", "muted"),
          "today-attn"
        )
      });
    });
    return items.sort(function (a, b) { return a.sort.localeCompare(b.sort); }).map(function (it) {
      if (it.html) return it.html;
      var lv = it.spell;
      // part of a day off reads as "away 4:00 PM – 6:00 PM", not a whole day on leave
      var title = lv.allDay ? lv.coach + " on leave" : lv.coach + " away " + lv.label;
      // open the Leave page on this leave (right filter, tab and month)
      return linkRow(
        'data-go="leave"' + (lv.id ? params({ show: lv.id }) : "") +
          ' aria-label="' + esc(title + ", " + fmt.date(lv.date, "long") + ", " +
            Admin.plural(lv.count, "class", "classes") + " blocked. Show leave") + '"',
        badge("leave", "leave"),
        esc(title),
        '<span class="nowrap">' + esc(fmt.date(lv.date)) + "</span> · " +
          (lv.allDay ? esc("All day") + " · " : "") +
          esc(Admin.plural(lv.count, "class", "classes") + " blocked") +
          (lv.reason ? " · " + esc(lv.reason) : ""),
        h.chip("FYI", "muted"),
        "today-attn today-attn--leave"
      );
    });
  }

  function fullRows(d, ahead) {
    var until = db.addDays(d.today, FULL_DAYS);
    return ahead.filter(function (o) {
      return o.date <= until && o.status === "open" && o.spotsLeft === 0;
    }).map(function (o) {
      return linkRow(
        'data-open-class="' + esc(o.key) + '"',
        badge("users", "full"),
        "Full · " + esc(o.name),
        esc(fmt.date(o.date) + " " + fmt.time(o.time) + " · " + o.coach + " · " + bookedLabel(o)),
        h.chip("Full", "warn"),
        "today-attn"
      );
    });
  }

  // "Ethan Tan" for one child; "Shared by Ethan & Chloe" when siblings share the pool
  function kidsLabel(children) {
    if (children.length < 2) return children[0] ? children[0].name : "";
    var names = children.map(function (ch) { return String(ch.name).split(/\s+/)[0]; });
    return "Shared by " + names.slice(0, -1).join(", ") + " & " + names[names.length - 1];
  }

  // credits are shared by the family — list the families below zero
  function negativeRows(d) {
    return d.report.rows.filter(function (r) { return r.available < 0; })
      .sort(function (a, b) {
        return a.available - b.available || String(a.family.parentName || "").localeCompare(String(b.family.parentName || ""));
      })
      .map(function (r) {
        var name = r.family.parentName ? r.family.parentName + "'s family" : "Family";
        var kids = kidsLabel(r.children);
        var first = r.children[0];
        return linkRow(
          'data-open-family="' + esc(r.family.id) + '"' + (first ? ' data-child="' + esc(first.id) + '"' : "") +
            ' aria-label="' + esc(name + " is " + Admin.plural(-r.available, "credit") + " below zero. Open family") + '"',
          badge("wallet", "neg"),
          esc(name),
          esc((kids ? kids + " · " : "") + "needs a top-up or correction"),
          h.credits(r.available),
          "today-attn today-attn--neg"
        );
      });
  }

  function renderAttention(d) {
    var ahead = db.occurrencesForRange(db.addDays(d.today, 1), db.addDays(d.today, OFF_DAYS));
    var toSchedule = { attrs: 'href="#schedule" data-go="schedule"', label: "Schedule" };
    var groups = [
      { id: "mark", title: "Attendance to mark", rows: markRows(d), more: toSchedule },
      { id: "off", title: "Classes off · next " + OFF_DAYS + " days", rows: offRows(d, ahead), more: toSchedule },
      { id: "full", title: "Full · next " + FULL_DAYS + " days", rows: fullRows(d, ahead), more: toSchedule },
      { id: "neg", title: "Negative credit balance", rows: negativeRows(d), more: {
        attrs: 'href="#students?credit=negative" data-go="students"' + params({ credit: "negative" }), label: "Students"
      } }
    ];
    var total = groups.reduce(function (n, g) { return n + g.rows.length; }, 0);
    var body = total
      ? '<div class="today-attn-groups">' + groups.map(function (g) { return group(g.id, g.title, g.rows, g.more); }).join("") + "</div>"
      : '<div class="card__body">' + h.empty("check", "All caught up", "Attendance is marked and nothing needs a look right now.") + "</div>";
    return card("Needs attention", total ? esc(Admin.plural(total, "item")) : "", body, "today-card--attention");
  }

  /* ============================================================
     COMING UP (next 7 days, one line per day)
     ============================================================ */
  function renderComing(d) {
    var from = db.addDays(d.today, 1);
    var rows = [];
    for (var i = 0; i < AHEAD_DAYS; i++) rows.push(dayRow(db.addDays(from, i)));
    var sub = esc(fmt.date(from) + " – " + fmt.date(db.addDays(from, AHEAD_DAYS - 1)));
    return card("Coming up", sub, '<div class="rows card__body--flush">' + rows.join("") + "</div>", "today-card--coming");
  }

  function dayRow(iso) {
    var occs = db.occurrencesForDate(iso, { includeRemoved: true });
    var open = occs.filter(function (o) { return o.status === "open"; });
    var blocked = occs.filter(function (o) { return o.status === "blocked"; }).length;
    var removed = occs.filter(function (o) { return o.status === "removed"; }).length;
    var full = open.filter(function (o) { return o.spotsLeft === 0; }).length;
    var booked = open.reduce(function (n, o) { return n + o.booked; }, 0);
    var cap = open.reduce(function (n, o) { return n + o.capacity; }, 0);
    var pct = cap ? Math.round((booked / cap) * 100) : 0;
    var leaves = db.leaves({ from: iso, to: iso });

    var parts = [Admin.plural(open.length, "class", "classes"), booked + " booked"];
    if (blocked) parts.push(blocked + " blocked");
    if (removed) parts.push(removed + " deleted");
    if (full) parts.push(full + " full");
    var chips = leaves.map(function (l) {
      return h.chip(l.allDay ? l.coach + " on leave" : l.coach + " · " + db.leaveLabel(l), "leave",
        l.reason || db.leaveLabel(l));
    }).join("");

    return linkRow(
      'data-go="schedule"' + params({ week: db.weekStart(iso) }) +
        ' aria-label="' + esc(fmt.date(iso) + ": " + parts.join(", ") + ". Open schedule") + '"',
      '<span class="today-day"><strong>' + esc(HC.dayShort[db.dayIndex(iso)]) + "</strong><span>" +
        esc(fmt.date(iso, "day")) + "</span></span>",
      esc(parts.join(" · ")) + (chips ? ' <span class="chips">' + chips + "</span>" : ""),
      '<span class="today-meter" aria-hidden="true"><i style="width:' + pct + '%"></i></span>' +
        '<span class="today-meter__label">' + (cap ? pct + "% full" : "No open classes") + "</span>",
      "",
      "today-dayrow"
    );
  }

  /* ============================================================
     RECENT ACTIVITY
     ============================================================ */
  function renderActivity() {
    var list = db.auditLog(ACTIVITY_LIMIT);
    var body;
    if (!list.length) {
      body = '<div class="card__body">' + h.empty("clock", "No recent activity",
        "Blocks, leave, one-off classes and credit changes will show up here.") + "</div>";
    } else {
      body = '<ul class="rows card__body--flush today-activity">' + list.map(function (a) {
        var who = db.actorName(a.by);
        return '<li class="row">' +
            h.avatar(who, "sm") +
            '<div class="row__main">' +
              '<p class="today-activity__text">' + esc(a.text) + "</p>" +
              '<p class="row__meta">' + esc(who + " · " + fmt.stamp(a.at)) + "</p>" +
            "</div>" +
          "</li>";
      }).join("") + "</ul>";
    }
    return card("Recent activity", "Across the studio", body, "today-card--activity");
  }

  /* ============================================================
     VIEW
     ============================================================ */
  Admin.registerView("today", {
    render: function (el) {
      var d = collect();
      el.innerHTML =
        renderHead(d) +
        renderStats(d) +
        '<div class="today-grid">' +
          '<div class="today-col today-col--main">' + renderClasses(d) + renderComing(d) + "</div>" +
          '<div class="today-col today-col--side">' + renderAttention(d) + renderActivity() + "</div>" +
        "</div>";

      var add = el.querySelector("#todayAddOneOff");
      if (add) {
        add.addEventListener("click", function () {
          if (canAddOneOff()) Admin.addOneOff();
        });
      }
    }
  });
})();
