/* Coaches view (admin/js/coaches.js) — coaches are data.
   Cards and the profile drawer, add / edit (rename, login),
   handing a weekly class to another coach, deactivate and
   reactivate, the private credit type, and the coach guard. */
const { openConsole } = require("./dom-harness.js");

let checks = 0, failed = 0;
function ok(cond, msg) { checks++; if (!cond) { failed++; console.log("  ✗ " + msg); } }
function eq(a, b, msg) { ok(a === b, msg + " (got " + JSON.stringify(a) + ", want " + JSON.stringify(b) + ")"); }
function section(t) { console.log("— " + t); }

(async () => {
  const errors = [];
  const c = await openConsole({ staff: "admin", hash: "#coaches", now: "2026-10-06T12:00" });
  const db = c.HC.db;
  const t = (ms) => c.tick(ms || 50);
  const modal = () => c.text("#modalCard");
  const toasts = () => c.text("#toastWrap");
  const today = db.todayISO();
  const nextMon = db.addDays(db.weekStart(today), 7);

  section("the list");
  eq(c.$("#page").getAttribute("data-view"), "coaches", "view is coaches");
  eq(c.text(".page__title"), "Coaches", "title");
  ok(/hand weekly classes between coaches/.test(c.text(".page__sub")), "sub line");
  eq(c.$$(".coa-card").length, db.coaches().length, "a card per active coach");
  ok(/Can log in/.test(c.text('[data-coa-card="coach-a"]')), "Coach A can log in");
  ok(/No login/.test(c.text('[data-coa-card="coach-b"]')), "Coach B can't");
  eq(c.text('[data-coa-card="coach-b"] .coa-stat__v'), String(db.weeklyClassesFor("Coach B").length), "weekly count matches the store");
  ok(!!c.$('[data-coa-card="coach-a"] a[href^="mailto:coach.a@"]'), "email is a mailto link");
  ok(/Studio admins/.test(c.text("#coaRoot")) && /Studio Admin/.test(c.text(".coa-admins")), "studio admins listed");
  ok(!c.$(".coa-admins [data-coa-act]"), "admin rows are read-only");
  ok(!c.$("#coaInactive"), "no inactive section while everyone is active");
  ok(/Active coaches/.test(c.text(".coa-summary")), "summary strip");

  section("opening a coach");
  c.click('[data-coa-card="coach-b"] .coa-stats'); await t();
  ok(c.Admin.drawerOpen() && c.text("#drawerTitle") === "Coach B", "clicking the card opens the drawer");
  ok(c.$("#drawer").classList.contains("drawer--wide"), "wide drawer");
  c.Admin.closeDrawer();
  c.click("#coaCls-coach-a"); await t();
  eq(c.text("#drawerTitle"), "Coach A", "Classes opens that coach");
  eq(c.$$("#drawer .coa-wk").length, db.weeklyClassesFor("Coach A").length, "weekly rows match the store");
  ok(/Coming up · next 14 days/.test(c.text("#drawer")), "coming-up section");
  ok(c.$$("#drawer .coa-up[data-open-class]").length > 0, "classes link to the class panel");
  ok(/Console login/.test(c.text("#drawer .coa-kv")) && /Since/.test(c.text("#drawer .coa-kv")), "profile details");

  section("the coach's private credit type");
  ok(/Private \(Coach A\) credits/.test(c.text(".coa-private")), "the drawer mentions their private credits");
  eq(c.$("#coaDrPackages").getAttribute("data-go"), "packages", "and links to Packages");
  ok(/private-coach-a/.test(c.$("#coaDrPackages").getAttribute("data-params")), "on that credit type");
  c.click("#coaDrPackages"); await t(80);
  eq(c.$("#page").getAttribute("data-view"), "packages", "the link navigates");
  ok(!c.Admin.drawerOpen(), "and closes the drawer");
  await c.go("#coaches");

  section("add a coach — validation");
  c.click("#coaAdd"); await t();
  ok(c.Admin.modalOpen() && /Add a coach/.test(modal()), "add modal");
  c.click("#coaSave"); await t();
  ok(/Enter the coach’s name/.test(c.text("#coaNameErr")) && c.Admin.modalOpen(), "empty name");
  c.input("#coaName", "coach a"); c.click("#coaSave"); await t();
  ok(/already a staff member called Coach A/.test(c.text("#coaNameErr")), "duplicate name, from the store");
  ok(c.Admin.modalOpen(), "the modal stays open on a store error");
  c.input("#coaName", "Coach Mei");
  c.input("#coaLogin", true); await t();
  ok(/Add an email address so they can log in/.test(c.text("#coaEmailErr")), "a login needs an email");
  c.input("#coaEmail", "not-an-email"); c.click("#coaSave"); await t();
  ok(/valid email/.test(c.text("#coaEmailErr")), "email must look like one");
  c.input("#coaEmail", "COACH.A@huachengelite.com"); c.click("#coaSave"); await t();
  ok(/already used by Coach A/.test(c.text("#coaEmailErr")), "duplicate email, from the store");

  section("add a coach — success");
  c.input("#coaEmail", "mei@huachengelite.com");
  c.input("#coaTitle", "Junior programmes");
  c.input("#coaPhone", "9123 4567");
  c.click("#coaSave"); await t(80);
  const mei = db.staff().find((s) => s.name === "Coach Mei");
  ok(!!mei && mei.login && mei.title === "Junior programmes", "coach stored with a login");
  ok(!c.Admin.modalOpen(), "modal closed");
  ok(/Coach Mei added — hand them weekly classes from their profile\./.test(toasts()), "success toast");
  ok(c.Admin.drawerOpen() && c.text("#drawerTitle") === "Coach Mei", "her profile opens");
  ok(/No weekly classes/.test(c.text("#drawer")), "with nothing on the timetable yet");
  ok(db.staff({ canLogin: true }).some((s) => s.id === mei.id), "she can log in");
  ok(!!db.creditType("private-coach-mei"), "the store made her private credit type");
  ok(/Private \(Coach Mei\) credits.*Add a package/.test(c.text(".coa-private")),
    "the drawer points at Packages: " + c.text(".coa-private").slice(0, 90));
  ok(/"add":"1"/.test(c.$("#coaDrPackages").getAttribute("data-params")), "the link opens the add-package form");

  section("edit — rename");
  c.Admin.openCoach("coach-a"); await t();
  c.click("#coaDrEdit"); await t();
  ok(/Renaming updates the timetable, leave and what parents see/.test(modal()), "the form explains a rename");
  c.input("#coaName", "Coach Royce"); await t();
  ok(/Renaming Coach A to Coach Royce updates/.test(c.text("#coaFormNote")), "live note");
  c.click("#coaSave"); await t(80);
  eq(db.staffById("coach-a").name, "Coach Royce", "renamed in the store");
  eq(c.text("#drawerTitle"), "Coach Royce", "the open drawer follows");
  ok(/Saved changes to Coach Royce\./.test(toasts()), "toast");
  ok(db.occurrencesForWeek(today, { coach: "Coach Royce" }).length > 0, "the timetable uses the new name");
  eq(db.occurrencesForWeek(today, { coach: "Coach A" }).length, 0, "and nothing is left under the old one");
  ok(db.coachNames().indexOf("Coach A") < 0, "old name gone from the coach list");
  const royceType = db.creditTypes().filter((x) => x.kind === "private" && x.coach === "Coach Royce")[0];
  ok(!!royceType, "their private credit type follows the rename");
  eq(royceType.name, "Private (Coach Royce)", "and is renamed with them");
  eq(db.packages({ creditType: royceType.id }).length, 2, "its packages come along");
  eq(db.creditTypeFor({ programmeId: "private", coach: "Coach Royce" }), royceType.id,
    "a private class with them needs those credits");

  section("edit — turn a login off");
  c.click("#coaDrEdit"); await t();
  c.input("#coaLogin", false); await t();
  ok(/signed out/.test(c.text("#coaFormNote")), "warns they'll be signed out");
  c.click("#coaSave"); await t(80);
  ok(!db.staff({ canLogin: true }).some((s) => s.id === "coach-a"), "gone from the staff who can log in");
  ok(/No login/.test(c.text('[data-coa-card="coach-a"]')), "card updated");
  c.click("#coaDrEdit"); await t();
  c.click("#coaSave"); await t();
  ok(!c.Admin.modalOpen() && /No changes to save/.test(toasts()), "saving an untouched form just closes");

  section("the schedule shows the new name");
  c.Admin.closeDrawer();
  await c.go("#schedule");
  ok(/Coach Royce/.test(c.text("#page")), "schedule mentions Coach Royce");
  ok(!c.$$(".sch-card__coach").some((n) => n.textContent.trim() === "Coach A"), "no class still says Coach A");
  await c.go("#coaches");

  section("hand a weekly class over from next week");
  c.Admin.openCoach("coach-a"); await t();
  ok(!!c.$("#coaHo-m1"), "each weekly class has a hand-over button");
  c.click("#coaHo-m1"); await t();
  ok(/Hand over Wushu Tots/.test(modal()), "hand-over modal");
  const picks = c.$$("#coaHoCoach option").map((o) => o.value);
  ok(picks.indexOf("Coach Royce") < 0 && picks.indexOf("Coach Mei") >= 0, "the picker leaves out this coach: " + picks.join(","));
  eq(c.$("#coaHoFrom").value, today, "starts today by default");
  eq(c.$("#coaHoFrom").getAttribute("min"), today, "and can't start earlier");
  c.input("#coaHoFrom", db.addDays(today, -1)); await t();
  ok(/Pick today or a later date/.test(c.text("#coaHoFromErr")), "a past date is refused");
  c.input("#coaHoCoach", "Coach Mei");
  c.input("#coaHoFrom", nextMon); await t();
  ok(c.text("#coaHoHint").includes("First class with Coach Mei: " + db.formatDate(nextMon, "long")), "names the first class");
  ok(/Earlier weeks keep Coach Royce/.test(c.text("#coaHoHint")), "and says earlier weeks don't move");
  c.click("#coaHoSave"); await t(80);
  ok(!c.Admin.modalOpen(), "saved");
  ok(/is now Coach Mei’s from/.test(toasts()), "toast: " + toasts().slice(0, 80));
  eq(db.occurrence(db.occKey(db.addDays(nextMon, -7), "m1")).coach, "Coach Royce", "the week before keeps the old coach");
  eq(db.occurrence(db.occKey(nextMon, "m1")).coach, "Coach Mei", "from that Monday it's the new one");
  eq(db.occurrence(db.occKey(db.addDays(nextMon, 14), "m1")).coach, "Coach Mei", "and it stays that way");
  ok(/To Coach Mei from/.test(c.text("#drawer")), "the old coach's list shows the pending move");
  c.Admin.openCoach(mei.id); await t();
  ok(/Starting later/.test(c.text("#drawer")) && /Wushu Tots/.test(c.text("#drawer")), "the new coach sees it coming");

  section("hand-over warnings");
  c.Admin.openCoach("coach-a"); await t();
  c.click("#coaHo-w1"); await t();
  c.input("#coaHoCoach", "Coach B"); await t();
  ok(/Coach B is on leave on/.test(c.text("#coaHoWarn")), "warns when the new coach is on leave that weekday");
  ok(/Students already booked stay booked/.test(c.text("#coaHoWarn")), "and reassures about bookings");
  c.click("#modalCard [data-close]"); await t();
  const tue = db.addDays(nextMon, 1);
  ok(db.addOneOff({ date: tue, time: "16:30", programmeId: "tots", coach: "Coach B", capacity: 8 }, { by: "admin" }).ok, "a clashing one-off for Coach B");
  await t();
  c.click("#coaHo-t1"); await t();
  c.input("#coaHoCoach", "Coach B");
  c.input("#coaHoFrom", nextMon); await t();
  ok(/Timing clash on/.test(c.text("#coaHoWarn")), "warns about a clash: " + c.text("#coaHoWarn").slice(0, 90));
  c.click("#modalCard [data-close]"); await t();

  section("assign a class to a coach from their own profile");
  c.Admin.openCoach(mei.id); await t();
  c.click("#coaDrAssign"); await t();
  ok(/Assign a weekly class/.test(modal()) && c.$$("#coaHoClass option").length > 0, "class picker");
  eq(c.$$("#coaHoClass optgroup").length, 7, "grouped by day");
  ok(!c.$('#coaHoClass option[value="m1"]'), "leaves out the class that's already hers");
  c.input("#coaHoClass", "u1"); await t();
  c.click("#coaHoSave"); await t(80);
  ok(db.weeklyClassesFor("Coach Mei").some((w) => w.templateId === "u1"), "she now teaches it");

  section("a coach with classes can't be deactivated");
  c.Admin.openCoach("coach-b"); await t();
  c.click("#coaDrDeact"); await t();
  ok(/Coach B still has classes/.test(modal()), "the list of what's in the way");
  ok(/Weekly classes/.test(modal()) && c.$$("#modalCard .coa-busy__item").length > 0, "weekly classes listed");
  ok(/One-off classes/.test(modal()) && c.$$("#modalCard .coa-busy__item--link").length > 0, "one-offs listed, with links");
  ok(db.staffById("coach-b").active !== false, "still active");
  c.click("#coaBusyGo"); await t(80);
  ok(!c.Admin.modalOpen() && c.text("#drawerTitle") === "Coach B", "\"Hand over classes\" opens their profile");

  // the store refuses too, if a class turns up after the pre-check
  const realCommitments = db.coachCommitments;
  db.coachCommitments = () => ({ weekly: [], oneOffs: [], covers: [] });
  c.click("#coaDrDeact"); await t();
  ok(/Deactivate Coach B\?/.test(modal()) && /no longer be able to log in/.test(modal()), "confirm explains");
  db.coachCommitments = realCommitments;
  c.click("#confirmOk"); await t(80);
  ok(/Coach B still has classes/.test(modal()), "a 'busy' refusal from the store shows the same list");
  c.click("#modalCard [data-close]"); await t();

  section("deactivate and reactivate a free coach");
  const tan = db.addCoach({ name: "Coach Tan", title: "Flips" }, { by: "admin" }).coach;
  await t(80);
  c.Admin.openCoach(tan.id); await t();
  c.click("#coaDrDeact"); await t();
  ok(/Deactivate Coach Tan\?/.test(modal()), "confirm");
  c.click("#confirmOk"); await t(80);
  eq(db.staffById(tan.id).active, false, "now inactive");
  ok(/is now inactive/.test(toasts()), "toast");
  ok(!!c.$("#coaDrReact"), "the drawer offers Reactivate");
  c.Admin.closeDrawer(); await t();
  ok(!c.$('[data-coa-card="' + tan.id + '"]'), "no card any more");
  ok(!!c.$("#coaInactive") && c.$("#coaInactive").hidden, "inactive list starts collapsed");
  eq(c.$("#coaInactiveToggle").getAttribute("aria-expanded"), "false", "and says so");
  c.click("#coaInactiveToggle"); await t();
  ok(!c.$("#coaInactive").hidden && /Coach Tan/.test(c.text("#coaInactive")), "it expands");
  c.click("#coaReact-" + tan.id); await t(80);
  ok(db.staffById(tan.id).active !== false, "reactivated");
  ok(!!c.$('[data-coa-card="' + tan.id + '"]'), "back in the grid");

  section("leave links");
  c.Admin.openCoach("coach-b"); await t();
  ok(c.$$("#drawer .coa-leave").length === db.leaves({ coach: "Coach B", from: today }).length, "upcoming leave listed");
  c.click("#coaDrLeavePage"); await t(120);
  eq(c.$("#page").getAttribute("data-view"), "leave", "the Leave link navigates");
  eq(c.$("#lvCoachFilter") && c.$("#lvCoachFilter").value, "Coach B", "and lands filtered to that coach");
  await c.go("#coaches");

  section("escaping");
  db.addCoach({ name: '<img src=x onerror="window.__x=1">' }, { by: "admin" });
  await t(80);
  ok(!c.$("#coaRoot img") && !c.window.__x, "a name is never treated as markup");
  ok(/<img src=x/.test(c.text("#coaRoot")), "it reads as plain text");
  errors.push(...c.errors);
  c.close();

  section("coaches can't manage coaches");
  const k = await openConsole({ staff: "coach-a", hash: "#coaches", now: "2026-10-06T12:00" });
  eq(k.$("#page").getAttribute("data-view"), "schedule", "a coach is redirected to My classes");
  ok(!k.$('[data-nav="coaches"]'), "no Coaches in their nav");
  k.Admin.openCoach("coach-b"); await k.tick(40);
  ok(!k.Admin.drawerOpen() && /Only the studio admin/.test(k.text("#toastWrap")), "openCoach refuses");
  k.Admin.editCoach("coach-b"); await k.tick(40);
  ok(!k.Admin.modalOpen(), "editCoach refuses");
  errors.push(...k.errors);
  k.close();

  eq(errors.length, 0, "no console errors " + JSON.stringify(errors.slice(0, 3)));
  if (failed) { console.log(failed + " of " + checks + " checks FAILED"); process.exit(1); }
  console.log(checks + " checks passed");
})().catch((err) => { console.error(err); process.exit(1); });
