/* The Schedule view and the class actions it owns (admin/js/schedule.js).

   Coaches get "My classes": their own week, each class showing Upcoming / Now /
   Passed and whether attendance is marked. Admins get every class, the coach
   filter, one-off classes, camps, coach changes and weekly deletions.

   The page clock is frozen so "now / passed / upcoming" never drifts:
   Tue 6 Oct 2026, midday (nothing has started) — and 4:20 PM for the live class. */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { openConsole, ROOT } = require("./dom-harness.js");

const NOON = "2026-10-06T12:00";        // Tuesday, before the first class
const DURING = "2026-10-06T16:20";      // inside Tuesday's 4:00 PM Wushu Junior (Coach A)

let checks = 0;
const ok = (cond, msg) => { checks++; assert.ok(cond, msg); };
const eq = (a, b, msg) => {
  checks++;
  assert.strictEqual(a, b, msg + " (got " + JSON.stringify(a) + ", want " + JSON.stringify(b) + ")");
};
const norm = (s) => String(s || "").replace(/\s+/g, " ").trim();

const cardSel = (key) => 'article.sch-card[data-open-class="' + key + '"]';
const cardOf = (c, key) => c.$(cardSel(key));
const moreOf = (c, key) => c.$(cardSel(key) + " .sch-more");
const stateOf = (c, key) => norm(cardOf(c, key).querySelector(".chip--state").textContent);
const badgeOf = (c, key) => {
  const b = cardOf(c, key).querySelector(".att-badge");
  return b ? norm(b.textContent) : "";
};
const lastToast = (c) => {
  const t = c.$$(".toast");
  return t.length ? norm(t[t.length - 1].textContent) : "";
};
const menuActs = (c) => c.$$("#schMenu [data-sch-act]").map((b) => b.getAttribute("data-sch-act"));

async function openMenu(c, key) {
  const b = moreOf(c, key);
  assert.ok(b, "no menu button for " + key);
  c.click(b);
  await c.tick(10);
  return b;
}
const menuItem = (c, act) => c.$('#schMenu [data-sch-act="' + act + '"]');
const keydown = (c, el, key) =>
  el.dispatchEvent(new c.window.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));

// every card: one status chip with the right words, an attendance badge only once started
function checkCards(c, list, label) {
  const bad = [];
  list.forEach((o) => {
    const card = cardOf(c, o.key);
    if (!card) return bad.push(o.key + " missing");
    const chips = card.querySelectorAll(".chip--state");
    const want = o.status === "removed" && o.removedScope === "series"
      ? "Weekly class deleted"
      : c.Admin.h.classState(o).label;
    if (chips.length !== 1 || norm(chips[0].textContent) !== want) {
      bad.push(o.key + " state " + (chips[0] && norm(chips[0].textContent)));
    }
    const att = c.Admin.h.attendance(o);
    const badge = card.querySelector(".att-badge");
    const shouldShow = att.key === "done" || att.key === "todo";
    if (!!badge !== shouldShow) bad.push(o.key + " badge " + !!badge + "/" + att.key);
    if (badge && norm(badge.textContent) !== att.label) bad.push(o.key + " badge text " + norm(badge.textContent));
    if (!o.started && badge) bad.push(o.key + " badge before the class started");
  });
  ok(bad.length === 0, label + ": " + bad.join("; "));
}

/* ============================================================
   COACH — "My classes"
   ============================================================ */
async function coachHome() {
  const c = await openConsole({ staff: "coach-a", hash: "#schedule", now: NOON });
  const db = c.HC.db;
  const t = db.todayISO();
  eq(t, "2026-10-06", "the clock is frozen");
  eq(c.$("#page").getAttribute("data-view"), "schedule", "schedule is the coach's home view");
  eq(c.text(".page__title"), "My classes", "coaches see My classes");
  eq(c.text(".page__sub"), "Your week at a glance — tap a class to take attendance.", "friendly sub");
  ok(!c.$("#schAdd") && !c.$$("[data-sch-add]").length, "coaches get no Add one-off class");
  ok(!c.$("#schCoach") && !c.$("#schMine") && !c.$("#schAll"), "no coach filter, no My/All toggle");

  const dates = db.weekDates(t);
  eq(c.$$(".sch-day").length, 7, "seven day columns");
  eq(c.$$(".sch-day").map((x) => x.getAttribute("data-date")).join(), dates.map((d) => d.iso).join(), "Mon–Sun");
  eq(c.$(".sch-day.is-today").getAttribute("data-date"), t, "today's column is marked");
  const mine = db.occurrencesForWeek(t, { coach: "Coach A" });
  eq(c.$$(".sch-card").length, mine.length, "only the coach's own classes");
  ok(mine.every((o) => o.coach === "Coach A"), "every card is Coach A's");
  eq(c.$$(".sch-card__coach").length, 0, "no coach line on a coach's own cards");
  checkCards(c, mine, "this week's cards");
  ok(mine.filter((o) => !o.started).every((o) => stateOf(c, o.key) === "Upcoming"), "future classes read Upcoming");
  ok(mine.filter((o) => o.ended).every((o) => stateOf(c, o.key) === "Passed"), "finished classes read Passed");

  // the Today strip: today's classes, each with its status
  const todays = db.occurrencesForDate(t, { coach: "Coach A" });
  ok(!!c.$("#schToday"), "the coach gets a Today strip");
  eq(c.$$("#schToday .sch-tb__item").length, todays.length, "the strip lists today's classes");
  todays.forEach((o) => {
    const b = c.$('#schToday [data-open-class="' + o.key + '"]');
    ok(b && norm(b.querySelector(".chip--state").textContent) === c.Admin.h.classState(o).label, "strip status " + o.key);
  });

  // a card opens the class drawer
  const any = mine.find((o) => !o.started) || mine[0];
  c.click(cardOf(c, any.key).querySelector(".sch-card__open"));
  await c.tick();
  ok(c.Admin.drawerOpen(), "a card opens the class drawer");
  c.Admin.closeDrawer();

  // next week: the blocked Thursday class and the part-day leave on Tuesday
  await c.go("#schedule?week=" + db.addDays(db.weekStart(t), 7));
  const nw = db.addDays(db.weekStart(t), 7);
  ok(!c.$("#schToday"), "the Today strip only shows on this week");
  const blocked = cardOf(c, db.occKey(db.addDays(nw, 3), "h1"));
  ok(blocked.classList.contains("sch-card--blocked"), "blocked class is styled as blocked");
  eq(norm(blocked.querySelector(".chip--state").textContent), "Blocked", "…and says Blocked");
  ok(/national team selection/.test(blocked.textContent), "the block reason is on the card");
  ok(!blocked.querySelector(".sch-cap"), "no places bar on a blocked class");
  const tue = db.addDays(nw, 1);
  const leaveChip = c.$('.sch-day[data-date="' + tue + '"] .sch-day__leave .chip');
  ok(leaveChip && /You're on leave · 4 – 6 PM/.test(norm(leaveChip.textContent)),
    "part-day leave says when: " + (leaveChip && norm(leaveChip.textContent)));
  ok(/4:00 PM – 6:00 PM/.test(leaveChip.getAttribute("title")), "…with the full window in the tooltip");
  const closed = db.occurrencesForDate(tue, { coach: "Coach A" }).filter((o) => o.blockKind === "leave");
  ok(closed.length >= 1 && closed.every((o) => o.leaveWindow), "only the classes inside the window close");
  eq(stateOf(c, closed[0].key), "Coach on leave", "the card says the coach is on leave");
  checkCards(c, db.occurrencesForWeek(nw, { coach: "Coach A" }), "next week's cards");

  // the coach param is ignored — a coach only ever sees their own classes
  await c.go("#schedule?coach=all");
  eq(c.$$(".sch-card").length, mine.length, "coach=all is ignored");
  await c.go("#schedule?week=nonsense&deleted=x");
  eq(c.$(".sch-day").getAttribute("data-date"), db.weekStart(t), "a bad week falls back to this week");

  eq(c.errors.length, 0, "no page errors: " + c.errors.join(" | "));
  c.close();
}

/* a class in progress: Now, and the attendance nudge */
async function coachNow() {
  const c = await openConsole({ staff: "coach-a", hash: "#schedule", now: DURING });
  const db = c.HC.db;
  const t = db.todayISO();
  const live = db.occurrencesForDate(t, { coach: "Coach A" }).find((o) => o.started && !o.ended);
  ok(!!live, "a Coach A class is running at 4:20 PM");
  const card = cardOf(c, live.key);
  ok(card.classList.contains("is-live") && card.classList.contains("sch-state--now"), "the live class stands out");
  const chip = card.querySelector(".chip--state");
  ok(chip.classList.contains("chip--now") && !!chip.querySelector(".pulse"), "a pulsing Now chip");
  eq(norm(chip.textContent), "Now", "…that reads Now");
  eq(badgeOf(c, live.key), "Attendance not marked", "attendance is flagged as soon as it starts");
  ok(card.classList.contains("needs-att"), "…and the card is marked as needing attention");
  ok(!moreOf(c, live.key), "a coach gets no menu once the class has started");
  ok(!!c.$("#schToday .sch-tb__item--now"), "the Today strip marks the live class");

  // marking the register updates the badge
  const roster = db.bookings({ occKey: live.key, status: "booked" });
  db.setAttendance(roster[0].id, "present", { by: "coach-a" });
  await c.tick();
  eq(badgeOf(c, live.key), "1 of " + roster.length + " marked", "partly marked");
  db.markAll(live.key, "present", { by: "coach-a" });
  await c.tick();
  eq(badgeOf(c, live.key), "Attendance marked", "fully marked");
  ok(cardOf(c, live.key).querySelector(".att-badge--done"), "…with the done styling");

  // yesterday has passed
  const past = db.occurrencesForDate(db.addDays(t, -1), { coach: "Coach A" })[0];
  await c.go("#schedule");
  eq(stateOf(c, past.key), "Passed", "yesterday's class reads Passed");
  ok(!moreOf(c, past.key), "nothing to do on a finished class but open it");

  eq(c.errors.length, 0, "no page errors: " + c.errors.join(" | "));
  c.close();
}

/* block, reopen, delete one date, restore — and what a coach may not do */
async function coachActions() {
  const c = await openConsole({ staff: "coach-a", hash: "#schedule", now: NOON });
  const db = c.HC.db;
  const t = db.todayISO();
  const occ = db.occurrencesForRange(db.addDays(t, 1), db.addDays(t, 13), { coach: "Coach A" })
    .find((o) => o.status === "open" && o.templateId && o.booked > 0);
  ok(!!occ, "found a booked Coach A class to work with");
  await c.go("#schedule?week=" + db.weekStart(occ.date));

  // --- block
  await openMenu(c, occ.key);
  eq(menuActs(c).join(), "open,block,delete", "a coach's menu: view, block, delete this date");
  c.click(menuItem(c, "block"));
  await c.tick(5);
  eq(c.text("#modalTitle"), "Block this class?", "the block dialog opens");
  const sub = c.$$(".modal__sub .nowrap").map((x) => x.textContent);
  eq(sub.length, 3, "date, time and coach each stay whole when the line wraps");
  eq(sub[2], "Coach A", "…the coach name last");
  const booking = db.bookings({ occKey: occ.key, status: "booked" })[0];
  const wallet = db.balance(booking.familyId, occ.creditType);
  ok(new RegExp(occ.booked + " booked student").test(c.text(".modal__body")), "it says who loses their place");
  c.input("#schBlockReason", "Other");
  c.click("#schBlockGo");
  await c.tick(5);
  ok(c.Admin.modalOpen() && c.$("#schBlockNote").classList.contains("invalid"), "\"Other\" needs a few words");
  eq(db.occurrence(occ.key).status, "open", "nothing happened yet");
  c.input("#schBlockNote", "Family emergency");
  c.click("#schBlockGo");
  await c.tick();
  ok(!c.Admin.modalOpen(), "the dialog closes once it's blocked");
  eq(db.occurrence(occ.key).status, "blocked", "the class is blocked");
  eq(db.occurrence(occ.key).reason, "Other — Family emergency", "with the reason");
  eq(db.balance(booking.familyId, occ.creditType), wallet + occ.cost, "the credits go back to the wallet they came from");
  ok(/Class blocked/.test(lastToast(c)), "and a toast says so: " + lastToast(c));
  eq(stateOf(c, occ.key), "Blocked", "the card follows");

  // --- reopen
  await openMenu(c, occ.key);
  eq(menuActs(c).join(), "open,unblock,delete", "a blocked class offers Reopen");
  c.click(menuItem(c, "unblock"));
  await c.tick(5);
  eq(c.text("#modalTitle"), "Reopen this class?", "the reopen confirmation");
  c.click("#confirmOk");
  await c.tick();
  eq(db.occurrence(occ.key).status, "open", "open again");

  // --- delete one date, then restore it
  ok(!c.$("#schDeleted"), "no deleted-class switch while nothing is deleted");
  await openMenu(c, occ.key);
  c.click(menuItem(c, "delete"));
  await c.tick(5);
  eq(c.$$('input[name="schScope"]').length, 1, "a coach can only delete the one date");
  ok(/Ask the studio admin/.test(c.text(".modal__body")), "…and is told who can end a weekly class");
  ok(/“Show deleted” on My classes/.test(c.text(".modal__body")), "the undo hint names their own view");
  c.input("#schDelReason", "Hall booked");
  c.click("#schDelGo");
  await c.tick();
  const gone = db.occurrence(occ.key);
  eq(gone.status + "/" + gone.removedScope, "removed/one", "just that date is deleted");
  eq(db.occurrence(db.occKey(db.addDays(occ.date, 7), occ.templateId)).status, "open", "the following week is untouched");
  ok(!cardOf(c, occ.key), "the card goes away");
  ok(!!c.$("#schDeleted"), "the deleted-class switch appears once there's something to show");
  c.input("#schDeleted", true);
  await c.tick();
  ok(cardOf(c, occ.key).classList.contains("sch-card--removed"), "it comes back struck through");
  eq(stateOf(c, occ.key), "Deleted", "…and reads Deleted");
  await openMenu(c, occ.key);
  eq(menuActs(c).join(), "open,restore", "a deleted class can be restored");
  c.click(menuItem(c, "restore"));
  await c.tick(5);
  c.click("#confirmOk");
  await c.tick();
  eq(db.occurrence(occ.key).status, "open", "restored");
  ok(/parents can book it again/.test(lastToast(c)), "the toast is honest: " + lastToast(c));

  // --- what a coach may not do
  const other = db.occurrencesForRange(db.addDays(t, 1), db.addDays(t, 13), { coach: "Coach B" })
    .find((o) => o.status === "open");
  c.Admin.blockClass(other.key);
  ok(!c.Admin.modalOpen() && /only change your own/.test(lastToast(c)), "a coach can't touch another coach's class");
  c.Admin.substituteCoach(occ.key);
  ok(!c.Admin.modalOpen() && /Only an admin can change the coach/.test(lastToast(c)), "…or change the coach");
  c.Admin.deleteClass(occ.key, { scope: "series" });
  ok(!c.Admin.modalOpen() && /Only an admin/.test(lastToast(c)), "…or end a weekly class");
  const oneOffs = db.dump().oneOffs.length;
  c.Admin.addOneOff({ date: db.addDays(t, 3) });
  ok(!c.Admin.modalOpen() && /added by the studio admin/.test(lastToast(c)), "…or add a one-off class");
  eq(db.dump().oneOffs.length, oneOffs, "nothing was added");
  c.Admin.blockClass("nope|x");
  ok(/couldn't be found/.test(lastToast(c)), "an unknown class is handled");

  eq(c.errors.length, 0, "no page errors: " + c.errors.join(" | "));
  c.close();
}

/* ============================================================
   ADMIN — filter, weekly deletions, coach changes
   ============================================================ */
async function adminSchedule() {
  const c = await openConsole({ staff: "admin", hash: "#schedule", now: NOON });
  const db = c.HC.db;
  const t = db.todayISO();
  eq(c.text(".page__title"), "Schedule", "the admin sees the whole schedule");
  ok(!!c.$("#schAdd"), "…with Add one-off class");
  ok(!c.$("#schToday"), "no coach Today strip for the admin");
  eq(c.$$(".sch-card").length, db.occurrencesForWeek(t).length, "every class this week");
  eq(c.$$(".sch-card__coach").length, c.$$(".sch-card").length, "each card names its coach");
  checkCards(c, db.occurrencesForWeek(t), "admin cards");
  eq(c.$$("#schCoach option").map((o) => o.value).join(), "all,Coach A,Coach B", "the coach filter is built from coach data");

  // the credit type a class needs is in the places tooltip, not shouted on the card
  const jr = db.occurrencesForWeek(t).find((o) => o.creditType === "junior" && o.status === "open");
  const tip = cardOf(c, jr.key).querySelector(".sch-cap").getAttribute("title");
  ok(/places booked · Junior credits$/.test(tip), "the places tooltip names the credit type: " + tip);
  ok(/pays with Junior credits/.test(cardOf(c, jr.key).querySelector(".sch-card__open").getAttribute("aria-label")),
    "…and so does the card's label");

  c.input("#schCoach", "Coach B");
  await c.tick();
  eq(c.$$(".sch-card").length, db.occurrencesForWeek(t, { coach: "Coach B" }).length, "filtered to one coach");
  await c.go("#schedule?coach=Nobody");
  eq(c.$("#schCoach").value, "all", "an unknown coach falls back to all");

  // --- change coach for one date, and for every week
  const nw = db.addDays(db.weekStart(t), 7);
  await c.go("#schedule?week=" + nw);
  const target = db.occurrencesForRange(nw, db.addDays(nw, 6), { coach: "Coach A" })
    .find((o) => o.status === "open" && o.templateId && !o.substituted && o.day !== 2);
  await openMenu(c, target.key);
  eq(menuActs(c).join(), "open,block,coach,delete,series", "the admin's menu");
  ok(/Delete this and later weeks…/.test(menuItem(c, "series").textContent), "plain words for the weekly deletion");
  c.click(menuItem(c, "coach"));
  await c.tick(5);
  eq(c.text("#modalTitle"), "Change coach", "the change-coach dialog");
  eq(c.$$('input[name="schSubScope"]').length, 2, "one date, or every week from this date");
  eq(c.$('input[name="schSubScope"]:checked').value, "one", "one date by default");
  ok(c.$("#schSubGo").disabled, "…and nothing to do until another coach is chosen");
  c.input("#schSubCoach", "Coach B");
  ok(!c.$("#schSubGo").disabled, "choosing a coach enables it");
  c.click("#schSubGo");
  await c.tick();
  let now = db.occurrence(target.key);
  ok(now.coach === "Coach B" && now.substituted, "Coach B covers that date");
  eq(now.originalCoach, "Coach A", "the weekly timetable is untouched");
  ok(/is now covering/.test(lastToast(c)), "the toast explains the cover: " + lastToast(c));
  ok(/Cover for Coach A/.test(cardOf(c, target.key).textContent), "the card shows who is covered");

  // hand the weekly class over from this date
  const weekly = db.occurrencesForRange(nw, db.addDays(nw, 6), { coach: "Coach A" })
    .find((o) => o.status === "open" && o.templateId && !o.substituted && o.key !== target.key);
  c.Admin.substituteCoach(weekly.key);
  await c.tick(5);
  c.input("#schSubCoach", "Coach B");
  c.input("#schSubScope-weekly", true);
  eq(c.$("#schSubGo").textContent.trim(), "Hand over every week", "the button says what it does");
  ok(/teaches this class every/.test(c.text("#schSubCheck")), "…and the dialog explains it");
  c.click("#schSubGo");
  await c.tick();
  eq(db.occurrence(weekly.key).coach, "Coach B", "this date moves");
  eq(db.occurrence(db.occKey(db.addDays(weekly.date, 14), weekly.templateId)).coach, "Coach B", "so do later weeks");
  eq(db.occurrence(db.occKey(db.addDays(weekly.date, -7), weekly.templateId)).coach, "Coach A", "earlier weeks stay put");
  ok(!db.occurrence(weekly.key).substituted, "it's the timetable now, not a cover");

  // --- a class closed by leave
  const wed = db.addDays(nw, 2);
  const onLeave = db.occurrencesForDate(wed, { coach: "Coach B" }).find((o) => o.blockKind === "leave");
  c.Admin.unblockClass(onLeave.key);
  await c.tick(5);
  eq(c.text("#modalTitle"), "Closed for leave", "reopening explains the leave instead");
  ok(/every class they teach that day is closed/.test(c.text(".modal__body")), "all-day leave wording");
  c.Admin.closeModal();
  // part of a day: only the window closes
  const partly = db.occurrencesForDate(db.addDays(nw, 1), { coach: "Coach A" }).find((o) => o.blockKind === "leave");
  c.Admin.unblockClass(partly.key);
  await c.tick(5);
  ok(/4:00 PM – 6:00 PM/.test(c.text(".modal__body")), "part-day leave names its window: " + c.text(".modal__body"));
  ok(/classes in that window are closed/.test(c.text(".modal__body")), "…and says only those classes close");
  c.Admin.closeModal();

  // --- delete a weekly class from this date, then restore it
  const series = db.occurrencesForRange(nw, db.addDays(nw, 6))
    .find((o) => o.status === "open" && o.templateId && o.booked > 0 && !o.substituted);
  c.Admin.deleteClass(series.key, { scope: "series" });
  await c.tick(5);
  eq(c.$$('input[name="schScope"]').length, 2, "one date or the weekly class");
  eq(c.$('input[name="schScope"]:checked').value, "series", "the menu choice is preselected");
  ok(/This and later weeks/.test(c.text('label[for="schScope-series"]')), "plain words for the scope");
  eq(c.$("#schDelGo").textContent.trim(), "Delete this and later weeks", "…and on the button");
  c.click("#schDelGo");
  await c.tick();
  eq(db.occurrence(series.key).removedScope, "series", "the weekly class stops from that date");
  const later = db.occurrence(db.occKey(db.addDays(series.date, 14), series.templateId));
  eq(later.removedScope, "series", "later weeks go too");
  await c.go("#schedule?week=" + db.weekStart(later.date) + "&deleted=1");
  eq(stateOf(c, later.key), "Weekly class deleted", "a deleted weekly class says so");
  c.Admin.restoreClass(later.key);
  await c.tick(5);
  c.click("#confirmOk");
  await c.tick();
  ok(db.occurrence(series.key).status !== "removed", "restoring brings the weekly class back");

  eq(c.errors.length, 0, "no page errors: " + c.errors.join(" | "));
  c.close();
}

/* ============================================================
   ADD A ONE-OFF CLASS — one date, private sessions, camps
   ============================================================ */
async function addOneDate() {
  const c = await openConsole({ staff: "admin", hash: "#schedule", now: NOON });
  const db = c.HC.db;
  const t = db.todayISO();
  const before = db.dump().oneOffs.length;
  c.click("#schAdd");
  await c.tick(5);
  eq(c.text("#modalTitle"), "Add a one-off class", "the add dialog");
  eq(c.$("#schOoModeOne").getAttribute("aria-pressed"), "true", "one date to start with");
  eq(c.document.activeElement && c.document.activeElement.id, "schOoDate", "the date field takes focus");
  eq(c.$$("#schOoProg option").map((o) => o.value).join(),
    db.programmes().map((p) => p.id).join(), "every programme the store offers, private included");
  ok(c.$$("#schOoProg option").some((o) => o.value === "private" && o.textContent === "Private 1-to-1"), "…listed by name");
  eq(c.$$("#schOoCoach option").map((o) => o.value).join(), "Coach A,Coach B", "active coaches only");

  // what parents pay with, for the chosen programme
  eq(c.text("#schOoPay"), "Parents pay with Junior credits.", "the credit type is spelled out");
  c.input("#schOoProg", "wushu-elite");
  eq(c.text("#schOoPay"), "Parents pay with Elite credits.", "…and follows the programme");
  const chip = c.$("#schOoPay .chip--credit");
  ok(chip && chip.children.length === 0, "the credit chip is plain text, escaped");
  c.input("#schOoProg", "wushu-jr");

  // validation and the live check
  const date = db.addDays(db.weekStart(t), 9);     // next Wednesday
  c.input("#schOoDate", date);
  c.input("#schOoTime", "21:30");
  ok(/Runs past 10:00 PM/.test(c.text("#schOoCheck")), "a class that runs past closing is flagged");
  c.input("#schOoCap", "25");
  c.click("#schOoGo");
  await c.tick(5);
  ok(c.Admin.modalOpen(), "it stays open while something is wrong");
  ok(/must finish by 10:00 PM/.test(c.text("#schOoDurErr")), "…the length is marked");
  ok(/1 to 20/.test(c.text("#schOoCapErr")), "…and so is the class size");
  eq(db.dump().oneOffs.length, before, "nothing was added");
  c.input("#schOoTime", "16:00");
  c.input("#schOoCap", "12");
  ok(/Clashes with Coach A’s classes/.test(c.text("#schOoCheck")), "a clash with the coach's own class is flagged");
  c.input("#schOoTime", "13:00");
  ok(!/Clashes/.test(c.text("#schOoCheck")), "…and clears when the time moves");
  const preview = c.$$("#schOoCheck .sch-preview .nowrap").map((x) => x.textContent);
  eq(preview.length, 3, "the preview keeps date, time and coach whole");
  c.input("#schOoNote", "Grading prep <b>");
  c.click("#schOoGo");
  await c.tick(60);
  ok(!c.Admin.modalOpen(), "the dialog closes once it's added");
  const made = db.dump().oneOffs.slice(-1)[0];
  eq(db.dump().oneOffs.length, before + 1, "one class was added");
  eq([made.date, made.time, made.coach, made.capacity, made.note].join("|"),
    [date, "13:00", "Coach A", 12, "Grading prep <b>"].join("|"), "…with what was typed");
  eq(lastToast(c), "Wushu Junior added on " + db.formatDate(date) + " at 1:00 PM — parents can book it now.", "the toast");
  ok(c.window.location.hash.indexOf("week=" + db.weekStart(date)) >= 0, "the schedule jumps to that week");
  const card = cardOf(c, date + "|" + made.id);
  ok(card.classList.contains("sch-card--oneoff") && /One-off/.test(card.textContent), "the new class is marked one-off");
  const note = card.querySelector(".sch-card__note");
  ok(note && note.children.length === 0 && note.textContent === "Grading prep <b>", "the note is escaped");
  c.Admin.closeDrawer();

  // beyond the parent portal's four-week window
  const far = db.addDays(db.weekStart(t), 7 * 5 + 2);
  const opens = db.addDays(db.weekStart(far), -21);
  c.Admin.addOneOff({ date: far });
  await c.tick(5);
  ok(new RegExp("Parents can book it from " + db.formatDate(opens)).test(c.text("#schOoCheck")),
    "a far-off date says when booking opens: " + c.text("#schOoCheck"));
  c.input("#schOoTime", "12:00");
  c.click("#schOoGo");
  await c.tick(60);
  ok(new RegExp("parents can book it from " + db.formatDate(opens) + "\\.$").test(lastToast(c)),
    "…and so does the toast: " + lastToast(c));
  c.Admin.closeDrawer();

  // a coach on leave that day
  const nw = db.addDays(db.weekStart(t), 7);
  c.Admin.addOneOff({ date: db.addDays(nw, 2), coach: "Coach B" });
  await c.tick(5);
  c.input("#schOoTime", "11:00");
  ok(/Coach B is on leave then/.test(c.text("#schOoCheck")), "leave is flagged before adding");
  c.click("#schOoGo");
  await c.tick(60);
  ok(/closed for now while Coach B is on leave/.test(lastToast(c)), "…and in the toast: " + lastToast(c));
  c.Admin.closeDrawer();

  eq(c.errors.length, 0, "no page errors: " + c.errors.join(" | "));
  c.close();
}

/* private 1-to-1 sessions: created like any one-off, but unmistakable on the schedule */
async function privateSessions() {
  const c = await openConsole({ staff: "admin", hash: "#schedule", now: NOON });
  const db = c.HC.db;
  const t = db.todayISO();
  const nw = db.addDays(db.weekStart(t), 7);

  // the seeded sessions read clearly, with the student's name
  await c.go("#schedule?week=" + nw);
  const seeded = db.occurrencesForRange(nw, db.addDays(nw, 6)).filter((o) => o.tier === "private");
  ok(seeded.length >= 1, "the demo studio has private sessions");
  const one = seeded[0];
  const card = cardOf(c, one.key);
  ok(card.classList.contains("sch-card--private"), "a private session has its own look");
  ok(/Private/.test(card.querySelector(".sch-card__chips").textContent), "…a Private chip");
  ok(!/One-off/.test(card.querySelector(".sch-card__chips").textContent), "…instead of the One-off chip");
  ok(!card.querySelector(".sch-cap"), "no places bar for a single seat");
  const student = db.roster(one.key)[0].child.name;
  eq(norm(card.querySelector(".sch-card__who").textContent), student, "the student's name is on the card");
  ok(!card.querySelector(".sch-card__note"), "the default note isn't repeated under the chip");
  const label = card.querySelector(".sch-card__open").getAttribute("aria-label");
  ok(/private one-to-one/.test(label) && label.indexOf("with " + student) >= 0, "the label names the student: " + label);
  ok(new RegExp("pays with " + one.creditTypeName + " credits").test(label), "…and the credit type");

  // adding one: the places field locks to a single student
  const date = db.addDays(nw, 5);
  c.Admin.addOneOff({ date: date });
  await c.tick(5);
  c.input("#schOoProg", "private");
  eq(c.$("#schOoCap").value, "1", "a private session has one place");
  ok(c.$("#schOoCap").disabled, "…and it can't be changed");
  eq(c.text("#schOoCapHint"), "One student — a one-to-one session.", "the hint says why");
  eq(c.text("#schOoPay"), "Parents pay with Private · Coach A credits.", "it uses that coach's private credits");
  c.input("#schOoCoach", "Coach B");
  eq(c.text("#schOoPay"), "Parents pay with Private · Coach B credits.", "…and follows the coach");
  c.input("#schOoCoach", "Coach A");
  c.input("#schOoTime", "12:00");
  c.click("#schOoGo");
  await c.tick(60);
  const made = db.dump().oneOffs.slice(-1)[0];
  eq(made.programmeId, "private", "a private session was created");
  eq(made.capacity, 1, "with a single place");
  const occ = db.occurrence(date + "|" + made.id);
  eq(occ.creditType, "private-coach-a", "it needs that coach's private credits");
  eq(occ.creditTypeName, db.creditTypeShort("private-coach-a"), "…named on the occurrence");
  c.Admin.closeDrawer();
  await c.go("#schedule?week=" + nw);
  const fresh = cardOf(c, occ.key);
  eq(norm(fresh.querySelector(".sch-card__who").textContent), "No student booked yet", "an empty session says so");
  ok(fresh.querySelector(".sch-card__who.is-free"), "…quietly");

  // once a child books it, the name shows
  const family = db.families().find((f) => db.children(f.id).length);
  const child = db.children(family.id)[0];
  db.adjustCredits(family.id, 1, { creditType: "private-coach-a", reason: "Manual adjustment", by: "admin" });
  ok(db.book(occ.key, child.id, { by: "admin", source: "staff" }).ok, "the child books the session");
  await c.tick();
  eq(norm(cardOf(c, occ.key).querySelector(".sch-card__who").textContent), child.name, "the student's name appears");
  ok(!/Full/.test(cardOf(c, occ.key).querySelector(".sch-card__chips").textContent), "a booked private session isn't shouted as Full");

  eq(c.errors.length, 0, "no page errors: " + c.errors.join(" | "));
  c.close();
}

/* a camp: sessions on several date ranges under one name */
async function campFlows() {
  const c = await openConsole({ staff: "admin", hash: "#schedule", now: NOON });
  const db = c.HC.db;
  const t = db.todayISO();
  const ws = db.weekStart(t);
  const pl = (n, one, many) => n + " " + (n === 1 ? one : many);
  const R = [[14, 18], [21, 25], [28, 32]].map(([a, b]) => [db.addDays(ws, a), db.addDays(ws, b)]);
  const rows = () => c.$$("#schOoRanges .sch-range");
  const setRange = (i, from, to) => {
    c.input(rows()[i].querySelector("[data-range-from]"), from);
    c.input(rows()[i].querySelector("[data-range-to]"), to);
  };
  const summary = () => c.text("#schOoCheck .sch-camp__sum");

  c.click("#schAdd");
  await c.tick(5);
  ok(c.$("#schOoMany").hidden && c.$("#schOoName").disabled, "the camp fields start hidden and out of the way");
  c.click("#schOoModeMany");
  await c.tick(5);
  eq(c.$("#schOoModeMany").getAttribute("aria-pressed"), "true", "switching to several dates");
  ok(!c.$("#schOoMany").hidden && c.$("#schOoDateField").hidden, "the single date gives way to ranges");
  ok(/several dates under one name/.test(c.text(".modal__sub")), "the dialog explains itself");
  eq(rows().length, 1, "one date range to begin with");
  eq(c.$$("#schOoDays [data-wd]").map((b) => b.getAttribute("aria-pressed")).join(),
    "true,true,true,true,true,false,false", "weekdays are on, the weekend is off");
  eq(c.text("#schOoPay"), "Parents pay with Junior credits.", "the credit type shows here too");

  c.input("#schOoTime", "12:00");
  setRange(0, R[0][0], R[0][1]);
  c.click("#schOoAddRange"); await c.tick(5);
  setRange(1, R[1][0], R[1][1]);
  c.click("#schOoAddRange"); await c.tick(5);
  setRange(2, R[2][0], R[2][1]);
  eq(summary(), "Creates 15 sessions · " + db.formatDate(R[0][0]) + " – " + db.formatDate(R[2][1]), "the preview counts the sessions");
  eq(c.$$("#schOoCheck .sch-camp__list li").length, 3, "the dates are grouped by range");
  eq(c.$$("#schOoCheck .sch-camp__d").length, 15, "every date is listed");
  eq(c.$("#schOoGo").textContent.trim(), "Add 15 sessions", "the button counts them too");

  // weekday chips
  c.click("#schOoDay-2"); await c.tick(5);
  ok(/^Creates 12 sessions/.test(summary()), "turning Wednesday off drops three sessions");
  c.click("#schOoDay-2"); await c.tick(5);
  ok(/^Creates 15 sessions/.test(summary()), "…and back again");

  // clashes and dates that have already gone
  c.input("#schOoTime", "16:00");
  ok(/Clashes with Coach A’s classes on 15 dates/.test(c.text("#schOoCheck")), "clashes are counted per date");
  c.input("#schOoTime", "12:00");
  c.click("#schOoAddRange"); await c.tick(5);
  const pastFrom = db.addDays(t, -3), pastTo = db.addDays(t, -1);
  setRange(3, pastFrom, pastTo);
  const pastDates = db.datesFromRanges([{ from: pastFrom, to: pastTo }], [0, 1, 2, 3, 4]);
  ok(new RegExp(pl(pastDates.length, "date has", "dates have") + " already passed").test(c.text("#schOoCheck")),
    "dates in the past are called out");
  eq(c.$$("#schOoCheck .sch-camp__d.is-past").length, pastDates.length, "…and struck through");
  ok(/^Creates 15 sessions/.test(summary()), "…and left out of the count");

  // the cap on one batch
  c.click("#schOoDay-5"); c.click("#schOoDay-6"); await c.tick(5);
  setRange(0, db.addDays(t, 1), db.addDays(t, 70));
  ok(/you can add up to 60 at a time/.test(c.text("#schOoCheck")), "too many sessions is refused kindly");
  c.input("#schOoName", "June Boot Camp");
  const before = db.dump().oneOffs.length;
  c.click("#schOoGo"); await c.tick(5);
  ok(c.Admin.modalOpen() && /add at most 60 at a time/.test(c.text("#schOoRangesErr")), "…and blocks the submit");
  eq(db.dump().oneOffs.length, before, "nothing was added");
  c.click("#schOoDay-5"); c.click("#schOoDay-6"); await c.tick(5);
  setRange(0, R[0][0], R[0][1]);

  // the name is required
  c.input("#schOoName", "");
  c.click("#schOoGo"); await c.tick(5);
  ok(/Give the sessions a name/.test(c.text("#schOoNameErr")), "a camp needs a name");
  c.input("#schOoName", "June Boot Camp <b>");
  c.click("#schOoGo"); await c.tick(60);
  ok(!c.Admin.modalOpen(), "the dialog closes once the camp is made");
  const made = db.dump().oneOffs.slice(before);
  eq(made.length, 15, "fifteen sessions");
  const gid = made[0].groupId;
  ok(gid && made.every((o) => o.groupId === gid && o.groupName === "June Boot Camp <b>"), "all under one name");
  const g = db.oneOffGroup(gid);
  eq(g.total, 15, "the store groups them");
  ok(/^June Boot Camp <b> added — 15 sessions\./.test(lastToast(c)), "the toast: " + lastToast(c));
  ok(new RegExp(pl(pastDates.length, "date was", "dates were") + " skipped").test(lastToast(c)), "…and mentions the skipped dates");
  ok(c.window.location.hash.indexOf("week=" + R[0][0]) >= 0, "the schedule jumps to the first session");

  // the cards say which session of the camp they are
  const chip = cardOf(c, g.sessions[0].key).querySelector(".chip--group");
  eq(chip.textContent, "June Boot Camp <b> · 1/15", "session 1 of 15");
  eq(chip.children.length, 0, "the name is escaped");
  eq(c.$$(".chip--group").length, 5, "five of them this week");

  // deleting the rest of the camp in one go
  const family = db.families().find((f) => db.children(f.id).length);
  const child = db.children(family.id)[0];
  const type = g.sessions[4].creditType;
  db.adjustCredits(family.id, 2, { creditType: type, reason: "Manual adjustment", by: "admin" });
  ok(db.book(g.sessions[4].key, child.id, { by: "admin", source: "staff" }).ok, "a child books a later session");
  const wallet = db.balance(family.id, type);
  const third = g.sessions[2];
  await openMenu(c, third.key);
  ok(menuActs(c).indexOf("group") >= 0, "the admin can delete this and the later sessions");
  keydown(c, c.document.activeElement, "Escape");
  c.Admin.deleteClass(third.key);
  await c.tick(5);
  eq(c.$$('input[name="schScope"]').length, 2, "one date, or the rest of the camp");
  eq(c.$('input[name="schScope"]:checked').value, "one", "one date by default");
  eq(c.text('label[for="schScope-group"] .choice__t'), "This and the 12 later sessions of June Boot Camp <b>", "the camp scope");
  c.input("#schScope-group", true);
  ok(/13 sessions of June Boot Camp <b> will be deleted/.test(c.text("#schDelImpact")), "it says how many");
  ok(/1 booked student across 1 session will be refunded/.test(c.text("#schDelImpact")), "…and who gets credits back");
  eq(c.$("#schDelGo").textContent.trim(), "Delete 13 sessions", "the button counts them");
  c.click("#schDelGo");
  await c.tick();
  const after = db.oneOffGroup(gid);
  eq(after.sessions.filter((o) => o.status === "removed").length, 13, "thirteen sessions deleted");
  ok(after.sessions[0].status !== "removed", "the earlier sessions stay");
  eq(db.balance(family.id, type), wallet + 1, "the credit goes back to the right wallet");
  ok(/^Deleted 13 sessions of June Boot Camp <b> from/.test(lastToast(c)), "the toast: " + lastToast(c));

  eq(c.errors.length, 0, "no page errors: " + c.errors.join(" | "));
  c.close();
}

/* a coach sees camp and private sessions, but can't create or bulk-delete them */
async function coachSeesGroups() {
  const c = await openConsole({ staff: "coach-a", hash: "#schedule", now: NOON });
  const db = c.HC.db;
  const ws = db.weekStart(db.todayISO());
  const dates = db.datesFromRanges([{ from: db.addDays(ws, 7), to: db.addDays(ws, 11) }], [0, 1, 2, 3, 4]);
  const res = db.addOneOffs({
    dates, time: "12:00", programmeId: "wushu-jr", coach: "Coach A",
    capacity: 10, duration: 60, groupName: "Holiday Camp",
  }, { by: "admin" });
  ok(res.ok && res.keys.length === 5, "the admin sets up a camp for Coach A");
  await c.go("#schedule?week=" + db.addDays(ws, 7));
  eq(cardOf(c, res.keys[1]).querySelector(".chip--group").textContent, "Holiday Camp · 2/5", "the coach sees which session it is");
  await openMenu(c, res.keys[1]);
  eq(menuActs(c).join(), "open,block,delete", "…but not the camp-wide delete");
  keydown(c, c.document.activeElement, "Escape");
  c.Admin.deleteClass(res.keys[1], { scope: "group" });
  ok(!c.Admin.modalOpen() && /Only an admin can delete several sessions/.test(lastToast(c)), "which is refused: " + lastToast(c));
  c.Admin.addOneOff({ mode: "many" });
  ok(!c.Admin.modalOpen() && /added by the studio admin/.test(lastToast(c)), "and a coach can't start a camp");

  eq(c.errors.length, 0, "no page errors: " + c.errors.join(" | "));
  c.close();
}

/* the module's own source rules */
function sourceChecks() {
  const js = fs.readFileSync(path.join(ROOT, "admin/js/schedule.js"), "utf8");
  ok(!/HC\.coaches|HC\.staff\b/.test(js), "coaches come from the store, never HC.coaches");
  ok(!/HC\.programmes|HC\.getProgramme/.test(js), "programmes come from HC.db.programmes(), so Private is never missed");
  ok(/Admin\.can\("oneoff"\)/.test(js), "one-off classes are gated on the permission");
  const css = fs.readFileSync(path.join(ROOT, "admin/css/schedule.css"), "utf8");
  ok(/\.sch-card--private/.test(css) && /\.sch-card__who/.test(css), "private sessions are styled");
  ok(!/minmax\(172px/.test(css) && css.indexOf("repeat(7, calc((100% - 4 * 6px) / 5))") >= 0,
    "the week grid shows whole day columns");
  ok(/\.sch-card__time--stack b \{[^}]*white-space: nowrap/.test(css), "phone start times stay on one line");
}

(async () => {
  for (const fn of [coachHome, coachNow, coachActions, adminSchedule, addOneDate, privateSessions, campFlows, coachSeesGroups]) {
    try {
      await fn();
    } catch (e) {
      console.error("✗ " + fn.name + ": " + (e && e.message));
      throw e;
    }
  }
  sourceChecks();
  console.log(checks + " checks passed");
})();
