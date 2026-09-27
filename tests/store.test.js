/* The shared store (hc-store.js) on its own — v4: typed credits.
   Credits belong to a family AND a credit type (Junior / Elite / Competitive /
   Private with one coach); packages are admin-managed; leave can be a time range. */
const fs = require("fs"), vm = require("vm"), assert = require("assert"), path = require("path");
const ROOT = path.resolve(__dirname, "..");

function boot(store = {}) {
  const localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
  };
  const window = { addEventListener() {}, localStorage };
  const ctx = vm.createContext({ window, localStorage, console, Date, Math, JSON });
  vm.runInContext(fs.readFileSync(path.join(ROOT, "mock-data.js"), "utf8"), ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, "hc-store.js"), "utf8"), ctx);
  return { HC: window.HC, store };
}

let checks = 0;
const ok = (cond, msg) => { checks++; assert.ok(cond, msg); };
const eq = (a, b, msg) => { checks++; assert.strictEqual(a, b, msg + " (got " + JSON.stringify(a) + ", want " + JSON.stringify(b) + ")"); };

const { HC, store } = boot();
const db = HC.db;
db.load();
const d = db.dump();

/* ---------- shape ---------- */
eq(d.version, 4, "store version");
ok(d.creditTypes.length >= 5 && d.packages.length >= 10, "seeded credit types and packages");

/* ---------- credit types ---------- */
const typeIds = db.creditTypes().map((t) => t.id);
["junior", "elite", "competitive", "private-coach-a", "private-coach-b"].forEach((id) =>
  ok(typeIds.includes(id), "credit type " + id));
eq(db.creditType("private-coach-a").name, "Private (Coach A)", "private type is named after its coach");
eq(db.creditTypeShort("junior"), "Junior", "short name");

/* ---------- packages ---------- */
const packs = db.packages();
ok(packs.find((p) => p.creditType === "junior" && p.credits === 10 && p.price === 425), "Junior 10-class pack");
ok(packs.find((p) => p.creditType === "private-coach-a" && p.credits === 1 && p.price === 200), "Private (Coach A) single session");
ok(packs.find((p) => p.creditType === "private-coach-b" && p.credits === 1 && p.price === 160), "Private (Coach B) single session");
ok(packs.find((p) => p.trial && p.price === 0), "free trial package");
d.ledger.forEach((l) => ok(l.creditType && db.creditType(l.creditType), "every ledger row is typed: " + l.id));

/* ---------- wallets ---------- */
const demo = db.familyByEmail("demo@huachengelite.com");
const wallets = db.balances(demo.id);
ok(wallets.length >= 1, "family holds at least one wallet");
eq(wallets.reduce((n, w) => n + w.credits, 0), db.balance(demo.id), "wallets add up to the family total");

/* ---------- a class only takes its own credits ---------- */
const nw = db.addDays(db.weekStart(db.todayISO()), 14);
const jr = db.occurrencesForRange(nw, db.addDays(nw, 6)).find((o) => o.programmeId === "wushu-jr" && o.status === "open");
const el = db.occurrencesForRange(nw, db.addDays(nw, 6)).find((o) => o.programmeId === "wushu-elite" && o.status === "open");
eq(jr.creditType, "junior", "junior class needs junior credits");
eq(el.creditType, "elite", "elite class needs elite credits");
const ethan = db.children(demo.id)[0];
const jr0 = db.balance(demo.id, "junior");
ok(db.book(jr.key, ethan.id, { familyId: demo.id }).ok, "books with the right credits");
eq(db.balance(demo.id, "junior"), jr0 - 1, "junior wallet charged");
const wrong = db.book(el.key, ethan.id, { familyId: demo.id });
ok(!wrong.ok && wrong.code === "credits" && /Elite/.test(wrong.error), "refused without elite credits: " + wrong.error);
const elitePack = packs.find((p) => p.creditType === "elite" && p.credits === 5);
ok(db.purchase(demo.id, elitePack.id).ok, "buy elite pack");
eq(db.balance(demo.id, "elite"), 5, "elite wallet topped up");
const jrHeld = db.balance(demo.id, "junior");
ok(db.book(el.key, ethan.id, { familyId: demo.id }).ok, "elite class now bookable");
eq(db.balance(demo.id, "elite"), 4, "elite wallet charged");
eq(db.balance(demo.id, "junior"), jrHeld, "other wallets untouched");
const booking = db.bookings({ occKey: el.key }).find((b) => b.childId === ethan.id);
db.cancelBooking(booking.id, { by: "admin", notify: true });
eq(db.balance(demo.id, "elite"), 5, "refund returns the same credit type");

/* ---------- private 1-to-1 ---------- */
const priv = db.occurrencesForRange(db.todayISO(), db.addDays(db.todayISO(), 21)).filter((o) => o.programmeId === "private");
ok(priv.length >= 2, "seeded private sessions");
eq(priv[0].capacity, 1, "private session is one-to-one");
ok(priv[0].creditType.indexOf("private-") === 0, "private session needs private credits");
ok(priv.some((o) => o.booked === 1), "a private session is booked");
const arjun = db.children().find((c) => c.name === "Arjun Menon");
const stranger = db.children().find((c) => c.familyId !== arjun.familyId && c.level === "Competitive");
const noPriv = db.book(priv[0].key, stranger.id, { familyId: stranger.familyId, allowFull: true });
ok(!noPriv.ok, "a family without that coach's private credits cannot book: " + noPriv.error);

/* ---------- admin-managed packages ---------- */
const added = db.addPackage({ name: "Holiday 3-pack", creditType: "junior", credits: 3, price: 150, tag: "Camp" }, { by: "admin" });
ok(added.ok && db.packages().some((p) => p.id === added.package.id), "admin adds a package");
ok(!db.addPackage({ name: "Same again", creditType: "junior", credits: 3, price: 150 }, {}).ok, "duplicate package refused");
ok(!db.addPackage({ name: "Bad type", creditType: "nope", credits: 3, price: 10 }, {}).ok, "unknown credit type refused");
ok(!db.addPackage({ name: "No credits", creditType: "junior", credits: 0, price: 10 }, {}).ok, "zero credits refused");
ok(db.updatePackage(added.package.id, { price: 165 }, { by: "admin" }).ok, "admin edits a package");
eq(db.packageById(added.package.id).price, 165, "price saved");
ok(db.retirePackage(added.package.id, { by: "admin" }).ok, "package taken off sale");
ok(!db.packages().some((p) => p.id === added.package.id), "retired package is hidden");
ok(db.packages({ includeInactive: true }).some((p) => p.id === added.package.id), "retired, never deleted");

/* ---------- manual adjustments name the credit type ---------- */
const noType = db.adjustCredits(demo.id, -1, { reason: "Correction", by: "admin" });
ok(!noType.ok && noType.code === "creditType", "adjustment must say which credits");
ok(db.adjustCredits(demo.id, -1, { creditType: "elite", reason: "Correction", by: "admin" }).ok, "typed adjustment");
eq(db.balance(demo.id, "elite"), 4, "adjustment hits the right wallet");

/* ---------- leave for part of a day ---------- */
const day = db.addDays(db.weekStart(db.todayISO()), 21);   // a Monday well ahead (Coach A teaches twice)
const classes = db.occurrencesForDate(day, { coach: "Coach A" });
ok(classes.length >= 2, "coach has several classes that day");
const first = classes[0];
const window = { from: first.time, to: db.fromMinutes(db.toMinutes(first.time) + first.duration) };
eq(db.leaveImpact("Coach A", day, window).classes.length, 1, "only the overlapping class is affected");
const lv = db.addLeave({ coach: "Coach A", date: day, from: window.from, to: window.to, reason: "Medical appointment" }, { by: "coach-a" });
ok(lv.ok && lv.classes === 1, "part-day leave booked");
eq(db.occurrence(first.key).status, "blocked", "overlapping class closes");
eq(db.occurrence(first.key).blockKind, "leave", "closed by leave");
eq(db.occurrence(classes[1].key).status, "open", "the later class still runs");
ok(/–/.test(db.leaveLabel(db.leavesOn("Coach A", day)[0])), "leave shows its time window");
ok(!db.addLeave({ coach: "Coach A", date: day, from: window.from, to: window.to }, {}).ok, "overlapping leave refused");
const last = classes[classes.length - 1];
ok(db.addLeave({ coach: "Coach A", date: day, from: last.time, to: db.fromMinutes(db.toMinutes(last.time) + last.duration) }, { by: "coach-a" }).ok, "a second, separate window is fine");
eq(db.leavesOn("Coach A", day).length, 2, "two leave windows that day");
const seededPart = db.leaves({ coach: "Coach A" }).find((l) => !l.allDay);
ok(seededPart && seededPart.from === "16:00", "demo data includes a part-day leave");
const allDay = db.leaves({ coach: "Coach B" }).find((l) => l.allDay);
ok(allDay, "whole-day leave still works");

/* ---------- report: credit types and date ranges ---------- */
const rep = db.creditReport();
ok(rep.totals.byType.length >= 2 && rep.totals.byType.every((x) => x.type && x.credits > 0), "totals split by credit type");
ok(rep.rows[0].wallets, "each family row lists its wallets");
ok(rep.activity.classes > 0, "activity counted");
const from = db.addDays(db.todayISO(), -14);
const ranged = db.creditReport({ from: from, to: db.todayISO() });
eq(ranged.movement.from, from, "movement uses the chosen range");
const older = db.creditReport({ from: db.addDays(db.todayISO(), -60), to: db.addDays(db.todayISO(), -30) });
eq(older.rows.length, rep.rows.length, "same families in every range");
ok(older.movement.used !== rep.movement.used || older.totals.available !== rep.totals.available, "a different range gives different figures");

/* ---------- families and children are made by staff ---------- */
const made = db.createFamily({ parentName: "Studio Made", email: "made@example.com", phone: "91230000", children: [{ name: "New Kid", age: 7 }] }, { by: "admin" });
ok(made.ok && db.children(made.family.id).length === 1, "admin creates a family with a child");
eq(db.balance(made.family.id), 0, "no credits until a package is bought");
ok(db.trialEligible(made.family.id), "new family can still claim the trial");

/* ---------- roster rows carry the class's own wallet ---------- */
{
  const past = db.occurrencesForDate(db.addDays(db.todayISO(), -1)).find((o) => o.booked);
  const row = db.roster(past.key)[0];
  eq(row.creditType, past.creditType, "roster says which credits the class takes");
  eq(row.wallet, db.balance(row.family.id, past.creditType), "roster wallet is that type's balance");
  eq(row.balance, db.balance(row.family.id), "roster balance is still the family total");
}

/* ---------- persistence ---------- */
const { HC: H2 } = boot(store);
eq(H2.db.balance(demo.id, "elite"), db.balance(demo.id, "elite"), "wallets survive a reload");
eq(H2.db.packages().length, db.packages().length, "packages survive a reload");

console.log("types:", db.creditTypes().map((t) => t.id + "×" + db.packages({ creditType: t.id }).length).join(" "));
console.log("demo wallets:", db.balances(demo.id).map((w) => w.type.short + " " + w.credits).join(" · "));
console.log(checks + " checks passed");

/* ---------- renaming a coach carries their private credits ---------- */
{
  const fresh = boot().HC.db;
  fresh.load();
  const sophie = fresh.children().find((c) => c.name === "Sophie Lim");
  const before = fresh.balance(sophie.familyId, "private-coach-b");
  ok(before > 0, "family holds Private (Coach B) credits");
  const rowsBefore = fresh.ledger({ creditType: "private-coach-b" }).length;
  const pkBefore = fresh.packages({ creditType: "private-coach-b" }).length;
  ok(fresh.updateCoach("coach-b", { name: "Coach Huaiyu" }, { by: "admin" }).ok, "coach renamed");
  const newId = "private-coach-huaiyu";
  eq(fresh.creditType(newId).name, "Private (Coach Huaiyu)", "private type renamed with the coach");
  eq(fresh.creditType("private-coach-b"), null, "old private type is gone");
  eq(fresh.balance(sophie.familyId, newId), before, "credits followed the rename");
  eq(fresh.ledger({ creditType: newId }).length, rowsBefore, "history followed the rename");
  eq(fresh.packages({ creditType: newId }).length, pkBefore, "packages followed the rename");
  const priv = fresh.occurrencesForRange(fresh.todayISO(), fresh.addDays(fresh.todayISO(), 21))
    .find((o) => o.programmeId === "private" && o.coach === "Coach Huaiyu");
  ok(priv && priv.creditType === newId, "private sessions need the renamed credits");
  console.log(checks + " checks passed (incl. coach rename)");
}
