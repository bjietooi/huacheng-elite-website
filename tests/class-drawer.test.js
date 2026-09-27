/* The class drawer (admin/js/class-drawer.js) — v4: typed credits and private sessions.
   Covers the header/state/attendance indicators, marking attendance, remarks (the class
   coach writes them, admins read them), adding and removing students with the right
   wallet, private 1-to-1 sessions, camp groups and the coach/admin permission split. */
const assert = require("assert");
const { openConsole } = require("./dom-harness.js");

let checks = 0;
const ok = (cond, msg) => { checks++; assert.ok(cond, msg); };
const eq = (a, b, msg) => { checks++; assert.strictEqual(a, b, msg + " (got " + JSON.stringify(a) + ", want " + JSON.stringify(b) + ")"); };

const NOON = "2026-10-06T12:00";          // a Tuesday, before the afternoon timetable
const T = 60;

/* ---------- helpers ---------- */
const rows = (c) => c.$$("#drawer .cd-roster:not(.cd-roster--cancelled) > .cd-stu");
const squash = (s) => String(s || "").replace(/\s+/g, "");
const toasts = (c) => c.text("#toastWrap");
const famOf = (db, familyId) => (db.family(familyId) || {}).parentName + "'s family";

async function open(c, key) { c.Admin.openClass(key); await c.tick(T); }

function pick(c, childId) {
  const r = c.$('#cdAssignResults input[value="' + childId + '"]');
  assert.ok(r, "pick: child not listed " + childId);
  r.checked = true;
  r.dispatchEvent(new c.window.Event("change", { bubbles: true }));
  return r;
}

// a click from a forged button — the drawer must refuse it, not act on it
function forge(c, attrs) {
  const btn = c.document.createElement("button");
  Object.keys(attrs).forEach((k) => btn.setAttribute(k, attrs[k]));
  c.$("#drawer .cd").appendChild(btn);
  c.click(btn);
}

function stubSchedule(c) {
  const calls = [];
  ["blockClass", "unblockClass", "deleteClass", "restoreClass", "substituteCoach"].forEach((n) => {
    c.Admin[n] = function (key) { calls.push([n, key]); };
  });
  return calls;
}

function fixtures(c) {
  const db = c.HC.db;
  const t = db.todayISO(), ws = db.weekStart(t), nw = db.addDays(ws, 7);
  const next = db.occurrencesForRange(nw, db.addDays(nw, 6), { includeRemoved: true });
  const past = db.occurrencesForRange(db.addDays(t, -7), db.addDays(t, -1), {});
  return {
    db, t, nw,
    futureA: next.find((o) => o.coach === "Coach A" && o.status === "open" && !o.oneOff && !o.substituted && o.booked >= 3),
    futureB: next.find((o) => o.coach === "Coach B" && o.status === "open" && !o.oneOff && !o.substituted && o.booked >= 1),
    eliteA: next.find((o) => o.status === "open" && o.creditType === "elite" && o.booked >= 1),
    passedA: past.filter((o) => o.coach === "Coach A" && o.status === "open" && o.booked >= 3).pop(),
    passedB: past.filter((o) => o.coach === "Coach B" && o.status === "open" && o.booked >= 2).pop(),
    blocked: next.find((o) => o.status === "blocked" && o.blockKind === "manual"),
    leave: next.find((o) => o.status === "blocked" && o.blockKind === "leave"),
    removed: next.find((o) => o.status === "removed"),
    private: db.occurrencesForRange(t, db.addDays(t, 28), {}).filter((o) => o.programmeId === "private"),
  };
}

(async () => {
  /* ============================================================
     1. Header, state bar, typed credit cost, roster wallets
     ============================================================ */
  {
    const c = await openConsole({ staff: "admin", hash: "#today", now: NOON });
    const f = fixtures(c);
    const occ = f.futureA;
    ok(occ && occ.creditType, "fixture: a future Coach A class with a credit type");
    await open(c, occ.key);
    ok(c.Admin.drawerOpen() && c.$("#drawer").classList.contains("drawer--wide"), "the drawer opens wide");
    eq(c.text("#drawerTitle"), occ.name, "title is the programme");
    const sub = c.text("#drawer .drawer__sub");
    ok(sub.includes(f.db.formatDate(occ.date, "long")) && sub.includes(c.Admin.fmt.timeRange(occ)), "header: date and time");
    ok(sub.includes("Coach A"), "header: coach");
    eq(c.text("#drawer .drawer__sub .chip--state"), "Upcoming", "header: Upcoming chip");

    ok(c.$("#drawer .cd-state--upcoming"), "state bar: upcoming");
    const days = f.db.daysBetween(f.t, occ.date);
    eq(c.text("#drawer .cd-state__when"),
      days === 1 ? "Starts tomorrow at " + c.HC.formatTime(occ.time) : "Starts in " + days + " days", "state bar: when");
    ok(!c.$("#drawer .cd-state__att"), "no attendance indicator before the class starts");

    // typed credit cost
    const cost = c.$$("#drawer .cd-sum").find((el) => el.textContent.includes("Credit cost"));
    ok(cost.textContent.includes("◆" + occ.cost), "summary: credit cost");
    eq(cost.querySelector(".chip--credit").textContent.trim(), f.db.creditTypeShort(occ.creditType), "summary: the credit type chip");
    ok(cost.textContent.includes("per student"), "summary: per student");

    // roster rows show the family's wallet OF THIS CLASS'S TYPE
    eq(rows(c).length, occ.booked, "one row per booking");
    const walletsOk = rows(c).every((row) => {
      const b = f.db.booking(row.getAttribute("data-booking"));
      const want = f.db.creditTypeShort(occ.creditType) + "◆" + f.db.balance(b.familyId, occ.creditType);
      return squash(row.querySelector(".cd-bal").textContent) === want;
    });
    ok(walletsOk, "each row shows that family's wallet for this class's credit type");
    const first = f.db.booking(rows(c)[0].getAttribute("data-booking"));
    const tip = rows(c)[0].querySelector(".cd-bal").title;
    ok(tip.startsWith(famOf(f.db, first.familyId)), "wallet tooltip names the family");
    const others = f.db.balances(first.familyId).filter((w) => w.type.id !== occ.creditType);
    ok(others.length ? others.every((w) => tip.includes(w.type.name + " " + w.credits)) : tip.includes("No other credits"),
      "wallet tooltip lists their other credits");
    ok(rows(c).every((row) => {
      const link = row.querySelector("[data-open-family]");
      return !link || link.getAttribute("data-child") === f.db.booking(row.getAttribute("data-booking")).childId;
    }), "parent links carry the child");
    ok(c.$("#drawer .cd-stu__phone a[href^='tel:']"), "the phone number is a dial link on its own line");
    ok(!c.$("#drawer .att") && !c.$('#drawer [data-cd-action="note"]'), "no attendance or remarks before the class starts");
    ok(c.text("#drawer").includes("Attendance opens"), "says when attendance opens");
    eq(c.errors.length, 0, "no page errors: " + c.errors.join("\n"));
    c.close();
  }

  /* ============================================================
     2. Attendance: the class coach and admins mark it
     ============================================================ */
  {
    const c = await openConsole({ staff: "coach-a", hash: "#schedule", now: NOON });
    const f = fixtures(c);
    const occ = f.passedA;
    ok(occ && occ.ended, "fixture: a Coach A class that has ended");
    const roster = f.db.roster(occ.key);
    roster.forEach((r) => f.db.setAttendance(r.booking.id, null, { by: "coach-a" }));
    await open(c, occ.key);

    eq(c.text("#drawer .drawer__sub .chip--state"), "Passed", "header: Passed chip");
    const ago = -f.db.daysBetween(f.t, occ.date);
    eq(c.text("#drawer .cd-state__when"), ago === 1 ? "Ended yesterday" : "Ended " + ago + " days ago", "state bar: when");
    ok(c.$("#drawer .cd-state--todo"), "state bar flags attendance still to mark");
    eq(c.text("#drawer .cd-state__att .att-badge--todo"), "0 of " + roster.length + " marked", "attendance indicator counts");
    eq(c.$$("#drawer .att").length, roster.length, "an attendance group on every row");

    const b0 = roster[0].booking.id;
    c.click("#cdAtt-" + b0 + "-late");
    await c.tick(T);
    eq(f.db.booking(b0).attendance, "late", "Late recorded");
    eq(f.db.booking(b0).attendanceBy, "coach-a", "recorded against the coach");
    eq(c.$("#cdAtt-" + b0 + "-late").getAttribute("aria-pressed"), "true", "the pressed state survives the re-render");
    c.click("#cdAtt-" + b0 + "-late");
    await c.tick(T);
    eq(f.db.booking(b0).attendance, null, "clicking the pressed status clears it");
    c.click("#cdAtt-" + b0 + "-present");
    await c.tick(T);
    eq(f.db.booking(b0).attendance, "present", "Present recorded");

    c.click("#cdMarkAll");
    await c.tick(T);
    eq(f.db.roster(occ.key).filter((r) => !r.booking.attendance).length, 0, "mark all covers everyone left");
    eq(c.text("#drawer .cd-state__att .att-badge--done"), "All marked", "indicator: All marked");
    ok(!c.$("#cdMarkAll"), "mark all disappears when nothing is unmarked");
    ok(c.text("#drawer .cd-state__d").match(/\d+ present · \d+ late · \d+ absent/), "the breakdown is shown");
    eq(c.errors.length, 0, "no page errors: " + c.errors.join("\n"));
    const storage = c.storage;
    c.close();

    // an admin marks attendance too, but never writes remarks
    const a = await openConsole({ staff: "admin", hash: "#today", now: NOON, storage });
    const fa = fixtures(a);
    await open(a, occ.key);
    ok(!a.Admin.can("notes", fa.db.occurrence(occ.key)), "an admin cannot write remarks");
    ok(a.$("#drawer .att"), "an admin can mark attendance");
    a.click("#cdAtt-" + b0 + "-absent");
    await a.tick(T);
    eq(fa.db.booking(b0).attendance, "absent", "admin marked attendance");
    eq(a.errors.length, 0, "no page errors: " + a.errors.join("\n"));
    a.close();
  }

  /* ============================================================
     3. Remarks: the class coach writes them, admins read them
     ============================================================ */
  {
    const c = await openConsole({ staff: "coach-a", hash: "#schedule", now: NOON });
    const f = fixtures(c);
    const occ = f.passedA;
    const roster = f.db.roster(occ.key);
    roster.forEach((r) => { const n = f.db.noteForBooking(r.booking.id); if (n) f.db.deleteNote(n.id); });
    f.db.saveNote({ childId: roster[2].child.id, bookingId: roster[2].booking.id, rating: 3, text: "Coach B wrote <i>this</i>", shared: false }, { by: "coach-b" });
    const mine = roster[0].booking.id, theirs = roster[2].booking.id;
    await open(c, occ.key);
    ok(c.Admin.can("notes", f.db.occurrence(occ.key)), "the class coach may write remarks");

    eq(c.text("#cdNote-" + mine), "Add remark", "Add remark on a row without one");
    c.click("#cdNote-" + mine);
    await c.tick();
    eq(c.text("#modalTitle"), "Add remark", "the remark editor opens");
    ok(!c.$("#cdNoteShared").checked, "sharing with the parent starts unticked");
    ok(c.text("#modalCard").includes("Leave unticked to keep it staff-only"), "the share hint explains");
    c.click("#cdNoteSave");
    await c.tick();
    ok(c.text("#cdNoteError").includes("Add a rating or a few words"), "an empty remark is refused");
    c.input('input[name="cdRate"][value="4"]', true);
    c.input("#cdNoteText", "Great <script>x</script> kicks");
    c.click("#cdNoteSave");
    await c.tick(T);
    const note = f.db.noteForBooking(mine);
    ok(note && note.rating === 4 && note.by === "coach-a", "the remark is saved against the coach");
    eq(note.shared, false, "not shared unless the coach ticks the box");
    ok(toasts(c).includes("staff only"), "the toast says it is staff only");
    const row = () => c.$('#drawer .cd-stu[data-booking="' + mine + '"]');
    ok(row().textContent.includes("Great <script>x</script> kicks"), "the text is shown as typed");
    ok(!row().querySelector("script"), "nothing is injected");

    c.click("#cdNote-" + mine);
    await c.tick();
    c.input("#cdNoteShared", true);
    c.click("#cdNoteSave");
    await c.tick(T);
    eq(f.db.noteForBooking(mine).shared, true, "ticking the box shares it with the parent");
    ok(row().textContent.includes("Shared with parent"), "the row shows it is shared");

    c.click("#cdNote-" + mine);
    await c.tick();
    c.click("#cdNoteDelete");
    await c.tick();
    ok(c.text("#modalCard").includes("Delete this remark?"), "deleting asks first");
    c.click("#confirmOk");
    await c.tick(T);
    ok(!f.db.noteForBooking(mine), "the remark is deleted");

    // someone else's remark is read-only, even for the class coach
    ok(!c.$("#cdNote-" + theirs), "no edit button on another coach's remark");
    const other = c.$('#drawer .cd-stu[data-booking="' + theirs + '"]');
    ok(other.textContent.includes("Coach B wrote <i>this</i>"), "the other coach's remark is readable");
    eq(c.text('#drawer .cd-stu[data-booking="' + theirs + '"] .cd-note__lock'), "Only Coach B can change this remark", "it says who may change it");
    forge(c, { "data-cd-action": "note", "data-booking": theirs });
    await c.tick();
    ok(!c.Admin.modalOpen() && toasts(c).includes("Only Coach B"), "a forged edit is refused");
    eq(c.errors.length, 0, "no page errors: " + c.errors.join("\n"));
    const storage = c.storage;
    c.close();

    // the admin reads every remark but has no way to write one
    const a = await openConsole({ staff: "admin", hash: "#today", now: NOON, storage });
    const fa = fixtures(a);
    await open(a, occ.key);
    ok(!a.$('#drawer [data-cd-action="note"]'), "no Add or Edit remark for an admin");
    ok(a.text("#cdRemarkHint").includes("Remarks are written by the class coach (Coach A)"), "the drawer explains why");
    ok(a.text("#drawer").includes("Coach B wrote <i>this</i>"), "the admin still reads the remark");
    forge(a, { "data-cd-action": "note", "data-booking": theirs });
    await a.tick();
    ok(!a.Admin.modalOpen() && a.text("#toastWrap").includes("Remarks are written by the class coach"), "a forged remark click is refused");
    eq(fa.db.noteForBooking(theirs).text, "Coach B wrote <i>this</i>", "the remark is untouched");
    eq(a.errors.length, 0, "no page errors: " + a.errors.join("\n"));
    a.close();
  }

  /* ============================================================
     4. Add student: the class's own credit type
     ============================================================ */
  {
    const c = await openConsole({ staff: "admin", hash: "#today", now: NOON });
    const f = fixtures(c);
    const occ = f.futureA;
    const type = occ.creditType;
    const short = f.db.creditTypeShort(type);
    await open(c, occ.key);
    c.click("#cdAddStudent");
    await c.tick();
    ok(c.Admin.modalOpen() && c.$("#cdAssignSearch"), "the Add student modal opens");
    ok(c.text("#cdAssignChargeLabel").includes("Deduct 1 " + short + " credit from the student's family"), "the charge line names the credit type");
    const picksOk = c.$$("#cdAssignResults .cd-pick").every((l) => {
      const kid = f.db.child(l.querySelector("input").value);
      return squash(l.querySelector(".cd-pick__bal").textContent) === squash(short + " credits") + "◆" + f.db.balance(kid.familyId, type);
    });
    ok(picksOk, "every result shows that family's wallet for this class");

    // a family with none of this type
    const broke = f.db.searchChildren("").find((ch) => !f.db.roster(occ.key).some((r) => r.child.id === ch.id));
    const bal = f.db.balance(broke.familyId, type);
    if (bal !== 0) f.db.adjustCredits(broke.familyId, -bal, { creditType: type, reason: "Correction", by: "admin", allowNegative: true });
    const otherType = f.db.creditTypes().find((t) => t.id !== type && t.kind === "class").id;
    f.db.adjustCredits(broke.familyId, 3, { creditType: otherType, reason: "Correction", by: "admin" });
    const otherBefore = f.db.balance(broke.familyId, otherType);
    await c.tick();
    c.input("#cdAssignSearch", broke.name);
    await c.tick();
    pick(c, broke.id);
    await c.tick();
    ok(c.text("#cdAssignChargeLabel").includes("Deduct 1 " + short + " credit from " + famOf(f.db, broke.familyId)), "the charge line names the family");
    ok(squash(c.text("#cdAssignChargeLabel")).includes("◆0→after:◆-1"), "the charge line shows the wallet before and after");
    ok(c.text("#cdWarnNeg").includes(famOf(f.db, broke.familyId) + " has no " + short + " credits left."), "the warning names the missing credits");
    ok(c.text("#cdWarnNeg").includes(f.db.creditTypeName(type) + " classes take " + f.db.creditTypeName(type) + " credits"), "the warning explains the type");
    ok(c.$("#cdAllowNeg"), "an admin may add anyway");
    c.click("#cdAssignSubmit");
    await c.tick();
    ok(c.text("#cdAssignError").includes("Add anyway"), "without the tick the booking is refused");
    c.input("#cdAllowNeg", true);
    c.click("#cdAssignSubmit");
    await c.tick(T);
    const booked = f.db.roster(occ.key).find((r) => r.child.id === broke.id);
    ok(booked, "the student is booked");
    eq(booked.booking.creditType, type, "the booking is charged to the class's credit type");
    eq(f.db.balance(broke.familyId, type), -1, "that wallet went negative");
    eq(f.db.balance(broke.familyId, otherType), otherBefore, "their other wallet is untouched");
    ok(c.text("#cdAssignDone").includes("Added " + broke.name), "the modal confirms");

    // a second press does nothing until another student is picked
    ok(c.$("#cdAssignSubmit").disabled, "the button waits for the next pick");
    c.click("#cdAssignSubmit");
    await c.tick();
    eq(c.text("#cdAssignError"), "", "no error from the second press");
    eq(f.db.roster(occ.key).filter((r) => r.child.id === broke.id).length, 1, "still only one booking");

    // an admin may book without charging at all
    const free = f.db.searchChildren("").find((ch) => !f.db.roster(occ.key).some((r) => r.child.id === ch.id) && f.db.balance(ch.familyId, type) > 1);
    c.input("#cdAssignSearch", free.name);
    await c.tick();
    pick(c, free.id);
    c.input("#cdAssignCharge", false);
    await c.tick();
    const before = f.db.balance(free.familyId, type);
    c.click("#cdAssignSubmit");
    await c.tick(T);
    const freeRow = f.db.roster(occ.key).find((r) => r.child.id === free.id);
    eq(freeRow.booking.cost, 0, "booked with no charge");
    eq(f.db.balance(free.familyId, type), before, "their wallet is untouched");
    ok(c.text("#drawer").includes("no credit charged"), "the roster marks the free booking");
    eq(c.errors.length, 0, "no page errors: " + c.errors.join("\n"));
    c.close();
  }

  /* ============================================================
     5. Coaches: always charge, refunds follow the rule, no removals after the end
     ============================================================ */
  {
    const c = await openConsole({ staff: "coach-a", hash: "#schedule", now: NOON });
    const f = fixtures(c);
    const db = f.db;
    const t = db.todayISO();
    const now = db.addOneOff({ date: t, time: "11:30", duration: 60, programmeId: "tots", coach: "Coach A", capacity: 6 }, { by: "admin", allowPast: true });
    const soon = db.addOneOff({ date: t, time: "12:30", duration: 60, programmeId: "tots", coach: "Coach A", capacity: 6 }, { by: "admin" });
    ok(now.ok && soon.ok, "two one-off classes for today");
    const type = db.occurrence(now.key).creditType;
    const kids = db.searchChildren("").filter((ch) => db.balance(ch.familyId, type) > 2).slice(0, 2);
    db.book(now.key, kids[0].id, { by: "admin", source: "staff", allowStarted: true });
    db.book(soon.key, kids[1].id, { by: "admin", source: "staff" });
    await c.tick(T);

    // a class in progress
    await open(c, now.key);
    eq(c.text("#drawer .drawer__sub .chip--state"), "Now", "header: Now chip");
    ok(c.$("#drawer .drawer__sub .chip--now .pulse"), "the Now chip pulses");
    eq(c.text("#drawer .cd-state__when"), "Happening now · ends at 12:30 PM", "state bar: in progress");
    eq(c.text("#drawer .cd-state__att .att-badge"), "0 of 1 marked", "attendance indicator while it runs");

    // the coach cannot waive the charge
    c.click("#cdAddStudent");
    await c.tick();
    ok(c.$("#cdAssignCharge").checked && c.$("#cdAssignCharge").disabled, "the charge box is locked for coaches");
    ok(c.text("#cdAssignChargeLabel").includes("Only admins can book without deducting credits."), "and says why");
    const broke = db.searchChildren("").find((ch) => db.balance(ch.familyId, type) === 0 && !db.roster(now.key).some((r) => r.child.id === ch.id));
    ok(broke, "fixture: a family with none of this credit type");
    c.input("#cdAssignSearch", broke.name);
    await c.tick();
    pick(c, broke.id);
    await c.tick();
    ok(!c.$("#cdAllowNeg"), "a coach gets no way to go negative");
    ok(c.text("#cdWarnNeg").includes("Ask the studio admin to add " + db.creditTypeShort(type) + " credits first."), "the coach is told to ask an admin");
    c.click("#cdAssignSubmit");
    await c.tick(T);
    ok(c.text("#cdAssignError").includes("ask the studio admin"), "the booking is refused");
    ok(!db.roster(now.key).some((r) => r.child.id === broke.id), "nothing was booked");
    c.Admin.closeModal();
    await c.tick(T);

    // removing during the class keeps the credit
    const bNow = db.roster(now.key)[0].booking;
    const balNow = db.balance(bNow.familyId, type);
    c.click("#cdRm-" + bNow.id);
    await c.tick();
    ok(!c.$("#cdRefund"), "a coach gets no refund choice");
    ok(c.text("#cdRefundInfo").includes("the credit is kept. Ask the studio admin"), "the coach is told the credit is kept");
    c.click("#confirmOk");
    await c.tick(T);
    eq(db.booking(bNow.id).refunded, false, "no refund after the class starts");
    eq(db.balance(bNow.familyId, type), balNow, "the wallet is unchanged");

    // removing before it starts gives the credit back, in the right wallet
    await open(c, soon.key);
    eq(c.text("#drawer .cd-state__when"), "Starts in 30 minutes", "state bar: starts in minutes");
    const bSoon = db.roster(soon.key)[0].booking;
    const balSoon = db.balance(bSoon.familyId, type);
    c.click("#cdRm-" + bSoon.id);
    await c.tick();
    ok(c.text("#cdRefundInfo").includes("1 " + db.creditTypeShort(type) + " credit goes back to " + famOf(db, bSoon.familyId)),
      "the dialog names the credit and the family");
    c.click("#confirmOk");
    await c.tick(T);
    eq(db.booking(bSoon.id).refunded, true, "refunded before the start");
    eq(db.balance(bSoon.familyId, type), balSoon + bSoon.cost, "the credit went back to the right wallet");
    ok(toasts(c).includes("1 " + db.creditTypeShort(type) + " credit back to " + famOf(db, bSoon.familyId)), "the toast says so");

    // after the class has ended only an admin may remove
    await open(c, f.passedA.key);
    ok(!c.$('#drawer [data-cd-action="remove"]'), "no Remove on a class that has ended");
    const past = db.roster(f.passedA.key)[0].booking;
    forge(c, { "data-cd-action": "remove", "data-booking": past.id });
    await c.tick();
    ok(!c.Admin.modalOpen() && toasts(c).includes("absent instead"), "a forged removal is refused with advice");
    eq(db.booking(past.id).status, "booked", "the booking stands");

    // another coach's class is read-only
    await open(c, f.passedB.key);
    ok(c.text("#drawer").includes("View only — this is Coach B's class."), "view only on another coach's class");
    ok(!c.$("#drawer .att") && !c.$("#cdAddStudent") && !c.$("#cdActionsTitle"), "no controls there");
    const bB = db.roster(f.passedB.key)[0].booking;
    const attB = db.booking(bB.id).attendance;
    forge(c, { "data-att": "absent", "data-booking": bB.id });
    await c.tick(T);
    eq(db.booking(bB.id).attendance, attB, "a forged attendance click is ignored");
    eq(c.errors.length, 0, "no page errors: " + c.errors.join("\n"));
    c.close();
  }

  /* ============================================================
     6. Admin refunds land in the class's own wallet
     ============================================================ */
  {
    const c = await openConsole({ staff: "admin", hash: "#today", now: NOON });
    const f = fixtures(c);
    const occ = f.eliteA || f.futureA;
    const type = occ.creditType;
    await open(c, occ.key);
    const b = f.db.roster(occ.key)[0].booking;
    const before = f.db.balance(b.familyId, type);
    const otherType = f.db.creditTypes().find((t) => t.id !== type && t.kind === "class").id;
    const otherBefore = f.db.balance(b.familyId, otherType);
    c.click("#cdRm-" + b.id);
    await c.tick();
    ok(c.$("#cdRefund") && c.$("#cdRefund").checked, "an admin chooses, and before the start the box is ticked");
    ok(c.text("#modalCard").includes("Refund 1 " + f.db.creditTypeShort(type) + " credit to " + famOf(f.db, b.familyId)),
      "the refund names the credit type and the family");
    c.click("#confirmOk");
    await c.tick(T);
    eq(f.db.booking(b.id).status, "cancelled", "the booking is cancelled");
    eq(f.db.balance(b.familyId, type), before + b.cost, "the credit went back to that wallet");
    eq(f.db.balance(b.familyId, otherType), otherBefore, "their other wallet is untouched");
    c.click("#cdShowCancelled");
    await c.tick();
    const chip = c.$$("#cdCancelledList .chip").find((el) => el.textContent === "Refunded");
    ok(chip && chip.title.includes("1 " + f.db.creditTypeShort(type) + " credit returned to " + famOf(f.db, b.familyId)),
      "the cancelled row explains the refund");
    eq(c.errors.length, 0, "no page errors: " + c.errors.join("\n"));
    c.close();
  }

  /* ============================================================
     7. Private 1-to-1 sessions
     ============================================================ */
  {
    const c = await openConsole({ staff: "admin", hash: "#today", now: NOON });
    const f = fixtures(c);
    ok(f.private.length, "fixture: the demo studio runs private sessions");
    const occ = f.private.find((o) => o.booked === 1) || f.private[0];
    const type = occ.creditType;
    eq(type, "private-" + occ.coach.toLowerCase().replace(/[^a-z0-9]+/g, "-"), "a private session takes that coach's own credits");
    await open(c, occ.key);
    const status = c.text("#drawer .cd-status");
    ok(status.includes("Private 1-to-1 with " + occ.coach + " — one student"), "the notice says it is one-to-one");
    ok(status.includes("Booked with " + f.db.creditTypeName(type) + " credits"), "and which credits it takes");
    ok(!status.includes("runs on this date only"), "no duplicate one-off wording");
    eq(c.$$("#drawer .cd-sum").length, 2, "the summary drops the places count");
    ok(c.$("#drawer .cd-sums--two"), "and lays out as two cells");
    const student = f.db.roster(occ.key)[0];
    ok(c.text("#drawer .cd-sums").includes(student.child.name.split(" ")[0]), "the summary names the student");
    ok(c.text("#drawer .cd-sums").includes(f.db.creditTypeShort(type)), "the summary shows the private credit type");
    ok(c.text("#cdStudentsTitle").startsWith("Student ("), "the section is titled Student");
    ok(!c.$$("#drawer .drawer__sub .chip").some((el) => el.textContent === "Full"), "no \u201cFull\u201d chip on a one-seat session");
    ok(c.$$("#drawer .drawer__sub .chip").some((el) => el.textContent === "One-off"), "but it is still flagged as a one-off");
    eq(rows(c).length, 1, "a single roster row");
    eq(squash(rows(c)[0].querySelector(".cd-bal").textContent), "Private◆" + f.db.balance(student.family.id, type), "the row shows their private wallet");
    ok(!c.$("#cdAddStudent"), "no Add student while the slot is taken");
    ok(c.text("#drawer").includes("A private session is for one student"), "and the drawer says why");

    // free the slot, then fill it again
    c.click("#cdRm-" + student.booking.id);
    await c.tick();
    ok(c.text("#modalCard").includes("Refund 1 " + f.db.creditTypeName(type) + " credit"), "the refund names the private credits");
    c.click("#confirmOk");
    await c.tick(T);
    eq(f.db.occurrence(occ.key).booked, 0, "the session is free again");
    ok(c.text("#drawer").includes("add the student this session is for"), "the empty state suits a private session");
    eq(c.text("#cdAddStudent"), "Add the student", "the button reads for one student");
    c.click("#cdAddStudent");
    await c.tick();
    ok(c.text("#cdAssignChargeLabel").includes("Deduct 1 " + f.db.creditTypeName(type) + " credit"), "the charge line names the private credits");
    const back = f.db.balance(student.family.id, type);
    c.input("#cdAssignSearch", student.child.name);
    await c.tick();
    pick(c, student.child.id);
    await c.tick();
    ok(squash(c.text("#cdAssignResults .cd-pick__bal")).includes("◆" + back), "the result shows their private wallet");
    c.click("#cdAssignSubmit");
    await c.tick(T);
    const again = f.db.roster(occ.key)[0];
    ok(again && again.child.id === student.child.id, "the student is booked back in");
    eq(again.booking.creditType, type, "charged to the coach's private credits");
    eq(f.db.balance(student.family.id, type), back - occ.cost, "their private wallet paid for it");
    c.Admin.closeModal();
    await c.tick(T);
    ok(!c.$("#cdAddStudent"), "the slot is taken again");
    eq(c.errors.length, 0, "no page errors: " + c.errors.join("\n"));
    const storage = c.storage;
    c.close();

    // a coach sees their own private sessions, not another coach's
    const other = f.private.find((o) => o.coach !== "Coach A");
    ok(other, "fixture: another coach also runs private sessions");
    const cc = await openConsole({ staff: "coach-a", hash: "#schedule", now: NOON, storage });
    await open(cc, other.key);
    ok(cc.text("#drawer").includes("View only — this is " + other.coach + "'s class."), "another coach's private session is read-only");
    ok(cc.text("#drawer .cd-status").includes("Private 1-to-1 with " + other.coach), "it still reads as a private session");
    eq(cc.errors.length, 0, "no page errors: " + cc.errors.join("\n"));
    cc.close();
  }

  /* ============================================================
     8. Camp groups: which session this is, and the way to the next
     ============================================================ */
  {
    const c = await openConsole({ staff: "admin", hash: "#today", now: NOON });
    const f = fixtures(c);
    const db = f.db;
    const dates = [db.addDays(f.t, 2), db.addDays(f.t, 3), db.addDays(f.t, 9)];
    const g = db.addOneOffs({ dates, time: "11:00", programmeId: "tots", coach: "Coach A", capacity: 6, groupName: "June <b>Boot</b> Camp" }, { by: "admin" });
    ok(g.ok && g.keys.length === 3, "a camp of three sessions");
    const calls = stubSchedule(c);
    await open(c, g.keys[1]);
    const status = c.text("#drawer .cd-status");
    ok(status.includes("Part of June <b>Boot</b> Camp — session 2 of 3 (" + db.formatDate(dates[0]) + " – " + db.formatDate(dates[2]) + ")."),
      "the notice places the session in the camp");
    ok(!c.$("#drawer .cd-status b"), "the camp name is escaped");
    ok(status.includes("3 sessions still to come"), "how many are left");
    eq(c.$("#cdGroupPrev").getAttribute("data-open-class"), g.keys[0], "a link to the previous session");
    eq(c.$("#cdGroupNext").getAttribute("data-open-class"), g.keys[2], "a link to the next one");
    c.click("#cdGroupNext");
    await c.tick(T);
    eq(c.$("#drawer .cd").getAttribute("data-key"), g.keys[2], "the link opens that session");
    ok(c.text("#drawer .cd-status").includes("session 3 of 3"), "the last session is numbered");
    ok(!c.$("#cdGroupNext") && c.$("#cdGroupPrev"), "the last session only looks back");
    ok(c.text("#drawer").includes("Delete cancels this session, or this and later sessions of June <b>Boot</b> Camp."), "an admin can end the rest of the camp");
    c.click("#cdAct-delete");
    eq(JSON.stringify(calls), JSON.stringify([["deleteClass", g.keys[2]]]), "Delete hands over to the schedule module");
    db.removeOccurrence(g.keys[0], { by: "admin", reason: "Hall unavailable" });
    await open(c, g.keys[1]);
    ok(c.text("#drawer .cd-status").includes("1 deleted"), "deleted sessions are counted");
    ok(c.text("#cdGroupPrev").includes("(deleted)"), "and flagged on the link");
    eq(c.errors.length, 0, "no page errors: " + c.errors.join("\n"));
    c.close();
  }

  /* ============================================================
     9. Class actions, blocked / leave / deleted classes
     ============================================================ */
  {
    const c = await openConsole({ staff: "coach-a", hash: "#schedule", now: NOON });
    const f = fixtures(c);
    const calls = stubSchedule(c);
    await open(c, f.futureA.key);
    ok(c.$("#cdAct-block") && c.$("#cdAct-delete"), "a coach can block or delete their own class");
    ok(!c.$("#cdAct-coach"), "but not change the coach");
    ok(c.text("#drawer").includes("Delete cancels this date only."), "the scope is explained");
    c.click("#cdAct-block");
    eq(JSON.stringify(calls), JSON.stringify([["blockClass", f.futureA.key]]), "Block hands over to the schedule module");
    calls.length = 0;
    forge(c, { "data-cd-action": "coach" });
    eq(calls.length, 0, "a forged coach change is refused");
    eq(c.errors.length, 0, "no page errors: " + c.errors.join("\n"));
    c.close();

    const a = await openConsole({ staff: "admin", hash: "#today", now: NOON });
    const fa = fixtures(a);
    const acalls = stubSchedule(a);
    await open(a, fa.futureA.key);
    ok(a.$("#cdAct-coach"), "an admin can change the coach");
    a.click("#cdAct-coach");
    eq(JSON.stringify(acalls), JSON.stringify([["substituteCoach", fa.futureA.key]]), "and it reaches the schedule module");

    await open(a, fa.blocked.key);
    ok(a.text("#drawer .cd-status").includes("Blocked"), "a blocked class says so");
    ok(a.$("#cdAct-unblock") && !a.$("#cdAct-block"), "Reopen replaces Block");
    ok(a.$("#cdAddStudent").disabled, "no adding students while blocked");

    ok(fa.leave, "fixture: a class closed by coach leave");
    await open(a, fa.leave.key);
    const win = fa.db.occurrence(fa.leave.key).leaveWindow;
    const when = win ? a.HC.formatTime(win.from) + " – " + a.HC.formatTime(win.to) : "all day";
    ok(a.text("#drawer .cd-status").includes(fa.leave.coach + " is on leave " + when), "leave shows the hours it covers");
    ok(a.text("#drawer").includes("Closed while " + fa.leave.coach + " is on leave."), "adding students is closed meanwhile");
    const lv = fa.db.leaveFor(fa.leave.coach, fa.leave.date, fa.leave.time, fa.leave.duration);
    eq(a.$("#cdViewLeave").getAttribute("data-params"), JSON.stringify({ show: lv && lv.id }), "View leave opens that entry");

    await open(a, fa.removed.key);
    ok(a.text("#drawer .cd-status").includes("deleted"), "a deleted class says so");
    ok(a.$("#cdAct-restore") && !a.$("#cdAddStudent"), "it offers Restore and nothing else");

    a.Admin.openClass("2026-01-01|nope");
    await a.tick();
    eq(a.text("#drawerTitle"), "Class not found", "an unknown class is handled");
    eq(a.errors.length, 0, "no page errors: " + a.errors.join("\n"));
    a.close();
  }

  console.log("credit types seen: junior · elite · competitive · private (per coach)");
  console.log(checks + " checks passed");
})().catch((e) => {
  console.error("✗ " + (e && e.message ? e.message : e));
  process.exit(1);
});
