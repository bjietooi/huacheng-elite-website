/* Leave (admin/js/leave.js) and the admin Today dashboard (admin/js/today.js).
   v4: leave can be a whole day or a time window, and a coach can be off
   several times in one day. The page clock is frozen so "now / passed /
   upcoming" and "already under way" are the same on every run. */
const { openConsole } = require("./dom-harness.js");

let checks = 0, failures = 0;
function ok(cond, msg) {
  checks++;
  if (!cond) { failures++; console.log("  ✗", msg); }
}
function eq(a, b, msg) { ok(a === b, msg + " (got " + JSON.stringify(a) + ", want " + JSON.stringify(b) + ")"); }
function section(name) { console.log("-", name); }
function txt(el) { return el ? el.textContent.replace(/\s+/g, " ").trim() : ""; }

// Errors thrown inside another module's file (other agents are working on those)
// are reported but not counted against this suite.
const FOREIGN = /\/admin\/js\/(students|schedule|class-drawer|credits|reports|coaches|packages)\.js:/;
function noErrors(c, label) {
  const mine = c.errors.filter((e) => !FOREIGN.test(String(e)));
  const others = c.errors.length - mine.length;
  if (others) console.log("  note: ignored " + others + " error(s) from other modules");
  eq(mine.length, 0, "no console errors (" + label + "): " + mine.join("\n"));
}

/* The frozen clock: a Thursday, 5.35pm — the 4pm class has finished, the
   5.30pm one is under way, and two more are still to come. */
const NOW = "2026-10-08T17:35";
const DAY = NOW.slice(0, 10);
const open = (opts) => openConsole(Object.assign({ now: NOW }, opts));

/* ============================================================
   LEAVE · admin — whole days
   ============================================================ */
async function leaveAdmin() {
  section("Leave · admin");
  const c = await open({ staff: "admin", hash: "#leave" });
  const db = c.HC.db, A = c.Admin;
  const today = db.todayISO();
  eq(today, DAY, "clock frozen on the test day");
  eq(c.text(".page__title"), "Leave", "title");
  ok(c.text(".page__sub").indexOf("whole day or just a few hours") >= 0, "sub mentions part of a day: " + c.text(".page__sub"));

  // coach filter comes from the store, never a static list
  const filter = c.$("#lvCoachFilter");
  eq(Array.from(filter.options).map((o) => o.value).join(","), ["all"].concat(db.coachNames()).join(","), "filter = All + coachNames");
  eq(filter.value, "all", "All coaches selected");

  // the seeded whole-day leave
  const lv = db.leaves({ from: today }).find((l) => l.allDay);
  ok(lv, "fixture: a seeded whole-day leave");
  const entry = c.$("#leave-" + lv.id);
  ok(entry && entry.classList.contains("leave-entry"), "leave entry rendered");
  ok(txt(entry).indexOf("All day") >= 0, "all-day entry carries an All day chip");
  const card = entry.closest(".leave-item");
  ok(txt(card).indexOf(db.formatDate(lv.date, "long")) >= 0, "date on the card");
  ok(txt(card).indexOf(lv.coach) >= 0, "coach on the card (admin)");
  ok(txt(entry).indexOf("Booked by") >= 0, "who booked it");
  const blocked = db.occurrencesForDate(lv.date, { coach: lv.coach }).filter((o) => o.leaveId === lv.id);
  eq(entry.querySelectorAll(".leave-occ").length, blocked.length, "one chip per blocked class");
  ok(txt(entry).indexOf(A.plural(blocked.length, "class", "classes") + " blocked") >= 0, "impact line: " + txt(entry.querySelector(".leave-item__impact-t")));
  let opened = null;
  A.openClass = (k) => { opened = k; };
  c.click(entry.querySelector(".leave-occ"));
  eq(opened, blocked[0].key, "class chip opens the class");

  // filtering
  c.input("#lvCoachFilter", "Coach A");
  ok(!c.$("#leave-" + lv.id), "Coach B's leave hidden under the Coach A filter");
  c.input("#lvCoachFilter", "all");
  ok(c.$("#leave-" + lv.id), "shown again under All");

  noErrors(c, "admin leave");
  c.close();
}

/* ============================================================
   LEAVE · part of a day
   ============================================================ */
async function partDay() {
  section("Leave · part of a day");
  const c = await open({ staff: "admin", hash: "#leave" });
  const db = c.HC.db, A = c.Admin;
  const today = db.todayISO();
  // the first day ahead where Coach A teaches more than once, so some classes stay open
  let date = null, classes = [];
  for (let i = 2; i <= 14 && !date; i++) {
    const d = db.addDays(today, i);
    const list = db.occurrencesForDate(d, { coach: "Coach A" }).filter((o) => o.status === "open");
    if (list.length >= 2 && !db.leavesOn("Coach A", d).length) { date = d; classes = list; }
  }
  ok(date, "fixture: a day ahead where Coach A teaches more than once");
  const target = classes[0];
  const window = { from: target.time, to: db.fromMinutes(db.toMinutes(target.time) + target.duration) };

  /* ---- the form ---- */
  A.addLeave({ coach: "Coach A", date: date });
  ok(A.modalOpen(), "add-leave modal open");
  eq(c.$("#lvSpanAll").getAttribute("aria-pressed"), "true", "All day is the default");
  ok(c.$("#lvTimes").hidden, "time row hidden while All day is chosen");
  ok(c.text("#lvImpact").indexOf("Blocks " + A.plural(classes.length, "class", "classes")) >= 0,
    "all-day preview blocks every class that day: " + c.text("#lvImpact"));

  c.click("#lvSpanPart");
  eq(c.$("#lvSpanPart").getAttribute("aria-pressed"), "true", "Part of the day pressed");
  eq(c.$("#lvSpanAll").getAttribute("aria-pressed"), "false", "All day released");
  ok(!c.$("#lvTimes").hidden, "time row shown");
  const def = { from: c.$("#lvTimeFrom").value, to: c.$("#lvTimeTo").value };
  eq(db.toMinutes(def.to) - db.toMinutes(def.from), 120, "a sensible two-hour window by default");
  eq(def.from, classes[0].time, "starts at the coach's next class that day");
  ok(c.$$("#lvTimeFrom option").length > 10 && c.$("#lvTimeFrom option").value === "10:00", "times come from the studio hours");

  // To must be after From
  c.input("#lvTimeTo", def.from);
  eq(c.text("#lvTimeErr"), "The end time must be after the start time.", "end after start");
  c.click("#lvSubmit");
  ok(A.modalOpen(), "not booked while the times are wrong");
  eq(db.leavesOn("Coach A", date).length, 0, "nothing written");

  // a window over the first class only
  c.input("#lvTimeFrom", window.from);
  c.input("#lvTimeTo", window.to);
  eq(c.text("#lvTimeErr"), "", "error cleared");
  const imp = db.leaveImpact("Coach A", date, window);
  eq(imp.classes.length, 1, "store: the window hits one class");
  const preview = c.text("#lvImpact");
  ok(preview.indexOf("Blocks 1 class") >= 0, "preview counts the overlapping class: " + preview);
  ok(preview.indexOf("refunds " + A.plural(imp.bookings, "student")) >= 0 || !imp.bookings, "preview counts the students refunded");
  ok(preview.indexOf(A.fmt.time(window.from) + " – " + A.fmt.time(window.to)) >= 0, "preview shows the window");
  eq(c.$$("#lvImpact .leave-impact__item").length, classes.length, "every class that day is listed");
  eq(c.$$("#lvImpact .leave-impact__item.is-unaffected").length, classes.length - 1, "the others are marked not affected");
  ok(c.text("#lvOutsideNote").indexOf("aren't affected") >= 0 || c.text("#lvOutsideNote").indexOf("isn't affected") >= 0,
    "a note says which classes are untouched: " + c.text("#lvOutsideNote"));
  ok(txt(c.$("#lvImpact .is-unaffected .chip")).indexOf("not affected") >= 0, "not-affected chip");

  c.input("#lvReason", "Medical leave");
  c.input("#lvNote", "<img src=x onerror=alert(1)> physio");
  c.click("#lvSubmit");
  await c.tick(120);
  ok(!A.modalOpen(), "modal closes on success");
  const made = db.leavesOn("Coach A", date);
  eq(made.length, 1, "one entry booked");
  eq(made[0].allDay, false, "it is a part-day entry");
  eq(made[0].from + "-" + made[0].to, window.from + "-" + window.to, "the window was stored");
  eq(made[0].reason, "Medical leave — <img src=x onerror=alert(1)> physio", "reason + note stored");
  ok(!c.$("#page img"), "the note is escaped");
  ok(c.text("#toastWrap").indexOf(A.fmt.time(window.from) + " – " + A.fmt.time(window.to)) >= 0, "toast names the window: " + c.text("#toastWrap"));
  eq(db.occurrence(target.key).status, "blocked", "the overlapping class is blocked");
  eq(db.occurrence(classes[1].key).status, "open", "the later class stays open");
  eq(db.occurrence(target.key).leaveWindow.from, window.from, "the class carries the leave window");

  /* ---- the card ---- */
  const item = c.$("#leave-" + made[0].id);
  ok(item, "part-day entry listed");
  eq(txt(item.querySelector(".leave-entry__window")), A.fmt.time(window.from) + " – " + A.fmt.time(window.to), "window shown on the entry");
  ok(txt(item).indexOf("All day") < 0, "no All day chip on a part-day entry");
  ok(item.getAttribute("aria-label").indexOf(db.formatDate(date) + " · " + db.leaveLabel(made[0]) + " · Medical leave") === 0,
    "row reads 'Tue 6 Oct · 4:00 PM – 6:00 PM · reason': " + item.getAttribute("aria-label"));
  ok(txt(item).indexOf("1 class blocked") >= 0, "impact counts only its own class");

  /* ---- a second window the same day ---- */
  const later = classes[classes.length - 1];
  const w2 = { from: later.time, to: db.fromMinutes(Math.min(db.toMinutes(later.time) + later.duration, 21 * 60 + 30)) };
  A.addLeave({ coach: "Coach A", date: date });
  c.click("#lvSpanPart");
  c.input("#lvTimeFrom", window.from);
  c.input("#lvTimeTo", window.to);
  ok(c.text("#lvImpact").indexOf("already on leave") >= 0, "an overlapping window is refused in the preview");
  c.click("#lvSubmit");
  ok(A.modalOpen(), "overlapping window not booked");
  ok(c.text("#lvFormErr").indexOf("already on leave") >= 0, "form says why: " + c.text("#lvFormErr"));
  eq(db.leavesOn("Coach A", date).length, 1, "still one entry");
  c.input("#lvTimeFrom", w2.from);
  c.input("#lvTimeTo", w2.to);
  ok(c.text("#lvImpact").indexOf("already on leave") < 0, "a free window is fine");
  c.click("#lvSubmit");
  await c.tick(120);
  const both = db.leavesOn("Coach A", date);
  eq(both.length, 2, "two windows that day");
  const dayCard = c.$("#leave-" + both[1].id).closest(".leave-item");
  eq(dayCard.querySelectorAll(".leave-entry").length, 2, "both windows grouped under one date");
  eq(dayCard.querySelectorAll(".leave-item__title").length, 1, "the date is shown once");
  ok(txt(dayCard).indexOf("2 periods off") >= 0, "the card says how many: " + txt(dayCard.querySelector(".leave-item__top")));

  /* ---- calendar markers ---- */
  if (date.slice(0, 7) !== today.slice(0, 7)) c.click("#lvCalNext");
  const cell = c.$("#lvDay-" + date);
  ok(cell.classList.contains("has-leave") && cell.classList.contains("is-part"), "part-day cell is marked differently");
  ok(!cell.classList.contains("is-leave"), "not shown as a whole day off");
  ok(cell.querySelector(".leave-cal__mark--part"), "half-filled marker");
  const tip = cell.getAttribute("title");
  ok(tip.indexOf("Coach A: " + A.fmt.time(window.from)) === 0 && tip.indexOf(A.fmt.time(w2.from)) > 0, "tooltip lists both windows: " + tip);
  ok(cell.hasAttribute("data-book-date"), "the rest of the day can still be booked");

  // whole day off looks different again
  const allDayDate = db.addDays(today, 8);
  db.addLeave({ coach: "Coach A", date: allDayDate, reason: "Annual leave" }, { by: "admin" });
  db.coaches().forEach((x) => { if (x.coach !== "Coach A") db.addLeave({ coach: x.coach, date: allDayDate, reason: "Annual leave" }, { by: "admin" }); });
  await c.tick(50);
  if (!c.$("#lvDay-" + allDayDate)) c.click("#lvCalNext");
  const full = c.$("#lvDay-" + allDayDate);
  ok(full.classList.contains("is-leave") && !full.classList.contains("is-part"), "every coach off all day → full marker");
  ok(full.hasAttribute("data-show-leave"), "a full day off opens the leave");

  /* ---- cancel one window, the other stays ---- */
  const keep = both[0].id, drop = both[1].id;
  c.click("#lvCancel-" + drop);
  ok(A.modalOpen(), "confirm opens");
  ok(c.text("#modalCard").indexOf("between") >= 0, "confirm names the hours: " + c.text(".modal__title") + " " + c.text("#modalCard").slice(0, 120));
  c.click("#confirmOk");
  await c.tick(80);
  eq(db.leavesOn("Coach A", date).length, 1, "only that window cancelled");
  ok(c.$("#leave-" + keep) && !c.$("#leave-" + drop), "the other window is still listed");
  eq(db.occurrence(later.key).status, "open", "its class reopened");
  eq(db.occurrence(target.key).status, "blocked", "the kept window still blocks its class");

  /* ---- a window across a date range ---- */
  const from = db.addDays(today, 20), to = db.addDays(from, 2);
  A.addLeave({ coach: "Coach B", date: from });
  c.click("#lvSpanPart");
  c.input("#lvTo", to);
  c.input("#lvTimeFrom", "18:00");
  c.input("#lvTimeTo", "20:00");
  const rangeText = c.text("#lvImpact");
  ok(rangeText.indexOf("3 days of leave") >= 0, "multi-day summary: " + rangeText);
  ok(rangeText.indexOf("6:00 PM – 8:00 PM each day") >= 0, "says the window applies to each day");
  eq(c.text("#lvSubmitLabel"), "Book 3 days", "submit label counts the days");
  c.click("#lvSubmit");
  await c.tick(150);
  const range = db.leaves({ coach: "Coach B", from: from, to: to });
  eq(range.length, 3, "one entry per day");
  ok(range.every((l) => !l.allDay && l.from === "18:00" && l.to === "20:00"), "same window on each day");

  noErrors(c, "part-day leave");
  c.close();
}

/* ============================================================
   LEAVE · coaches
   ============================================================ */
async function leaveCoach() {
  section("Leave · coaches");
  const c = await open({ staff: "coach-a", hash: "#leave" });
  const db = c.HC.db, A = c.Admin;
  const today = db.todayISO();
  ok(!c.$("#lvCoachFilter"), "no coach filter for a coach");
  const bLeave = db.leaves({ coach: "Coach B" })[0];
  ok(bLeave && !c.$("#leave-" + bLeave.id), "a coach can't see another coach's leave");

  // book part of a day for myself
  c.click("#lvAdd");
  ok(!c.$("#lvCoach"), "no coach picker");
  ok(c.text(".leave-fixed").indexOf("Coach A") >= 0, "my own name is fixed");
  const date = db.addDays(today, 4);
  c.input("#lvFrom", date);
  c.click("#lvSpanPart");
  c.input("#lvTimeFrom", "16:00");
  c.input("#lvTimeTo", "18:00");
  c.input("#lvReason", "Medical leave");
  c.click("#lvSubmit");
  await c.tick(120);
  const mine = db.leavesOn("Coach A", date);
  eq(mine.length, 1, "coach booked their own window");
  eq(mine[0].by, "coach-a", "booked by the coach");
  eq(mine[0].allDay, false, "part of the day");
  ok(c.$("#lvCancel-" + mine[0].id), "a coach can cancel their own leave");

  // and can't book for someone else
  A.addLeave({ coach: "Coach B", date: db.addDays(today, 5) });
  ok(c.text(".leave-fixed").indexOf("Coach A") >= 0, "still my own name");
  c.click("#lvSubmit");
  await c.tick(100);
  eq(db.leaves({ coach: "Coach B", from: db.addDays(today, 5), to: db.addDays(today, 5) }).length, 0, "nothing booked for Coach B");
  eq(db.leaves({ coach: "Coach A" }).length, 2, "booked for Coach A instead");

  // my calendar shows only my leave, with the part-day marker
  if (date.slice(0, 7) !== today.slice(0, 7)) c.click("#lvCalNext");
  const cell = c.$("#lvDay-" + date);
  ok(cell.classList.contains("is-part") && cell.querySelector(".leave-cal__dot--part"), "part-day marker on the coach calendar");
  ok(cell.getAttribute("title").indexOf("You're off: 4:00 PM – 6:00 PM") === 0, "tooltip: " + cell.getAttribute("title"));

  noErrors(c, "coach leave");
  c.close();
}

/* ============================================================
   TODAY (admin only) — classes off show the window
   ============================================================ */
async function today() {
  section("Today · admin");
  const c = await open({ staff: "admin", hash: "#today" });
  const db = c.HC.db, A = c.Admin, h = A.h;
  const day = db.todayISO();
  eq(c.$("#page").getAttribute("data-view"), "today", "admin lands on Today");

  // class states from the frozen clock
  const all = db.occurrencesForDate(day, { includeRemoved: true });
  const states = {};
  all.forEach((o) => {
    const st = h.classState(o), row = c.$('.today-card--classes [data-open-class="' + o.key + '"]');
    states[st.key] = (states[st.key] || 0) + 1;
    ok(row && row.classList.contains("today-class--" + st.key), "row state " + st.key + " for " + o.key);
    if (o.status === "open") eq(txt(row.querySelector(".chip--state")), st.label, "state chip for " + o.key);
  });
  ok(states.now >= 1 && states.passed >= 1 && states.upcoming >= 1, "fixture: a passed, a live and an upcoming class");

  // part-day leave ahead → "away 4:00 PM – 6:00 PM", not a whole day off
  const date = db.addDays(day, 3);
  const cls = db.occurrencesForDate(date, { coach: "Coach A" }).filter((o) => o.status === "open")[0];
  const win = { from: cls.time, to: db.fromMinutes(db.toMinutes(cls.time) + cls.duration) };
  const res = db.addLeave({ coach: "Coach A", date: date, reason: "Medical appointment", from: win.from, to: win.to }, { by: "admin" });
  ok(res.ok, "part-day leave booked for Coach A");
  await c.tick(60);
  const rows = c.$$("#todayAttn-off .today-attn--leave");
  const row = rows.find((r) => (r.getAttribute("data-params") || "").indexOf(res.leave.id) >= 0);
  ok(row, "the leave shows in Classes off");
  const label = A.fmt.time(win.from) + " – " + A.fmt.time(win.to);
  ok(txt(row).indexOf("Coach A away " + label) >= 0, "row shows the window: " + txt(row));
  ok(txt(row).indexOf("on leave") < 0, "it doesn't read as a whole day off");
  ok(txt(row).indexOf(A.plural(res.classes, "class", "classes") + " blocked") >= 0, "counts the blocked classes");
  ok(txt(row).indexOf("Medical appointment") >= 0, "shows the reason");

  // a whole day off still reads as "on leave", with an All day line
  const lv = db.leaves({ from: day }).find((l) => l.allDay);
  const allRow = c.$$("#todayAttn-off .today-attn--leave").find((r) => (r.getAttribute("data-params") || "").indexOf(lv.id) >= 0);
  ok(allRow && txt(allRow).indexOf(lv.coach + " on leave") >= 0, "whole-day row: " + txt(allRow));
  ok(txt(allRow).indexOf("All day") >= 0, "whole-day row says All day");

  // the leave row opens that leave on the Leave page
  await c.go("#leave");
  c.input("#lvCoachFilter", "Coach B");
  await c.go("#today");
  // the view re-rendered, so find the row again
  const again = c.$$("#todayAttn-off .today-attn--leave").find((r) => (r.getAttribute("data-params") || "").indexOf(res.leave.id) >= 0);
  ok(again, "the leave row is still there after coming back");
  c.click(again);
  await c.tick(150);
  eq(c.$("#page").getAttribute("data-view"), "leave", "lands on Leave");
  eq(c.$("#lvCoachFilter").value, "all", "the filter widens so the leave is visible");
  ok(c.$("#leave-" + res.leave.id) && c.$("#leave-" + res.leave.id).classList.contains("is-flash"), "the entry is highlighted");
  eq(c.window.location.hash, "#leave", "the show parameter is cleared");

  // coaches have no Today dashboard
  const coach = await open({ staff: "coach-a", hash: "#today" });
  eq(coach.$("#page").getAttribute("data-view"), "schedule", "a coach is sent to My classes");
  ok(!coach.$(".today-stats"), "no Today dashboard for coaches");
  noErrors(coach, "coach today");
  coach.close();

  noErrors(c, "admin today");
  c.close();
}

(async () => {
  try {
    await leaveAdmin();
    await partDay();
    await leaveCoach();
    await today();
  } catch (e) {
    failures++;
    console.log("  ✗ CRASH:", (e && e.stack) || e);
  }
  console.log("\n" + checks + " checks passed" + (failures ? ", " + failures + " failed" : ""));
  process.exit(failures ? 1 : 0);
})();
