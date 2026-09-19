/* ============================================================
   HUACHENG ELITE — Coach & Admin console · Coaches (admin only)
   ------------------------------------------------------------
   Coaches are data: the studio admin adds and edits them, turns
   their console login on or off, hands weekly classes between
   coaches and deactivates coaches who have left.

   - #coaches          cards for active coaches, studio admins
                       (read-only) and a collapsed inactive list
   - Admin.openCoach(staffId[, "classes"])
                       wide profile drawer: profile, weekly classes
                       (hand over / assign), the next 14 days, leave
   - Admin.addCoach() / Admin.editCoach(staffId)
                       add / edit modal (store errors shown inline)

   A weekly class is handed over "from a date": earlier weeks keep
   the coach they had, so past registers and remarks stay put.
   Deactivating is refused while a coach still has classes — the
   admin gets the list and a way to hand them over instead.
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

  var AHEAD_DAYS = 14;        // "Coming up" in the profile
  var NEXT_DAYS = 28;         // how far a card looks for the next class
  var FAR_DAYS = 400;         // "taught later" probe for weekly classes changing hands
  var NAME_MAX = 40;
  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  var PHONE_RE = /^\+?[\d\s()-]{6,20}$/;

  var ui = { showInactive: false };
  var prof = { id: null };

  /* ============================================================
     HELPERS
     ============================================================ */
  function denied() { return !Admin.can("coaches"); }
  function isDate(s) { return /^\d{4}-\d{2}-\d{2}$/.test(String(s || "")); }
  function isActive(c) { return c.active !== false; }

  function coachById(id) {
    var s = id ? db.staffById(id) : null;
    return s && s.role === "coach" ? s : null;
  }

  function attrJson(o) { return esc(JSON.stringify(o)); }

  // first date on or after `from` that falls on weekday `day` (0 = Mon)
  function firstOnOrAfter(from, day) {
    return db.addDays(from, (day - db.dayIndex(from) + 7) % 7);
  }

  // weekly class row, same shape as db.weeklyClassesFor()
  function classInfo(templateId) {
    var t = HC.schedule.filter(function (x) { return x.id === templateId; })[0];
    if (!t) return null;
    var p = HC.getProgramme(t.programmeId) || {};
    return {
      templateId: t.id, day: t.day, time: t.time, programmeId: t.programmeId,
      name: p.name || t.programmeId, level: p.level || "", capacity: t.capacity, duration: p.duration || 60
    };
  }

  function endOf(w) { return db.fromMinutes(db.toMinutes(w.time) + (w.duration || 60)); }
  function slot(w) { return HC.dayShort[w.day] + " " + fmt.time(w.time); }
  function slotLong(w) { return HC.dayNames[w.day] + "s at " + fmt.time(w.time); }

  // the coach timetabled for a weekly class on a date (ignores one-date covers)
  function coachOn(templateId, date) {
    var o = db.occurrence(db.occKey(date, templateId));
    return o ? o.originalCoach : "";
  }

  function loginChip(c) {
    if (!isActive(c)) return h.chip("Inactive", "muted");
    return c.login
      ? h.chip("Can log in", "ok", "Signs in to the coach console with " + (c.email || "their email"))
      : h.chip("No login", "muted", "Teaches classes but can't sign in to the console");
  }

  function sinceText(c) {
    return c.createdAt ? fmt.date(String(c.createdAt).slice(0, 10), "full") : "Original team";
  }

  function whenText(iso) { return fmt.date(iso, "relative"); }

  function contactHtml(c, idPrefix) {
    var mail = c.email
      ? '<a class="coa-contact__link" href="mailto:' + esc(c.email) + '" id="' + idPrefix + 'Mail">' +
          Admin.icon("mail") + '<span class="coa-contact__text">' + esc(c.email) + "</span></a>"
      : '<span class="coa-contact__none">' + Admin.icon("mail") + "<span>No email</span></span>";
    var tel = c.phone
      ? '<a class="coa-contact__link" href="tel:' + esc(String(c.phone).replace(/[^\d+]/g, "")) + '" id="' + idPrefix + 'Tel">' +
          Admin.icon("phone") + '<span class="coa-contact__text">' + esc(c.phone) + "</span></a>"
      : '<span class="coa-contact__none">' + Admin.icon("phone") + "<span>No phone</span></span>";
    return '<ul class="coa-contact"><li>' + mail + "</li><li>" + tel + "</li></ul>";
  }

  /* ---------- weekly classes changing hands ---------- */
  // now:     weekly classes the coach teaches as of today
  // leaving: templateId → { date, to, ended } — moves on (or ends) from `date`
  // joining: [{ cls, date, from }] — handed to this coach from a later date
  function weeklyPlan(tag, today) {
    var now = db.weeklyClassesFor(tag, today);
    var far = db.weeklyClassesFor(tag, db.addDays(today, FAR_DAYS));
    var nowIds = {}, farIds = {};
    now.forEach(function (w) { nowIds[w.templateId] = true; });
    far.forEach(function (w) { farIds[w.templateId] = true; });

    // first date (on the class's weekday, after today) where `has` flips
    function switchDate(w, wanted) {
      var d = firstOnOrAfter(db.addDays(today, 1), w.day);
      for (var i = 0; i * 7 <= FAR_DAYS; i++, d = db.addDays(d, 7)) {
        var has = db.weeklyClassesFor(tag, d).some(function (x) { return x.templateId === w.templateId; });
        if (has === wanted) return d;
      }
      return null;
    }

    var leaving = {};
    now.forEach(function (w) {
      if (farIds[w.templateId]) return;
      var d = switchDate(w, false);
      if (!d) return;
      var occ = db.occurrence(db.occKey(d, w.templateId));
      var ended = !!occ && occ.status === "removed" && occ.removedScope === "series";
      leaving[w.templateId] = { date: d, ended: ended, to: ended || !occ ? "" : occ.originalCoach };
    });

    var joining = [];
    far.forEach(function (w) {
      if (nowIds[w.templateId]) return;
      var d = switchDate(w, true);
      if (!d) return;
      joining.push({ cls: w, date: d, from: coachOn(w.templateId, db.addDays(d, -7)) });
    });
    joining.sort(function (a, b) { return a.date.localeCompare(b.date); });
    return { now: now, leaving: leaving, joining: joining };
  }

  /* ============================================================
     LIST VIEW
     ============================================================ */
  // Every class from the start of this week to NEXT_DAYS ahead, by coach.
  function classesByCoach(today) {
    var from = db.weekStart(today);
    var by = {};
    db.occurrencesForRange(from, db.addDays(today, NEXT_DAYS)).forEach(function (o) {
      (by[o.coach] = by[o.coach] || []).push(o);
    });
    return { weekEnd: db.addDays(from, 6), by: by };
  }

  function cardStats(c, cache, today) {
    var list = cache.by[c.coach] || [];
    var week = list.filter(function (o) { return o.date <= cache.weekEnd && o.status === "open"; });
    var plan = weeklyPlan(c.coach, today);
    return {
      weekly: plan.now.length,
      joining: plan.joining,
      week: week.length,
      left: week.filter(function (o) { return !o.ended; }).length,
      next: list.filter(function (o) { return o.status === "open" && !o.started; })[0] || null,
      leave: db.leaves({ coach: c.coach, from: today }),
      offToday: !!db.leaveFor(c.coach, today)
    };
  }

  function statCell(key, value, note) {
    return '<div class="coa-stat"><dt class="coa-stat__k">' + esc(key) + "</dt>" +
      '<dd class="coa-stat__v">' + esc(value) + "</dd>" +
      '<dd class="coa-stat__d">' + (note ? esc(note) : "&nbsp;") + "</dd></div>";
  }

  function coachCard(c, st) {
    var id = esc(c.id);
    var weeklyNote = st.joining.length
      ? "+" + st.joining.length + " from " + fmt.date(st.joining[0].date, "day")
      : st.weekly ? "classes a week" : "none yet";
    var weekNote = st.week ? st.left + " to come" : "no classes";
    var leaveNote = st.leave.length ? "next " + fmt.date(st.leave[0].date, "day") : "none booked";

    var next = st.next
      ? '<button type="button" class="coa-next" data-open-class="' + esc(st.next.key) + '" id="coaNext-' + id + '"' +
          ' aria-label="' + esc("Next class: " + st.next.name + ", " + fmt.date(st.next.date, "long") + " at " + fmt.time(st.next.time)) + '">' +
          Admin.icon("clock") +
          '<span class="coa-next__k">Next</span>' +
          '<span class="coa-next__when">' + esc(whenText(st.next.date) + " · " + fmt.time(st.next.time)) + "</span>" +
          '<span class="coa-next__name">' + esc(st.next.name) + "</span>" +
        "</button>"
      : '<p class="coa-next coa-next--none">' + Admin.icon("clock") +
          "<span>No classes in the next " + (NEXT_DAYS / 7) + " weeks</span></p>";

    return '<article class="coa-card" data-coa-card="' + id + '" aria-labelledby="coaName-' + id + '">' +
        '<header class="coa-card__head">' +
          h.avatar(c.name, "lg") +
          '<div class="coa-card__who">' +
            '<h3 class="coa-card__name" id="coaName-' + id + '">' +
              '<button type="button" class="coa-card__open" data-coa-act="open" data-staff="' + id + '" id="coaOpen-' + id + '">' +
                esc(c.name) + "</button></h3>" +
            '<p class="coa-card__title">' + esc(c.title || "Coach") + "</p>" +
          "</div>" +
          '<div class="coa-card__badges">' + loginChip(c) +
            (st.offToday ? h.chip("On leave today", "leave") : "") + "</div>" +
        "</header>" +
        contactHtml(c, "coaCard-" + id) +
        '<dl class="coa-stats">' +
          statCell("Weekly", st.weekly, weeklyNote) +
          statCell("This week", st.week, weekNote) +
          statCell("Leave ahead", st.leave.length, leaveNote) +
        "</dl>" +
        next +
        '<footer class="coa-card__actions">' +
          '<button type="button" class="btn btn--ghost btn--sm" data-coa-act="edit" data-staff="' + id + '" id="coaEdit-' + id + '"' +
            ' aria-label="' + esc("Edit " + c.name) + '">' + Admin.icon("edit") + "Edit</button>" +
          '<button type="button" class="btn btn--quiet btn--sm" data-coa-act="classes" data-staff="' + id + '" id="coaCls-' + id + '"' +
            ' aria-label="' + esc(c.name + "'s classes") + '">' + Admin.icon("calendar") + "Classes" + Admin.icon("chevron-right", "coa-chev") + "</button>" +
        "</footer>" +
      "</article>";
  }

  function summaryHtml(active, stats, today) {
    var logins = active.filter(function (c) { return c.login; }).length;
    var weekly = 0, week = 0, left = 0, leaveDays = 0, nextLeave = null;
    active.forEach(function (c) {
      var st = stats[c.id];
      weekly += st.weekly; week += st.week; left += st.left; leaveDays += st.leave.length;
      if (st.leave.length && (!nextLeave || st.leave[0].date < nextLeave.date)) nextLeave = st.leave[0];
    });
    function cell(k, v, d) {
      return '<div class="coa-sum"><span class="coa-sum__k">' + esc(k) + "</span>" +
        '<span class="coa-sum__v">' + esc(v) + "</span>" +
        '<span class="coa-sum__d">' + esc(d) + "</span></div>";
    }
    return '<section class="coa-summary" aria-label="Team at a glance">' +
        cell("Active coaches", active.length, Admin.plural(logins, "can log in", "can log in")) +
        cell("Weekly classes", weekly, "across " + Admin.plural(active.length, "coach", "coaches")) +
        cell("Classes this week", week, left + " still to come") +
        cell("Leave ahead", leaveDays, nextLeave ? nextLeave.coach + " · " + whenText(nextLeave.date) : "none booked") +
      "</section>";
  }

  function adminsHtml(admins) {
    if (!admins.length) return "";
    return '<section class="coa-section" aria-labelledby="coaAdminsH">' +
        '<h2 class="coa-section__h" id="coaAdminsH">Studio admins<span class="coa-count">' + admins.length + "</span></h2>" +
        '<div class="card coa-admins"><ul class="rows">' +
          admins.map(function (a) {
            var me = Admin.staff && a.id === Admin.staff.id;
            return '<li class="row coa-admin">' +
                h.avatar(a.name) +
                '<div class="row__main">' +
                  '<p class="row__title">' + esc(a.name) + (me ? ' <span class="coa-you">You</span>' : "") + "</p>" +
                  '<p class="row__meta">' + esc([a.title, a.email].filter(Boolean).join(" · ")) + "</p>" +
                "</div>" +
                '<div class="row__aside">' + h.chip("Admin", "admin") +
                  (a.active === false ? h.chip("Inactive", "muted") : "") + "</div>" +
              "</li>";
          }).join("") +
        "</ul>" +
        '<p class="coa-admins__note">' + Admin.icon("info") + "Admins manage coaches, credits and reports. Admin accounts can't be changed here.</p>" +
        "</div>" +
      "</section>";
  }

  function inactiveHtml(list) {
    if (!list.length) return "";
    var open = ui.showInactive;
    return '<section class="coa-section" aria-labelledby="coaInactiveToggle">' +
        '<h2 class="coa-section__h">' +
          '<button type="button" class="coa-toggle" id="coaInactiveToggle" data-coa-act="toggle-inactive"' +
            ' aria-expanded="' + open + '" aria-controls="coaInactive">' +
            Admin.icon("chevron-right", "coa-toggle__chev") + "Inactive coaches" +
            '<span class="coa-count">' + list.length + "</span></button></h2>" +
        '<div class="card coa-inactive" id="coaInactive"' + (open ? "" : " hidden") + ">" +
          '<p class="coa-inactive__note">Inactive coaches can’t log in or be given classes. Their past classes and remarks are kept.</p>' +
          '<ul class="rows">' + list.map(function (c) {
            var id = esc(c.id);
            return '<li class="row coa-inactive__row">' +
                h.avatar(c.name) +
                '<div class="row__main">' +
                  '<p class="row__title"><button type="button" class="coa-link" data-coa-act="open" data-staff="' + id + '" id="coaInOpen-' + id + '">' +
                    esc(c.name) + "</button></p>" +
                  '<p class="row__meta">' + esc([c.title, c.email].filter(Boolean).join(" · ")) + "</p>" +
                "</div>" +
                '<div class="row__aside">' +
                  '<button type="button" class="btn btn--ghost btn--sm" data-coa-act="reactivate" data-staff="' + id + '" id="coaReact-' + id + '"' +
                    ' aria-label="' + esc("Reactivate " + c.name) + '">' + Admin.icon("undo") + "Reactivate</button>" +
                "</div>" +
              "</li>";
          }).join("") + "</ul>" +
        "</div>" +
      "</section>";
  }

  function renderList(el) {
    if (denied()) {
      el.innerHTML = h.pageHead({ title: "Coaches" }) +
        h.empty("whistle", "Only the studio admin manages coaches", "Ask the studio admin if a coach's details need to change.");
      return;
    }
    var today = db.todayISO();
    var active = db.coaches();
    var inactive = db.coaches({ includeInactive: true }).filter(function (c) { return !isActive(c); });
    var admins = db.staff({ role: "admin", includeInactive: true });
    var cache = classesByCoach(today);
    var stats = {};
    active.forEach(function (c) { stats[c.id] = cardStats(c, cache, today); });

    var addBtn = '<button type="button" class="btn btn--primary" data-coa-act="add" id="coaAdd">' +
      Admin.icon("plus") + "Add coach</button>";

    var main = active.length
      ? summaryHtml(active, stats, today) +
        '<section class="coa-section" aria-labelledby="coaActiveH">' +
          '<h2 class="coa-section__h" id="coaActiveH">Coaches<span class="coa-count">' + active.length + "</span></h2>" +
          '<div class="coa-grid">' + active.map(function (c) { return coachCard(c, stats[c.id]); }).join("") + "</div>" +
        "</section>"
      : h.empty("whistle", "No coaches yet",
          "Add your first coach, then hand them weekly classes from their profile.",
          '<button type="button" class="btn btn--primary btn--sm" data-coa-act="add" id="coaAddEmpty">' + Admin.icon("plus") + "Add coach</button>");

    el.innerHTML = '<div class="coa" id="coaRoot">' +
        h.pageHead({
          title: "Coaches",
          sub: "Add coaches, choose who can log in, and hand weekly classes between coaches.",
          actions: addBtn
        }) +
        main +
        adminsHtml(admins) +
        inactiveHtml(inactive) +
      "</div>";

    var root = el.querySelector("#coaRoot");
    root.addEventListener("click", onRootClick);
  }

  function onRootClick(e) {
    if (e.target.closest("[data-open-class], [data-go]")) return; // the core handles these
    var t = e.target.closest("[data-coa-act]");
    if (t) {
      if (t.disabled) return;
      e.preventDefault();
      act(t.getAttribute("data-coa-act"), t);
      return;
    }
    if (e.target.closest("a, button, input, select, textarea, label")) return;
    var card = e.target.closest("[data-coa-card]");
    if (card) Admin.openCoach(card.getAttribute("data-coa-card"));
  }

  function act(name, t) {
    var id = t.getAttribute("data-staff") || prof.id;
    switch (name) {
      case "add": openCoachForm(null); break;
      case "open": Admin.openCoach(id); break;
      case "classes": Admin.openCoach(id, "classes"); break;
      case "edit": openCoachForm(id); break;
      case "deactivate": deactivate(id); break;
      case "reactivate": reactivate(id); break;
      case "toggle-inactive":
        ui.showInactive = !ui.showInactive;
        Admin.refresh();
        break;
      case "handover":
        openHandover({ mode: "give", staffId: id, templateId: t.getAttribute("data-template"), from: t.getAttribute("data-from") });
        break;
      case "assign": openHandover({ mode: "take", staffId: id }); break;
    }
  }

  Admin.registerView("coaches", { render: renderList });

  /* ============================================================
     PROFILE DRAWER
     ============================================================ */
  Admin.openCoach = function (staffId, focus) {
    if (denied()) { Admin.toast("warn", "Only the studio admin can manage coaches."); return; }
    var c = coachById(staffId);
    if (!c) { Admin.toast("warn", "Coach not found."); return; }
    prof.id = c.id;
    bindDrawerOnce();
    Admin.openDrawer({
      wide: true,
      head: profileHead,
      render: renderProfile,
      onClose: function () { prof.id = null; }
    });
    if (focus === "classes") {
      var sec = document.getElementById("coaDrWeeklyH");
      if (sec) {
        try { sec.scrollIntoView({ block: "start" }); } catch (e) {}
        try { sec.focus({ preventScroll: true }); } catch (e) {}
      }
    }
  };

  function profileHead() {
    var c = coachById(prof.id);
    if (!c) return { title: "Coach not found", sub: "" };
    var parts = ['<span class="coa-dr-title">' + esc(c.title || "Coach") + "</span>", loginChip(c)];
    if (isActive(c) && db.leaveFor(c.coach, db.todayISO())) parts.push(h.chip("On leave today", "leave"));
    return { title: c.name, sub: parts.join("") };
  }

  function section(id, title, inner, aside) {
    return '<section class="drawer__section coa-dsec" aria-labelledby="' + id + '">' +
      '<div class="drawer__section-title"><h3 class="coa-dsec__h" id="' + id + '" tabindex="-1">' + title + "</h3>" +
      (aside || "") + "</div>" + inner + "</section>";
  }

  function renderProfile(body) {
    var c = coachById(prof.id);
    if (!c) {
      body.innerHTML = h.empty("whistle", "Coach not found", "This coach may have been removed or the demo data reset.");
      return;
    }
    var today = db.todayISO();
    var active = isActive(c);
    var plan = weeklyPlan(c.coach, today);

    var actions = '<div class="btn-row coa-dr-actions">' +
      '<button type="button" class="btn btn--ghost btn--sm" data-coa-act="edit" data-staff="' + esc(c.id) + '" id="coaDrEdit">' +
        Admin.icon("edit") + "Edit details</button>" +
      (active
        ? '<button type="button" class="btn btn--danger btn--sm" data-coa-act="deactivate" data-staff="' + esc(c.id) + '" id="coaDrDeact">' +
            Admin.icon("ban") + "Deactivate</button>"
        : '<button type="button" class="btn btn--primary btn--sm" data-coa-act="reactivate" data-staff="' + esc(c.id) + '" id="coaDrReact">' +
            Admin.icon("undo") + "Reactivate</button>") +
      "</div>";

    var top = '<div class="coa-dr-top">' +
        h.avatar(c.name, "lg") +
        '<div class="coa-dr-top__main">' + contactHtml(c, "coaDr") + "</div>" +
        actions +
      "</div>" +
      (active ? "" : h.notice("info", "<p><strong>" + esc(c.name) + " is inactive.</strong> They can’t log in or be given classes. Reactivate them to bring them back.</p>"));

    var profile = '<dl class="kv coa-kv">' +
        "<dt>Title</dt><dd>" + esc(c.title || "Coach") + "</dd>" +
        "<dt>Email</dt><dd>" + (c.email ? '<a class="coa-link" href="mailto:' + esc(c.email) + '">' + esc(c.email) + "</a>" : '<span class="muted">Not added</span>') + "</dd>" +
        "<dt>Phone</dt><dd>" + (c.phone ? '<a class="coa-link" href="tel:' + esc(String(c.phone).replace(/[^\d+]/g, "")) + '">' + esc(c.phone) + "</a>" : '<span class="muted">Not added</span>') + "</dd>" +
        "<dt>Console login</dt><dd>" + (!active ? "Off while inactive" : c.login ? "Can log in with " + esc(c.email) : "No login — teaches classes only") + "</dd>" +
        "<dt>Since</dt><dd>" + esc(sinceText(c)) + "</dd>" +
      "</dl>";

    body.innerHTML = '<div class="coa-dr">' +
        top +
        section("coaDrProfileH", "Profile", '<div class="card coa-dcard">' + profile + "</div>") +
        section("coaDrWeeklyH", "Weekly classes <span class=\"coa-count\">" + plan.now.length + "</span>",
          weeklyHtml(c, plan, active),
          active
            ? '<button type="button" class="btn btn--quiet btn--xs" data-coa-act="assign" data-staff="' + esc(c.id) + '" id="coaDrAssign">' +
                Admin.icon("plus") + "Assign a weekly class</button>"
            : "") +
        section("coaDrUpH", "Coming up · next " + AHEAD_DAYS + " days", upcomingHtml(c, today)) +
        laterHtml(c, today) +
        section("coaDrLeaveH", "Leave", leaveHtml(c, today)) +
      "</div>";
  }

  function weeklyHtml(c, plan, active) {
    var rows = [];
    var lastDay = -1;
    plan.now.forEach(function (w) {
      var move = plan.leaving[w.templateId];
      var note = move
        ? (move.ended
            ? h.chip("Ends " + fmt.date(move.date, "day"), "removed", "Weekly class deleted from " + fmt.date(move.date, "long"))
            : h.chip("To " + move.to + " from " + fmt.date(move.date, "day"), "sub", "Handed over from " + fmt.date(move.date, "long")))
        : "";
      rows.push(weeklyRow(c, w, note, w.day !== lastDay, "", active));
      lastDay = w.day;
    });

    var joining = plan.joining.map(function (j) {
      return weeklyRow(c, j.cls,
        h.chip("Starts " + fmt.date(j.date, "day"), "oneoff", "First class " + fmt.date(j.date, "long")) +
          (j.from ? '<span class="coa-wk__from">from ' + esc(j.from) + "</span>" : ""),
        true, j.date, active);
    }).join("");

    if (!rows.length && !joining) {
      return h.empty("calendar", "No weekly classes",
        active
          ? esc(c.name) + " isn’t on the weekly timetable yet. Use <strong>Assign a weekly class</strong> to hand one over from another coach."
          : "Inactive coaches don’t teach weekly classes.", "", "sm");
    }
    return (rows.length
        ? '<ul class="card coa-dcard coa-wks">' + rows.join("") + "</ul>"
        : '<p class="coa-none">No weekly classes yet.</p>') +
      (joining
        ? '<p class="coa-sublabel">Starting later</p><ul class="card coa-dcard coa-wks">' + joining + "</ul>"
        : "");
  }

  function weeklyRow(c, w, note, showDay, startDate, active) {
    var label = w.name + ", " + slotLong(w);
    return '<li class="coa-wk' + (showDay ? " coa-wk--first" : "") + '">' +
        '<span class="coa-wk__day"' + (showDay ? "" : ' aria-hidden="true"') + ">" + (showDay ? esc(HC.dayShort[w.day]) : "") + "</span>" +
        '<span class="coa-wk__time">' + esc(fmt.time(w.time)) + '<span class="coa-wk__end">' + esc("– " + fmt.time(endOf(w))) + "</span></span>" +
        '<span class="coa-wk__main">' +
          '<span class="coa-wk__name">' + (showDay ? "" : '<span class="sr-only">' + esc(HC.dayNames[w.day]) + " </span>") + esc(w.name) + "</span>" +
          '<span class="coa-wk__meta">' + h.levelChip(w.level) +
            '<span class="coa-wk__cap">Max ' + esc(w.capacity) + "</span>" + note + "</span>" +
        "</span>" +
        (active
          ? '<button type="button" class="btn btn--ghost btn--xs coa-wk__btn" data-coa-act="handover" data-staff="' + esc(c.id) + '"' +
              ' data-template="' + esc(w.templateId) + '"' + (startDate ? ' data-from="' + esc(startDate) + '"' : "") +
              ' id="coaHo-' + esc(w.templateId) + (startDate ? "-later" : "") + '" aria-label="' + esc("Hand over " + label) + '">' +
              Admin.icon("swap") + "Hand over…</button>"
          : "") +
      "</li>";
  }

  function occRow(o, idPrefix) {
    var booked = o.status === "open" ? o.booked + "/" + o.capacity + " booked" : o.reason || "";
    return '<button type="button" class="row coa-up" data-open-class="' + esc(o.key) + '" id="' + idPrefix + esc(o.key.replace(/\W+/g, "-")) + '"' +
        ' aria-label="' + esc(o.name + ", " + fmt.date(o.date, "long") + " at " + fmt.time(o.time) + ", " + h.classState(o).label) + '">' +
        '<span class="coa-up__time">' + esc(fmt.time(o.time)) + "</span>" +
        '<span class="row__main">' +
          '<span class="row__title coa-up__name">' + esc(o.name) + "</span>" +
          '<span class="row__meta">' + esc(fmt.timeRange(o) + (booked ? " · " + booked : "")) + "</span>" +
        "</span>" +
        '<span class="coa-up__chips">' + h.stateChip(o) + h.occChips(o) + h.attendanceBadge(o) + "</span>" +
      "</button>";
  }

  function upcomingHtml(c, today) {
    var list = db.occurrencesForRange(today, db.addDays(today, AHEAD_DAYS - 1), { coach: c.coach });
    if (!list.length) {
      return h.empty("calendar", "Nothing in the next two weeks",
        isActive(c) ? "Classes " + esc(c.name) + " teaches or covers will show here." : "", "", "sm");
    }
    var groups = [];
    list.forEach(function (o) {
      var g = groups[groups.length - 1];
      if (!g || g.date !== o.date) groups.push(g = { date: o.date, items: [] });
      g.items.push(o);
    });
    return '<div class="card coa-dcard coa-ups">' + groups.map(function (g) {
      var rel = whenText(g.date);
      var label = rel === fmt.date(g.date) ? rel : rel + " · " + fmt.date(g.date);
      return '<div class="coa-upday' + (g.date === today ? " is-today" : "") + '">' +
          '<p class="coa-upday__h">' + esc(label) + '<span class="coa-count">' + g.items.length + "</span></p>" +
          '<div class="rows">' + g.items.map(function (o) { return occRow(o, "coaUp-"); }).join("") + "</div>" +
        "</div>";
    }).join("") + "</div>";
  }

  // one-offs and covers beyond the "Coming up" window (they block deactivation too)
  function laterHtml(c, today) {
    var cut = db.addDays(today, AHEAD_DAYS);
    var busy = db.coachCommitments(c.coach, today);
    var keys = busy.oneOffs.map(function (o) { return db.occKey(o.date, o.id); }).concat(busy.covers);
    var list = keys.filter(function (k) { return k.slice(0, 10) >= cut; })
      .map(function (k) { return db.occurrence(k); })
      .filter(function (o) { return o && o.coach === c.coach && o.status !== "removed"; })
      .sort(function (a, b) { return a.date.localeCompare(b.date) || a.time.localeCompare(b.time); });
    if (!list.length) return "";
    return section("coaDrLaterH", "Later one-offs &amp; covers",
      '<div class="card coa-dcard"><div class="rows">' + list.map(function (o) {
        return occRow(o, "coaLater-").replace('<span class="coa-up__time">', '<span class="coa-up__time"><span class="coa-up__date">' + esc(fmt.date(o.date)) + "</span>");
      }).join("") + "</div></div>");
  }

  function leaveHtml(c, today) {
    var list = db.leaves({ coach: c.coach, from: today });
    var btns = '<div class="btn-row coa-leave__btns">' +
      (isActive(c)
        ? '<button type="button" class="btn btn--ghost btn--sm" data-go="leave" data-params="' + attrJson({ add: "1", coach: c.coach }) + '" id="coaDrBookLeave">' +
            Admin.icon("plus") + "Book leave</button>"
        : "") +
      '<button type="button" class="btn btn--quiet btn--sm" data-go="leave" data-params="' + attrJson({ coach: c.coach }) + '" id="coaDrLeavePage">' +
        Admin.icon("leave") + "Open the Leave page" + Admin.icon("chevron-right", "coa-chev") + "</button>" +
      "</div>";
    if (!list.length) {
      return '<p class="coa-none">' + Admin.icon("check") + "No leave booked from today.</p>" + btns;
    }
    return '<ul class="card coa-dcard coa-leaves">' + list.map(function (l) {
      var blocked = db.occurrencesForDate(l.date, { coach: c.coach }).filter(function (o) {
        return o.status === "blocked" && o.blockKind === "leave";
      }).length;
      return '<li class="coa-leave">' +
          '<span class="coa-leave__date" aria-hidden="true">' +
            '<span class="coa-leave__dow">' + esc(HC.dayShort[db.dayIndex(l.date)]) + "</span>" +
            '<span class="coa-leave__day">' + esc(+l.date.slice(8, 10)) + "</span>" +
          "</span>" +
          '<span class="coa-leave__main">' +
            '<span class="coa-leave__t">' + esc(fmt.date(l.date, "long")) + "</span>" +
            '<span class="coa-leave__m">' + esc((l.reason || "No reason given") + " · " +
              (blocked ? Admin.plural(blocked, "class", "classes") + " closed" : "no classes that day")) + "</span>" +
          "</span>" +
          h.chip(whenText(l.date), l.date === today ? "leave" : "info") +
        "</li>";
    }).join("") + "</ul>" + btns;
  }

  /* ---------- drawer events: one delegated listener ---------- */
  var drawerBound = false;
  function bindDrawerOnce() {
    if (drawerBound) return;
    var d = document.getElementById("drawer");
    if (!d) return;
    drawerBound = true;
    d.addEventListener("click", function (e) {
      var t = e.target.closest("[data-coa-act]");
      if (!t || t.disabled || !d.contains(t)) return;
      e.preventDefault();
      act(t.getAttribute("data-coa-act"), t);
    });
  }

  /* ============================================================
     ADD / EDIT COACH
     ============================================================ */
  Admin.addCoach = function () { if (!denied()) openCoachForm(null); };
  Admin.editCoach = function (id) { if (!denied()) openCoachForm(id); };

  function openCoachForm(id) {
    if (denied()) return;
    var c = id ? coachById(id) : null;
    if (id && !c) { Admin.toast("warn", "Coach not found."); return; }
    var d = c || { name: "", title: "", email: "", phone: "", login: false };
    var weeklyCount = c ? db.weeklyClassesFor(c.coach).length : 0;

    var body =
      '<form id="coaForm" class="coa-form" novalidate>' +
        '<div class="field"><label for="coaName">Name</label>' +
          '<input type="text" id="coaName" maxlength="' + NAME_MAX + '" autocomplete="off" required placeholder="e.g. Coach Mei"' +
            ' value="' + esc(d.name) + '" aria-describedby="coaNameHint coaNameErr" />' +
          '<p class="field__hint" id="coaNameHint">' + (c
            ? "Renaming updates the timetable, leave and what parents see."
            : "Shown on the timetable and to parents.") + "</p>" +
          '<p class="field-error" id="coaNameErr" role="alert"></p></div>' +
        '<div class="field"><label for="coaTitle">Title or speciality <span class="field__opt">(optional)</span></label>' +
          '<input type="text" id="coaTitle" maxlength="' + NAME_MAX + '" autocomplete="off" placeholder="e.g. Junior programmes"' +
            ' value="' + esc(c ? d.title : "") + '" /></div>' +
        '<div class="field-row">' +
          '<div class="field"><label for="coaEmail">Email <span class="field__opt" id="coaEmailOpt">' + (d.login ? "(needed to log in)" : "(optional)") + "</span></label>" +
            '<input type="email" id="coaEmail" maxlength="80" autocomplete="off" inputmode="email" placeholder="name@huachengelite.com"' +
              ' value="' + esc(d.email) + '" aria-describedby="coaEmailErr" />' +
            '<p class="field-error" id="coaEmailErr" role="alert"></p></div>' +
          '<div class="field"><label for="coaPhone">Phone <span class="field__opt">(optional)</span></label>' +
            '<input type="tel" id="coaPhone" maxlength="20" autocomplete="off" inputmode="tel" placeholder="e.g. 9123 4567"' +
              ' value="' + esc(d.phone) + '" aria-describedby="coaPhoneErr" />' +
            '<p class="field-error" id="coaPhoneErr" role="alert"></p></div>' +
        "</div>" +
        '<label class="choice coa-login" for="coaLogin">' +
          '<input type="checkbox" id="coaLogin"' + (d.login ? " checked" : "") + ' aria-describedby="coaLoginDesc" />' +
          "<span>" +
            '<span class="choice__t">Can log in to the coach console</span>' +
            '<span class="choice__d" id="coaLoginDesc">They sign in with their email to see their classes, take attendance and write remarks. Leave it off for coaches who only teach.</span>' +
          "</span>" +
        "</label>" +
        '<div id="coaFormNote" aria-live="polite"></div>' +
        '<div id="coaFormErr" role="alert"></div>' +
        '<button type="submit" hidden tabindex="-1" aria-hidden="true"></button>' +
      "</form>";

    Admin.openModal({
      title: c ? "Edit " + c.name : "Add a coach",
      sub: c
        ? esc(c.title || "Coach") + (isActive(c) ? "" : " · inactive")
        : "They’ll appear in coach pickers straight away. Hand them weekly classes from their profile.",
      body: body,
      actions:
        '<button type="button" class="btn btn--ghost" data-close>Cancel</button>' +
        '<button type="button" class="btn btn--primary" id="coaSave">' + (c ? "Save changes" : "Add coach") + "</button>",
      onOpen: function (card) { bindCoachForm(card, c, weeklyCount); }
    });
  }

  function bindCoachForm(card, c, weeklyCount) {
    var form = card.querySelector("#coaForm");
    var f = {
      name: card.querySelector("#coaName"),
      title: card.querySelector("#coaTitle"),
      email: card.querySelector("#coaEmail"),
      phone: card.querySelector("#coaPhone"),
      login: card.querySelector("#coaLogin")
    };
    var errEl = { name: "#coaNameErr", email: "#coaEmailErr", phone: "#coaPhoneErr" };
    var note = card.querySelector("#coaFormNote");
    var formErr = card.querySelector("#coaFormErr");
    var tried = false;

    function read() {
      return {
        name: f.name.value.trim(),
        title: f.title.value.trim(),
        email: f.email.value.trim(),
        phone: f.phone.value.trim(),
        login: f.login.checked
      };
    }

    function validate(v) {
      var errs = {};
      if (!v.name) errs.name = "Enter the coach’s name.";
      else if (v.name.length > NAME_MAX) errs.name = "Keep the name to " + NAME_MAX + " characters or fewer.";
      if (v.email && !EMAIL_RE.test(v.email)) errs.email = "Enter a valid email address.";
      else if (v.login && !v.email) errs.email = "Add an email address so they can log in.";
      if (v.phone && !PHONE_RE.test(v.phone)) errs.phone = "Enter a valid phone number.";
      return errs;
    }

    function setErr(key, msg) {
      var input = f[key];
      input.classList.toggle("invalid", !!msg);
      if (msg) input.setAttribute("aria-invalid", "true"); else input.removeAttribute("aria-invalid");
      card.querySelector(errEl[key]).textContent = msg || "";
    }

    function paintErrors(errs) {
      Object.keys(errEl).forEach(function (k) { setErr(k, errs[k] || ""); });
    }

    function paintNote() {
      var v = read();
      card.querySelector("#coaEmailOpt").textContent = v.login ? "(needed to log in)" : "(optional)";
      var parts = [];
      if (c && v.name && v.name !== c.name) {
        parts.push(h.notice("info", "<p>Renaming <strong>" + esc(c.name) + "</strong> to <strong>" + esc(v.name) + "</strong> updates " +
          (weeklyCount ? esc(Admin.plural(weeklyCount, "weekly class", "weekly classes")) + ", " : "the timetable, ") +
          "their leave and one-off classes, and what parents see. Past classes show the new name too.</p>"));
      }
      if (c && c.login && isActive(c) && !v.login) {
        parts.push(h.notice("warn", "<p>" + esc(c.name) + " will be signed out and can’t log in until you turn this back on. They keep their classes.</p>"));
      }
      if (!c && v.login) {
        parts.push(h.notice("info", "<p>In this demo, coaches who can log in appear as quick sign-ins on the login page.</p>"));
      }
      note.innerHTML = parts.join("");
    }

    function live(e) {
      paintNote();
      var errs = validate(read());
      // the login box asks for an email straight away; other fields once a save was tried
      if (tried) paintErrors(errs);
      else if (e && e.target === f.login) setErr("email", errs.email && f.login.checked ? errs.email : "");
      else if (e && e.target === f.email && !errs.email) setErr("email", "");
      formErr.innerHTML = "";
    }

    function storeField(msg) {
      if (/email/i.test(msg)) return "email";
      if (/name|called/i.test(msg)) return "name";
      return null;
    }

    function save(e) {
      if (e) e.preventDefault();
      tried = true;
      formErr.innerHTML = "";
      var v = read();
      var errs = validate(v);
      paintErrors(errs);
      var bad = ["name", "email", "phone"].filter(function (k) { return errs[k]; })[0];
      if (bad) { f[bad].focus(); return; }

      if (c && v.name === c.name && v.title === (c.title || "") && v.email === (c.email || "") &&
          v.phone === (c.phone || "") && v.login === !!c.login) {
        Admin.closeModal();
        Admin.toast("info", "No changes to save.");
        return;
      }

      var res = c
        ? db.updateCoach(c.id, v, { by: Admin.by() })
        : db.addCoach(v, { by: Admin.by() });
      if (!res || !res.ok) {
        var msg = (res && res.error) || "Something went wrong.";
        var key = storeField(msg);
        if (key) { setErr(key, msg); f[key].focus(); }
        else formErr.innerHTML = h.notice("warn", "<p>" + esc(msg) + "</p>");
        return;
      }
      Admin.closeModal();
      if (c) {
        Admin.toast("ok", "Saved changes to " + res.coach.name + ".");
      } else {
        Admin.toast("ok", res.coach.name + " added — hand them weekly classes from their profile.");
        Admin.openCoach(res.coach.id);
      }
    }

    form.addEventListener("submit", save);
    card.querySelector("#coaSave").addEventListener("click", save);
    [f.name, f.title, f.email, f.phone].forEach(function (i) { i.addEventListener("input", live); });
    f.login.addEventListener("change", live);
    paintNote();
  }

  /* ============================================================
     HAND OVER / ASSIGN A WEEKLY CLASS
     opts: { mode: "give" (this coach's class → another coach)
                 | "take" (another coach's class → this coach),
             staffId, templateId (give), from (default start date) }
     ============================================================ */
  function openHandover(opts) {
    if (denied()) return;
    var c = coachById(opts.staffId);
    if (!c || !isActive(c)) { Admin.toast("warn", "Choose an active coach."); return; }
    var today = db.todayISO();
    var give = opts.mode !== "take";
    var from = isDate(opts.from) && opts.from >= today ? opts.from : today;
    var fixed = give ? classInfo(opts.templateId) : null;
    if (give && !fixed) { Admin.toast("warn", "Weekly class not found."); return; }

    var others = db.coaches().filter(function (x) { return x.coach !== c.coach; });
    var candidates = give ? [] : takeCandidates(c, today);

    var empty = give && !others.length
      ? h.empty("whistle", "No other coaches yet", "Add another coach first, then hand this class over.",
          '<button type="button" class="btn btn--primary btn--sm" id="coaHoAddCoach">' + Admin.icon("plus") + "Add coach</button>", "sm")
      : !give && !candidates.length
        ? h.empty("calendar", "Nothing to assign", esc(c.name) + " already teaches every weekly class.", "", "sm")
        : "";

    var pick = give
      ? '<div class="coa-ho-class">' +
          '<span class="coa-ho-class__day">' + esc(HC.dayShort[fixed.day]) + "</span>" +
          '<span class="coa-ho-class__main"><strong>' + esc(fixed.name) + "</strong>" +
            "<span>" + esc(HC.dayNames[fixed.day] + "s · " + fmt.time(fixed.time) + " – " + fmt.time(endOf(fixed)) + " · Max " + fixed.capacity) + "</span></span>" +
          h.levelChip(fixed.level) +
        "</div>" +
        '<div class="field"><label for="coaHoCoach">Hand over to</label>' +
          '<select id="coaHoCoach">' + h.options(others.map(function (x) {
            return { value: x.coach, label: x.name + (x.title ? " · " + x.title : "") };
          }), "") + "</select></div>"
      : '<div class="field"><label for="coaHoClass">Weekly class</label>' +
          '<select id="coaHoClass">' + classOptions(candidates) + "</select>" +
          '<p class="field__hint">Grouped by day. The name after each class is the coach teaching it now.</p></div>';

    var body = empty ||
      '<form id="coaHoForm" class="coa-form" novalidate>' +
        pick +
        '<div class="field"><label for="coaHoFrom">Starting</label>' +
          '<input type="date" id="coaHoFrom" required min="' + today + '" value="' + esc(from) + '" aria-describedby="coaHoHint coaHoFromErr" />' +
          '<p class="field__hint coa-ho-hint" id="coaHoHint"></p>' +
          '<p class="field-error" id="coaHoFromErr" role="alert"></p></div>' +
        '<div id="coaHoWarn" class="coa-ho-warn" aria-live="polite"></div>' +
        '<div id="coaHoErr" role="alert"></div>' +
        '<button type="submit" hidden tabindex="-1" aria-hidden="true"></button>' +
      "</form>";

    Admin.openModal({
      title: give ? "Hand over " + fixed.name : "Assign a weekly class",
      sub: give
        ? esc("Currently taught by " + c.name + " on " + slotLong(fixed) + ".")
        : esc("Give " + c.name + " a class from another coach’s timetable."),
      body: body,
      actions: empty
        ? '<button type="button" class="btn btn--ghost" data-close>Close</button>'
        : '<button type="button" class="btn btn--ghost" data-close>Cancel</button>' +
          '<button type="button" class="btn btn--primary" id="coaHoSave">' + Admin.icon("swap") + (give ? "Hand over class" : "Assign class") + "</button>",
      onOpen: function (card) {
        var addBtn = card.querySelector("#coaHoAddCoach");
        if (addBtn) addBtn.addEventListener("click", function () { Admin.closeModal(); openCoachForm(null); });
        if (!empty) bindHandover(card, c, give, fixed);
      }
    });
  }

  // weekly classes this coach doesn't already teach (today or from the next class)
  function takeCandidates(c, today) {
    var mine = {};
    db.weeklyClassesFor(c.coach, today).forEach(function (w) { mine[w.templateId] = true; });
    return HC.schedule.map(function (t) { return classInfo(t.id); }).filter(function (w) {
      if (!w || mine[w.templateId]) return false;
      var end = db.seriesEnd(w.templateId);
      return !(end && end.from <= today);
    }).map(function (w) {
      w.current = coachOn(w.templateId, firstOnOrAfter(today, w.day));
      return w;
    }).filter(function (w) {
      return w.current !== c.coach; // already handed to this coach from its next class
    }).sort(function (a, b) { return a.day - b.day || a.time.localeCompare(b.time); });
  }

  function classOptions(list) {
    var out = "";
    for (var day = 0; day < 7; day++) {
      var items = list.filter(function (w) { return w.day === day; });
      if (!items.length) continue;
      out += '<optgroup label="' + esc(HC.dayNames[day]) + '">' + items.map(function (w) {
        return '<option value="' + esc(w.templateId) + '">' +
          esc(fmt.time(w.time) + " · " + w.name + (w.current ? " — " + w.current : "")) + "</option>";
      }).join("") + "</optgroup>";
    }
    return out;
  }

  function bindHandover(card, c, give, fixed) {
    var coachSel = card.querySelector("#coaHoCoach");
    var classSel = card.querySelector("#coaHoClass");
    var fromIn = card.querySelector("#coaHoFrom");
    var hint = card.querySelector("#coaHoHint");
    var warn = card.querySelector("#coaHoWarn");
    var formErr = card.querySelector("#coaHoErr");
    var fromErr = card.querySelector("#coaHoFromErr");

    function read() {
      return {
        cls: give ? fixed : classInfo(classSel.value),
        coach: give ? coachSel.value : c.coach,
        from: fromIn.value
      };
    }

    function dateError(from) {
      if (!from) return "Choose the first date.";
      if (!isDate(from)) return "Enter a valid date.";
      if (from < db.todayISO()) return "Pick today or a later date.";
      return "";
    }

    function paint() {
      var v = read();
      formErr.innerHTML = "";
      var err = dateError(v.from);
      fromErr.textContent = err;
      fromIn.classList.toggle("invalid", !!err);
      if (err) fromIn.setAttribute("aria-invalid", "true"); else fromIn.removeAttribute("aria-invalid");
      if (err || !v.cls || !v.coach) { hint.textContent = ""; warn.innerHTML = ""; return; }

      var w = v.cls;
      var first = firstOnOrAfter(v.from, w.day);
      var key = db.occKey(first, w.templateId);
      var firstOcc = db.occurrence(key);
      var current = firstOcc ? firstOcc.originalCoach : "";
      var before = coachOn(w.templateId, db.addDays(first, -7));

      hint.textContent = "First class with " + v.coach + ": " + fmt.date(first, "long") + " at " + fmt.time(w.time) + ". " +
        "Earlier weeks keep " + (before && before !== v.coach ? before : "their current coach") + ", so past registers and remarks stay as they are.";

      var notes = [];
      if (current === v.coach) {
        notes.push(h.notice("warn", "<p><strong>" + esc(v.coach) + " already teaches this class</strong> on " + esc(fmt.date(first, "long")) +
          ". Pick another coach or date.</p>"));
      }
      var away = db.leaves({ coach: v.coach, from: v.from }).filter(function (l) { return db.dayIndex(l.date) === w.day; });
      if (away.length) {
        notes.push(h.notice("warn", "<p><strong>" + esc(v.coach) + " is on leave on " +
          esc(away.slice(0, 3).map(function (l) { return fmt.date(l.date); }).join(", ") + (away.length > 3 ? " and " + (away.length - 3) + " more" : "")) +
          ".</strong> " + (away.length === 1 ? "That class stays" : "Those classes stay") +
          " closed, and anyone booked is refunded and told.</p>"));
      }
      var clash = db.clashes(first, w.time, w.duration, v.coach, key).filter(function (o) { return o.status === "open"; });
      if (clash.length) {
        notes.push(h.notice("warn", "<p><strong>Timing clash on " + esc(fmt.date(first)) + ":</strong> " + esc(v.coach) + " already teaches " +
          esc(clash.map(function (o) { return o.name + " (" + fmt.timeRange(o) + ")"; }).join(", ")) + ".</p>"));
      }
      if (firstOcc && first === db.todayISO() && firstOcc.started) {
        notes.push(h.notice("info", "<p>Today’s class has already started — it will show " + esc(v.coach) +
          " too. Start from tomorrow to leave it with " + esc(current || "its coach") + ".</p>"));
      }
      notes.push('<p class="coa-ho-ok">' + Admin.icon("check") + "Students already booked stay booked and keep their credits.</p>");
      warn.innerHTML = notes.join("");
    }

    function save(e) {
      if (e) e.preventDefault();
      paint();
      var v = read();
      if (dateError(v.from)) { fromIn.focus(); return; }
      if (!v.cls || !v.coach) { formErr.innerHTML = h.notice("warn", "<p>Choose a class and a coach.</p>"); return; }
      var res = db.assignWeeklyClass(v.cls.templateId, v.coach, { by: Admin.by(), from: v.from });
      if (!res || !res.ok) {
        formErr.innerHTML = h.notice("warn", "<p>" + esc((res && res.error) || "Something went wrong.") + "</p>");
        return;
      }
      Admin.closeModal();
      Admin.toast("ok", v.cls.name + " (" + slot(v.cls) + ") is now " + v.coach + "’s from " + fmt.date(v.from) +
        (res.refunded ? " — " + Admin.plural(res.refunded, "booking") + " refunded while they’re on leave." : "."));
    }

    card.querySelector("#coaHoForm").addEventListener("submit", save);
    card.querySelector("#coaHoSave").addEventListener("click", save);
    fromIn.addEventListener("input", paint);
    fromIn.addEventListener("change", paint);
    if (coachSel) coachSel.addEventListener("change", paint);
    if (classSel) classSel.addEventListener("change", paint);
    paint();
  }

  /* ============================================================
     DEACTIVATE / REACTIVATE
     ============================================================ */
  function busyCount(b) { return b.weekly.length + b.oneOffs.length + b.covers.length; }

  function deactivate(id) {
    var c = coachById(id);
    if (!c || !isActive(c)) return;
    // same check the store makes: say so straight away rather than after "Are you sure?"
    var busy = db.coachCommitments(c.coach);
    if (busyCount(busy)) { showBusy(c.id, busy); return; }
    Admin.confirm({
      title: "Deactivate " + c.name + "?",
      body: "<p><strong>" + esc(c.name) + "</strong> will no longer be able to log in or be given classes, and won’t appear in coach pickers.</p>" +
        "<p>Their past classes, attendance and remarks stay as they are. You can reactivate them at any time.</p>",
      confirmLabel: "Deactivate",
      danger: true
    }).then(function (yes) {
      if (!yes) return;
      var res = db.updateCoach(c.id, { active: false }, { by: Admin.by() });
      if (res && res.ok) {
        Admin.toast("ok", c.name + " is now inactive and can no longer log in.");
        return;
      }
      if (res && res.code === "busy") { showBusy(c.id, res.commitments); return; }
      Admin.check(res);
    });
  }

  function showBusy(id, busy) {
    var c = coachById(id);
    if (!c) return;
    var weekly = busy.weekly.map(function (t) { return classInfo(t.id); }).filter(Boolean)
      .sort(function (a, b) { return a.day - b.day || a.time.localeCompare(b.time); });
    function occs(keys) {
      return keys.map(function (k) { return db.occurrence(k); }).filter(Boolean)
        .sort(function (a, b) { return a.date.localeCompare(b.date) || a.time.localeCompare(b.time); });
    }
    var oneOffs = occs(busy.oneOffs.map(function (o) { return db.occKey(o.date, o.id); }));
    var covers = occs(busy.covers);
    var n = busyCount(busy);

    function group(title, items) {
      if (!items.length) return "";
      return '<div class="coa-busy__group"><p class="coa-busy__h">' + esc(title) + '<span class="coa-count">' + items.length + "</span></p>" +
        '<ul class="coa-busy__list">' + items.join("") + "</ul></div>";
    }
    var weeklyItems = weekly.map(function (w) {
      return '<li class="coa-busy__item"><span class="coa-busy__when">' + esc(slot(w)) + "</span>" +
        '<span class="coa-busy__name">' + esc(w.name) + "</span></li>";
    });
    function occItem(o) {
      return '<li><button type="button" class="coa-busy__item coa-busy__item--link" data-open-class="' + esc(o.key) + '"' +
        ' aria-label="' + esc("Open " + o.name + ", " + fmt.date(o.date, "long") + " at " + fmt.time(o.time)) + '">' +
        '<span class="coa-busy__when">' + esc(fmt.date(o.date) + " · " + fmt.time(o.time)) + "</span>" +
        '<span class="coa-busy__name">' + esc(o.name) + "</span>" + Admin.icon("chevron-right", "coa-chev") + "</button></li>";
    }

    Admin.openModal({
      title: c.name + " still has classes",
      sub: esc("Hand " + (n === 1 ? "it" : "these " + n) + " to another coach first — then you can deactivate " + c.name + "."),
      body:
        '<div class="coa-busy">' +
          group("Weekly classes", weeklyItems) +
          group("One-off classes", oneOffs.map(occItem)) +
          group("Covering for another coach", covers.map(occItem)) +
        "</div>" +
        ((oneOffs.length || covers.length)
          ? '<p class="coa-busy__tip">' + Admin.icon("info") + "<span>One-offs and covers are changed per date: open the class and choose <strong>Change coach</strong>.</span></p>"
          : ""),
      actions:
        '<button type="button" class="btn btn--ghost" data-close>Not now</button>' +
        (weekly.length
          ? '<button type="button" class="btn btn--primary" id="coaBusyGo">' + Admin.icon("swap") + "Hand over classes</button>"
          : ""),
      onOpen: function (card) {
        var go = card.querySelector("#coaBusyGo");
        if (go) {
          go.addEventListener("click", function () {
            Admin.closeModal();
            Admin.openCoach(c.id, "classes");
          });
        }
        // the core opens the class; close this modal first so the class panel is visible
        card.addEventListener("click", function (e) {
          if (e.target.closest("[data-open-class]")) Admin.closeModal();
        });
      }
    });
  }

  function reactivate(id) {
    var c = coachById(id);
    if (!c || isActive(c)) return;
    var res = db.updateCoach(c.id, { active: true }, { by: Admin.by() });
    Admin.check(res, c.name + " is active again" +
      (c.login ? " and can log in." : ". Turn on their login from Edit if they need the console."));
  }
})();
