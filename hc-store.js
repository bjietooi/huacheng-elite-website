/* ============================================================
   HUACHENG ELITE — shared mock database (booking concept)
   ------------------------------------------------------------
   Stands in for the real booking backend so the parent portal
   (portal.html) and the coach/admin console (admin/) act on the
   SAME data: a class a coach blocks can't be booked by parents,
   a manual credit deduction shows in the family's history, a
   coach's attendance notes appear in the parent's past classes.

   Both apps live on one origin, so they share the localStorage
   key below; a `storage` event keeps open tabs in sync.

   Load order:  mock-data.js → hc-store.js → app code.
   Storage key: hc_db (versioned JSON). HC.db.reset() re-seeds.

   Model
   - The weekly timetable (HC.schedule) is a template. A dated
     class is an "occurrence", keyed "YYYY-MM-DD|<templateId>"
     (or "YYYY-MM-DD|<oneOffId>" for a one-off class).
   - overrides[key]   per-date status (blocked/removed) or a
                      substitute coach
   - seriesEnds[tid]  weekly class deleted from a date onward
   - staff[]          admin + coach accounts (admins can add / edit
                      coaches). A coach's `coach` tag is the name the
                      timetable uses; renaming rewrites every reference.
   - templateCoach    weekly class handed to another coach from a date
   - leaves[]         coach off for a whole day → that coach's
                      classes on the day are blocked (a class that
                      had already started when the leave was booked
                      is left as it ran)
   - bookings[]       one child in one occurrence
   - ledger[]         every credit movement. Credits belong to the FAMILY:
                      one pool any child can use (booking / refund rows
                      also note which child). balance(familyId) = sum(delta)
   ============================================================ */
(function () {
  "use strict";

  var HC = (window.HC = window.HC || {});
  if (!HC.schedule || !HC.programmes) {
    console.warn("[HC] mock-data.js must load before hc-store.js");
    return;
  }

  var KEY = "hc_db";
  var VERSION = 3; // 3: one shared credit pool per family (client decision, 19 Sep)
  var SESSION_KEYS = { parent: "hc_parent", staff: "hc_staff" };

  var DB = null;
  var rev = 0;
  var cache = { rev: -1 };
  var listeners = [];

  /* ============================================================
     DATES — local time. Dates are "YYYY-MM-DD", timestamps are
     "YYYY-MM-DDTHH:MM"; both sort correctly as strings.
     ============================================================ */
  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July",
    "August", "September", "October", "November", "December"];

  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function isoOf(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function parse(iso) {
    var p = String(iso).slice(0, 10).split("-");
    return new Date(+p[0], +p[1] - 1, +p[2]);
  }
  function todayISO() { return isoOf(new Date()); }
  function addDays(iso, n) { var d = parse(iso); d.setDate(d.getDate() + n); return isoOf(d); }
  function dayIndex(iso) { return (parse(iso).getDay() + 6) % 7; } // 0 = Mon
  function weekStart(iso) { return addDays(iso, -dayIndex(iso)); }
  function daysBetween(a, b) { return Math.round((parse(b) - parse(a)) / 86400000); }
  function toMinutes(t) { var p = String(t).split(":"); return (+p[0]) * 60 + (+p[1] || 0); }
  function fromMinutes(m) { return pad(Math.floor(m / 60)) + ":" + pad(m % 60); }
  function nowMinutes() { var d = new Date(); return d.getHours() * 60 + d.getMinutes(); }
  function nowStamp() {
    var d = new Date();
    return isoOf(d) + "T" + pad(d.getHours()) + ":" + pad(d.getMinutes());
  }
  function stampOf(d) { return isoOf(d) + "T" + pad(d.getHours()) + ":" + pad(d.getMinutes()); }
  function hoursAgo(h) { return stampOf(new Date(Date.now() - h * 3600000)); }

  function formatDate(iso, style) {
    if (!iso) return "";
    var d = parse(iso);
    var dow = HC.dayShort[dayIndex(iso)];
    switch (style) {
      case "long": return HC.dayNames[dayIndex(iso)] + " " + d.getDate() + " " + MONTHS_LONG[d.getMonth()] + " " + d.getFullYear();
      case "full": return dow + " " + d.getDate() + " " + MONTHS[d.getMonth()] + " " + d.getFullYear();
      case "day": return d.getDate() + " " + MONTHS[d.getMonth()];
      case "month": return MONTHS_LONG[d.getMonth()] + " " + d.getFullYear();
      case "relative": {
        var diff = daysBetween(todayISO(), iso);
        if (diff === 0) return "Today";
        if (diff === 1) return "Tomorrow";
        if (diff === -1) return "Yesterday";
        return dow + " " + d.getDate() + " " + MONTHS[d.getMonth()];
      }
      default: return dow + " " + d.getDate() + " " + MONTHS[d.getMonth()]; // "Wed 16 Sep"
    }
  }

  function formatStamp(stamp) {
    if (!stamp) return "";
    var date = stamp.slice(0, 10), time = stamp.slice(11, 16) || "00:00";
    return formatDate(date, "relative") + ", " + HC.formatTime(time);
  }

  function weekDates(startIso) {
    var start = weekStart(startIso || todayISO());
    var t = todayISO();
    var out = [];
    for (var i = 0; i < 7; i++) {
      var iso = addDays(start, i), d = parse(iso);
      out.push({
        iso: iso, day: i, name: HC.dayNames[i], short: HC.dayShort[i],
        date: d.getDate(), month: MONTHS[d.getMonth()],
        isToday: iso === t, isPast: iso < t
      });
    }
    return out;
  }

  /* ============================================================
     REFERENCE DATA
     ============================================================ */
  // Package rates from the 2026 pricing sheet — used to value credits.
  var TIER_PACKS = {
    junior:      { 5: 220, 10: 425, 20: 800 },
    elite:       { 5: 250, 10: 475, 20: 900 },
    competitive: { 1: 130, 5: 650, 10: 1300, 20: 2500 }
  };
  var TIER_LABEL = { junior: "Junior", elite: "Elite", competitive: "Competitive" };
  var DEFAULT_UNIT_PRICE = 42.5; // junior 10-pack, when a family has no paid purchases

  var ATTENDANCE = [
    { id: "present", label: "Present" },
    { id: "late",    label: "Late" },
    { id: "absent",  label: "Absent" }
  ];

  var NOTE_SCALE = [
    { v: 1, label: "Needs focus" },
    { v: 2, label: "Developing" },
    { v: 3, label: "Steady" },
    { v: 4, label: "Strong" },
    { v: 5, label: "Outstanding" }
  ];

  var ADJUST_REASONS = {
    deduct: ["Late cancellation / no-show", "Private 1-to-1 lesson", "Camp or special programme", "Correction", "Other"],
    add:    ["Payment received at studio", "Make-up / goodwill credit", "Correction", "Other"]
  };

  var LEVELS = ["Junior", "Elite", "Competitive"];

  function staffList() { load(); return DB.staff || []; }
  function staffById(id) {
    return staffList().find(function (s) { return s.id === id; }) || null;
  }
  function staffForCoach(coach) {
    return staffList().find(function (s) { return s.coach === coach; }) || null;
  }
  function template(id) {
    return HC.schedule.find(function (t) { return t.id === id; }) || null;
  }

  /* ============================================================
     PERSISTENCE
     ============================================================ */
  // The demo is laid out around the day it was seeded ("this week", "next
  // Wednesday", yesterday's register). Data from an earlier day would open on
  // a backlog of unmarked classes and no upcoming changes, so it's re-seeded;
  // edits made on a previous day are disposable in this concept.
  function usable(parsed) {
    return !!parsed && parsed.version === VERSION && Array.isArray(parsed.staff) &&
      String(parsed.seededAt || "").slice(0, 10) === todayISO();
  }

  function load() {
    if (DB) return DB;
    var raw = null;
    try { raw = localStorage.getItem(KEY); } catch (e) { /* private mode */ }
    if (raw) {
      try {
        var parsed = JSON.parse(raw);
        if (usable(parsed)) DB = parsed;
      } catch (e) { /* corrupt → re-seed */ }
    }
    if (!DB) {
      DB = seed();
      persist();
    }
    return DB;
  }

  function persist() {
    try { localStorage.setItem(KEY, JSON.stringify(DB)); }
    catch (e) { console.warn("[HC] could not save demo data", e); }
  }

  function commit(detail) {
    rev++;
    persist();
    emit(detail || {});
  }

  // Silent writes (used while seeding) skip saving but still refresh indexes.
  function done(opts, detail) {
    if (opts && opts.silent) rev++;
    else commit(detail);
  }

  function emit(detail) {
    listeners.slice().forEach(function (fn) {
      try { fn(detail); } catch (e) { console.error(e); }
    });
  }

  window.addEventListener("storage", function (e) {
    if (e.key !== KEY && e.key !== null) return;
    DB = null;
    rev++;
    if (e.newValue) {
      try {
        var parsed = JSON.parse(e.newValue);
        if (usable(parsed)) DB = parsed;
      } catch (err) { /* fall through to load() */ }
    }
    load();
    emit({ external: true });
  });

  function idNum(id) { return parseInt(String(id).replace(/^\D+/, ""), 10) || 0; }

  function nextId(prefix) {
    DB.seq = (DB.seq || 0) + 1;
    return prefix + DB.seq;
  }

  function audit(by, action, text, at) {
    DB.audit.push({ id: nextId("A"), at: at || nowStamp(), by: by || "system", action: action, text: text });
    if (DB.audit.length > 400) DB.audit.splice(0, DB.audit.length - 400);
  }

  function notify(familyId, kind, text, ref, at) {
    DB.notices.push({ id: nextId("M"), familyId: familyId, kind: kind, text: text, ref: ref || null, at: at || nowStamp(), read: false });
  }

  /* ---------- derived indexes (rebuilt when data changes) ---------- */
  function idx() {
    load();
    if (cache.rev === rev) return cache;
    var c = { rev: rev, family: {}, child: {}, booking: {}, byOcc: {}, byChild: {}, byFamily: {}, balance: {}, leave: {} };
    DB.families.forEach(function (f) { c.family[f.id] = f; c.balance[f.id] = 0; });
    DB.children.forEach(function (ch) { c.child[ch.id] = ch; });
    DB.bookings.forEach(function (b) {
      c.booking[b.id] = b;
      (c.byOcc[b.occKey] = c.byOcc[b.occKey] || []).push(b);
      (c.byChild[b.childId] = c.byChild[b.childId] || []).push(b);
      (c.byFamily[b.familyId] = c.byFamily[b.familyId] || []).push(b);
    });
    DB.ledger.forEach(function (l) { c.balance[l.familyId] = (c.balance[l.familyId] || 0) + l.delta; });
    DB.leaves.forEach(function (l) { c.leave[l.coach + "|" + l.date] = l; });
    cache = c;
    return c;
  }

  /* ============================================================
     OCCURRENCES
     ============================================================ */
  function occKey(date, id) { return date + "|" + id; }

  function splitKey(key) {
    var i = String(key).indexOf("|");
    return { date: key.slice(0, i), id: key.slice(i + 1) };
  }

  // Coach for a weekly class on a date, after any permanent reassignment.
  function templateCoachOn(t, date) {
    var list = (DB.templateCoach && DB.templateCoach[t.id]) || [];
    var coach = t.coach;
    list.forEach(function (x) { if (x.from <= date) coach = x.coach; });
    return resolveTag(coach);
  }

  // A renamed coach keeps an alias from the old timetable tag.
  function resolveTag(tag) {
    var hops = 0;
    while (DB.coachAliases && DB.coachAliases[tag] && hops++ < 20) tag = DB.coachAliases[tag];
    return tag;
  }

  function baseFor(key) {
    var k = splitKey(key);
    var o = DB.oneOffs.find(function (x) { return x.id === k.id; });
    if (o) {
      if (o.date !== k.date) return null;
      return {
        key: key, date: o.date, templateId: null, oneOffId: o.id, time: o.time,
        programmeId: o.programmeId, coach: o.coach, capacity: o.capacity,
        duration: o.duration, note: o.note || "", createdBy: o.by
      };
    }
    var t = template(k.id);
    if (!t || !k.date || dayIndex(k.date) !== t.day) return null;
    var prog = HC.getProgramme(t.programmeId) || {};
    return {
      key: key, date: k.date, templateId: t.id, oneOffId: null, time: t.time,
      programmeId: t.programmeId, coach: templateCoachOn(t, k.date), capacity: t.capacity,
      duration: prog.duration || 60, note: "", createdBy: null
    };
  }

  // Where a deleted weekly series starts, or null.
  function seriesEnd(templateId) {
    load();
    var s = DB.seriesEnds[templateId];
    return s ? Object.assign({}, s) : null;
  }

  function seriesEnded(templateId, date) {
    var s = DB.seriesEnds[templateId];
    return s && date >= s.from ? s : null;
  }

  function buildOcc(base) {
    var c = idx();
    var ov = DB.overrides[base.key] || {};
    var prog = HC.getProgramme(base.programmeId) ||
      { id: base.programmeId, name: base.programmeId, level: "", credits: 1, tier: "junior" };
    var coach = ov.coach || base.coach;
    var t = todayISO(), nowM = nowMinutes();
    var start = toMinutes(base.time);

    var occ = {
      key: base.key,
      date: base.date,
      day: dayIndex(base.date),
      time: base.time,
      endTime: fromMinutes(start + base.duration),
      duration: base.duration,
      programmeId: prog.id,
      programme: prog,
      name: prog.name,
      level: prog.level,
      tier: prog.tier,
      cost: prog.credits || 1,
      coach: coach,
      originalCoach: base.coach,
      substituted: !!ov.coach && ov.coach !== base.coach,
      substituteBy: ov.coach ? ov.coachBy : null,
      capacity: base.capacity,
      templateId: base.templateId,
      oneOffId: base.oneOffId,
      oneOff: !!base.oneOffId,
      note: base.note,
      createdBy: base.createdBy,
      status: "open",       // open | blocked | removed
      blockKind: null,      // manual | leave
      removedScope: null,   // one | series
      reason: "",
      statusBy: null,
      statusAt: null,
      leaveId: null
    };

    var series = base.templateId ? seriesEnded(base.templateId, base.date) : null;
    if (series) {
      occ.status = "removed"; occ.removedScope = "series";
      occ.reason = series.reason || ""; occ.statusBy = series.by; occ.statusAt = series.at;
    } else if (ov.status === "removed") {
      occ.status = "removed"; occ.removedScope = "one";
      occ.reason = ov.reason || ""; occ.statusBy = ov.by; occ.statusAt = ov.at;
    } else if (ov.status === "blocked") {
      occ.status = "blocked"; occ.blockKind = "manual";
      occ.reason = ov.reason || ""; occ.statusBy = ov.by; occ.statusAt = ov.at;
    } else {
      var lv = c.leave[coach + "|" + base.date];
      // leave booked once a class had begun doesn't touch it — it ran as normal
      if (lv && !(lv.at >= base.date + "T" + base.time)) {
        occ.status = "blocked"; occ.blockKind = "leave"; occ.leaveId = lv.id;
        occ.reason = lv.reason || "Coach on leave"; occ.statusBy = lv.by; occ.statusAt = lv.at;
      }
    }

    var active = (c.byOcc[base.key] || []).filter(function (b) { return b.status === "booked"; });
    occ.booked = active.length;
    occ.spotsLeft = Math.max(0, occ.capacity - occ.booked);
    occ.isToday = base.date === t;
    occ.isPast = base.date < t;
    occ.started = base.date < t || (base.date === t && nowM >= start);
    occ.ended = base.date < t || (base.date === t && nowM >= start + base.duration);
    occ.bookable = occ.status === "open" && !occ.started && occ.spotsLeft > 0;
    occ.unmarked = occ.started ? active.filter(function (b) { return !b.attendance; }).length : 0;
    return occ;
  }

  function occurrence(key) {
    load();
    var base = baseFor(key);
    return base ? buildOcc(base) : null;
  }

  // opts: { includeRemoved: bool, coach: "Coach A" }
  function occurrencesForDate(date, opts) {
    load();
    opts = opts || {};
    var day = dayIndex(date);
    var list = [];
    HC.schedule.forEach(function (t) {
      if (t.day !== day) return;
      var base = baseFor(occKey(date, t.id));
      if (base) list.push(buildOcc(base));
    });
    DB.oneOffs.forEach(function (o) {
      if (o.date !== date) return;
      var base = baseFor(occKey(date, o.id));
      if (base) list.push(buildOcc(base));
    });
    return list.filter(function (o) {
      if (!opts.includeRemoved && o.status === "removed") return false;
      if (opts.coach && o.coach !== opts.coach) return false;
      return true;
    }).sort(function (a, b) {
      return a.time.localeCompare(b.time) || a.name.localeCompare(b.name);
    });
  }

  function occurrencesForRange(from, to, opts) {
    var out = [];
    for (var d = from; d <= to; d = addDays(d, 1)) {
      out = out.concat(occurrencesForDate(d, opts));
    }
    return out;
  }

  function occurrencesForWeek(anyDateInWeek, opts) {
    var start = weekStart(anyDateInWeek || todayISO());
    return occurrencesForRange(start, addDays(start, 6), opts);
  }

  /* ---------- permissions ---------- */
  // action: view | manage (block / delete / roster / attendance) | notes (write remarks)
  //         | oneoff | substitute | series | credits | reports | coaches | leave
  function can(staff, action, target) {
    if (!staff) return false;
    // remarks are the class coach's job — admins read them but don't write them
    if (action === "notes") {
      return staff.role === "coach" && !!target && target.coach === staff.coach;
    }
    if (staff.role === "admin") return true;
    switch (action) {
      case "view": return true;
      case "manage": return !!target && target.coach === staff.coach;
      case "leave": return !target || target === staff.coach;
      default: return false; // oneoff, substitute, series, credits, reports, coaches
    }
  }

  /* ---------- staff actions on classes ---------- */
  function cancelActiveBookings(key, by, reason, at) {
    var occ = occurrence(key);
    var active = (idx().byOcc[key] || []).filter(function (b) { return b.status === "booked"; });
    active.forEach(function (b) {
      doCancel(b, { by: by, refund: true, reason: reason, notify: true, at: at, occ: occ });
    });
    return active.length;
  }

  function blockOccurrence(key, opts) {
    opts = opts || {};
    load();
    var occ = occurrence(key);
    if (!occ) return fail("Class not found.");
    if (occ.status === "removed") return fail("This class has been deleted.");
    if (occ.status === "blocked" && occ.blockKind === "manual") return fail("This class is already blocked.");
    var at = opts.at || nowStamp();
    var ov = DB.overrides[key] = DB.overrides[key] || {};
    ov.status = "blocked"; ov.reason = opts.reason || ""; ov.by = opts.by; ov.at = at;
    rev++;
    var n = cancelActiveBookings(key, opts.by, "Class unavailable" + (opts.reason ? " — " + opts.reason : ""), at);
    audit(opts.by, "block", "Blocked " + occ.name + " · " + formatDate(occ.date) + " " + HC.formatTime(occ.time) +
      (n ? " (" + n + " booking" + (n === 1 ? "" : "s") + " refunded)" : ""), at);
    done(opts, { type: "block", key: key });
    return { ok: true, refunded: n };
  }

  function unblockOccurrence(key, opts) {
    opts = opts || {};
    load();
    var ov = DB.overrides[key];
    if (!ov || ov.status !== "blocked") return fail("This class isn't blocked.");
    delete ov.status; delete ov.reason; delete ov.by; delete ov.at;
    if (!Object.keys(ov).length) delete DB.overrides[key];
    rev++;
    var occ = occurrence(key);
    audit(opts.by, "unblock", "Reopened " + occ.name + " · " + formatDate(occ.date) + " " + HC.formatTime(occ.time));
    commit({ type: "unblock", key: key });
    return { ok: true };
  }

  // opts.scope: "one" (this date only, default) | "series" (this and all following weeks)
  function removeOccurrence(key, opts) {
    opts = opts || {};
    load();
    var occ = occurrence(key);
    if (!occ) return fail("Class not found.");
    if (occ.status === "removed") return fail("This class is already deleted.");
    var at = opts.at || nowStamp();
    var reason = opts.reason || "";
    var refunded = 0;

    if (opts.scope === "series") {
      if (!occ.templateId) return fail("One-off classes have no weekly series.");
      DB.seriesEnds[occ.templateId] = { from: occ.date, reason: reason, by: opts.by, at: at };
      rev++;
      // cancel every active booking on or after this date for the series
      DB.bookings.forEach(function (b) {
        if (b.status === "booked" && b.templateId === occ.templateId && b.date >= occ.date) {
          doCancel(b, { by: opts.by, refund: true, reason: "Weekly class discontinued" + (reason ? " — " + reason : ""), notify: true, at: at });
          refunded++;
        }
      });
      audit(opts.by, "remove-series", "Deleted weekly " + occ.name + " (" + HC.dayNames[occ.day] + " " +
        HC.formatTime(occ.time) + ") from " + formatDate(occ.date) + " onward" +
        (refunded ? " (" + refunded + " booking" + (refunded === 1 ? "" : "s") + " refunded)" : ""), at);
    } else {
      var ov = DB.overrides[key] = DB.overrides[key] || {};
      ov.status = "removed"; ov.reason = reason; ov.by = opts.by; ov.at = at;
      rev++;
      refunded = cancelActiveBookings(key, opts.by, "Class cancelled" + (reason ? " — " + reason : ""), at);
      audit(opts.by, "remove", "Deleted " + occ.name + " · " + formatDate(occ.date) + " " + HC.formatTime(occ.time) +
        (refunded ? " (" + refunded + " booking" + (refunded === 1 ? "" : "s") + " refunded)" : ""), at);
    }
    done(opts, { type: "remove", key: key });
    return { ok: true, refunded: refunded };
  }

  function restoreOccurrence(key, opts) {
    opts = opts || {};
    load();
    var occ = occurrence(key);
    if (!occ || occ.status !== "removed") return fail("This class isn't deleted.");
    if (occ.removedScope === "series") {
      delete DB.seriesEnds[occ.templateId];
      audit(opts.by, "restore-series", "Restored weekly " + occ.name + " (" + HC.dayNames[occ.day] + " " + HC.formatTime(occ.time) + ")");
    } else {
      var ov = DB.overrides[key];
      delete ov.status; delete ov.reason; delete ov.by; delete ov.at;
      if (!Object.keys(ov).length) delete DB.overrides[key];
      audit(opts.by, "restore", "Restored " + occ.name + " · " + formatDate(occ.date) + " " + HC.formatTime(occ.time));
    }
    commit({ type: "restore", key: key });
    return { ok: true };
  }

  // Swap the coach for one date (admin). coach = null reverts to the timetable coach.
  // If the coach now taking the class is on leave that day, the class stays closed
  // and its bookings are refunded — whichever way the class is being handed over.
  function substituteCoach(key, coach, opts) {
    opts = opts || {};
    load();
    var occ = occurrence(key);
    if (!occ) return fail("Class not found.");
    var back = !coach || coach === occ.originalCoach;
    var ov = DB.overrides[key] = DB.overrides[key] || {};
    if (back) {
      delete ov.coach; delete ov.coachBy;
      if (!Object.keys(ov).length) delete DB.overrides[key];
    } else {
      ov.coach = coach; ov.coachBy = opts.by;
    }
    rev++;
    var after = occurrence(key);
    var refunded = after.status === "blocked" && after.blockKind === "leave"
      ? cancelActiveBookings(key, opts.by, "Coach unavailable", opts.at) : 0;
    audit(opts.by, "substitute", (back
      ? occ.name + " · " + formatDate(occ.date) + " back to " + occ.originalCoach
      : coach + " covering " + occ.name + " · " + formatDate(occ.date) + " " + HC.formatTime(occ.time)) +
      (refunded ? " (" + refunded + " booking" + (refunded === 1 ? "" : "s") + " refunded)" : ""), opts.at);
    done(opts, { type: "substitute", key: key });
    return { ok: true, refunded: refunded };
  }

  // data: { date, time, programmeId, coach, capacity, duration, note }
  function addOneOff(data, opts) {
    opts = opts || {};
    load();
    var prog = HC.getProgramme(data.programmeId);
    if (!prog) return fail("Choose a programme.");
    if (!data.date) return fail("Choose a date.");
    if (!/^\d{2}:\d{2}$/.test(data.time || "")) return fail("Choose a start time.");
    var duration = +data.duration || prog.duration || 60;
    var start = toMinutes(data.time);
    if (start < 10 * 60 || start + duration > 22 * 60) return fail("Classes must run within studio hours (10am–10pm).");
    if (!opts.allowPast && (data.date < todayISO() || (data.date === todayISO() && start <= nowMinutes()))) {
      return fail("That time has already passed.");
    }
    var capacity = Math.floor(+data.capacity || prog.maxSize || 20);
    if (capacity < 1) return fail("Capacity must be at least 1.");
    if (prog.maxSize && capacity > prog.maxSize) return fail(prog.name + " is capped at " + prog.maxSize + " students.");
    if (!data.coach) return fail("Choose a coach.");

    var o = {
      id: nextId("X"),
      date: data.date,
      time: data.time,
      programmeId: prog.id,
      coach: data.coach,
      capacity: capacity,
      duration: duration,
      note: (data.note || "").trim(),
      by: opts.by,
      at: opts.at || nowStamp()
    };
    DB.oneOffs.push(o);
    audit(opts.by, "one-off", "Added one-off " + prog.name + " · " + formatDate(o.date) + " " + HC.formatTime(o.time) + " (" + o.coach + ")", o.at);
    done(opts, { type: "one-off", key: occKey(o.date, o.id) });
    return { ok: true, key: occKey(o.date, o.id) };
  }

  // Classes that clash with a proposed slot for the same coach (warning only).
  function clashes(date, time, duration, coach, ignoreKey) {
    var s = toMinutes(time), e = s + (+duration || 60);
    return occurrencesForDate(date).filter(function (o) {
      if (o.key === ignoreKey || o.coach !== coach) return false;
      var os = toMinutes(o.time), oe = os + o.duration;
      return s < oe && os < e;
    });
  }

  /* ---------- leave ---------- */
  function leaves(filter) {
    load();
    filter = filter || {};
    return DB.leaves.filter(function (l) {
      if (filter.coach && l.coach !== filter.coach) return false;
      if (filter.from && l.date < filter.from) return false;
      if (filter.to && l.date > filter.to) return false;
      return true;
    }).sort(function (a, b) { return a.date.localeCompare(b.date) || a.coach.localeCompare(b.coach); });
  }

  function leaveFor(coach, date) {
    return idx().leave[coach + "|" + date] || null;
  }

  // Classes new leave would close: open ones that haven't started yet. A class
  // already under way (or finished) keeps its bookings and attendance.
  function leaveTargets(coach, date) {
    return occurrencesForDate(date, { coach: coach }).filter(function (o) { return o.status === "open" && !o.started; });
  }

  // What adding leave would affect — for the confirmation step.
  function leaveImpact(coach, date) {
    var list = leaveTargets(coach, date);
    return {
      classes: list,
      bookings: list.reduce(function (n, o) { return n + o.booked; }, 0)
    };
  }

  function addLeave(data, opts) {
    opts = opts || {};
    load();
    if (!data.coach) return fail("Choose a coach.");
    if (!data.date) return fail("Choose a date.");
    if (!opts.allowPast && data.date < todayISO()) return fail("That date has already passed.");
    if (leaveFor(data.coach, data.date)) return fail(data.coach + " is already on leave on " + formatDate(data.date) + ".");
    var at = opts.at || nowStamp();
    var affected = leaveTargets(data.coach, data.date);
    var lv = { id: nextId("L"), coach: data.coach, date: data.date, reason: (data.reason || "").trim(), by: opts.by, at: at };
    DB.leaves.push(lv);
    rev++;
    var refunded = 0;
    affected.forEach(function (o) {
      refunded += cancelActiveBookings(o.key, opts.by, "Coach unavailable", at);
    });
    audit(opts.by, "leave", data.coach + " on leave " + formatDate(data.date) + " — " + affected.length + " class" +
      (affected.length === 1 ? "" : "es") + " blocked" + (refunded ? ", " + refunded + " booking" + (refunded === 1 ? "" : "s") + " refunded" : ""), at);
    done(opts, { type: "leave" });
    return { ok: true, leave: lv, classes: affected.length, refunded: refunded };
  }

  function removeLeave(id, opts) {
    opts = opts || {};
    load();
    var i = DB.leaves.findIndex(function (l) { return l.id === id; });
    if (i < 0) return fail("Leave not found.");
    var lv = DB.leaves[i];
    DB.leaves.splice(i, 1);
    audit(opts.by, "leave-cancel", lv.coach + " back on " + formatDate(lv.date) + " — classes reopened");
    commit({ type: "leave" });
    return { ok: true };
  }

  /* ============================================================
     COACHES & STAFF (admins manage coaches)
     A coach record: { id, name, role: "coach", coach (timetable tag,
     same as name), email, phone, title, login (may sign in), active }
     ============================================================ */
  function staff(opts) {
    load();
    opts = opts || {};
    return DB.staff.filter(function (s) {
      if (!opts.includeInactive && s.active === false) return false;
      if (opts.role && s.role !== opts.role) return false;
      if (opts.canLogin && (s.active === false || !s.login)) return false;
      return true;
    }).map(function (s) { return s; });
  }

  function coaches(opts) {
    return staff(Object.assign({}, opts || {}, { role: "coach" }))
      .sort(function (a, b) { return a.name.localeCompare(b.name); });
  }

  // Coach tags for pickers and filters: active coaches, plus inactive ones
  // who still appear on the timetable (so old classes stay filterable).
  function coachNames(opts) {
    opts = opts || {};
    var names = coaches().map(function (c) { return c.coach; });
    if (opts.includeTimetable !== false) {
      HC.schedule.forEach(function (t) {
        var c = templateCoachOn(t, todayISO());
        if (names.indexOf(c) < 0) names.push(c);
      });
    }
    return names.sort();
  }

  function slugId(name) {
    var base = "coach-" + String(name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    var id = base, n = 2;
    while (staffById(id)) id = base + "-" + n++;
    return id;
  }

  function validateCoach(data, selfId) {
    var name = String(data.name || "").trim();
    var email = String(data.email || "").trim();
    if (!name) return "Enter the coach's name.";
    if (name.length > 40) return "Keep the name under 40 characters.";
    var clash = DB.staff.find(function (s) {
      return s.id !== selfId && (s.name.toLowerCase() === name.toLowerCase() ||
        (s.coach && s.coach.toLowerCase() === name.toLowerCase()));
    });
    if (clash) return "There's already a staff member called " + clash.name + ".";
    if (data.login && !email) return "A login needs an email address.";
    if (email) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return "Enter a valid email address.";
      var used = DB.staff.find(function (s) { return s.id !== selfId && (s.email || "").toLowerCase() === email.toLowerCase(); });
      if (used) return "That email is already used by " + used.name + ".";
    }
    return null;
  }

  // data: { name, email, phone, title, login }
  function addCoach(data, opts) {
    opts = opts || {};
    load();
    var err = validateCoach(data, null);
    if (err) return fail(err);
    var name = String(data.name).trim();
    var c = {
      id: slugId(name), name: name, role: "coach", coach: name,
      email: String(data.email || "").trim(), phone: String(data.phone || "").trim(),
      title: String(data.title || "").trim() || "Coach",
      login: !!data.login, active: true, createdAt: opts.at || nowStamp()
    };
    DB.staff.push(c);
    audit(opts.by, "coach", "Added coach " + c.name + (c.login ? " (can log in)" : ""), c.createdAt);
    done(opts, { type: "coach", staffId: c.id });
    return { ok: true, coach: c };
  }

  // Classes that still need this coach from today on (weekly + one-offs + covers).
  function coachCommitments(coach, from) {
    from = from || todayISO();
    var weekly = HC.schedule.filter(function (t) {
      var ends = DB.seriesEnds[t.id];
      if (ends && ends.from <= from) return false;
      return templateCoachOn(t, addDays(from, 400)) === coach || templateCoachOn(t, from) === coach;
    });
    var oneOffs = DB.oneOffs.filter(function (o) {
      return o.coach === coach && o.date >= from &&
        !(DB.overrides[occKey(o.date, o.id)] || {}).status;
    });
    var covers = Object.keys(DB.overrides).filter(function (k) {
      return DB.overrides[k].coach === coach && splitKey(k).date >= from;
    });
    return { weekly: weekly, oneOffs: oneOffs, covers: covers };
  }

  // patch: { name, email, phone, title, login, active }
  function updateCoach(id, patch, opts) {
    opts = opts || {};
    load();
    var c = staffById(id);
    if (!c || c.role !== "coach") return fail("Coach not found.");
    var next = Object.assign({}, c, patch);
    if (patch.name != null) next.name = String(patch.name).trim();
    var err = validateCoach(next, id);
    if (err) return fail(err);

    if (patch.active === false && c.active !== false) {
      var busy = coachCommitments(c.coach);
      var n = busy.weekly.length + busy.oneOffs.length + busy.covers.length;
      if (n) {
        return fail(c.name + " still has " + n + " class" + (n === 1 ? "" : "es") +
          " on the timetable — hand them to another coach first.", { code: "busy", commitments: busy });
      }
    }

    var oldTag = c.coach;
    var oldName = c.name;
    var changes = [];
    if (next.name !== c.name) {
      changes.push("renamed to " + next.name);
      renameCoachTag(oldTag, next.name);
      c.name = next.name;
      c.coach = next.name;
    }
    ["email", "phone", "title"].forEach(function (k) {
      if (patch[k] != null && String(patch[k]).trim() !== (c[k] || "")) {
        c[k] = String(patch[k]).trim();
        changes.push(k + " updated");
      }
    });
    if (patch.login != null && !!patch.login !== !!c.login) {
      c.login = !!patch.login;
      changes.push(c.login ? "login enabled" : "login disabled");
    }
    if (patch.active != null && !!patch.active !== (c.active !== false)) {
      c.active = !!patch.active;
      changes.push(c.active ? "reactivated" : "deactivated");
    }
    if (changes.length) {
      rev++;
      audit(opts.by, "coach", oldName + ": " + changes.join(", "));
    }
    done(opts, { type: "coach", staffId: id });
    return { ok: true, coach: c };
  }

  // Point every stored reference at a coach's new timetable tag.
  function renameCoachTag(from, to) {
    DB.coachAliases[from] = to;
    delete DB.coachAliases[to]; // renaming back must not loop
    Object.keys(DB.templateCoach).forEach(function (tid) {
      DB.templateCoach[tid].forEach(function (x) { if (x.coach === from) x.coach = to; });
    });
    DB.oneOffs.forEach(function (o) { if (o.coach === from) o.coach = to; });
    DB.leaves.forEach(function (l) { if (l.coach === from) l.coach = to; });
    Object.keys(DB.overrides).forEach(function (k) {
      if (DB.overrides[k].coach === from) DB.overrides[k].coach = to;
    });
    rev++;
  }

  // Hand a weekly class to another coach from a date (default: today) onward.
  function assignWeeklyClass(templateId, coach, opts) {
    opts = opts || {};
    load();
    var t = template(templateId);
    if (!t) return fail("Weekly class not found.");
    var target = staffForCoach(coach);
    if (!target || target.active === false) return fail("Choose an active coach.");
    var from = opts.from || todayISO();
    var current = templateCoachOn(t, from);
    if (current === coach) return fail(coach + " already teaches this class.");
    var list = DB.templateCoach[t.id] = (DB.templateCoach[t.id] || []).filter(function (x) { return x.from < from; });
    list.push({ from: from, coach: coach, by: opts.by, at: opts.at || nowStamp() });
    rev++;
    var prog = HC.getProgramme(t.programmeId) || {};
    // bookings stay; any class this coach can't take that day is caught by leave rules
    var refunded = 0;
    DB.leaves.filter(function (l) { return l.coach === coach && l.date >= from; }).forEach(function (l) {
      if (dayIndex(l.date) !== t.day) return;
      var key = occKey(l.date, t.id);
      var o = occurrence(key);
      if (o && o.status === "blocked" && o.blockKind === "leave") refunded += cancelActiveBookings(key, opts.by, "Coach unavailable", opts.at);
    });
    audit(opts.by, "coach", "Weekly " + (prog.name || t.programmeId) + " (" + HC.dayNames[t.day] + " " +
      HC.formatTime(t.time) + ") now taught by " + coach + " from " + formatDate(from) +
      (refunded ? " (" + refunded + " booking" + (refunded === 1 ? "" : "s") + " refunded — coach on leave)" : ""), opts.at);
    done(opts, { type: "coach" });
    return { ok: true, refunded: refunded };
  }

  // The weekly classes a coach teaches as of a date.
  function weeklyClassesFor(coach, date) {
    date = date || todayISO();
    return HC.schedule.filter(function (t) {
      var ends = DB.seriesEnds[t.id];
      return templateCoachOn(t, date) === coach && !(ends && ends.from <= date);
    }).map(function (t) {
      var prog = HC.getProgramme(t.programmeId) || {};
      return { templateId: t.id, day: t.day, time: t.time, programmeId: t.programmeId, name: prog.name || t.programmeId,
        level: prog.level, capacity: t.capacity, duration: prog.duration || 60 };
    }).sort(function (a, b) { return a.day - b.day || a.time.localeCompare(b.time); });
  }

  /* ============================================================
     FAMILIES & CHILDREN
     ============================================================ */
  function families() { load(); return DB.families.slice(); }
  function family(id) { return idx().family[id] || null; }
  function familyByEmail(email) {
    load();
    var e = String(email || "").trim().toLowerCase();
    if (!e) return null;
    return DB.families.find(function (f) { return f.email.toLowerCase() === e; }) || null;
  }
  function children(familyId, opts) {
    load();
    opts = opts || {};
    return DB.children.filter(function (c) {
      if (familyId && c.familyId !== familyId) return false;
      if (!opts.includeInactive && c.active === false) return false;
      return true;
    });
  }
  function child(id) { return idx().child[id] || null; }

  function createFamily(data, opts) {
    opts = opts || {};
    load();
    if (!String(data.parentName || "").trim()) return fail("Parent's name is required.");
    if (!String(data.email || "").trim()) return fail("Email is required.");
    if (familyByEmail(data.email)) return fail("An account with this email already exists.");
    var at = opts.at || nowStamp();
    var f = {
      id: nextId("F"),
      parentName: data.parentName.trim(),
      email: data.email.trim(),
      phone: (data.phone || "").trim(),
      createdAt: at
    };
    DB.families.push(f);
    rev++;
    (data.children || []).forEach(function (c) { addChildRaw(f.id, c); });
    if (opts.trialCredit) {
      DB.ledger.push({ id: nextId("T"), familyId: f.id, childId: null, delta: 1, type: "trial", amount: 0,
        reason: "Free trial credit", by: "system", at: at });
    }
    audit(opts.by || ("parent:" + f.id), "family", "New account: " + f.parentName, at);
    done(opts, { type: "family", familyId: f.id });
    return { ok: true, family: f };
  }

  function updateFamily(id, patch, opts) {
    opts = opts || {};
    var f = family(id);
    if (!f) return fail("Account not found.");
    if (patch.email != null) {
      var other = familyByEmail(patch.email);
      if (!String(patch.email).trim()) return fail("Email is required.");
      if (other && other.id !== id) return fail("Another account already uses this email.");
    }
    ["parentName", "email", "phone"].forEach(function (k) {
      if (patch[k] != null) f[k] = String(patch[k]).trim();
    });
    audit(opts.by || ("parent:" + id), "family", "Updated account details for " + f.parentName);
    commit({ type: "family", familyId: id });
    return { ok: true, family: f };
  }

  function addChildRaw(familyId, data) {
    var c = {
      id: nextId("C"),
      familyId: familyId,
      name: String(data.name || "").trim(),
      age: data.age === "" || data.age == null ? "" : +data.age,
      level: LEVELS.indexOf(data.level) >= 0 ? data.level : "Junior",
      programmes: Array.isArray(data.programmes) ? data.programmes.slice() : [],
      medical: (data.medical || "").trim(),
      active: true
    };
    DB.children.push(c);
    rev++;
    return c;
  }

  function addChild(familyId, data, opts) {
    opts = opts || {};
    load();
    if (!family(familyId)) return fail("Account not found.");
    if (!String(data.name || "").trim()) return fail("Child's name is required.");
    var c = addChildRaw(familyId, data);
    audit(opts.by || ("parent:" + familyId), "child", "Added child " + c.name + " to " + family(familyId).parentName + "'s account");
    commit({ type: "child", childId: c.id });
    return { ok: true, child: c };
  }

  function updateChild(id, patch, opts) {
    var c = child(id);
    if (!c) return fail("Child not found.");
    if (patch.name != null) {
      if (!String(patch.name).trim()) return fail("Child's name is required.");
      c.name = String(patch.name).trim();
    }
    if (patch.age != null) c.age = patch.age === "" ? "" : +patch.age;
    if (patch.level != null && LEVELS.indexOf(patch.level) >= 0) c.level = patch.level;
    if (patch.medical != null) c.medical = String(patch.medical).trim();
    if (Array.isArray(patch.programmes)) c.programmes = patch.programmes.slice();
    audit((opts && opts.by) || ("parent:" + c.familyId), "child", "Updated details for " + c.name);
    commit({ type: "child", childId: id });
    return { ok: true, child: c };
  }

  // Soft-remove; refused while the child still has upcoming classes.
  function removeChild(id, opts) {
    opts = opts || {};
    var c = child(id);
    if (!c) return fail("Child not found.");
    if (upcomingBookings({ childId: id }).length) {
      return fail(c.name + " still has upcoming classes — please contact the studio to cancel them first.");
    }
    c.active = false; // the family's credits stay in the shared pool
    audit(opts.by || ("parent:" + c.familyId), "child", "Removed child " + c.name);
    commit({ type: "child", childId: id });
    return { ok: true };
  }

  function levelFits(ch, prog) {
    if (!ch || !prog) return true;
    if (prog.level === ch.level) return true;
    return ch.level === "Competitive" && prog.level === "Elite";
  }

  // Name / parent / email / phone search over active children.
  function searchChildren(q) {
    q = String(q || "").trim().toLowerCase();
    var digits = q.replace(/\D/g, "");
    var c = idx();
    return children().filter(function (ch) {
      if (!q) return true;
      var f = c.family[ch.familyId] || {};
      if ([ch.name, f.parentName, f.email, f.phone].join(" ").toLowerCase().indexOf(q) >= 0) return true;
      // "91234501" should find "+65 9123 4501"
      return digits.length >= 3 && digits.length === q.replace(/[\s+()-]/g, "").length &&
        String(f.phone || "").replace(/\D/g, "").indexOf(digits) >= 0;
    }).sort(function (a, b) { return a.name.localeCompare(b.name); });
  }

  /* ============================================================
     CREDITS
     ============================================================ */
  function balance(familyId) { return idx().balance[familyId] || 0; }

  // "Jane Tan's family" — how credit messages name the shared pool
  function familyLabel(f) { return f ? f.parentName + "'s family" : "the family"; }

  // filter: { familyId, childId, type, from, to }
  function ledger(filter) {
    load();
    filter = filter || {};
    return DB.ledger.filter(function (l) {
      if (filter.familyId && l.familyId !== filter.familyId) return false;
      if (filter.childId && l.childId !== filter.childId) return false;
      if (filter.type && l.type !== filter.type) return false;
      if (filter.from && l.at.slice(0, 10) < filter.from) return false;
      if (filter.to && l.at.slice(0, 10) > filter.to) return false;
      return true;
    }).sort(function (a, b) { return b.at.localeCompare(a.at) || idNum(b.id) - idNum(a.id); });
  }

  // A family's history, newest first, with the pool's balance after each row.
  function ledgerWithBalance(familyId) {
    var run = 0;
    return ledger({ familyId: familyId }).reverse().map(function (l) {
      run += l.delta;
      return Object.assign({}, l, { balanceAfter: run });
    }).reverse();
  }

  // delta < 0 deducts. opts: { reason, note, amount, by, allowNegative }
  function adjustCredits(familyId, delta, opts) {
    opts = opts || {};
    load();
    var f = family(familyId);
    if (!f) return fail("Account not found.");
    delta = Math.trunc(+delta);
    if (!delta) return fail("Enter a number of credits.");
    if (!opts.reason) return fail("Choose a reason.");
    var bal = balance(familyId);
    if (delta < 0 && bal + delta < 0 && !opts.allowNegative) {
      return fail(familyLabel(f) + " only has " + bal + " credit" + (bal === 1 ? "" : "s") + ".", { code: "insufficient", balance: bal });
    }
    var entry = {
      id: nextId("T"), familyId: familyId, childId: null, delta: delta, type: "manual",
      reason: opts.reason, note: (opts.note || "").trim(),
      amount: delta > 0 && +opts.amount > 0 ? +opts.amount : 0,
      by: opts.by, at: opts.at || nowStamp()
    };
    DB.ledger.push(entry);
    audit(opts.by, "credits", (delta < 0 ? "Deducted " + (-delta) : "Added " + delta) + " credit" +
      (Math.abs(delta) === 1 ? "" : "s") + (delta < 0 ? " from " : " to ") + familyLabel(f) + " — " + opts.reason, entry.at);
    done(opts, { type: "credits", familyId: familyId });
    return { ok: true, entry: entry, balance: bal + delta };
  }

  function hasClaimedTrial(familyId) {
    load();
    return DB.ledger.some(function (l) { return l.familyId === familyId && l.type === "trial"; });
  }

  // The free trial is for a new family: nothing claimed, bought or booked yet.
  function trialEligible(familyId) {
    var c = idx();
    if (!c.family[familyId] || (c.byFamily[familyId] || []).length) return false;
    return !DB.ledger.some(function (l) {
      return l.familyId === familyId && (l.type === "trial" || l.type === "purchase" ||
        (l.type === "manual" && l.delta > 0 && l.amount > 0));
    });
  }

  // The pricing levels a family's children train at (for suggesting packages).
  function familyTiers(familyId) {
    var tiers = [];
    DB.children.forEach(function (ch) {
      if (ch.familyId !== familyId || ch.active === false) return;
      var t = tierOf(ch.level);
      if (tiers.indexOf(t) < 0) tiers.push(t);
    });
    return tiers.length ? tiers : ["junior"];
  }

  function topTier(familyId) {
    var order = ["junior", "elite", "competitive"];
    return familyTiers(familyId).sort(function (a, b) { return order.indexOf(b) - order.indexOf(a); })[0];
  }

  // Packages a parent can buy — credits go into the family's shared pool.
  // The free trial comes first, then every level's packs; `suggested` marks
  // the levels this family's children train at.
  // [{ id, name, credits, price, tier, tierLabel, tag, note, suggested, eligible?, claimed? }]
  function packagesFor(familyId) {
    if (!family(familyId)) return [];
    var mine = familyTiers(familyId);
    var list = [{
      id: "trial", name: "Free Trial", credits: 1, price: 0, tier: null, tierLabel: "", tag: "New students",
      note: "One complimentary class for a new family", eligible: trialEligible(familyId),
      claimed: hasClaimedTrial(familyId), suggested: true
    }];
    ["junior", "elite", "competitive"].forEach(function (tier) {
      var packs = TIER_PACKS[tier];
      Object.keys(packs).map(Number).sort(function (a, b) { return a - b; }).forEach(function (n) {
        list.push({
          id: tier + "-" + n,
          name: n + (n === 1 ? " Class" : " Classes"),
          credits: n,
          price: packs[n],
          tier: tier,
          tierLabel: TIER_LABEL[tier],
          tag: n === 10 ? "Popular" : n === 20 ? "Best value" : "",
          note: n + " credit" + (n === 1 ? "" : "s") + " · " + TIER_LABEL[tier] + " rate" +
            (n > 1 ? " · S$" + (Math.round(packs[n] / n * 100) / 100) + " per class" : ""),
          suggested: mine.indexOf(tier) >= 0
        });
      });
    });
    return list;
  }

  // Parent portal purchase into the family pool (PayNow is mocked).
  // packageId: an id from packagesFor ("trial", "elite-10", …); legacy
  // HC.packages ids (pack5 / pack10 / pack20) use the family's top level.
  function purchase(familyId, packageId, opts) {
    opts = opts || {};
    load();
    var f = family(familyId);
    if (!f) return fail("Account not found.");
    var legacy = { pack5: 5, pack10: 10, pack20: 20 };
    if (legacy[packageId]) packageId = topTier(familyId) + "-" + legacy[packageId];
    var p = packagesFor(familyId).find(function (x) { return x.id === packageId; });
    if (!p) return fail("Package not found.");
    if (p.price === 0 && !p.eligible) {
      return fail(p.claimed ? "The free trial credit has already been claimed."
        : "The free trial is for new families.", { code: "trial" });
    }
    var entry = {
      id: nextId("T"), familyId: familyId, childId: null, delta: p.credits,
      type: p.price === 0 ? "trial" : "purchase",
      packageId: p.id, amount: p.price, unitPrice: p.credits ? p.price / p.credits : 0,
      reason: p.price === 0 ? "Free trial credit" : p.name + " · " + p.tierLabel + " (PayNow)",
      by: opts.by || ("parent:" + familyId), at: opts.at || nowStamp()
    };
    DB.ledger.push(entry);
    done(opts, { type: "credits", familyId: familyId });
    return { ok: true, entry: entry, balance: balance(familyId) };
  }

  /* ============================================================
     BOOKINGS
     ============================================================ */
  function booking(id) { return idx().booking[id] || null; }

  function sortBookings(list, desc) {
    return list.sort(function (a, b) {
      var r = a.date.localeCompare(b.date) || a.time.localeCompare(b.time);
      return desc ? -r : r;
    });
  }

  // filter: { occKey, childId, familyId, status, from, to, includeCancelled }
  function bookings(filter) {
    filter = filter || {};
    var c = idx();
    var list = filter.occKey ? (c.byOcc[filter.occKey] || [])
      : filter.childId ? (c.byChild[filter.childId] || [])
      : filter.familyId ? (c.byFamily[filter.familyId] || [])
      : DB.bookings;
    return sortBookings(list.filter(function (b) {
      if (filter.childId && b.childId !== filter.childId) return false;
      if (filter.familyId && b.familyId !== filter.familyId) return false;
      if (filter.status && b.status !== filter.status) return false;
      if (!filter.status && !filter.includeCancelled && b.status === "cancelled") return false;
      if (filter.from && b.date < filter.from) return false;
      if (filter.to && b.date > filter.to) return false;
      return true;
    }), filter.desc);
  }

  function hasStarted(b) {
    var t = todayISO();
    return b.date < t || (b.date === t && nowMinutes() >= toMinutes(b.time));
  }

  function upcomingBookings(filter) {
    filter = Object.assign({}, filter || {}, { status: "booked", from: todayISO() });
    return bookings(filter).filter(function (b) { return !hasStarted(b); });
  }

  function pastBookings(filter) {
    filter = Object.assign({}, filter || {}, { includeCancelled: false, to: todayISO(), desc: true });
    return bookings(filter).filter(hasStarted);
  }

  // Roster for a class: active bookings joined with child + family.
  function roster(key, opts) {
    opts = opts || {};
    var c = idx();
    return bookings({ occKey: key, includeCancelled: !!opts.includeCancelled }).map(function (b) {
      var ch = c.child[b.childId] || { name: "(removed)" };
      var f = c.family[b.familyId] || {};
      return { booking: b, child: ch, family: f, balance: c.balance[b.familyId] || 0, note: noteForBooking(b.id) };
    }).sort(function (a, b) {
      if (a.booking.status !== b.booking.status) return a.booking.status === "booked" ? -1 : 1;
      return a.child.name.localeCompare(b.child.name);
    });
  }

  // opts: { by, source: "parent"|"staff", familyId (parent guard), charge (default true),
  //         allowStarted, allowFull, allowNegative, allowBlocked, silent, at }
  function book(key, childId, opts) {
    opts = opts || {};
    load();
    var occ = occurrence(key);
    var ch = child(childId);
    if (!occ) return fail("Class not found.");
    if (!ch || ch.active === false) return fail("Student not found.");
    if (opts.familyId && ch.familyId !== opts.familyId) return fail("Student not found.");
    if (occ.status === "removed") return fail("This class has been cancelled.");
    if (occ.status === "blocked" && !opts.allowBlocked) return fail("This class is unavailable.", { code: "blocked" });
    if (occ.started && !opts.allowStarted) return fail("This class has already started.", { code: "started" });
    var dup = (idx().byOcc[key] || []).some(function (b) { return b.childId === childId && b.status === "booked"; });
    if (dup) return fail(ch.name + " is already booked into this class.", { code: "duplicate" });
    if (occ.spotsLeft <= 0 && !opts.allowFull) return fail("Sorry, this class is full.", { code: "full" });
    var charge = opts.charge !== false;
    var bal = balance(ch.familyId);
    if (charge && bal < occ.cost && !opts.allowNegative) {
      return fail("Not enough credits.", { code: "credits", balance: bal });
    }
    var at = opts.at || nowStamp();
    var b = {
      id: nextId("B"),
      occKey: key,
      date: occ.date,
      time: occ.time,
      templateId: occ.templateId,
      oneOffId: occ.oneOffId,
      programmeId: occ.programmeId,
      childId: childId,
      familyId: ch.familyId,
      status: "booked",
      cost: charge ? occ.cost : 0,
      source: opts.source || "parent",
      by: opts.by || ("parent:" + ch.familyId),
      at: at,
      attendance: null
    };
    DB.bookings.push(b);
    if (charge) {
      DB.ledger.push({
        id: nextId("T"), familyId: ch.familyId, childId: childId, delta: -occ.cost, type: "booking",
        bookingId: b.id, reason: occ.name + " · " + formatDate(occ.date) + " " + HC.formatTime(occ.time) + " · " + ch.name,
        by: b.by, at: at
      });
    }
    rev++;
    if (b.source === "staff") {
      audit(opts.by, "assign", "Added " + ch.name + " to " + occ.name + " · " + formatDate(occ.date) + " " +
        HC.formatTime(occ.time) + (charge ? "" : " (no credit charged)"), at);
      notify(ch.familyId, "assigned", ch.name + " was booked into " + occ.name + " on " + formatDate(occ.date) + " at " +
        HC.formatTime(occ.time) + " by the studio" + (charge ? " — " + occ.cost + " credit used." : "."), b.id, at);
    }
    done(opts, { type: "book", key: key });
    return { ok: true, booking: b };
  }

  // opts.kind: "cancelled" (the class itself is off, default) | "removed" (just this child)
  function doCancel(b, opts) {
    var at = opts.at || nowStamp();
    var kind = opts.kind || "cancelled";
    b.status = "cancelled";
    b.cancelKind = kind;
    b.cancelledAt = at;
    b.cancelledBy = opts.by;
    b.cancelReason = opts.reason || "";
    b.refunded = false;
    if (opts.refund && b.cost > 0) {
      var occ = opts.occ || occurrence(b.occKey);
      var ch = child(b.childId);
      DB.ledger.push({
        id: nextId("T"), familyId: b.familyId, childId: b.childId, delta: b.cost, type: "refund", bookingId: b.id,
        reason: "Refund · " + (occ ? occ.name + " · " + formatDate(occ.date) : "cancelled class") + (ch ? " · " + ch.name : ""),
        by: opts.by, at: at
      });
      b.refunded = true;
    }
    if (opts.notify) {
      var o = opts.occ || occurrence(b.occKey);
      var who = child(b.childId);
      var cls = (o ? o.name : "a class") + " on " + formatDate(b.date) + " at " + HC.formatTime(b.time);
      var refund = b.refunded ? " — " + b.cost + " credit" + (b.cost === 1 ? "" : "s") + " refunded." : ".";
      notify(b.familyId, kind, kind === "removed"
        ? (who ? who.name : "Your child") + " was removed from " + cls + " by the studio" + refund
        : cls.charAt(0).toUpperCase() + cls.slice(1) + (who ? " (" + who.name + ")" : "") +
          " was cancelled by the studio" + refund, b.id, at);
    }
    rev++;
  }

  // Staff take one student out of a class (the class itself still runs).
  // opts: { by, refund (default true), reason, notify }
  function cancelBooking(id, opts) {
    opts = opts || {};
    var b = booking(id);
    if (!b) return fail("Booking not found.");
    if (b.status !== "booked") return fail("This booking is already cancelled.");
    doCancel(b, { by: opts.by, refund: opts.refund !== false, reason: opts.reason, notify: opts.notify, kind: "removed" });
    var ch = child(b.childId), occ = occurrence(b.occKey);
    audit(opts.by, "unassign", "Removed " + (ch ? ch.name : "student") + " from " + (occ ? occ.name : "class") + " · " +
      formatDate(b.date) + (b.refunded ? " (credit refunded)" : ""));
    commit({ type: "cancel", key: b.occKey });
    return { ok: true, booking: b };
  }

  /* ---------- attendance & notes ---------- */
  function setAttendance(bookingId, status, opts) {
    opts = opts || {};
    var b = booking(bookingId);
    if (!b) return fail("Booking not found.");
    if (status && !ATTENDANCE.some(function (a) { return a.id === status; })) return fail("Unknown attendance status.");
    b.attendance = status || null;
    b.attendanceBy = status ? opts.by : null;
    b.attendanceAt = status ? (opts.at || nowStamp()) : null;
    done(opts, { type: "attendance", key: b.occKey });
    return { ok: true, booking: b };
  }

  // Mark every unmarked active booking in a class with one status.
  function markAll(key, status, opts) {
    opts = opts || {};
    var n = 0;
    (idx().byOcc[key] || []).forEach(function (b) {
      if (b.status === "booked" && !b.attendance) {
        setAttendance(b.id, status, { by: opts.by, silent: true });
        n++;
      }
    });
    if (n) {
      var occ = occurrence(key);
      audit(opts.by, "attendance", "Marked " + n + " student" + (n === 1 ? "" : "s") + " " + status + " · " +
        (occ ? occ.name + " " + formatDate(occ.date) : ""));
      commit({ type: "attendance", key: key });
    }
    return { ok: true, count: n };
  }

  function notesFor(filter) {
    load();
    filter = filter || {};
    return DB.notes.filter(function (n) {
      if (filter.childId && n.childId !== filter.childId) return false;
      if (filter.occKey && n.occKey !== filter.occKey) return false;
      if (filter.by && n.by !== filter.by) return false;
      if (filter.shared != null && !!n.shared !== !!filter.shared) return false;
      return true;
    }).sort(function (a, b) { return (b.date + b.at).localeCompare(a.date + a.at); });
  }

  function noteForBooking(bookingId) {
    load();
    return DB.notes.find(function (n) { return n.bookingId === bookingId; }) || null;
  }

  // data: { childId, bookingId?, rating?, text, shared }
  function saveNote(data, opts) {
    opts = opts || {};
    load();
    var ch = child(data.childId);
    if (!ch) return fail("Student not found.");
    var text = String(data.text || "").trim();
    var rating = data.rating ? Math.max(1, Math.min(5, Math.round(+data.rating))) : null;
    if (!text && !rating) return fail("Add a rating or a note.");
    var b = data.bookingId ? booking(data.bookingId) : null;
    var existing = data.id ? DB.notes.find(function (n) { return n.id === data.id; })
      : b ? noteForBooking(b.id) : null;
    var at = opts.at || nowStamp();
    if (existing) {
      existing.text = text;
      existing.rating = rating;
      existing.shared = !!data.shared;
      existing.updatedAt = at;
      existing.updatedBy = opts.by;
      if (!opts.silent) audit(opts.by, "note", "Updated a note for " + ch.name);
      done(opts, { type: "note", childId: ch.id });
      return { ok: true, note: existing };
    }
    var n = {
      id: nextId("N"),
      childId: ch.id,
      bookingId: b ? b.id : null,
      occKey: b ? b.occKey : null,
      programmeId: b ? b.programmeId : null,
      date: b ? b.date : at.slice(0, 10),
      rating: rating,
      text: text,
      shared: !!data.shared,
      by: opts.by,
      at: at
    };
    DB.notes.push(n);
    if (!opts.silent) audit(opts.by, "note", "Added a " + (n.shared ? "shared" : "staff-only") + " note for " + ch.name);
    done(opts, { type: "note", childId: ch.id });
    return { ok: true, note: n };
  }

  function deleteNote(id, opts) {
    load();
    var i = DB.notes.findIndex(function (n) { return n.id === id; });
    if (i < 0) return fail("Note not found.");
    var gone = DB.notes.splice(i, 1)[0];
    var who = child(gone.childId);
    audit(opts && opts.by, "note", "Deleted a note for " + (who ? who.name : "a student"));
    commit({ type: "note" });
    return { ok: true };
  }

  // Attendance summary for a child across past classes.
  function attendanceStats(childId) {
    var s = { classes: 0, present: 0, late: 0, absent: 0, unmarked: 0, rate: null };
    pastBookings({ childId: childId }).forEach(function (b) {
      s.classes++;
      if (b.attendance) s[b.attendance]++; else s.unmarked++;
    });
    var marked = s.present + s.late + s.absent;
    s.rate = marked ? Math.round(((s.present + s.late) / marked) * 100) : null;
    return s;
  }

  /* ---------- parent notices ---------- */
  function notices(familyId, opts) {
    load();
    opts = opts || {};
    return DB.notices.filter(function (n) {
      return n.familyId === familyId && (!opts.unreadOnly || !n.read);
    }).sort(function (a, b) { return b.at.localeCompare(a.at); });
  }

  function markNoticesRead(familyId) {
    load();
    var changed = false;
    DB.notices.forEach(function (n) {
      if (n.familyId === familyId && !n.read) { n.read = true; changed = true; }
    });
    if (changed) commit({ type: "notices", familyId: familyId });
  }

  function auditLog(limit) {
    load();
    return DB.audit.slice().sort(function (a, b) {
      return b.at.localeCompare(a.at) || idNum(b.id) - idNum(a.id);
    }).slice(0, limit || 50);
  }

  function actorName(by) {
    if (!by || by === "system") return "System";
    if (by.indexOf("parent:") === 0) {
      var f = family(by.slice(7));
      return f ? f.parentName + " (parent)" : "Parent";
    }
    var s = staffById(by);
    return s ? s.name : by;
  }

  /* ============================================================
     REPORTS — credits not yet utilised, one row per family (shared pool)
     "Available": in the family's balance, not booked (never below 0).
     "Reserved":  already deducted for a class that hasn't started,
                  less any booked on a negative (unpaid) balance —
                  those aren't owed until the family tops up.
                  reservedTotal = every credit deducted for upcoming
                  classes; unpaid = the part not yet paid for.
     Unutilised = available + reserved.
     ============================================================ */
  function creditReport(opts) {
    opts = opts || {};
    var c = idx();
    var t = todayISO();
    var dormantDays = opts.dormantDays || 21;
    var monthStart = t.slice(0, 8) + "01";

    var rows = DB.families.map(function (f) {
      var available = c.balance[f.id] || 0;
      var kids = DB.children.filter(function (ch) { return ch.familyId === f.id && ch.active !== false; });
      var reserved = 0, lastClass = null, upcoming = 0;
      (c.byFamily[f.id] || []).forEach(function (b) {
        if (b.status !== "booked") return;
        if (!hasStarted(b)) { reserved += b.cost; upcoming++; }
        else if (!lastClass || b.date > lastClass) lastClass = b.date;
      });
      var paidCredits = 0, paidAmount = 0, lastPurchase = null, lastLedger = null, hadTrial = false;
      DB.ledger.forEach(function (l) {
        if (l.familyId !== f.id) return;
        if (!lastLedger || l.at > lastLedger) lastLedger = l.at;
        if (l.type === "trial") hadTrial = true;
        if (l.type === "purchase" || (l.type === "manual" && l.delta > 0 && l.amount > 0)) {
          paidCredits += l.delta; paidAmount += l.amount || 0;
          if (!lastPurchase || l.at > lastPurchase) lastPurchase = l.at;
        }
      });
      var unitPrice = paidCredits ? paidAmount / paidCredits : DEFAULT_UNIT_PRICE;
      // a negative balance means some upcoming bookings haven't been paid for yet
      var unpaid = available < 0 ? Math.min(reserved, -available) : 0;
      var unutilised = Math.max(0, available) + reserved - unpaid;
      var since = f.createdAt.slice(0, 10);
      var lastActivity = [lastClass, lastLedger && lastLedger.slice(0, 10)].filter(Boolean).sort().pop() || since;
      var idleDays = daysBetween(lastClass || since, t);
      return {
        family: f,
        children: kids,
        available: available,
        reserved: reserved - unpaid,
        reservedTotal: reserved,
        unpaid: unpaid,
        upcoming: upcoming,
        unutilised: unutilised,
        unitPrice: unitPrice,
        estValue: Math.round(unutilised * unitPrice * 100) / 100,
        lastPurchase: lastPurchase,
        lastClass: lastClass,
        lastActivity: lastActivity,
        idleDays: idleDays,
        dormant: available > 0 && upcoming === 0 && idleDays > dormantDays,
        trialOnly: !paidCredits && hadTrial
      };
    });

    var totals = rows.reduce(function (s, r) {
      s.available += Math.max(0, r.available);
      s.reserved += r.reserved;
      s.reservedTotal += r.reservedTotal;
      s.unpaid += r.unpaid;
      s.unutilised += r.unutilised;
      s.estValue += r.estValue;
      s.students += r.children.length;
      if (r.unutilised > 0) s.familiesWithCredits++;
      if (r.dormant) { s.dormantFamilies++; s.dormantCredits += r.available; }
      if (r.available < 0) s.negativeFamilies++;
      return s;
    }, { available: 0, reserved: 0, reservedTotal: 0, unpaid: 0, unutilised: 0, estValue: 0,
         families: rows.length, familiesWithCredits: 0, dormantFamilies: 0, dormantCredits: 0,
         negativeFamilies: 0, students: 0 });
    totals.estValue = Math.round(totals.estValue);

    // credit movement this calendar month
    var movement = { from: monthStart, to: t, purchased: 0, trial: 0, used: 0, refunded: 0, manualAdded: 0, manualDeducted: 0, revenue: 0 };
    DB.ledger.forEach(function (l) {
      var d = l.at.slice(0, 10);
      if (d < monthStart || d > t) return;
      if (l.type === "purchase") { movement.purchased += l.delta; movement.revenue += l.amount || 0; }
      else if (l.type === "trial") movement.trial += l.delta;
      else if (l.type === "booking") movement.used += -l.delta;
      else if (l.type === "refund") movement.refunded += l.delta;
      else if (l.type === "manual") {
        if (l.delta > 0) { movement.manualAdded += l.delta; movement.revenue += l.amount || 0; }
        else movement.manualDeducted += -l.delta;
      }
    });

    // available credits by days since any of the family's children last attended a class
    var aging = [
      { label: "0–14 days", min: 0, max: 14, credits: 0, families: 0 },
      { label: "15–30 days", min: 15, max: 30, credits: 0, families: 0 },
      { label: "31–60 days", min: 31, max: 60, credits: 0, families: 0 },
      { label: "60+ days", min: 61, max: Infinity, credits: 0, families: 0 }
    ];
    rows.forEach(function (r) {
      if (r.available <= 0) return;
      var bucket = aging.find(function (a) { return r.idleDays >= a.min && r.idleDays <= a.max; }) || aging[aging.length - 1];
      bucket.credits += r.available;
      bucket.families++;
    });

    return { asOf: t, rows: rows, totals: totals, movement: movement, aging: aging };
  }

  /* ============================================================
     SESSIONS (per app; parent and staff are independent)
     ============================================================ */
  // The signed-in staff member, if their account is still allowed in.
  function currentStaff() {
    var id = session.get("staff");
    var s = id && staffById(id);
    return s && s.active !== false && s.login ? s : null;
  }

  var session = {
    get: function (kind) {
      try { return localStorage.getItem(SESSION_KEYS[kind]) || null; } catch (e) { return null; }
    },
    set: function (kind, id) {
      try { localStorage.setItem(SESSION_KEYS[kind], id); } catch (e) {}
    },
    clear: function (kind) {
      try { localStorage.removeItem(SESSION_KEYS[kind]); } catch (e) {}
    }
  };

  function reset() {
    DB = seed();
    rev++;
    persist();
    emit({ type: "reset" });
  }

  function fail(msg, extra) {
    return Object.assign({ ok: false, error: msg }, extra || {});
  }

  /* ============================================================
     SEED — a believable studio: ~27 families, 6 weeks of classes
     with attendance, notes, purchases and a few staff changes.
     Deterministic relative to the current week.
     ============================================================ */
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // [parentName, email, phone, remainder, children[[name, age, level, programmes, extra]]]
  // remainder: roughly how many credits the family should still hold.
  var SEED_FAMILIES = [
    ["Jane Tan", "demo@huachengelite.com", "+65 8888 8888", 6, [
      ["Ethan Tan", 7, "Junior", ["wushu-jr"]],
      ["Chloe Tan", 5, "Junior", ["tots"]]]],
    ["Marcus Lim", "marcus.lim@example.com", "+65 9123 4501", 3, [
      ["Ryan Lim", 9, "Junior", ["wushu-jr", "flips-jr"]],
      ["Sophie Lim", 12, "Elite", ["wushu-elite", "cond-elite"]]]],
    ["Siti Rahman", "siti.rahman@example.com", "+65 9123 4502", 8, [
      ["Aisyah Iskandar", 10, "Junior", ["wushu-jr", "cond-jr"], { medical: "Mild asthma — inhaler in bag" }]]],
    ["Priya Nair", "priya.nair@example.com", "+65 9123 4503", 4, [
      ["Arjun Menon", 13, "Competitive", ["competitive", "wushu-elite", "flips-elite"]]]],
    ["Kevin Ong", "kevin.ong@example.com", "+65 9123 4504", 12, [
      ["Lucas Ong", 6, "Junior", ["wushu-jr"]],
      ["Mia Ong", 4, "Junior", ["tots"]]]],
    ["Grace Koh", "grace.koh@example.com", "+65 9123 4505", 0, [
      ["Isaac Koh", 11, "Elite", ["wushu-elite", "flips-elite"]]]],
    ["Daniel Wong", "daniel.wong@example.com", "+65 9123 4506", 9, [
      ["Nathan Wong", 14, "Competitive", ["competitive", "cond-elite"]]]],
    ["Michelle Chua", "michelle.chua@example.com", "+65 9123 4507", 2, [
      ["Hannah Chua", 8, "Junior", ["wushu-jr", "flips-jr"]]]],
    ["Ahmad Yusof", "ahmad.yusof@example.com", "+65 9123 4508", 5, [
      ["Rayyan Ahmad", 7, "Junior", ["wushu-jr"]]]],
    ["Rachel Goh", "rachel.goh@example.com", "+65 9123 4509", 14, [
      ["Caleb Goh", 5, "Junior", ["tots"]],
      ["Zoe Goh", 9, "Junior", ["wushu-jr", "cond-jr"]]]],
    ["Vincent Teo", "vincent.teo@example.com", "+65 9123 4510", 7, [
      ["Jayden Teo", 15, "Competitive", ["competitive", "wushu-elite", "cond-elite"]]]],
    ["Lakshmi Pillai", "lakshmi.pillai@example.com", "+65 9123 4511", 3, [
      ["Ananya Pillai", 10, "Elite", ["wushu-elite"]]]],
    ["Benjamin Ng", "ben.ng@example.com", "+65 9123 4512", 1, [
      ["Aiden Ng", 6, "Junior", ["wushu-jr"]],
      ["Emma Ng", 4, "Junior", ["tots"]]]],
    ["Joanne Seah", "joanne.seah@example.com", "+65 9123 4513", 10, [
      ["Clara Seah", 12, "Elite", ["wushu-elite", "flips-elite", "cond-elite"]]]],
    ["Farah Hassan", "farah.hassan@example.com", "+65 9123 4514", 4, [
      ["Irfan Hassan", 9, "Junior", ["flips-jr", "cond-jr"]]]],
    ["Alvin Yeo", "alvin.yeo@example.com", "+65 9123 4515", 2, [
      ["Evan Yeo", 13, "Competitive", ["competitive", "flips-elite"]]]],
    ["Cheryl Loh", "cheryl.loh@example.com", "+65 9123 4516", 6, [
      ["Megan Loh", 8, "Junior", ["wushu-jr", "flips-jr"]]]],
    ["Rajesh Kumar", "rajesh.kumar@example.com", "+65 9123 4517", 11, [
      ["Dev Kumar", 11, "Junior", ["wushu-jr", "cond-jr"]]]],
    ["Stephanie Pereira", "steph.pereira@example.com", "+65 9123 4518", 5, [
      ["Noah Pereira", 10, "Elite", ["wushu-elite", "flips-elite"]]]],
    ["Terence Low", "terence.low@example.com", "+65 9123 4519", 17, [
      ["Kayden Low", 5, "Junior", ["tots"], { lastWeek: -4 }]]],
    ["Chen Wei Ling", "weiling.chen@example.com", "+65 9123 4520", 8, [
      ["Chen Yu Xuan", 12, "Competitive", ["competitive", "wushu-elite"]]]],
    ["Nurul Huda", "nurul.huda@example.com", "+65 9123 4521", 3, [
      ["Adam Firdaus", 8, "Junior", ["wushu-jr", "cond-jr"]]]],
    ["Samuel Tay", "samuel.tay@example.com", "+65 9123 4522", 0, [
      ["Josiah Tay", 14, "Elite", ["wushu-elite", "cond-elite", "flips-elite"]]]],
    ["Angela Sim", "angela.sim@example.com", "+65 9123 4523", 9, [
      ["Elena Sim", 6, "Junior", ["tots", "wushu-jr"], { medical: "Nut allergy" }]]],
    ["Desmond Ho", "desmond.ho@example.com", "+65 9123 4524", 13, [
      ["Ren Ho", 16, "Competitive", ["competitive", "wushu-elite", "flips-elite", "cond-elite"]]]],
    ["Quek Pei Shan", "peishan.quek@example.com", "+65 9123 4525", 7, [
      ["Olivia Quek", 7, "Junior", ["wushu-jr"], { firstWeek: -2 }],
      ["Owen Quek", 10, "Junior", ["wushu-jr", "flips-jr"], { firstWeek: -2 }]]],
    ["Foo Hui Min", "huimin.foo@example.com", "+65 9123 4526", 0, [
      ["Lily Foo", 5, "Junior", [], { trialOnly: true }]]]
  ];

  // More regular families — keeps weekend and late-week rosters realistic.
  var MORE_FAMILIES = [
    ["Alicia Chan", "Jaden Chan", 8, ["wushu-jr", "flips-jr"], "Kate Chan", 5, ["tots"]],
    ["Bryan Toh", "Jonas Toh", 10, ["wushu-jr", "cond-jr"]],
    ["Carmen Yap", "Ashley Yap", 6, ["wushu-jr", "tots"], "Brandon Yap", 11, ["wushu-elite", "flips-elite"], "Elite", null],
    ["Derek Soh", "Liam Soh", 4, ["tots"]],
    ["Evelyn Kwek", "Sarah Kwek", 9, ["wushu-jr", "flips-jr"]],
    ["Faizal Omar", "Hakim Faizal", 7, ["wushu-jr"], "Nur Aina", 5, ["tots"]],
    ["Gina Lau", "Ethan Lau", 12, ["wushu-elite", "cond-elite"], null, null, null, null, "Elite"],
    ["Hafiz Rahim", "Danish Hafiz", 8, ["wushu-jr", "cond-jr"]],
    ["Irene Tang", "Faith Tang", 6, ["wushu-jr"]],
    ["Jason Poh", "Timothy Poh", 13, ["wushu-elite", "flips-elite", "cond-elite"], null, null, null, null, "Elite"],
    ["Karen Heng", "Isabelle Heng", 5, ["tots"], "Gabriel Heng", 9, ["wushu-jr", "flips-jr"]],
    ["Leonard Chia", "Matthew Chia", 11, ["wushu-jr", "cond-jr"]],
    ["Melissa Ang", "Sophia Ang", 4, ["tots"]],
    ["Nicholas Kok", "Ryan Kok", 7, ["wushu-jr"]],
    ["Anita Rao", "Aarav Rao", 10, ["wushu-elite"], null, null, null, null, "Elite"],
    ["Priscilla Wee", "Hayden Wee", 8, ["flips-jr", "wushu-jr"]],
    ["Zainal Abidin", "Iman Zainal", 6, ["tots", "wushu-jr"]],
    ["Serene Lye", "Natalie Lye", 12, ["wushu-elite", "flips-elite"], null, null, null, null, "Elite"],
    ["Gregory Fernandez", "Luke Fernandez", 9, ["wushu-jr", "cond-jr"]],
    ["Janice Pang", "Ella Pang", 5, ["tots"], "Max Pang", 7, ["wushu-jr", "tots"]],
    ["Kelvin Sng", "Bryson Sng", 10, ["wushu-jr", "flips-jr", "cond-jr"]],
    ["Lee Shu Fen", "Lee Kai Wen", 11, ["wushu-elite", "cond-elite"], null, null, null, null, "Elite"]
  ];

  function expandMoreFamilies() {
    return MORE_FAMILIES.map(function (r, i) {
      var parts = r[0].toLowerCase().split(" ");
      var email = parts[0] + "." + parts.slice(1).join("") + "@example.com";
      var phone = "+65 9123 45" + pad(27 + i);
      var level1 = r[8] || "Junior";
      var kids = [[r[1], r[2], level1, r[3]]];
      if (r[4]) kids.push([r[4], r[5], r[7] || "Junior", r[6]]);
      return [r[0], email, phone, (i * 7) % 13, kids];
    });
  }

  var NOTE_TEXTS = [
    [5, "Excellent focus today — stances were low and stable through the whole routine."],
    [4, "Good progress on the jump kick; needs to land softer on the left foot."],
    [3, "Steady session. Keep practising the bow stance transitions at home."],
    [4, "Much sharper hand forms this week. Ready to start the next section of the routine."],
    [2, "Distracted in the second half — worth a chat about listening during drills."],
    [5, "Nailed the tornado kick for the first time. Great confidence!"],
    [4, "Flexibility improving well; keep up the daily stretching."],
    [3, "Staff work is getting cleaner. Grip still slips on fast spins."],
    [4, "Showed great leadership helping the younger students warm up."],
    [3, "Balance on one-leg stances needs more work — practise 3×30s each side."],
    [5, "Competition-ready butterfly kick. Height and rotation both excellent."],
    [4, "Good stamina through conditioning; push-ups form is much better."],
    [2, "Came in tired — shorter session. Please make sure of rest before class."],
    [4, "Sword routine memorised end to end. Next: rhythm and expression."],
    [3, "Cartwheel is consistent; aerial still needs spotting."],
    [5, "Outstanding effort — one of the best sessions this term."]
  ];

  var PACK_SIZES = [20, 10, 5];

  function tierOf(level) {
    return level === "Competitive" ? "competitive" : level === "Elite" ? "elite" : "junior";
  }

  function seed() {
    var rnd = mulberry32(20260916);
    DB = {
      version: VERSION,
      seededAt: nowStamp(),
      seq: 0,
      families: [], children: [], ledger: [], bookings: [],
      staff: (HC.staff || []).map(function (s) {
        return Object.assign({ phone: "", active: true, login: true, createdAt: null }, s);
      }),
      templateCoach: {},
      coachAliases: {},
      overrides: {}, seriesEnds: {}, oneOffs: [], leaves: [],
      notes: [], notices: [], audit: []
    };
    rev++;

    var today = todayISO();
    var ws0 = weekStart(today);
    var meta = {}; // childId → seeding hints

    // ---- families & children ----
    SEED_FAMILIES.concat(expandMoreFamilies()).forEach(function (row, fi) {
      var created = addDays(ws0, -160 + fi * 2) + "T10:00";
      var f = { id: nextId("F"), parentName: row[0], email: row[1], phone: row[2], createdAt: created };
      DB.families.push(f);
      f._remainder = row[3];
      row[4].forEach(function (cr) {
        var extra = cr[4] || {};
        var c = {
          id: nextId("C"), familyId: f.id, name: cr[0], age: cr[1], level: cr[2],
          programmes: cr[3].slice(), medical: extra.medical || "", active: true
        };
        DB.children.push(c);
        meta[c.id] = {
          firstWeek: extra.firstWeek != null ? extra.firstWeek : -99,
          lastWeek: extra.lastWeek != null ? extra.lastWeek : 99,
          cap: c.level === "Competitive" ? 4 : c.level === "Elite" ? 3 : 2,
          trialOnly: !!extra.trialOnly
        };
        if (extra.firstWeek != null) f.createdAt = addDays(ws0, extra.firstWeek * 7 - 14) + "T19:20";
        if (extra.trialOnly) f.createdAt = addDays(today, -2) + "T21:05";
      });
    });
    rev++;

    // ---- bookings over six weeks ----
    var FILL = { "-4": 0.8, "-3": 0.85, "-2": 0.85, "-1": 0.9, "0": 0.85, "1": 0.5, "2": 0.2 };
    var nowS = nowStamp();
    // The scripted staff changes further down (block / leave / delete next week)
    // happen at most this many hours ago; bookings for coming weeks are made
    // before them so no refund predates its charge.
    var CHANGES_FROM = 30;
    var futureLatest = hoursAgo(CHANGES_FROM + 1);
    [-4, -3, -2, -1, 0, 1, 2].forEach(function (w) {
      var load = {};
      // visit the week's classes in a shuffled order so weekly caps don't
      // leave the end of the week empty
      var slots = HC.schedule.map(function (t) { return { t: t, r: rnd() }; })
        .sort(function (a, b) { return a.r - b.r; });
      slots.forEach(function (slot) {
        var t = slot.t;
        var date = addDays(ws0, w * 7 + t.day);
        var target = Math.min(t.capacity, Math.round(t.booked * FILL[w] * (0.85 + rnd() * 0.3)));
        var pool = DB.children.filter(function (c) {
          var m = meta[c.id];
          return c.programmes.indexOf(t.programmeId) >= 0 && !m.trialOnly &&
            w >= m.firstWeek && w <= m.lastWeek && (load[c.id] || 0) < m.cap;
        });
        pool.forEach(function (c) { c._r = rnd(); });
        pool.sort(function (a, b) { return (load[a.id] || 0) - (load[b.id] || 0) || a._r - b._r; });
        pool.slice(0, target).forEach(function (c) {
          load[c.id] = (load[c.id] || 0) + 1;
          var at = addDays(date, -(1 + Math.floor(rnd() * 6))) + "T" + pad(8 + Math.floor(rnd() * 14)) + ":" + pad(Math.floor(rnd() * 60));
          if (at > nowS) at = hoursAgo(1 + Math.floor(rnd() * 40));
          // (no extra rnd() here — it would reshuffle the rest of the seed)
          if (w > 0 && at > futureLatest) at = hoursAgo(CHANGES_FROM + 1 + DB.seq % 40);
          DB.bookings.push({
            id: nextId("B"), occKey: occKey(date, t.id), date: date, time: t.time,
            templateId: t.id, oneOffId: null, programmeId: t.programmeId,
            childId: c.id, familyId: c.familyId, status: "booked", cost: 1,
            source: rnd() < 0.9 ? "parent" : "staff",
            by: null, at: at, attendance: null
          });
        });
      });
    });
    DB.children.forEach(function (c) { delete c._r; });

    // ---- ledger: the family buys packs before they're needed, then each booking ----
    DB.families.forEach(function (f) {
      var kids = DB.children.filter(function (c) { return c.familyId === f.id; });
      var tier = tierOf(kids.reduce(function (top, c) {
        return LEVELS.indexOf(c.level) > LEVELS.indexOf(top) ? c.level : top;
      }, "Junior"));
      var fb = DB.bookings.filter(function (b) { return b.familyId === f.id; })
        .sort(function (a, b) { return a.at.localeCompare(b.at); });
      var remainder = f._remainder;
      delete f._remainder;
      var bal = 0;

      function buy(at, size) {
        var price = TIER_PACKS[tier][size];
        DB.ledger.push({
          id: nextId("T"), familyId: f.id, childId: null, delta: size, type: "purchase",
          packageId: tier + "-" + size, amount: price, unitPrice: price / size,
          reason: size + " Classes · " + TIER_LABEL[tier] + " (PayNow)",
          by: "parent:" + f.id, at: at
        });
        bal += size;
      }
      function pickSize(left) {
        return PACK_SIZES.find(function (s) { return s <= Math.max(5, left); }) || 5;
      }

      if (kids.every(function (c) { return meta[c.id].trialOnly; })) {
        DB.ledger.push({ id: nextId("T"), familyId: f.id, childId: null, delta: 1, type: "trial", amount: 0,
          reason: "Free trial credit", by: "system", at: f.createdAt });
        return;
      }
      if (f.email === "terence.low@example.com") {
        // dormant: topped up big, then stopped coming
        buy(addDays(ws0, -40) + "T20:14", 20);
      }
      var left = fb.length + remainder;
      fb.forEach(function (b, i) {
        if (bal < 1) {
          var size = pickSize(left);
          var at = i === 0
            ? addDays(b.at.slice(0, 10), -2) + "T" + pad(9 + (i % 10)) + ":1" + (i % 10)
            : addDays(b.at.slice(0, 10), -1) + "T" + pad(9 + (i % 10)) + ":2" + (i % 10);
          buy(at, size);
          left -= size;
        }
        bal -= 1;
        var occName = (HC.getProgramme(b.programmeId) || {}).name;
        var ch = DB.children.find(function (c) { return c.id === b.childId; });
        b.by = b.source === "staff" ? staffIdForTemplate(b.templateId) : "parent:" + f.id;
        DB.ledger.push({
          id: nextId("T"), familyId: f.id, childId: b.childId, delta: -1, type: "booking", bookingId: b.id,
          reason: occName + " · " + formatDate(b.date) + " " + HC.formatTime(b.time) + " · " + ch.name,
          by: b.by, at: b.at
        });
      });
      if (bal < remainder) {
        var gap = remainder - bal;
        var size = PACK_SIZES.slice().reverse().find(function (s) { return s >= gap; }) || 20;
        buy(hoursAgo(24 * (3 + (f.id.length + fb.length) % 9)), size);
      }
    });

    // Coach A covers Coach B's Friday elite class this week — set before the
    // register is filled in, so Coach A is the one who marks it
    substituteCoach(occKey(addDays(ws0, 4), "f2"), "Coach A", { by: "admin", at: hoursAgo(70), silent: true });

    // the staff member who actually taught a booking's class (cover included)
    function teacherId(b) {
      var ov = DB.overrides[b.occKey];
      var s = ov && ov.coach ? staffForCoach(ov.coach) : null;
      return s ? s.id : staffIdForTemplate(b.templateId);
    }

    // ---- attendance on classes that have finished (leave the last day open) ----
    // Today's classes stay unmarked, plus yesterday's last class (a small "to do").
    var nowM = nowMinutes();
    var yesterday = addDays(today, -1);
    var lastYesterday = HC.schedule.filter(function (t) { return t.day === dayIndex(yesterday); })
      .map(function (t) { return t.time; }).sort().pop();
    DB.bookings.forEach(function (b) {
      var prog = HC.getProgramme(b.programmeId) || {};
      var ended =b.date < today || (b.date === today && nowM >= toMinutes(b.time) + (prog.duration || 60));
      if (!ended || b.date === today || (b.date === yesterday && b.time === lastYesterday)) return;
      var r = rnd();
      // the demo family (first seed row) keeps a near-perfect record for walkthroughs
      if (b.familyId === DB.families[0].id) r = r * 0.9;
      b.attendance = r < 0.86 ? "present" : r < 0.92 ? "late" : "absent";
      b.attendanceBy = teacherId(b);
      b.attendanceAt = b.date + "T" + fromMinutes(Math.min(toMinutes(b.time) + 10, 23 * 60));
    });

    // ---- coach notes on recent attended classes ----
    var attended = DB.bookings.filter(function (b) {
      return b.attendance === "present" && b.date >= addDays(ws0, -21);
    });
    var picked = {};
    for (var n = 0; n < 22 && attended.length; n++) {
      var b = attended[Math.floor(rnd() * attended.length)];
      if (picked[b.id]) continue;
      picked[b.id] = 1;
      var nt = NOTE_TEXTS[n % NOTE_TEXTS.length];
      DB.notes.push({
        id: nextId("N"), childId: b.childId, bookingId: b.id, occKey: b.occKey, programmeId: b.programmeId,
        date: b.date, rating: nt[0], text: nt[1], shared: rnd() < 0.7,
        by: teacherId(b),
        at: b.date + "T" + fromMinutes(Math.min(toMinutes(b.time) + 95, 23 * 60 + 30))
      });
    }
    // make sure the demo parent has something to read
    var demo = DB.families[0];
    var ethan = DB.children.find(function (c) { return c.familyId === demo.id; });
    var ethanPast = DB.bookings.filter(function (b) {
      return b.childId === ethan.id && b.attendance === "present";
    }).sort(function (a, b) { return b.date.localeCompare(a.date); })[0];
    var ethanNote = ethanPast && DB.notes.find(function (x) { return x.bookingId === ethanPast.id; });
    if (ethanNote) {
      ethanNote.shared = true;
    } else if (ethanPast) {
      DB.notes.push({
        id: nextId("N"), childId: ethan.id, bookingId: ethanPast.id, occKey: ethanPast.occKey,
        programmeId: ethanPast.programmeId, date: ethanPast.date, rating: 4,
        text: "Great energy today, Ethan! Front stance is much deeper — keep practising the punch combination at home.",
        shared: true, by: teacherId(ethanPast), at: ethanPast.date + "T" + fromMinutes(toMinutes(ethanPast.time) + 80)
      });
    }
    rev++;

    // ---- a few manual credit adjustments ----
    var famOf = function (childName) {
      return DB.children.find(function (c) { return c.name === childName; }).familyId;
    };
    adjustCredits(famOf("Ryan Lim"), -1, {
      reason: "Late cancellation / no-show", note: "Ryan missed Flips & Jumps without notice.",
      by: "admin", at: hoursAgo(9), silent: true
    });
    adjustCredits(famOf("Dev Kumar"), 5, {
      reason: "Payment received at studio", note: "Cash at front desk — receipt #0418.", amount: 220,
      by: "admin", at: addDays(today, -6) + "T18:40", silent: true
    });
    adjustCredits(famOf("Jayden Teo"), -2, {
      reason: "Private 1-to-1 lesson", note: "Extra competition prep session.",
      by: "admin", at: hoursAgo(3), silent: true
    });
    adjustCredits(famOf("Hannah Chua"), 1, {
      reason: "Make-up / goodwill credit", note: "Class ran short due to aircon fault.",
      by: "admin", at: addDays(today, -2) + "T10:30", silent: true
    });

    // ---- staff changes across the coming fortnight ----
    var nw = addDays(ws0, 7);
    // Coach A blocks next Thursday's first class; make sure the demo family is affected
    var blockKey = occKey(addDays(nw, 3), "h1");
    if (!DB.bookings.some(function (b) { return b.occKey === blockKey && b.childId === ethan.id; })) {
      DB.ledger.push({ id: nextId("T"), familyId: demo.id, childId: null, delta: 5, type: "purchase", packageId: "junior-5",
        amount: 220, unitPrice: 44, reason: "5 Classes · Junior (PayNow)", by: "parent:" + demo.id, at: hoursAgo(50) });
      rev++;
      book(blockKey, ethan.id, { by: "parent:" + demo.id, at: hoursAgo(49), silent: true });
    }
    blockOccurrence(blockKey, { by: "coach-a", reason: "Coaching at national team selection", at: hoursAgo(20), silent: true });

    // Coach B on leave next Wednesday
    addLeave({ coach: "Coach B", date: addDays(nw, 2), reason: "Competition judging duty" },
      { by: "coach-b", at: hoursAgo(CHANGES_FROM), silent: true, allowPast: true });

    // Next Sunday's junior conditioning is deleted for that date only
    removeOccurrence(occKey(addDays(nw, 6), "u3"), { by: "admin", reason: "Hall booked for grading", at: hoursAgo(12), silent: true });

    // One-off classes
    addOneOff({ date: addDays(nw, 5), time: "19:30", programmeId: "competitive", coach: "Coach B",
      capacity: 6, duration: 120, note: "Extra competition prep before nationals" },
      { by: "coach-b", at: hoursAgo(26), silent: true, allowPast: true });
    var prep = DB.oneOffs[DB.oneOffs.length - 1];
    DB.children.filter(function (c) { return c.level === "Competitive"; }).slice(0, 3).forEach(function (c, i) {
      book(occKey(prep.date, prep.id), c.id, { by: "parent:" + c.familyId, at: hoursAgo(20 - i * 4), silent: true });
    });
    addOneOff({ date: addDays(ws0, 6), time: "17:00", programmeId: "flips-jr", coach: "Coach A",
      capacity: 12, duration: 60, note: "Holiday skills clinic" },
      { by: "coach-a", at: hoursAgo(60), silent: true, allowPast: true });

    // seeded audit trail entries for context
    audit("coach-a", "attendance", "Marked attendance · Wushu Junior " + formatDate(addDays(today, -2)), hoursAgo(40));
    audit("coach-b", "attendance", "Marked attendance · Wushu Elite " + formatDate(addDays(today, -2)), hoursAgo(38));

    return DB;
  }

  function staffIdForTemplate(templateId) {
    var t = template(templateId);
    var s = t && staffForCoach(resolveTag(t.coach));
    return s ? s.id : "admin";
  }

  /* ============================================================
     PUBLIC API
     ============================================================ */
  HC.db = {
    // lifecycle
    load: function () { load(); return true; },
    reset: reset,
    onChange: function (fn) { listeners.push(fn); return function () { listeners = listeners.filter(function (f) { return f !== fn; }); }; },
    session: session,
    dump: function () { return JSON.parse(JSON.stringify(load())); },

    // dates
    todayISO: todayISO, addDays: addDays, dayIndex: dayIndex, weekStart: weekStart,
    weekDates: weekDates, daysBetween: daysBetween, formatDate: formatDate,
    formatStamp: formatStamp, nowStamp: nowStamp, toMinutes: toMinutes, fromMinutes: fromMinutes,

    // reference
    staff: staff, coaches: coaches, coachNames: coachNames, currentStaff: currentStaff,
    staffById: staffById, staffForCoach: staffForCoach,
    addCoach: addCoach, updateCoach: updateCoach, assignWeeklyClass: assignWeeklyClass,
    weeklyClassesFor: weeklyClassesFor, coachCommitments: coachCommitments,
    attendanceStatuses: ATTENDANCE, noteScale: NOTE_SCALE, adjustReasons: ADJUST_REASONS,
    levels: LEVELS, tierPacks: TIER_PACKS,
    can: can, actorName: actorName, levelFits: levelFits,

    // classes
    occKey: occKey, occurrence: occurrence,
    occurrencesForDate: occurrencesForDate, occurrencesForRange: occurrencesForRange,
    occurrencesForWeek: occurrencesForWeek,
    blockOccurrence: blockOccurrence, unblockOccurrence: unblockOccurrence,
    removeOccurrence: removeOccurrence, restoreOccurrence: restoreOccurrence,
    substituteCoach: substituteCoach, addOneOff: addOneOff, clashes: clashes, seriesEnd: seriesEnd,

    // leave
    leaves: leaves, leaveFor: leaveFor, leaveImpact: leaveImpact, addLeave: addLeave, removeLeave: removeLeave,

    // people
    families: families, family: family, familyByEmail: familyByEmail,
    createFamily: createFamily, updateFamily: updateFamily,
    children: children, child: child, addChild: addChild, updateChild: updateChild,
    removeChild: removeChild, searchChildren: searchChildren,

    // credits
    balance: balance, ledger: ledger, ledgerWithBalance: ledgerWithBalance,
    packagesFor: packagesFor, familyTiers: familyTiers,
    adjustCredits: adjustCredits, purchase: purchase, hasClaimedTrial: hasClaimedTrial,
    trialEligible: trialEligible,

    // bookings
    booking: booking, bookings: bookings, upcomingBookings: upcomingBookings,
    pastBookings: pastBookings, roster: roster, book: book, cancelBooking: cancelBooking,
    hasStarted: hasStarted,

    // attendance & notes
    setAttendance: setAttendance, markAll: markAll, attendanceStats: attendanceStats,
    notes: notesFor, noteForBooking: noteForBooking, saveNote: saveNote, deleteNote: deleteNote,

    // notices / audit / reports
    notices: notices, markNoticesRead: markNoticesRead, auditLog: auditLog,
    creditReport: creditReport
  };
})();
