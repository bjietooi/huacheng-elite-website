/* ============================================================
   HUACHENG ELITE — Coach & Admin console · class drawer
   ------------------------------------------------------------
   Admin.openClass(key) opens one dated class in the wide drawer:
   where the class is in its day (Upcoming / Now / Passed),
   attendance progress, class actions, the roster (attendance,
   remarks, remove) and manual assignment of students.

   Who can do what (HC.db.can):
   - attendance, add / remove students: the class's coach + admins
   - remarks (rating + performance notes): the class's coach only;
     admins read them. A coach changes only remarks they wrote.
   - credit decisions (book without charging, refund or keep a
     credit when removing): admins only. Coaches always charge,
     and a removal refunds only before the class starts.

   Credits are one pool per family, shared by brothers and sisters:
   every balance shown here is the family's ("Jane Tan's family").

   The core re-runs render() after every HC.db change, so the
   drawer is derived from the store plus the small UI state
   below. Class-level actions (block / reopen / delete / restore
   / change coach) belong to the schedule module and are only
   offered when it exposes them.
   ============================================================ */
(function () {
  "use strict";

  var Admin = window.Admin;
  if (!Admin || !Admin.db) return;
  var db = Admin.db;
  var esc = Admin.esc;
  var fmt = Admin.fmt;
  var h = Admin.h;
  var icon = Admin.icon;

  var MAX_RESULTS = 30;
  var SEP = '<span class="cd-sep" aria-hidden="true">·</span>';

  /* ---------- UI state ---------- */
  var ui = { key: null, showCancelled: false };
  var assign = null; // open "Add student" modal: { key, q, childId, charge, allowNegative, allowFull, added }

  /* ============================================================
     HELPERS
     ============================================================ */
  function canManage(occ) { return !!occ && Admin.can("manage", occ); }

  // remarks are the class coach's job (admins get false)
  function canRemark(occ) { return !!occ && Admin.can("notes", occ); }

  // a coach changes only the remarks they wrote
  function ownsNote(note) { return !!note && !!note.by && note.by === Admin.by(); }

  // credit decisions (waive a charge, refund or keep a credit) are admin-only
  function canCredits() { return Admin.can("credits"); }

  // Once a class has ended only an admin can take a student off it —
  // coaches mark them Absent instead, so the attendance record stays.
  function canRemove(occ) { return canManage(occ) && (Admin.isAdmin() || !occ.ended); }

  function isTimeState(key) { return key === "upcoming" || key === "now" || key === "passed"; }

  function actor(by) { return db.actorName(by); }

  function whoWhen(by, at) {
    var parts = [];
    if (by) parts.push(esc(actor(by)));
    if (at) parts.push(esc(fmt.stamp(at)));
    return parts.join(" · ");
  }

  function firstName(name) { return String(name || "").trim().split(/\s+/)[0] || "This student"; }

  function telHref(phone) { return "tel:" + String(phone || "").replace(/[^\d+]/g, ""); }

  function signedNum(n) { return n < 0 ? "−" + (-n) : String(n); }

  // "Jane Tan's family" — whose credit pool a booking uses
  function familyLabel(f) { return f && f.parentName ? f.parentName + "'s family" : "the family"; }

  // "Shared by Ethan & Chloe" when siblings share the pool, else ""
  function sharedBy(familyId) {
    var kids = familyId ? db.children(familyId).map(function (k) { return firstName(k.name); }) : [];
    if (kids.length < 2) return "";
    return "Shared by " + kids.slice(0, -1).join(", ") + " & " + kids[kids.length - 1];
  }

  function poolTitle(f) { return sharedBy(f && f.id) || (f && f.parentName ? f.parentName + "'s family credits" : "Family credits"); }

  function opensAt(occ) {
    return "Attendance opens " + (occ.isToday ? "" : "on " + fmt.date(occ.date) + " ") + "at " + fmt.time(occ.time);
  }

  function isActive(r) { return r.booking.status === "booked"; }

  function section(id, title, inner, extraClass) {
    return '<section class="drawer__section' + (extraClass ? " " + extraClass : "") + '" aria-labelledby="' + id + '">' +
        '<h3 class="drawer__section-title" id="' + id + '">' + title + "</h3>" +
        inner +
      "</section>";
  }

  function hint(iconName, text) {
    return '<p class="cd-hint">' + icon(iconName) + "<span>" + esc(text) + "</span></p>";
  }

  function actionBtn(action, iconName, label, kind, extra) {
    return '<button type="button" class="btn btn--sm btn--' + kind + '" id="cdAct-' + action + '" data-cd-action="' + action + '"' +
      (extra || "") + ">" + icon(iconName) + esc(label) + "</button>";
  }

  function denied(msg) {
    Admin.toast("warn", msg || "You can only manage your own classes.");
  }

  function remarkDenied(occ) {
    Admin.toast("info", "Remarks are written by the class coach" + (occ && occ.coach ? " (" + occ.coach + ")." : "."));
  }

  function attCounts(active) {
    var c = { present: 0, late: 0, absent: 0 };
    active.forEach(function (r) { if (c[r.booking.attendance] != null) c[r.booking.attendance]++; });
    c.marked = c.present + c.late + c.absent;
    return c;
  }

  // "Starts tomorrow at 4:00 PM", "Happening now · ends at 5:15 PM", "Ended yesterday"
  function whenText(occ) {
    var key = h.classState(occ).key;
    var diff = db.daysBetween(db.todayISO(), occ.date);
    if (key === "now") return "Happening now · ends at " + fmt.time(occ.endTime);
    if (key === "upcoming") {
      if (diff === 0) {
        var mins = db.toMinutes(occ.time) - db.toMinutes(db.nowStamp().slice(11, 16));
        return mins <= 60 ? "Starts in " + Admin.plural(Math.max(1, mins), "minute") : "Starts today at " + fmt.time(occ.time);
      }
      if (diff === 1) return "Starts tomorrow at " + fmt.time(occ.time);
      return "Starts in " + diff + " days";
    }
    if (key === "passed") {
      if (diff === 0) return "Ended today at " + fmt.time(occ.endTime);
      if (diff === -1) return "Ended yesterday";
      return "Ended " + (-diff) + " days ago";
    }
    return "";
  }

  /* ============================================================
     ENTRY POINT
     ============================================================ */
  Admin.openClass = function (key) {
    if (!key) return;
    if (ui.key !== key) ui.showCancelled = false;
    ui.key = key;
    Admin.openDrawer({
      wide: true,
      head: function () { return headFor(key); },
      render: function (body) { renderBody(body, key); },
      onClose: function () { ui.key = null; ui.showCancelled = false; }
    });
  };

  function headFor(key) {
    var occ = db.occurrence(key);
    if (!occ) return { title: "Class not found", sub: "" };
    var sep = '<span class="cd-head__sep" aria-hidden="true">·</span>';
    // blocked / deleted classes carry their status in occChips
    var state = isTimeState(h.classState(occ).key) ? h.stateChip(occ) : "";
    return {
      title: occ.name,
      sub:
        '<span class="nowrap">' + esc(fmt.date(occ.date, "long")) + "</span>" + sep +
        '<span class="nowrap">' + esc(fmt.timeRange(occ)) + "</span>" + sep +
        '<span class="nowrap cd-head__coach">' + icon("user") + esc(occ.coach) + "</span>" +
        '<span class="chips">' + state + h.levelChip(occ.level) + h.occChips(occ) + "</span>"
    };
  }

  /* ============================================================
     RENDER
     ============================================================ */
  function renderBody(body, key) {
    var occ = db.occurrence(key);
    if (!occ) {
      body.innerHTML = '<div class="cd">' +
        h.empty("calendar", "Class not found", "This class is no longer on the timetable. It may have been removed.") +
        "</div>";
      return;
    }
    var manage = canManage(occ);
    var rows = db.roster(key, { includeCancelled: true });
    var active = rows.filter(isActive);
    var cancelled = rows.filter(function (r) { return !isActive(r); });

    body.innerHTML = '<div class="cd" data-key="' + esc(key) + '">' +
        statusSection(occ, manage) +
        summarySection(occ, active) +
        actionsSection(occ, manage) +
        studentsSection(occ, manage, active, cancelled) +
        footSection(occ) +
      "</div>";
    bind(body.querySelector(".cd"), key);
  }

  function repaint(key, focusId) {
    var body = document.querySelector("#drawer .drawer__body");
    if (!body || ui.key !== key || !Admin.drawerOpen()) return;
    var y = body.scrollTop;
    renderBody(body, key);
    body.scrollTop = y;
    var el = focusId && document.getElementById(focusId);
    if (el) { try { el.focus({ preventScroll: true }); } catch (e) {} }
  }

  /* ---------- 1. status notices ---------- */
  function statusSection(occ, manage) {
    var out = [];

    if (!manage) {
      var mine = Admin.staff && Admin.staff.coach;
      out.push(h.notice("info", mine && occ.substituted && occ.originalCoach === mine
        ? "<strong>View only</strong> — " + esc(occ.coach) + " is covering your class on this date."
        : "<strong>View only</strong> — this is " + esc(occ.coach) + "'s class."));
    }

    if (occ.status === "removed") {
      var series = occ.removedScope === "series";
      out.push(h.notice("warn",
        "<p><strong>" + (series ? "Weekly class deleted" : "Class deleted") + "</strong> — " +
          (series ? "this class no longer runs on this date or any later week."
            : occ.oneOff ? "this one-off class won't run and parents can't book it."
            : "it won't run on this date only. The rest of the weekly timetable is unchanged.") + "</p>" +
        reasonLine(occ.reason) +
        '<p class="cd-meta">Deleted by ' + whoWhen(occ.statusBy, occ.statusAt) + "</p>" +
        restoreControl(occ, manage)));
    } else if (occ.status === "blocked" && occ.blockKind === "leave") {
      out.push(h.notice("warn",
        "<p><strong>" + esc(occ.coach) + " is on leave</strong> on this day — the class is closed to parent bookings.</p>" +
        reasonLine(occ.reason) +
        '<p class="cd-meta">Leave added by ' + whoWhen(occ.statusBy, occ.statusAt) + "</p>" +
        '<div class="btn-row cd-notice__actions">' +
          '<button type="button" class="btn btn--quiet btn--xs" id="cdViewLeave" data-go="leave"' + leaveParams(occ) + ">" +
            icon("leave") + "View leave</button>" +
        "</div>"));
    } else if (occ.status === "blocked") {
      out.push(h.notice("warn",
        "<p><strong>Blocked</strong> — parents can't book this class" +
          (manage && !occ.ended && Admin.unblockClass ? ". Reopen it to take bookings again." : ".") + "</p>" +
        reasonLine(occ.reason) +
        '<p class="cd-meta">Blocked by ' + whoWhen(occ.statusBy, occ.statusAt) + "</p>"));
    }

    if (occ.oneOff) {
      out.push(h.notice("info",
        "<p><strong>One-off class</strong> — runs on this date only and isn't part of the weekly timetable.</p>" +
        (occ.note ? reasonLine(occ.note) : "")));
    }

    if (occ.substituted) {
      out.push(h.notice("info",
        "<p><strong>Cover</strong> — " + esc(occ.coach) + " is taking this class. Timetabled coach: " +
        esc(occ.originalCoach) + ".</p>"));
    }

    if (!out.length) return "";
    return '<div class="drawer__section cd-status">' + out.join("") + "</div>";
  }

  // opens the Leave view with this leave highlighted (#leave?show=<id>)
  function leaveParams(occ) {
    var lv = occ.leaveId ? { id: occ.leaveId } : db.leaveFor(occ.coach, occ.date);
    return lv && lv.id ? " data-params=\"" + esc(JSON.stringify({ show: lv.id })) + "\"" : "";
  }

  function reasonLine(text) {
    return text ? '<p class="cd-reason">“' + esc(text) + "”</p>" : "";
  }

  function restoreControl(occ, manage) {
    if (!manage || !Admin.restoreClass || occ.ended) return "";
    var series = occ.removedScope === "series";
    if (series && !Admin.can("series")) {
      return '<p class="cd-meta">Only an admin can restore a weekly class.</p>';
    }
    return '<div class="btn-row cd-notice__actions">' +
        '<button type="button" class="btn btn--ghost btn--sm" id="cdAct-restore" data-cd-action="restore">' +
          icon("undo") + (series ? "Restore weekly class" : "Restore class") + "</button>" +
      "</div>";
  }

  /* ---------- 2. summary: where the class is + attendance + numbers ---------- */
  function summarySection(occ, active) {
    return '<div class="drawer__section cd-summary">' +
        stateBar(occ, active) +
        '<div class="cd-sums">' + sumCells(occ) + "</div>" +
      "</div>";
  }

  function stateBar(occ, active) {
    var key = h.classState(occ).key;
    if (!isTimeState(key)) return "";
    var att = h.attendance(occ);
    return '<div class="cd-state cd-state--' + key + (att.key === "todo" ? " cd-state--todo" : "") + '">' +
        '<p class="cd-state__main">' + h.stateChip(occ) +
          '<span class="cd-state__when">' + esc(whenText(occ)) + "</span></p>" +
        attendanceStat(occ, att, active) +
      "</div>";
  }

  // "Attendance ✓ All marked" / "Attendance ◷ 2 of 6 marked" + the breakdown
  function attendanceStat(occ, att, active) {
    if (att.key === "none") return "";
    var body;
    if (att.key === "empty") {
      body = '<span class="cd-state__none">No students to mark</span>';
    } else {
      var c = attCounts(active);
      body = '<span class="att-badge att-badge--' + att.key + '">' +
          icon(att.key === "done" ? "check" : "clock") +
          "<span>" + (att.key === "done" ? "All marked" : c.marked + " of " + active.length + " marked") + "</span>" +
        "</span>" +
        '<span class="cd-state__d">' + c.present + " present · " + c.late + " late · " + c.absent + " absent</span>";
    }
    return '<div class="cd-state__att"><span class="cd-state__k">Attendance</span>' + body + "</div>";
  }

  function sumCells(occ) {
    var over = occ.booked > occ.capacity;
    var full = occ.booked >= occ.capacity;
    var pct = occ.capacity ? Math.min(100, Math.round((occ.booked / occ.capacity) * 100)) : 0;
    return sumCell("Booked",
        "<strong>" + occ.booked + "</strong><small>/ " + occ.capacity + "</small>",
        '<span class="cd-fill' + (full ? " is-full" : "") + '" role="progressbar" aria-label="Places booked"' +
          ' aria-valuemin="0" aria-valuemax="' + occ.capacity + '" aria-valuenow="' + occ.booked + '">' +
          '<i class="cd-fill__bar" style="width:' + pct + '%"></i></span>') +
      sumCell("Spots left",
        "<strong>" + occ.spotsLeft + "</strong>",
        over ? '<span class="cd-sum__d cd-sum__d--warn">' + (occ.booked - occ.capacity) + " over capacity</span>"
          : full ? '<span class="cd-sum__d cd-sum__d--warn">Class is full</span>'
          : '<span class="cd-sum__d">of ' + occ.capacity + " places</span>") +
      sumCell("Credit cost",
        '<strong class="cd-sum__cred">' + h.credits(occ.cost) + "</strong>",
        '<span class="cd-sum__d">per student</span>');
  }

  function sumCell(label, value, detail) {
    return '<div class="cd-sum">' +
        '<p class="cd-sum__k">' + esc(label) + "</p>" +
        '<p class="cd-sum__v">' + value + "</p>" +
        (detail || "") +
      "</div>";
  }

  /* ---------- 3. class actions ---------- */
  function actionsSection(occ, manage) {
    if (!manage || occ.status === "removed") return "";
    var btns = [];
    var text = "";
    var manualBlock = occ.status === "blocked" && occ.blockKind === "manual";
    var leaveBlock = occ.status === "blocked" && occ.blockKind === "leave";

    if (!occ.started && occ.status === "open" && Admin.blockClass) {
      btns.push(actionBtn("block", "ban", "Block class", "ghost",
        ' title="Stop parents booking this class (e.g. you can\'t make it)"'));
    }
    // reopen stays available while the class runs, so a mistaken block can be undone
    if (manualBlock && !occ.ended && Admin.unblockClass) {
      btns.push(actionBtn("unblock", "undo", "Reopen class", "ghost"));
    }
    if (!occ.started && Admin.substituteCoach && Admin.can("substitute")) {
      btns.push(actionBtn("coach", "swap", "Change coach", "ghost"));
    }
    if (!occ.started && Admin.deleteClass) {
      btns.push(actionBtn("delete", "trash", "Delete…", "danger",
        ' title="Delete this date only' + (Admin.can("series") && occ.templateId ? ", or the weekly class" : "") + '"'));
    }

    if (occ.started) {
      text = "This class has " + (occ.ended ? "ended" : "started") +
        (Admin.can("substitute") ? " — blocking, deleting and coach changes are closed."
          : " — it can no longer be blocked or deleted.");
    } else if (occ.status === "open" && (Admin.blockClass || Admin.deleteClass)) {
      text = (Admin.blockClass ? "Block keeps the class on the timetable but stops parent bookings. " : "") +
        (Admin.deleteClass
          ? (Admin.can("series") && occ.templateId
            ? "Delete cancels this date, or the whole weekly class. "
            : "Delete cancels this date only. ")
          : "") +
        (occ.booked === 1 ? "The booked student's credit goes back to their family, and the parent is told."
          : occ.booked > 1 ? "Credits for all " + occ.booked + " booked students go back to their families, and parents are told."
          : "");
    } else if (leaveBlock) {
      text = Admin.can("substitute") && Admin.substituteCoach
        ? "Blocked by leave — change the coach to reopen this class."
        : "Blocked by leave — cancel the leave to reopen this class.";
    }

    if (!btns.length && !text) return "";
    return section("cdActionsTitle", "Class actions",
      (btns.length ? '<div class="btn-row cd-actions">' + btns.join("") + "</div>" : "") +
      (text ? hint("info", text) : ""));
  }

  /* ---------- 4. students ---------- */
  function studentsSection(occ, manage, active, cancelled) {
    var remark = canRemark(occ);
    var info = [];
    var tools = [];

    if (occ.started && manage && occ.unmarked > 0) {
      tools.push('<button type="button" class="btn btn--ghost btn--sm" id="cdMarkAll" data-cd-action="mark-all"' +
        ' title="' + esc(Admin.plural(occ.unmarked, "student") + " not marked yet") + '">' +
        icon("check") + "Mark all unmarked present</button>");
    }
    if (manage && occ.status !== "removed") {
      var closedWhy = occ.status === "open" ? ""
        : occ.blockKind === "leave" ? "The coach is on leave — students can't be added"
        : "Reopen the class to add students";
      tools.push('<button type="button" class="btn btn--primary btn--sm" id="cdAddStudent" data-cd-action="assign"' +
        (closedWhy ? ' disabled title="' + esc(closedWhy) + '"' : "") + ">" +
        icon("plus") + "Add student</button>");
    }

    if (!occ.started && manage && active.length && occ.status === "open") {
      info.push(hint("clock", opensAt(occ)));
    } else if (manage && occ.status === "blocked") {
      info.push(hint("info", occ.blockKind === "leave"
        ? "Closed while the coach is on leave."
        : "Reopen the class to add students."));
    }
    if (occ.started && manage && !remark && active.length) {
      // admins: attendance yes, remarks no
      info.push('<p class="cd-hint" id="cdRemarkHint">' + icon("note") + "<span>Remarks are written by the class coach (" +
        esc(occ.coach) + "). You can read them here.</span></p>");
    }

    var html = "";
    if (info.length || tools.length) {
      html += '<div class="cd-bar">' +
          '<div class="cd-bar__info">' + info.join("") + "</div>" +
          (tools.length ? '<div class="btn-row cd-bar__tools">' + tools.join("") + "</div>" : "") +
        "</div>";
    }

    if (active.length) {
      html += '<ul class="cd-roster" aria-label="Booked students">' +
        active.map(function (r) { return activeRow(r, occ, manage, remark); }).join("") +
        "</ul>";
    } else {
      html += h.empty("users", "No students booked yet", esc(emptyText(occ, manage)))
        .replace('class="empty"', 'class="empty empty--sm cd-empty"');
    }

    if (cancelled.length) {
      var show = ui.showCancelled;
      html += '<div class="cd-cancelled">' +
          '<button type="button" class="btn btn--quiet btn--xs" id="cdShowCancelled" data-cd-action="toggle-cancelled"' +
            ' aria-expanded="' + show + '" aria-controls="cdCancelledList">' +
            icon(show ? "chevron-down" : "chevron-right") +
            (show ? "Hide cancelled" : "Show cancelled") + " (" + cancelled.length + ")</button>" +
          (show ? '<ul class="cd-roster cd-roster--cancelled" id="cdCancelledList" aria-label="Cancelled bookings">' +
            cancelled.map(cancelledRow).join("") + "</ul>" : "") +
        "</div>";
    }

    return section("cdStudentsTitle",
      'Students <span class="cd-count">(' + active.length + ")</span>", html, "cd-students");
  }

  function emptyText(occ, manage) {
    if (occ.status === "removed") return "Any bookings were cancelled and refunded when the class was deleted.";
    if (occ.status === "blocked") return "This class is closed to bookings.";
    if (occ.started) return manage ? "Use “Add student” to record a walk-in." : "Nobody was booked into this class.";
    return manage ? "Parents can book from the portal, or add a student yourself." : "Parents can book from the portal.";
  }

  function activeRow(r, occ, manage, remark) {
    var b = r.booking, ch = r.child, f = r.family || {}, note = r.note;
    var chips = [];
    if (ch.medical) chips.push(h.chip("Medical", "warn", ch.medical));
    if (ch.level && !db.levelFits(ch, occ.programme)) {
      chips.push(h.chip("Level: " + ch.level, "info",
        ch.name + " is at " + ch.level + " level; this is a " + occ.level + " class"));
    }

    var sub = [];
    if (ch.age !== "" && ch.age != null) sub.push("<span>Age " + esc(ch.age) + "</span>");
    if (ch.level) sub.push(h.levelChip(ch.level));
    if (f.parentName) {
      sub.push(Admin.openFamily && f.id
        ? '<button type="button" class="cd-link" data-open-family="' + esc(f.id) + '" data-child="' + esc(ch.id) + '">' + esc(f.parentName) + "</button>"
        : "<span>" + esc(f.parentName) + "</span>");
    }
    // the phone gets its own wrapper so phones can put it on a line of its own
    var phone = f.phone
      ? '<span class="cd-stu__phone">' + (sub.length ? SEP : "") +
          '<a class="cd-link" href="' + esc(telHref(f.phone)) + '" aria-label="Call ' + esc(f.parentName || "parent") +
          " on " + esc(f.phone) + '">' + esc(f.phone) + "</a></span>"
      : "";

    var source = b.source === "staff" ? "Added by " + actor(b.by) : "Booked by parent";
    var meta = '<span class="cd-bal" title="' + esc(poolTitle(f)) + '">Family credits ' + h.credits(r.balance) + "</span>" +
      '<span title="' + esc(fmt.stamp(b.at)) + '">' + esc(source) + (b.cost ? "" : " · no credit charged") + "</span>";

    // controls: attendance (or a read-only chip) + remark + remove
    var ctrl = "";
    if (occ.started) ctrl += manage ? attGroup(b, ch) : h.attendanceChip(b.attendance);
    var tools = [];
    if (remark) {
      if (note && ownsNote(note)) {
        tools.push('<button type="button" class="btn btn--quiet btn--xs" id="cdNote-' + esc(b.id) + '" data-cd-action="note"' +
          ' data-booking="' + esc(b.id) + '">' + icon("edit") + "Edit remark</button>");
      } else if (!note && occ.started) {
        tools.push('<button type="button" class="btn btn--quiet btn--xs" id="cdNote-' + esc(b.id) + '" data-cd-action="note"' +
          ' data-booking="' + esc(b.id) + '">' + icon("note") + "Add remark</button>");
      }
    }
    if (canRemove(occ)) {
      tools.push('<button type="button" class="btn btn--xs cd-rm" id="cdRm-' + esc(b.id) + '" data-cd-action="remove"' +
        ' data-booking="' + esc(b.id) + '" aria-label="Remove ' + esc(ch.name) + ' from this class" title="Remove from class">' +
        icon("x") + '<span class="cd-rm__t">Remove</span></button>');
    }
    if (tools.length) ctrl += '<div class="cd-stu__tools">' + tools.join("") + "</div>";

    return '<li class="cd-stu" data-booking="' + esc(b.id) + '">' +
        '<div class="cd-stu__avatar">' + h.avatar(ch.name) + "</div>" +
        '<div class="cd-stu__main">' +
          '<p class="cd-stu__name">' +
            '<button type="button" class="cd-stu__link" data-open-student="' + esc(ch.id) + '">' + esc(ch.name) + "</button>" +
            (chips.length ? '<span class="chips">' + chips.join("") + "</span>" : "") +
          "</p>" +
          '<p class="cd-stu__sub">' + sub.join(SEP) + phone + "</p>" +
          '<p class="cd-stu__meta">' + meta + "</p>" +
        "</div>" +
        (ctrl ? '<div class="cd-stu__ctrl">' + ctrl + "</div>" : "") +
        (note ? noteBlock(note, remark && !ownsNote(note)) : "") +
      "</li>";
  }

  function attGroup(b, ch) {
    var marked = b.attendance
      ? ' title="Marked by ' + esc(actor(b.attendanceBy)) + (b.attendanceAt ? " · " + esc(fmt.stamp(b.attendanceAt)) : "") + '"'
      : "";
    return '<div class="att" role="group" aria-label="Attendance for ' + esc(ch.name) + '"' + marked + ">" +
      db.attendanceStatuses.map(function (a) {
        var on = b.attendance === a.id;
        return '<button type="button" id="cdAtt-' + esc(b.id) + "-" + a.id + '" data-att="' + a.id + '"' +
          ' data-booking="' + esc(b.id) + '" aria-pressed="' + on + '"' +
          (on ? ' title="Click again to clear"' : "") + ">" + esc(a.label) + "</button>";
      }).join("") +
      "</div>";
  }

  // lockedFor: the class coach is looking at a remark someone else wrote
  function noteBlock(note, lockedFor) {
    var edited = note.updatedAt
      ? " · edited" + (note.updatedBy && note.updatedBy !== note.by ? " by " + esc(actor(note.updatedBy)) : "")
      : "";
    return '<div class="cd-note">' +
        '<p class="cd-note__head"><span class="cd-note__label">Remark</span>' +
          (note.rating ? h.rating(note.rating) : "") + "</p>" +
        (note.text ? '<p class="cd-note__text">' + esc(note.text) + "</p>" : "") +
        '<p class="cd-note__meta">' +
          (note.shared ? h.chip("Shared with parent", "ok") : h.chip("Staff only", "muted")) +
          "<span>" + whoWhen(note.by, note.at) + edited + "</span>" +
          (lockedFor ? '<span class="cd-note__lock">Only ' + esc(actor(note.by)) + " can change this remark</span>" : "") +
        "</p>" +
      "</div>";
  }

  function cancelledRow(r) {
    var b = r.booking, ch = r.child;
    var chips = [h.chip("Cancelled", "muted")];
    if (b.refunded) chips.push(h.chip("Refunded", "ok", Admin.plural(b.cost, "credit") + " returned to " + familyLabel(r.family)));
    else if (b.cost > 0) chips.push(h.chip("Not refunded", "warn"));
    else chips.push(h.chip("No charge", "muted"));
    return '<li class="cd-stu is-cancelled">' +
        '<div class="cd-stu__avatar">' + h.avatar(ch.name, "sm") + "</div>" +
        '<div class="cd-stu__main">' +
          '<p class="cd-stu__name">' +
            (ch.id ? '<button type="button" class="cd-stu__link" data-open-student="' + esc(ch.id) + '">' + esc(ch.name) + "</button>"
              : "<span>" + esc(ch.name) + "</span>") +
            '<span class="chips">' + chips.join("") + "</span>" +
          "</p>" +
          '<p class="cd-stu__sub">' + esc(b.cancelReason || "No reason given") + "</p>" +
          '<p class="cd-stu__meta"><span>Cancelled by ' + whoWhen(b.cancelledBy, b.cancelledAt) + "</span></p>" +
        "</div>" +
      "</li>";
  }

  /* ---------- 5. footer meta ---------- */
  function footSection(occ) {
    var bits = [];
    if (occ.oneOff && occ.createdBy) bits.push("One-off class added by " + esc(actor(occ.createdBy)));
    if (occ.substituted && occ.substituteBy) bits.push("Cover arranged by " + esc(actor(occ.substituteBy)));
    if (occ.statusBy || occ.statusAt) {
      var verb = occ.status === "removed" ? (occ.removedScope === "series" ? "Weekly class deleted" : "Deleted")
        : occ.blockKind === "leave" ? "Leave added" : "Blocked";
      bits.push("Last change: " + verb + " by " + whoWhen(occ.statusBy, occ.statusAt));
    }
    if (!bits.length) return "";
    return '<footer class="drawer__section cd-foot">' +
      bits.map(function (b) { return "<p>" + b + "</p>"; }).join("") +
      "</footer>";
  }

  /* ============================================================
     EVENTS — one listener on the freshly rendered root
     ============================================================ */
  function bind(root, key) {
    if (!root) return;
    root.addEventListener("click", function (e) {
      var btn = e.target.closest("button");
      if (!btn || btn.disabled || !root.contains(btn)) return;
      if (btn.hasAttribute("data-att")) { onAttendance(btn, key); return; }
      var action = btn.getAttribute("data-cd-action");
      if (!action) return;
      var bookingId = btn.getAttribute("data-booking");
      switch (action) {
        case "toggle-cancelled":
          ui.showCancelled = !ui.showCancelled;
          repaint(key, "cdShowCancelled");
          break;
        case "note": openNoteModal(bookingId); break;
        case "remove": removeStudent(bookingId); break;
        case "mark-all": markAllPresent(key); break;
        case "assign": openAssignModal(key); break;
        default: classAction(action, key);
      }
    });
  }

  // Block / reopen / delete / restore / change coach live in the schedule module.
  function classAction(action, key) {
    var occ = db.occurrence(key);
    if (!canManage(occ)) { denied(); return; }
    var fn = {
      block: Admin.blockClass,
      unblock: Admin.unblockClass,
      "delete": Admin.deleteClass,
      restore: Admin.restoreClass,
      coach: Admin.substituteCoach
    }[action];
    if (action === "coach" && !Admin.can("substitute")) { denied("Only an admin can change the coach."); return; }
    if (action === "restore" && occ.removedScope === "series" && !Admin.can("series")) {
      denied("Only an admin can restore a weekly class.");
      return;
    }
    if (typeof fn === "function") fn(key);
  }

  function onAttendance(btn, key) {
    var occ = db.occurrence(key);
    if (!canManage(occ)) { denied(); return; }
    if (!occ.started) { Admin.toast("info", opensAt(occ) + "."); return; }
    var b = db.booking(btn.getAttribute("data-booking"));
    if (!b || b.status !== "booked" || b.occKey !== key) return;
    var status = btn.getAttribute("data-att");
    // clicking the pressed status clears it
    Admin.check(db.setAttendance(b.id, b.attendance === status ? null : status, { by: Admin.by() }));
  }

  function markAllPresent(key) {
    var occ = db.occurrence(key);
    if (!canManage(occ)) { denied(); return; }
    if (!occ.started) return;
    var res = db.markAll(key, "present", { by: Admin.by() });
    if (Admin.check(res) && res.count) {
      Admin.toast("ok", "Marked " + Admin.plural(res.count, "student") + " present.");
    }
  }

  /* ============================================================
     REMOVE FROM CLASS
     Admins choose whether the credit comes back. For coaches it
     follows the rule: refunded before the class starts, kept after.
     ============================================================ */
  function refundRule(b, occ) { return b.cost > 0 && !occ.started; }

  function removeStudent(bookingId) {
    var b = db.booking(bookingId);
    var occ = b && db.occurrence(b.occKey);
    if (!b || !occ || b.status !== "booked") { Admin.toast("warn", "This booking is no longer active."); return; }
    if (!canManage(occ)) { denied(); return; }
    var ch = db.child(b.childId) || { name: "This student" };
    var name = firstName(ch.name);
    if (!canRemove(occ)) {
      Admin.toast("warn", "This class has ended — mark " + name + " absent instead, or ask the studio admin.");
      return;
    }
    var f = db.family(b.familyId) || {};
    var cost = fmt.credits(b.cost);
    var credit;
    if (!(b.cost > 0)) {
      credit = '<p class="field__hint cd-confirm-hint">No credit was charged for this booking.</p>';
    } else if (canCredits()) {
      credit = '<label class="check cd-confirm-check"><input type="checkbox" id="cdRefund"' + (refundRule(b, occ) ? " checked" : "") + " />" +
          "<span>Refund <strong>" + esc(cost) + "</strong> to " + esc(familyLabel(f)) + "</span></label>" +
        (occ.started ? '<p class="field__hint cd-confirm-hint">The class has already started, so the credit is kept unless you tick this.</p>' : "");
    } else if (refundRule(b, occ)) {
      credit = '<p class="cd-confirm-credit" id="cdRefundInfo">' + icon("check") +
        "<span><strong>" + esc(cost) + "</strong> goes back to " + esc(familyLabel(f)) + ".</span></p>";
    } else {
      credit = '<p class="cd-confirm-credit" id="cdRefundInfo">' + icon("info") +
        "<span>The class has started, so the credit is kept. Ask the studio admin if it should be refunded.</span></p>";
    }

    var body =
      "<p><strong>" + esc(ch.name) + "</strong> will be taken off " + esc(occ.name) + " on " +
        esc(fmt.date(occ.date, "full")) + ", " + esc(fmt.time(occ.time)) +
        (f.parentName ? ", and " + esc(f.parentName) + " will be told." : ".") + "</p>" +
      credit;

    var pending = Admin.confirm({
      title: "Remove " + ch.name + "?",
      body: body,
      confirmLabel: "Remove from class",
      danger: true
    });
    // the confirm modal is built synchronously; keep a handle on the checkbox so its
    // final state can be read once #confirmOk has closed (and emptied) the modal
    var box = document.getElementById("cdRefund");

    pending.then(function (yes) {
      if (!yes) return;
      var now = db.occurrence(b.occKey);
      if (!canRemove(now)) { denied(); return; }
      // decide from the class as it is now, not as it was when the dialog opened
      var refund = canCredits() ? !!(box && box.checked) : refundRule(b, now);
      var res = db.cancelBooking(bookingId, {
        by: Admin.by(), refund: refund, reason: "Removed by staff", notify: true
      });
      Admin.check(res, "Removed " + ch.name + " from " + now.name +
        (res && res.booking && res.booking.refunded ? " — " + fmt.credits(res.booking.cost) + " back to " + familyLabel(f) + "." : "."));
    });
  }

  /* ============================================================
     REMARK EDITOR (rating + performance notes) — class coach only
     ============================================================ */
  function openNoteModal(bookingId, draft) {
    var b = db.booking(bookingId);
    var occ = b && db.occurrence(b.occKey);
    var ch = b && db.child(b.childId);
    if (!b || !occ || !ch) { Admin.toast("warn", "Booking not found."); return; }
    if (!canRemark(occ)) { remarkDenied(occ); return; }
    var note = db.noteForBooking(b.id);
    if (note && !ownsNote(note)) {
      Admin.toast("warn", "Only " + actor(note.by) + " can change this remark.");
      return;
    }
    if (!note && !occ.started) { Admin.toast("info", "Remarks open once the class starts."); return; }
    var f = db.family(ch.familyId) || {};
    // sharing is a deliberate tick: a new remark starts staff-only
    var d = draft || {
      rating: note ? note.rating : null,
      text: note ? note.text : "",
      shared: note ? !!note.shared : false
    };

    var rates = [{ v: "", label: "No rating" }].concat(db.noteScale);
    var ratePick = rates.map(function (s) {
      var on = String(d.rating || "") === String(s.v);
      var dots = "";
      if (s.v) {
        for (var i = 1; i <= 5; i++) dots += '<i class="' + (i <= s.v ? "on" : "") + '"></i>';
        dots = '<span class="rating__dots" aria-hidden="true">' + dots + "</span>";
      }
      return '<label><input type="radio" name="cdRate" value="' + s.v + '"' + (on ? " checked" : "") + " />" +
        dots + "<span>" + esc(s.label) + "</span></label>";
    }).join("");

    var body =
      '<div class="field">' +
        '<span class="field__label" id="cdRateLabel">Rating <span class="field__opt">(optional)</span></span>' +
        '<div class="rate-pick cd-rate" role="radiogroup" aria-labelledby="cdRateLabel">' + ratePick + "</div>" +
      "</div>" +
      '<div class="field">' +
        '<label for="cdNoteText">Performance notes</label>' +
        '<textarea id="cdNoteText" rows="4" maxlength="1000" placeholder="What went well, and what to practise next">' +
          esc(d.text) + "</textarea>" +
        '<p class="field__hint">Add a rating, a few words, or both.</p>' +
      "</div>" +
      '<label class="check cd-share"><input type="checkbox" id="cdNoteShared"' + (d.shared ? " checked" : "") + " />" +
        "<span><strong>Share with parent</strong><br />" +
        '<span class="field__hint">Shows in ' + esc(f.parentName ? f.parentName + "'s" : "the parent's") +
          " portal under past classes. Leave unticked to keep it staff-only.</span></span></label>" +
      '<p class="field-error cd-form-error" id="cdNoteError" role="alert"></p>';

    Admin.openModal({
      title: note ? "Edit remark" : "Add remark",
      sub: esc(ch.name) + " · " + esc(occ.name) + ", " + esc(fmt.date(occ.date, "full")),
      body: body,
      actions:
        (note ? '<button type="button" class="btn btn--danger cd-modal-left" id="cdNoteDelete">' + icon("trash") + "Delete</button>" : "") +
        '<button type="button" class="btn btn--ghost" data-close>Cancel</button>' +
        '<button type="button" class="btn btn--primary" id="cdNoteSave">' + (note ? "Save changes" : "Save remark") + "</button>",
      onOpen: function (card) { bindNoteModal(card, b.id, note); }
    });
  }

  function readNoteForm(card) {
    var r = card.querySelector('input[name="cdRate"]:checked');
    return {
      rating: r && r.value ? +r.value : null,
      text: card.querySelector("#cdNoteText").value,
      shared: card.querySelector("#cdNoteShared").checked
    };
  }

  // Still allowed to write this remark? (the class may have changed coach meanwhile)
  function mayWrite(bookingId, note) {
    var b = db.booking(bookingId);
    var occ = b && db.occurrence(b.occKey);
    if (!b || !occ) { Admin.toast("warn", "Booking not found."); return null; }
    if (!canRemark(occ)) { remarkDenied(occ); return null; }
    var current = db.noteForBooking(b.id);
    var mine = current || note;
    if (mine && !ownsNote(mine)) { Admin.toast("warn", "Only " + actor(mine.by) + " can change this remark."); return null; }
    return b;
  }

  function bindNoteModal(card, bookingId, note) {
    var text = card.querySelector("#cdNoteText");
    var err = card.querySelector("#cdNoteError");
    function clearErr() { err.textContent = ""; text.classList.remove("invalid"); }

    text.addEventListener("input", clearErr);
    card.querySelectorAll('input[name="cdRate"]').forEach(function (r) { r.addEventListener("change", clearErr); });
    text.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); save(); }
    });
    card.querySelector("#cdNoteSave").addEventListener("click", save);

    function save() {
      var b = mayWrite(bookingId, note);
      if (!b) return;
      var d = readNoteForm(card);
      if (!d.rating && !d.text.trim()) {
        err.textContent = "Add a rating or a few words before saving.";
        text.classList.add("invalid");
        text.focus();
        return;
      }
      var res = db.saveNote({
        id: note ? note.id : undefined,
        childId: b.childId, bookingId: b.id,
        rating: d.rating, text: d.text, shared: d.shared
      }, { by: Admin.by() });
      if (!res || !res.ok) { err.textContent = (res && res.error) || "Couldn't save the remark."; }
      var msg = note ? "Remark updated" + (d.shared ? " — shared with the parent." : " — staff only.")
        : "Remark saved" + (d.shared ? " and shared with the parent." : " — staff only.");
      if (Admin.check(res, msg)) Admin.closeModal();
    }

    var del = card.querySelector("#cdNoteDelete");
    if (del && note) {
      del.addEventListener("click", function () {
        var draft = readNoteForm(card);
        var b = mayWrite(bookingId, note);
        if (!b) return;
        var ch = db.child(b.childId);
        var f = db.family(b.familyId);
        Admin.confirm({
          title: "Delete this remark?",
          body: "<p>The remark for <strong>" + esc(ch ? ch.name : "this student") + "</strong> on " +
            esc(fmt.date(note.date, "full")) + " will be removed" +
            (note.shared ? " and will no longer show in " + esc(f ? f.parentName + "'s" : "the parent's") + " portal" : "") +
            ". This can't be undone.</p>",
          confirmLabel: "Delete remark",
          danger: true
        }).then(function (yes) {
          if (!yes) { openNoteModal(bookingId, draft); return; }
          if (!mayWrite(bookingId, note)) return;
          Admin.check(db.deleteNote(note.id, { by: Admin.by() }), "Remark deleted.");
        });
      });
    }

    // coaches mostly come here to type — start in the text box
    setTimeout(function () {
      if (!Admin.modalOpen() || !document.body.contains(text)) return;
      try {
        text.focus();
        text.setSelectionRange(text.value.length, text.value.length);
      } catch (e) {}
    }, 0);
  }

  /* ============================================================
     ADD STUDENT (manual assignment) — uses the family's shared credits
     ============================================================ */
  // Only admins may book without deducting credits.
  function effectiveCharge() { return canCredits() ? !!(assign && assign.charge) : true; }

  function openAssignModal(key) {
    var occ = db.occurrence(key);
    if (!occ) return;
    if (!canManage(occ)) { denied(); return; }
    if (occ.status !== "open") {
      Admin.toast("warn", occ.status === "blocked" ? "Reopen the class before adding students." : "This class has been deleted.");
      return;
    }
    assign = { key: key, q: "", childId: null, charge: true, allowNegative: false, allowFull: false, added: null };

    Admin.openModal({
      title: "Add a student",
      sub: esc(occ.name) + " · " + esc(fmt.date(occ.date, "full")) + ", " + esc(fmt.time(occ.time)) + " · " + esc(occ.coach),
      body:
        '<div id="cdAssignDone" aria-live="polite"></div>' +
        '<div id="cdAssignCap" class="cd-assign__cap"></div>' +
        '<label class="field__label cd-assign__label" for="cdAssignSearch">Find a student</label>' +
        '<div class="search cd-assign__search">' + icon("search") +
          '<input type="search" id="cdAssignSearch" autocomplete="off" placeholder="Name, parent, email or phone" />' +
        "</div>" +
        '<div id="cdAssignResults" class="cd-assign__results"></div>' +
        '<label class="check cd-assign__charge"><input type="checkbox" id="cdAssignCharge" checked' +
          (canCredits() ? "" : " disabled") + " />" +
          '<span id="cdAssignChargeLabel"></span></label>' +
        '<div id="cdAssignWarn"></div>' +
        '<p class="field-error cd-form-error" id="cdAssignError" role="alert"></p>',
      actions:
        '<button type="button" class="btn btn--ghost" data-close>Done</button>' +
        '<button type="button" class="btn btn--primary" id="cdAssignSubmit">' + icon("plus") + "Add to class</button>",
      onOpen: bindAssign,
      onClose: function () { assign = null; }
    });
  }

  function bindAssign(card) {
    var search = card.querySelector("#cdAssignSearch");
    var results = card.querySelector("#cdAssignResults");
    var charge = card.querySelector("#cdAssignCharge");
    var warn = card.querySelector("#cdAssignWarn");

    search.addEventListener("input", function () {
      if (!assign) return;
      assign.q = search.value;
      clearAssignError();
      paintAssign();
    });
    results.addEventListener("change", function (e) {
      if (!assign || e.target.name !== "cdAssignChild") return;
      assign.childId = e.target.value;
      assign.allowNegative = false;
      clearAssignError();
      paintAssign({ skipResults: true });
    });
    charge.addEventListener("change", function () {
      if (!assign) return;
      if (!canCredits()) { charge.checked = true; assign.charge = true; return; }
      assign.charge = charge.checked;
      clearAssignError();
      paintAssign({ skipResults: true });
    });
    warn.addEventListener("change", function (e) {
      if (!assign) return;
      if (e.target.id === "cdAllowNeg") assign.allowNegative = e.target.checked;
      if (e.target.id === "cdAllowFull") assign.allowFull = e.target.checked;
      clearAssignError();
    });
    card.querySelector("#cdAssignSubmit").addEventListener("click", submitAssign);
    paintAssign();
  }

  function paintAssign(opts) {
    opts = opts || {};
    var results = document.getElementById("cdAssignResults");
    if (!assign || !results) return;
    var occ = db.occurrence(assign.key);
    if (!occ) return;

    document.getElementById("cdAssignDone").innerHTML = assign.added
      ? h.notice("ok", "Added <strong>" + esc(assign.added) + "</strong> — parent notified")
      : "";

    document.getElementById("cdAssignCap").innerHTML =
      '<p class="cd-assign__count">' + icon("users") + "<span>" + occ.booked + " of " + occ.capacity + " booked · " +
        (occ.spotsLeft ? Admin.plural(occ.spotsLeft, "spot") + " left" : "full") + "</span></p>" +
      (occ.started ? h.notice("info", "This class has " + (occ.ended ? "ended" : "started") +
        " — adding a student records a walk-in." +
        (occ.ended && !Admin.isAdmin() ? " Check the name first: only an admin can take a student off a class that has ended." : "")) : "");

    if (!opts.skipResults) results.innerHTML = assignResults(occ);

    var charge = document.getElementById("cdAssignCharge");
    if (charge) {
      charge.checked = effectiveCharge();
      charge.disabled = !canCredits();
    }
    document.getElementById("cdAssignChargeLabel").innerHTML = chargeLabel(occ);

    document.getElementById("cdAssignWarn").innerHTML = assignWarnings(occ);

    // after a successful add, wait for the next pick instead of showing an error
    var btn = document.getElementById("cdAssignSubmit");
    if (btn) {
      btn.disabled = !!(assign.added && !assign.childId);
      btn.title = btn.disabled ? "Pick another student to add" : "";
    }
  }

  // "Deduct 1 credit from Jane Tan's family  ◆12 → ◆11"
  function chargeLabel(occ) {
    var ch = assign.childId && db.child(assign.childId);
    var out = "<strong>Deduct " + esc(fmt.credits(occ.cost)) + "</strong> from ";
    if (ch) {
      var bal = db.balance(ch.familyId);
      out += esc(familyLabel(db.family(ch.familyId))) +
        ' <span class="cd-assign__after">' + h.credits(bal) + ' <span aria-hidden="true">→</span><span class="sr-only"> after: </span>' +
        h.credits(effectiveCharge() ? bal - occ.cost : bal) + "</span>";
    } else {
      out += "the student's family credits";
    }
    if (!canCredits()) out += '<br /><span class="field__hint">Only admins can book without deducting credits.</span>';
    return out;
  }

  function assignResults(occ) {
    var booked = {};
    db.roster(occ.key).forEach(function (r) { booked[r.child.id] = true; });
    var q = assign.q.trim();
    var list = db.searchChildren(q).filter(function (c) { return !booked[c.id]; });
    var label;
    if (!q) {
      list = list.filter(function (c) { return (c.programmes || []).indexOf(occ.programmeId) >= 0; });
      label = list.length ? "Regulars in " + occ.name : "";
    } else {
      label = Admin.plural(list.length, "match", "matches");
    }
    var total = list.length;
    list = list.slice(0, MAX_RESULTS);

    // never keep a selection the coach can no longer see
    if (assign.childId && !list.some(function (c) { return c.id === assign.childId; })) {
      assign.childId = null;
      assign.allowNegative = false;
    }

    if (!list.length) {
      return '<p class="cd-assign__none">' + (q
        ? "No students match “" + esc(q) + "”" + (Object.keys(booked).length ? " who aren't already in this class." : ".")
        : "No regulars left to add — search to find any student.") + "</p>";
    }
    return (label ? '<p class="cd-assign__group">' + esc(label) + "</p>" : "") +
      '<div class="choices cd-assign__list" role="radiogroup" aria-label="Students">' +
        list.map(function (c) { return assignChoice(c, occ); }).join("") +
      "</div>" +
      (total > list.length
        ? '<p class="field__hint cd-assign__more">Showing ' + list.length + " of " + total + " — keep typing to narrow down.</p>"
        : "");
  }

  function assignChoice(c, occ) {
    var f = db.family(c.familyId) || {};
    var bal = db.balance(c.familyId);
    var fits = db.levelFits(c, occ.programme);
    var d = [];
    if (c.age !== "" && c.age != null) d.push("Age " + esc(c.age));
    if (f.parentName) d.push(esc(familyLabel(f)));
    return '<label class="choice cd-pick">' +
        '<input type="radio" name="cdAssignChild" value="' + esc(c.id) + '"' + (assign.childId === c.id ? " checked" : "") + " />" +
        '<span class="cd-pick__body">' +
          '<span class="choice__t">' + esc(c.name) + " " +
            '<span class="chips">' + h.levelChip(c.level) +
              (fits ? "" : h.chip("Level differs", "warn", "This is a " + occ.level + " class")) +
              (c.medical ? h.chip("Medical", "warn", c.medical) : "") +
            "</span>" +
          "</span>" +
          '<span class="choice__d">' + d.join(" · ") + "</span>" +
        "</span>" +
        '<span class="cd-pick__bal" title="' + esc(poolTitle(f)) + '">' +
          '<span class="cd-pick__k">Family credits</span>' + h.credits(bal) + "</span>" +
      "</label>";
  }

  function assignWarnings(occ) {
    var out = "";
    var ch = assign.childId && db.child(assign.childId);
    if (ch && effectiveCharge()) {
      var bal = db.balance(ch.familyId);
      if (bal < occ.cost) {
        var fam = familyLabel(db.family(ch.familyId));
        var has = bal === 0 ? fam + " has no credits left"
          : bal < 0 ? fam + " is already at " + signedNum(bal) + " credits"
          : fam + " only has " + fmt.credits(bal);
        out += '<div class="notice notice--warn cd-assign__warn" id="cdWarnNeg">' + icon("alert") + "<div>" +
          "<p><strong>" + esc(has.charAt(0).toUpperCase() + has.slice(1)) + ".</strong> Adding " + esc(firstName(ch.name)) +
            " takes the family to " + esc(signedNum(bal - occ.cost)) + ".</p>" +
          '<label class="check"><input type="checkbox" id="cdAllowNeg"' + (assign.allowNegative ? " checked" : "") + " />" +
            "<span><strong>Allow negative balance</strong><br />" +
            '<span class="field__hint">The studio follows up on payment.</span></span></label>' +
          "</div></div>";
      }
    }
    if (occ.spotsLeft <= 0) {
      out += '<div class="notice notice--warn cd-assign__warn" id="cdWarnFull">' + icon("alert") + "<div>" +
        "<p><strong>This class is full</strong> — " + occ.booked + " of " + occ.capacity + " places are taken.</p>" +
        '<label class="check"><input type="checkbox" id="cdAllowFull"' + (assign.allowFull ? " checked" : "") + " />" +
          "<span><strong>Add over capacity</strong></span></label>" +
        "</div></div>";
    }
    return out;
  }

  function clearAssignError() {
    var err = document.getElementById("cdAssignError");
    if (err) err.textContent = "";
    ["cdWarnNeg", "cdWarnFull", "cdAssignResults"].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.classList.remove("is-invalid");
    });
  }

  function assignError(msg, markId, focusId) {
    var err = document.getElementById("cdAssignError");
    if (err) err.textContent = msg;
    var mark = markId && document.getElementById(markId);
    if (mark) mark.classList.add("is-invalid");
    var focus = focusId && document.getElementById(focusId);
    if (focus) { try { focus.focus(); } catch (e) {} }
  }

  function submitAssign() {
    if (!assign) return;
    var btn = document.getElementById("cdAssignSubmit");
    if (btn && btn.disabled) return; // waiting for the next pick after a successful add
    clearAssignError();
    var occ = db.occurrence(assign.key);
    if (!occ || occ.status !== "open") { assignError("This class is no longer open for bookings."); return; }
    if (!canManage(occ)) { denied(); return; }
    var ch = assign.childId && db.child(assign.childId);
    if (!ch) { assignError("Choose a student to add.", "cdAssignResults", "cdAssignSearch"); return; }

    var charge = effectiveCharge();
    var needNeg = charge && db.balance(ch.familyId) < occ.cost;
    var needFull = occ.spotsLeft <= 0;
    if (needNeg && !assign.allowNegative) {
      assignError("Tick “Allow negative balance” to add " + firstName(ch.name) + " — the family doesn't have enough credits.", "cdWarnNeg", "cdAllowNeg");
      return;
    }
    if (needFull && !assign.allowFull) {
      assignError("Tick “Add over capacity” — this class is full.", "cdWarnFull", "cdAllowFull");
      return;
    }

    var res = db.book(occ.key, ch.id, {
      by: Admin.by(),
      source: "staff",
      charge: charge,
      allowNegative: needNeg && assign.allowNegative,
      allowFull: needFull && assign.allowFull,
      allowStarted: occ.started
    });
    if (!Admin.check(res)) { assignError(res && res.error ? res.error : "Couldn't add this student."); return; }

    // stay open so several students can be added in a row
    assign.added = ch.name;
    assign.q = "";
    assign.childId = null;
    assign.charge = true;
    assign.allowNegative = false;
    assign.allowFull = false;
    var search = document.getElementById("cdAssignSearch");
    paintAssign();
    if (search) {
      search.value = "";
      try { search.focus(); } catch (e) {}
    }
  }
})();
