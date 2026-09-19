/* ============================================================
   HUACHENG ELITE — Coach & Admin console · Leave
   ------------------------------------------------------------
   Whole-day coach leave. A leave day blocks every class the
   coach runs that day (the store cancels + refunds bookings).
   Classes already under way when the leave is booked carry on.

   - Coaches see, book and cancel their own leave only.
   - The admin sees everyone (coach filter) and books for anyone.
     Coaches come from the store (Admin.h.coachOptions), never
     from the static HC.coaches list.
   - #leave?add=1[&date=YYYY-MM-DD][&coach=Coach A] opens the
     add-leave modal once (used by the Today quick action).
   - #leave?show=<leaveId> shows that leave day: right coach
     filter, tab and calendar month, row highlighted.

   Exposes Admin.addLeave({ date, coach }) — the add-leave modal.
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

  var REASONS = ["Annual leave", "Medical leave", "Competition / event duty", "Personal", "Other"];
  var MAX_SPAN = 31;         // days per booking
  var MONTHS_BACK = 2;       // calendar range around the current month
  var MONTHS_AHEAD = 6;
  var FLASH_MS = 2400;

  // module UI state (views re-render at any time)
  var ui = {
    tab: "upcoming",         // upcoming | past
    coach: "all",            // admin filter: "all" | coach tag
    month: null,             // "YYYY-MM" shown in the calendar
    flash: null              // { id, until } — leave row to highlight
  };
  var addPending = false;    // guards ?add=1 against re-renders
  var showPending = false;   // guards ?show= against re-renders

  /* ---------- helpers ---------- */
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function isDate(s) { return /^\d{4}-\d{2}-\d{2}$/.test(String(s || "")); }
  function monthOf(iso) { return iso.slice(0, 7); }
  function monthNum(ym) { return (+ym.slice(0, 4)) * 12 + (+ym.slice(5, 7) - 1); }
  function monthFromNum(n) { return Math.floor(n / 12) + "-" + pad((n % 12) + 1); }
  function daysInMonth(ym) { return new Date(+ym.slice(0, 4), +ym.slice(5, 7), 0).getDate(); }

  function monthBounds() {
    var cur = monthNum(monthOf(db.todayISO()));
    return { min: cur - MONTHS_BACK, max: cur + MONTHS_AHEAD };
  }
  function clampMonth(ym) {
    var b = monthBounds();
    return monthFromNum(Math.max(b.min, Math.min(b.max, monthNum(ym))));
  }

  function shortMonth(iso) { return db.formatDate(iso, "day").split(" ")[1] || ""; }

  function relative(iso) {
    var diff = db.daysBetween(db.todayISO(), iso);
    if (diff === 0) return "Today";
    if (diff === 1) return "Tomorrow";
    if (diff === -1) return "Yesterday";
    return diff > 0 ? "in " + diff + " days" : Math.abs(diff) + " days ago";
  }

  // "Coach B" → "B"; real names → initials
  function coachInitial(coach) {
    var parts = String(coach || "").trim().split(/\s+/);
    if (parts.length > 1 && /^coach$/i.test(parts[0])) return parts.slice(1).join(" ").charAt(0).toUpperCase();
    return parts.map(function (p) { return p.charAt(0); }).join("").slice(0, 2).toUpperCase();
  }

  // Coaches who can be picked for leave: active ones, plus anyone still on the timetable.
  function isCoach(tag) { return !!tag && db.coachNames().indexOf(tag) >= 0; }
  // Active coaches — the first is the default pick.
  function activeCoaches() { return db.coaches().map(function (c) { return c.coach; }); }

  // whose leave the view shows: a coach tag, or null for everyone (admin "All")
  function scopeCoach() {
    if (!Admin.isAdmin()) return Admin.staff.coach;
    return ui.coach === "all" ? null : ui.coach;
  }

  function findLeave(id) {
    return db.leaves().filter(function (l) { return l.id === id; })[0] || null;
  }

  function dateRange(from, to) {
    var out = [];
    for (var d = from; d <= to && out.length <= MAX_SPAN; d = db.addDays(d, 1)) out.push(d);
    return out;
  }

  // Classes this leave is blocking and the bookings it refunded.
  function impactOf(lv) {
    var classes = db.occurrencesForDate(lv.date, { coach: lv.coach }).filter(function (o) {
      return o.status === "blocked" && o.blockKind === "leave";
    });
    var refunded = 0;
    classes.forEach(function (o) {
      db.bookings({ occKey: o.key, status: "cancelled" }).forEach(function (b) {
        if (b.cancelReason === "Coach unavailable") refunded++;
      });
    });
    return { classes: classes, refunded: refunded };
  }

  /* ============================================================
     LIST
     ============================================================ */
  function leaveItem(lv, past) {
    var imp = impactOf(lv);
    var canCancel = !past && Admin.can("leave", lv.coach);
    var flashing = ui.flash && ui.flash.id === lv.id && Date.now() < ui.flash.until;

    var impactText = imp.classes.length
      ? Admin.plural(imp.classes.length, "class", "classes") + (past ? " were blocked" : " blocked") +
        " · " + Admin.plural(imp.refunded, "booking") + " refunded"
      : "No classes that day";

    var chips = imp.classes.map(function (o) {
      return '<button type="button" class="leave-occ" data-open-class="' + esc(o.key) + '"' +
        ' title="' + esc(o.name + " · " + fmt.timeRange(o)) + '"' +
        ' aria-label="' + esc("Open " + o.name + " at " + fmt.time(o.time)) + '">' +
          "<strong>" + esc(fmt.time(o.time)) + "</strong>" +
          '<span class="leave-occ__name">' + esc(o.name) + "</span>" +
        "</button>";
    }).join("");

    return '<article class="leave-item' + (past ? " leave-item--past" : "") + (flashing ? " is-flash" : "") +
        '" id="leave-' + esc(lv.id) + '" tabindex="-1" aria-label="' + esc(fmt.date(lv.date, "long") + (Admin.isAdmin() ? ", " + lv.coach : "")) + '">' +
        '<div class="leave-item__date" aria-hidden="true">' +
          '<span class="leave-item__dow">' + esc(HC.dayShort[db.dayIndex(lv.date)]) + "</span>" +
          '<span class="leave-item__day">' + esc(+lv.date.slice(8, 10)) + "</span>" +
          '<span class="leave-item__mon">' + esc(shortMonth(lv.date)) + "</span>" +
        "</div>" +
        '<div class="leave-item__top">' +
          '<h3 class="leave-item__title">' + esc(fmt.date(lv.date, "long")) + "</h3>" +
          h.chip(relative(lv.date), past ? "muted" : "info") +
        "</div>" +
        (canCancel
          ? '<div class="leave-item__actions">' +
              '<button type="button" class="btn btn--danger btn--sm" data-cancel-leave="' + esc(lv.id) + '" id="lvCancel-' + esc(lv.id) + '">' +
                Admin.icon("undo") + "Cancel leave</button>" +
            "</div>"
          : "") +
        '<div class="leave-item__body">' +
          (Admin.isAdmin()
            ? '<p class="leave-item__coach">' + h.avatar(lv.coach, "sm") + "<span>" + esc(lv.coach) + "</span></p>"
            : "") +
          '<p class="leave-item__reason">' + (lv.reason ? esc(lv.reason) : '<span class="muted">No reason given</span>') + "</p>" +
          '<p class="leave-item__by">Booked by ' + esc(db.actorName(lv.by)) + " · " + esc(fmt.stamp(lv.at)) + "</p>" +
          '<div class="leave-item__impact">' +
            '<p class="leave-item__impact-t">' + Admin.icon(imp.classes.length ? "ban" : "check") + esc(impactText) + "</p>" +
            (chips ? '<div class="leave-item__occs">' + chips + "</div>" : "") +
          "</div>" +
        "</div>" +
      "</article>";
  }

  function renderList(today) {
    var coach = scopeCoach();
    var upcoming = db.leaves({ coach: coach, from: today });
    var past = db.leaves({ coach: coach, to: db.addDays(today, -1) }).reverse();
    var list = ui.tab === "past" ? past : upcoming;
    var who = Admin.isAdmin() ? (coach ? coach + " has no" : "No coach has any") : "You have no";

    var tabs = '<div class="tabs leave-tabs" role="tablist" aria-label="Leave">' +
      [["upcoming", "Upcoming", upcoming.length], ["past", "Past", past.length]].map(function (t) {
        var on = ui.tab === t[0];
        return '<button type="button" role="tab" id="lvTab-' + t[0] + '" data-leave-tab="' + t[0] + '"' +
          ' aria-selected="' + on + '" aria-controls="lvPanel">' + t[1] +
          '<span class="count">' + t[2] + "</span></button>";
      }).join("") + "</div>";

    var body;
    if (!list.length) {
      body = ui.tab === "past"
        ? h.empty("clock", "No past leave", esc(who + " leave days before today."))
        : h.empty("leave", "No upcoming leave", esc(who + " leave booked.") +
            " Pick a date on the calendar or use <strong>Book leave</strong>.",
            '<button type="button" class="btn btn--primary btn--sm" data-leave-add id="lvAddEmpty">' + Admin.icon("plus") + "Book leave</button>");
    } else {
      body = '<div class="leave-items">' + list.map(function (lv) { return leaveItem(lv, ui.tab === "past"); }).join("") + "</div>";
    }

    return '<section class="leave-list">' + tabs +
        '<div class="card leave-panel" role="tabpanel" id="lvPanel" aria-labelledby="lvTab-' + ui.tab + '">' +
          (ui.tab === "past" && list.length
            ? '<p class="leave-panel__note">' + Admin.icon("info") + "Past leave is read-only.</p>"
            : "") +
          body +
        "</div>" +
      "</section>";
  }

  /* ============================================================
     CALENDAR
     ============================================================ */
  function renderCalendar(today) {
    var ym = ui.month;
    var first = ym + "-01";
    var last = ym + "-" + pad(daysInMonth(ym));
    var gridStart = db.weekStart(first);
    var gridEnd = db.addDays(db.weekStart(last), 6);
    var coach = scopeCoach();
    var b = monthBounds();
    var n = monthNum(ym);
    var thisMonth = monthOf(today);

    var byDate = {};
    var monthLeaves = db.leaves({ coach: coach, from: first, to: last });
    monthLeaves.forEach(function (l) { (byDate[l.date] = byDate[l.date] || []).push(l); });

    var head = HC.dayShort.map(function (d) {
      return '<span class="leave-cal__dow" aria-hidden="true">' + esc(d.charAt(0)) + '<span class="leave-cal__dow-rest">' + esc(d.slice(1)) + "</span></span>";
    }).join("");

    var active = activeCoaches();
    var cells = "";
    for (var d = gridStart; d <= gridEnd; d = db.addDays(d, 1)) {
      if (d < first || d > last) { cells += '<span class="leave-cal__cell leave-cal__cell--out" aria-hidden="true"></span>'; continue; }
      cells += dayCell(d, today, byDate[d] || [], coach, active);
    }

    var sub = monthLeaves.length
      ? Admin.plural(monthLeaves.length, "leave day") + " this month"
      : "No leave this month";

    return '<section class="card leave-cal" aria-labelledby="lvCalTitle">' +
        '<div class="card__head leave-cal__head">' +
          "<div>" +
            '<h2 class="card__title" id="lvCalTitle" aria-live="polite">' + esc(db.formatDate(first, "month")) + "</h2>" +
            '<p class="card__sub">' + esc(sub) + "</p>" +
          "</div>" +
          '<div class="leave-cal__nav">' +
            (ym !== thisMonth ? '<button type="button" class="btn btn--quiet btn--sm" data-leave-month="' + thisMonth + '" id="lvCalToday">Today</button>' : "") +
            '<button type="button" class="btn btn--icon btn--ghost btn--sm" id="lvCalPrev" aria-label="Previous month"' +
              (n <= b.min ? " disabled" : ' data-leave-month="' + monthFromNum(n - 1) + '"') + ">" + Admin.icon("chevron-left") + "</button>" +
            '<button type="button" class="btn btn--icon btn--ghost btn--sm" id="lvCalNext" aria-label="Next month"' +
              (n >= b.max ? " disabled" : ' data-leave-month="' + monthFromNum(n + 1) + '"') + ">" + Admin.icon("chevron-right") + "</button>" +
          "</div>" +
        "</div>" +
        '<div class="card__body">' +
          '<div class="leave-cal__grid" id="lvCalGrid">' + head + cells + "</div>" +
          '<div class="legend leave-cal__legend">' +
            '<span><i class="leave-cal__key leave-cal__key--leave"></i>' + (coach ? "On leave" : "All coaches off") + "</span>" +
            (coach ? "" : '<span><i class="leave-cal__key leave-cal__key--partial"></i>Some coaches off</span>') +
            '<span><i class="leave-cal__key leave-cal__key--today"></i>Today</span>' +
            "<span>Pick a future date to book leave</span>" +
          "</div>" +
        "</div>" +
      "</section>";
  }

  function dayCell(iso, today, list, coach, active) {
    var isPast = iso < today;
    var isToday = iso === today;
    var label = fmt.date(iso);
    var names = list.map(function (l) { return l.coach; });
    // a single coach in scope: any leave counts; "All": only when every active coach is off
    var onLeave = coach ? list.length > 0
      : list.length > 0 && active.every(function (c) { return names.indexOf(c) >= 0; });

    var cls = "leave-cal__cell leave-cal__day" +
      (isPast ? " is-past" : "") + (isToday ? " is-today" : "") +
      (list.length ? " has-leave" : "") + (onLeave ? " is-leave" : "");

    var marks = "";
    if (list.length && (Admin.isAdmin())) {
      marks = '<span class="leave-cal__marks" aria-hidden="true">' + list.map(function (l) {
        return '<i class="leave-cal__mark">' + esc(coachInitial(l.coach)) + "</i>";
      }).join("") + "</span>";
    } else if (list.length) {
      marks = '<span class="leave-cal__marks" aria-hidden="true"><i class="leave-cal__dot"></i></span>';
    }
    var num = '<span class="leave-cal__num">' + esc(+iso.slice(8, 10)) + "</span>";
    var who = Admin.isAdmin() ? names.join(" and ") + " on leave" : "You're on leave";
    var title = list.length ? who + (list[0].reason && list.length === 1 ? " — " + list[0].reason : "") : "";
    var id = ' id="lvDay-' + iso + '" data-date="' + iso + '"';

    if (list.length && (onLeave || isPast)) {
      return '<button type="button" class="' + cls + '"' + id + ' data-show-leave="' + esc(list[0].id) + '"' +
        ' aria-label="' + esc(label + " — " + who + ". Show leave") + '" title="' + esc(title) + '">' + num + marks + "</button>";
    }
    if (!isPast) {
      var extra = list.length ? " (" + names.join(" and ") + " already on leave)" : "";
      return '<button type="button" class="' + cls + '"' + id + ' data-book-date="' + iso + '"' +
        ' aria-label="' + esc("Book leave on " + label + extra) + '"' + (title ? ' title="' + esc(title) + '"' : "") + ">" +
        num + marks + "</button>";
    }
    return '<span class="' + cls + '" data-date="' + iso + '" aria-hidden="true">' + num + "</span>";
  }

  // Arrow keys move between day buttons (skipping past, non-interactive days).
  function onGridKey(e) {
    var steps = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    var step = steps[e.key];
    var from = e.target && e.target.getAttribute && e.target.getAttribute("data-date");
    if (!step || !from) return;
    var grid = e.currentTarget;
    for (var i = 1, d = from; i <= 42; i++) {
      d = db.addDays(d, step);
      var el = grid.querySelector('button[data-date="' + d + '"]');
      if (el) { e.preventDefault(); el.focus(); return; }
      if (monthOf(d) !== monthOf(from)) return;
    }
  }

  /* ============================================================
     ACTIONS
     ============================================================ */
  function reveal(id, focus) {
    setTimeout(function () {
      var row = document.getElementById("leave-" + id);
      if (!row) return;
      try { row.scrollIntoView({ block: "center", behavior: "smooth" }); } catch (e) { row.scrollIntoView(); }
      if (focus) { try { row.focus({ preventScroll: true }); } catch (e) {} }
    }, 60);
  }

  function flash(id) { ui.flash = { id: id, until: Date.now() + FLASH_MS }; }

  // Point the view at a leave day: a filter that includes it, the right tab
  // and its calendar month, row highlighted. Returns false if it can't be shown.
  function focusLeave(id) {
    var lv = findLeave(id);
    if (!lv || !Admin.can("leave", lv.coach)) return false;
    ui.tab = lv.date >= db.todayISO() ? "upcoming" : "past";
    if (Admin.isAdmin() && ui.coach !== "all" && ui.coach !== lv.coach) ui.coach = "all";
    ui.month = clampMonth(monthOf(lv.date));
    flash(id);
    return true;
  }

  function showLeave(id) {
    if (!focusLeave(id)) return;
    Admin.refresh();
    reveal(id, true);
  }

  function cancelLeave(id) {
    var lv = findLeave(id);
    if (!lv) return;
    if (!Admin.can("leave", lv.coach)) { Admin.toast("warn", "You can only change your own leave."); return; }
    var imp = impactOf(lv);
    var day = fmt.date(lv.date);
    var body =
      "<p>Classes on <strong>" + esc(day) + "</strong> will reopen for booking. " +
        "Students who were refunded are not re-booked automatically.</p>" +
      (imp.classes.length
        ? "<p>" + esc(Admin.plural(imp.classes.length, "class", "classes") + (imp.classes.length === 1 ? " reopens" : " reopen")) +
          (imp.refunded
            ? "; " + esc(Admin.plural(imp.refunded, "refunded booking") + (imp.refunded === 1 ? " stays" : " stay") + " cancelled")
            : "") + ".</p>"
        : "");
    Admin.confirm({
      title: "Cancel leave on " + day + "?",
      sub: Admin.isAdmin() ? esc(lv.coach) : "",
      body: body,
      confirmLabel: "Cancel leave",
      cancelLabel: "Keep leave",
      danger: true
    }).then(function (yes) {
      if (!yes) return;
      Admin.check(db.removeLeave(id, { by: Admin.by() }),
        (Admin.isAdmin() ? lv.coach + " is" : "You're") + " back on " + day + " — classes are open for booking again.");
    });
  }

  /* ============================================================
     ADD-LEAVE MODAL
     ============================================================ */
  function openAddLeave(opts) {
    opts = opts || {};
    var today = db.todayISO();
    var isAdmin = Admin.isAdmin();
    var active = activeCoaches();
    var coach = isAdmin
      ? (isCoach(opts.coach) ? opts.coach : isCoach(ui.coach) ? ui.coach : active[0] || "")
      : Admin.staff.coach;
    var from = isDate(opts.date) && opts.date >= today ? opts.date : "";
    // admin picked a day from the "All" calendar: prefer a coach who isn't off yet
    if (isAdmin && from && !opts.coach && db.leaveFor(coach, from)) {
      var free = active.filter(function (c) { return !db.leaveFor(c, from); })[0];
      if (free) coach = free;
    }

    var coachField = isAdmin
      ? '<div class="field"><label for="lvCoach">Coach</label>' +
          '<select id="lvCoach"' + (from ? " autofocus" : "") + ' aria-describedby="lvCoachErr">' +
            (coach ? "" : '<option value="">Choose a coach</option>') + h.coachOptions(coach) + "</select>" +
          '<p class="field-error" id="lvCoachErr"></p></div>'
      : '<div class="field"><span class="field__label">Coach</span>' +
          '<p class="leave-fixed">' + h.avatar(coach, "sm") + "<span>" + esc(coach) + "</span></p>" +
          '<p class="field__hint">You can book leave for yourself. Ask the studio admin to change someone else\'s.</p></div>';

    var body =
      '<form id="lvForm" class="leave-form" novalidate>' +
        coachField +
        '<div class="field-row">' +
          '<div class="field"><label for="lvFrom">From</label>' +
            '<input type="date" id="lvFrom" required min="' + today + '" value="' + esc(from) + '"' +
              (from ? "" : " autofocus") + ' aria-describedby="lvFromErr" />' +
            '<p class="field-error" id="lvFromErr"></p></div>' +
          '<div class="field"><label for="lvTo">To <span class="field__opt">(optional)</span></label>' +
            '<input type="date" id="lvTo" min="' + (from || today) + '" aria-describedby="lvToHint lvToErr" />' +
            '<p class="field__hint" id="lvToHint">For more than one day · up to ' + MAX_SPAN + " days</p>" +
            '<p class="field-error" id="lvToErr"></p></div>' +
        "</div>" +
        '<div class="field-row">' +
          '<div class="field"><label for="lvReason">Reason</label>' +
            '<select id="lvReason"' + (from && !isAdmin ? " autofocus" : "") + ">" + h.options(REASONS, REASONS[0]) + "</select></div>" +
          '<div class="field"><label for="lvNote">Note <span class="field__opt">(optional)</span></label>' +
            '<input type="text" id="lvNote" maxlength="80" autocomplete="off" placeholder="e.g. SEA Games judging" /></div>' +
        "</div>" +
        '<div class="leave-impact" id="lvImpact" aria-live="polite"></div>' +
        '<p class="field-error form-error" id="lvFormErr" role="alert"></p>' +
        '<button type="submit" class="sr-only" tabindex="-1" aria-hidden="true">Book leave</button>' +
      "</form>";

    Admin.openModal({
      title: "Book leave",
      sub: isAdmin
        ? "The coach's classes are blocked for the whole day, so parents can't book them. Anyone already booked gets their credit back and a notification."
        : "Your classes are blocked for the whole day, so parents can't book them. Anyone already booked gets their credit back and a notification.",
      body: body,
      size: "md",
      actions:
        '<button type="button" class="btn btn--ghost" data-close>Cancel</button>' +
        '<button type="button" class="btn btn--primary" id="lvSubmit">' + Admin.icon("check") + '<span id="lvSubmitLabel">Book leave</span></button>',
      onOpen: function (cardEl) { bindForm(cardEl, isAdmin); }
    });
  }

  function bindForm(cardEl, isAdmin) {
    var form = cardEl.querySelector("#lvForm");
    var el = {
      coach: cardEl.querySelector("#lvCoach"),
      from: cardEl.querySelector("#lvFrom"),
      to: cardEl.querySelector("#lvTo"),
      reason: cardEl.querySelector("#lvReason"),
      note: cardEl.querySelector("#lvNote"),
      impact: cardEl.querySelector("#lvImpact"),
      formErr: cardEl.querySelector("#lvFormErr"),
      submit: cardEl.querySelector("#lvSubmit"),
      submitLabel: cardEl.querySelector("#lvSubmitLabel")
    };
    var tried = false;
    var busy = false;

    function read() {
      return {
        coach: isAdmin ? el.coach.value : Admin.staff.coach,
        from: el.from.value,
        to: el.to.value,
        reason: el.reason.value,
        note: el.note.value.trim()
      };
    }

    function validate(v) {
      var today = db.todayISO();
      var errs = {};
      if (!isCoach(v.coach)) errs.coach = "Choose a coach.";
      else if (!Admin.can("leave", v.coach)) errs.coach = "You can only book your own leave.";
      if (!v.from) errs.from = "Choose the first day of leave.";
      else if (!isDate(v.from)) errs.from = "Enter a valid date.";
      else if (v.from < today) errs.from = "Leave can't start in the past.";
      if (v.to) {
        if (!isDate(v.to)) errs.to = "Enter a valid date.";
        else if (!errs.from && v.to < v.from) errs.to = "Must be on or after the first day.";
        else if (!errs.from && db.daysBetween(v.from, v.to) + 1 > MAX_SPAN) errs.to = "Book up to " + MAX_SPAN + " days at a time.";
      }
      return errs;
    }

    function showErrors(errs) {
      [["coach", el.coach, "#lvCoachErr"], ["from", el.from, "#lvFromErr"], ["to", el.to, "#lvToErr"]].forEach(function (f) {
        var msgEl = cardEl.querySelector(f[2]);
        if (f[1]) {
          f[1].classList.toggle("invalid", !!errs[f[0]]);
          if (errs[f[0]]) f[1].setAttribute("aria-invalid", "true"); else f[1].removeAttribute("aria-invalid");
        }
        if (msgEl) msgEl.textContent = errs[f[0]] || "";
      });
    }

    // classes: what the leave blocks (leaveImpact skips classes already under way)
    // running: today's classes that have started — they carry on as normal
    function compute(v, errs) {
      if (errs.coach || errs.from || errs.to || !v.from) return null;
      var today = db.todayISO();
      var r = { dates: dateRange(v.from, v.to || v.from), add: [], skip: [], classes: [], bookings: 0, running: [] };
      r.dates.forEach(function (d) {
        if (db.leaveFor(v.coach, d)) { r.skip.push(d); return; }
        r.add.push(d);
        var imp = db.leaveImpact(v.coach, d);
        r.classes = r.classes.concat(imp.classes);
        r.bookings += imp.bookings;
        if (d === today) {
          r.running = db.occurrencesForDate(d, { coach: v.coach }).filter(function (o) {
            return o.status === "open" && o.started;
          });
        }
      });
      return r;
    }

    function impactItem(when, what, n, cls) {
      return '<li class="leave-impact__item' + (cls ? " " + cls : "") + '">' +
          '<span class="leave-impact__when">' + esc(when) + "</span>" +
          '<span class="leave-impact__what">' + what + "</span>" +
          '<span class="leave-impact__n">' + esc(n) + "</span>" +
        "</li>";
    }

    function impactHtml(v, r) {
      if (!r) {
        return '<p class="leave-impact__hint">' + Admin.icon("calendar") + "Choose a date to see which classes are affected.</p>";
      }
      var who = isAdmin ? v.coach + " is" : "You're";
      if (!r.add.length) {
        return h.notice("warn", "<strong>" + esc(who + " already on leave " +
          (r.dates.length > 1 ? "on all of these dates." : "on " + fmt.date(v.from) + ".")) + "</strong> Nothing new to book.");
      }
      var head;
      if (!r.classes.length) {
        var multi = r.add.length > 1;
        head = "<strong>No classes to block</strong> — " + esc(r.running.length
          ? "today's classes have already started" + (multi ? " and nothing else is on the timetable." : ".")
          : multi ? "there's nothing on the timetable on these dates." : "there's nothing on the timetable that day.");
      } else {
        head = "<strong>Blocks " + esc(Admin.plural(r.classes.length, "class", "classes")) + "</strong>" +
          (r.bookings
            ? " and refunds <strong>" + esc(Admin.plural(r.bookings, "booked student")) + "</strong> — their parents get the credit back and a notification."
            : " — no students are booked yet.");
      }
      if (r.add.length > 1) head = esc(r.add.length + " days of leave") + " · " + head;

      // one line per class, in date order: blocked, carrying on, or a day skipped
      var items = r.classes.map(function (o) {
        return { sort: o.date + " " + o.time, html: impactItem(fmt.date(o.date) + " · " + fmt.time(o.time),
          esc(o.name), o.booked ? o.booked + " booked" : "No bookings") };
      }).concat(r.running.map(function (o) {
        return { sort: o.date + " " + o.time, html: impactItem(fmt.date(o.date) + " · " + fmt.time(o.time),
          esc(o.name) + " " + h.chip(o.ended ? "Finished · not affected" : "Under way · not affected", "muted"),
          o.booked ? o.booked + " booked" : "No bookings", "is-running") };
      })).concat(r.skip.map(function (d) {
        return { sort: d + " 00:00", html: impactItem(fmt.date(d), "Already on leave — skipped", "", "is-skip") };
      })).sort(function (a, b) { return a.sort.localeCompare(b.sort); }).map(function (it) { return it.html; });

      return h.notice(r.bookings ? "warn" : "info", head) +
        (items.length ? '<ul class="leave-impact__list" aria-label="Classes on these dates">' + items.join("") + "</ul>" : "") +
        (r.running.length
          ? '<p class="leave-impact__note" id="lvRunningNote">' + Admin.icon("info") +
              "<span>Classes already under way today aren't affected — they keep their bookings and attendance.</span></p>"
          : "");
    }

    function update() {
      var v = read();
      var errs = validate(v);
      el.to.min = isDate(v.from) ? v.from : db.todayISO();
      if (tried) showErrors(errs);
      else showErrors(pick(errs, v));
      var r = compute(v, errs);
      el.impact.innerHTML = impactHtml(v, r);
      var n = r ? r.add.length : 0;
      el.submitLabel.textContent = n > 1 ? "Book " + n + " days" : "Book leave";
      el.formErr.textContent = "";
      return { v: v, errs: errs, r: r };
    }

    // before the first submit, only flag fields that have a value that's wrong
    function pick(errs, v) {
      var out = {};
      if (v.from && errs.from) out.from = errs.from;
      if (v.to && errs.to) out.to = errs.to;
      return out;
    }

    function submit(e) {
      if (e) e.preventDefault();
      if (busy) return;
      tried = true;
      var s = update();
      var keys = Object.keys(s.errs);
      if (keys.length) {
        var first = el[keys[0]] || el.from;
        try { first.focus(); } catch (err) {}
        return;
      }
      if (!s.r.add.length) {
        el.formErr.textContent = (isAdmin ? s.v.coach + " is" : "You're") + " already on leave " +
          (s.r.dates.length > 1 ? "on all of these dates." : "that day.");
        return;
      }
      busy = true;
      var reason = s.v.reason + (s.v.note ? " — " + s.v.note : "");
      var made = [], failed = [], classes = 0, refunded = 0;
      s.r.add.forEach(function (d) {
        var res = db.addLeave({ coach: s.v.coach, date: d, reason: reason }, { by: Admin.by() });
        if (res && res.ok) {
          made.push(res.leave);
          classes += res.classes || 0;
          refunded += res.refunded || 0;
        } else {
          failed.push(fmt.date(d) + ": " + ((res && res.error) || "could not be booked"));
        }
      });
      busy = false;
      if (!made.length) {
        el.formErr.textContent = failed.join(" ");
        return;
      }

      Admin.closeModal();
      // show the new leave: right tab, a filter that includes it, its month
      ui.tab = "upcoming";
      if (isAdmin && ui.coach !== "all" && ui.coach !== s.v.coach) ui.coach = "all";
      ui.month = clampMonth(monthOf(made[0].date));
      flash(made[0].id);

      var msg = (made.length === 1 ? "Leave booked for " + fmt.date(made[0].date) : made.length + " days of leave booked") +
        (isAdmin ? " (" + s.v.coach + ")" : "") + " — " +
        Admin.plural(classes, "class", "classes") + " blocked" +
        (refunded ? ", " + Admin.plural(refunded, "booking") + " refunded" : "") + ".";
      Admin.check({ ok: true }, msg);
      if (failed.length) Admin.check({ ok: false, error: "Not booked — " + failed.join("; ") });
      if (Admin.currentView() === "leave") {
        Admin.refresh();
        reveal(made[0].id, true);
      }
    }

    form.addEventListener("input", update);
    form.addEventListener("change", update);
    form.addEventListener("submit", submit);
    el.submit.addEventListener("click", submit);
    update();
  }

  // cross-module entry point
  Admin.addLeave = openAddLeave;

  /* ============================================================
     VIEW
     ============================================================ */
  function bind(root) {
    function each(sel, fn) {
      Array.prototype.forEach.call(root.querySelectorAll(sel), function (node) {
        node.addEventListener("click", function (e) { fn(node, e); });
      });
    }
    each("#lvAdd, [data-leave-add]", function () {
      openAddLeave({ coach: Admin.isAdmin() && ui.coach !== "all" ? ui.coach : "" });
    });
    var coachFilter = root.querySelector("#lvCoachFilter");
    if (coachFilter) {
      coachFilter.addEventListener("change", function () {
        ui.coach = coachFilter.value || "all";
        Admin.refresh();
      });
    }
    each("[data-leave-tab]", function (node) {
      ui.tab = node.getAttribute("data-leave-tab");
      Admin.refresh();
    });
    each("[data-leave-month]", function (node) {
      ui.month = clampMonth(node.getAttribute("data-leave-month"));
      Admin.refresh();
    });
    each("[data-book-date]", function (node) {
      var coach = Admin.isAdmin() ? (ui.coach !== "all" ? ui.coach : "") : Admin.staff.coach;
      openAddLeave({ date: node.getAttribute("data-book-date"), coach: coach });
    });
    each("[data-show-leave]", function (node) { showLeave(node.getAttribute("data-show-leave")); });
    each("[data-cancel-leave]", function (node) { cancelLeave(node.getAttribute("data-cancel-leave")); });

    var grid = root.querySelector("#lvCalGrid");
    if (grid) grid.addEventListener("keydown", onGridKey);

    // tabs: arrow keys switch between Upcoming / Past
    var tablist = root.querySelector(".leave-tabs");
    if (tablist) {
      tablist.addEventListener("keydown", function (e) {
        if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
        e.preventDefault();
        ui.tab = ui.tab === "upcoming" ? "past" : "upcoming";
        Admin.refresh();
        var t = document.getElementById("lvTab-" + ui.tab);
        if (t) t.focus();
      });
    }
  }

  // ?show=<leaveId>: render() has already pointed the view at it; clear the
  // param and bring the row into view once the render is done.
  function handleShow(id, found) {
    if (showPending) return;
    showPending = true;
    setTimeout(function () {
      showPending = false;
      if (Admin.currentView() !== "leave") return;
      Admin.setParams({ show: "" });
      if (found) reveal(id, true);
      else Admin.toast("info", findLeave(id) ? "You can only see your own leave." : "That leave day isn't booked any more.");
    }, 0);
  }

  function handleParams(params) {
    if (!params || params.add !== "1" || addPending) return;
    addPending = true;
    var pre = { date: isDate(params.date) ? params.date : "", coach: params.coach || "" };
    // defer: setParams re-renders, and we're mid-render
    setTimeout(function () {
      addPending = false;
      if (Admin.currentView() !== "leave") return;
      Admin.setParams({ add: "", date: "", coach: "" });
      if (!Admin.modalOpen()) openAddLeave(pre);
    }, 0);
  }

  Admin.registerView("leave", {
    render: function (el, params) {
      params = params || {};
      var today = db.todayISO();
      if (!ui.month) ui.month = monthOf(today);
      ui.month = clampMonth(ui.month);
      if (!Admin.isAdmin()) ui.coach = "all";
      else if (ui.coach !== "all" && !isCoach(ui.coach)) ui.coach = "all";
      // ?coach=<tag> without add=1 (e.g. from a coach's profile) filters the page to them
      if (Admin.isAdmin() && params.coach && params.add !== "1" && isCoach(params.coach)) {
        ui.coach = params.coach;
        setTimeout(function () {
          if (Admin.currentView() === "leave" && Admin.params().coach) Admin.setParams({ coach: "" });
        }, 0);
      }
      var showId = params.show || "";
      var found = showId ? focusLeave(showId) : false;

      var filter = "";
      if (Admin.isAdmin()) {
        filter = '<div class="toolbar leave-toolbar">' +
            '<div class="toolbar__group">' +
              '<label class="leave-toolbar__label" for="lvCoachFilter">Show leave for</label>' +
              '<select class="input leave-toolbar__select" id="lvCoachFilter">' +
                h.coachOptions(ui.coach, true, { timetable: true }) +
              "</select>" +
            "</div>" +
          "</div>";
      }

      el.innerHTML =
        h.pageHead({
          title: "Leave",
          sub: Admin.isAdmin()
            ? "A leave day blocks all of that coach's classes for the day — booked students are refunded and notified automatically."
            : "A leave day blocks all your classes for the day — booked students are refunded and notified automatically.",
          actions: '<button type="button" class="btn btn--primary" id="lvAdd">' + Admin.icon("plus") + "Book leave</button>"
        }) +
        filter +
        '<div class="leave-layout">' +
          renderList(today) +
          renderCalendar(today) +
        "</div>";

      bind(el);
      if (showId) handleShow(showId, found);
      else handleParams(params);
    }
  });
})();
