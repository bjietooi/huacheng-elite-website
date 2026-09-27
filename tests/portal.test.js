/* The parent portal (login.html, portal.html, app.js) on the shared store — v4:
   credits belong to a credit TYPE (Junior / Elite / Competitive / Private per coach),
   the family shares one wallet per type, and accounts are created by the studio. */
const fs = require("fs"), path = require("path"), assert = require("assert");
const { openPortal, openPage, ROOT } = require("./dom-harness.js");

let checks = 0;
const ok = (cond, msg) => { checks++; assert.ok(cond, msg); };
const eq = (a, b, msg) => { checks++; assert.strictEqual(a, b, msg + " (got " + JSON.stringify(a) + ", want " + JSON.stringify(b) + ")"); };
const section = (name) => console.log("- " + name);
const noErrors = (c, where) => eq(c.errors.length, 0, "no console errors · " + where + (c.errors.length ? " → " + c.errors.join(" | ") : ""));

const DEMO_EMAIL = "demo@huachengelite.com";
const toasts = (c) => c.$$(".toast").map((t) => t.textContent.replace(/\s+/g, " ").trim());
const pillWallets = (c) => (c.$("#creditsPill .pt-pill__wallets") ? c.text("#creditsPill .pt-pill__wallets") : null);

// The demo family (Jane Tan, Ethan & Chloe) — ids move when the seed changes.
function demo(db) {
  const fam = db.familyByEmail(DEMO_EMAIL);
  const kids = db.children(fam.id);
  return { fam, fid: fam.id, kids, ethan: kids.find((k) => /Ethan/.test(k.name)), chloe: kids.find((k) => /Chloe/.test(k.name)) };
}
function setCredits(db, fid, typeId, n) {
  const d = n - db.balance(fid, typeId);
  if (d) db.adjustCredits(fid, d, { creditType: typeId, reason: "Correction", by: "admin", allowNegative: true });
}
function weekStartIn(db, n) { return db.addDays(db.weekStart(db.todayISO()), n * 7); }
// An open class in week n that none of the family's children are booked into.
function freeClass(db, fid, n, pred) {
  const ws = weekStartIn(db, n);
  return db.occurrencesForRange(ws, db.addDays(ws, 6))
    .find((o) => o.bookable && !db.bookings({ occKey: o.key, familyId: fid }).length && (!pred || pred(o)));
}
function eventFor(c, occ) {
  const label = c.HC.db.formatDate(occ.date, "long");
  const col = c.$$(".cal__col").find((x) => x.getAttribute("aria-label").indexOf(label) === 0);
  if (!col) return null;
  return Array.from(col.querySelectorAll(".cal__event")).find((e) =>
    e.querySelector(".cal__time").textContent === c.HC.formatTime(occ.time) &&
    e.querySelector(".cal__prog").textContent === occ.name) || null;
}
async function toWeek(c, n) {
  while (c.$("#ptWeekPrev") && !c.$("#ptWeekPrev").disabled) { c.click("#ptWeekPrev"); await c.tick(5); }
  for (let i = 0; i < n; i++) { c.click("#ptWeekNext"); await c.tick(5); }
}
const pickerOpen = (c) => !!c.$("#ptPickerBtn") && c.$("#ptPickerBtn").getAttribute("aria-expanded") === "true" && !c.$("#ptPickerPanel").hidden;
async function openPicker(c) { if (!pickerOpen(c)) { c.click("#ptPickerBtn"); await c.tick(5); } }

/* ============================================================ LOGIN (no public sign-up) */
async function login() {
  section("Login · the studio creates accounts — no sign-up anywhere");
  const html = fs.readFileSync(path.join(ROOT, "login.html"), "utf8");
  ok(!/signupForm|tabSignup|panelSignup|suParent|suEmail/.test(html), "login.html has no sign-up form or tab");
  ok(!/Create account/i.test(html), "no 'Create account' wording");
  const js = fs.readFileSync(path.join(ROOT, "app.js"), "utf8");
  ok(!/createFamily|signupForm|showEmailTaken/.test(js), "app.js has no create-account path");

  let c = await openPortal({ page: "login.html", storage: { hc_session: "{}", hc_state: "{}" } });
  const db = c.HC.db;
  eq(c.window.localStorage.getItem("hc_session"), null, "legacy hc_session removed");
  ok(db.familyByEmail(DEMO_EMAIL), "the demo family is in the seed");   // also seeds the store
  ok(c.window.localStorage.getItem("hc_db"), "shared DB saved");
  ok(!c.$("#signupForm") && !c.$("#tabSignup"), "no sign-up in the rendered page");
  ok(/Ask the studio to set up your account/.test(c.text("#loginNew")), "New here? line");
  const wa = c.$("#loginWhatsApp").getAttribute("href");
  ok(wa.indexOf("https://wa.me/" + c.HC.brand.whatsapp) === 0 && /set%20up/.test(wa), "WhatsApp link with a message: " + wa);
  eq(c.$("#loginPhone").textContent, c.HC.brand.phoneDisplay, "phone number shown");
  ok(c.$("#loginPhone").getAttribute("href").indexOf("tel:") === 0, "tel: link");
  ok(/marcus\.lim@example\.com/.test(c.text("#loginHelp")) && /any password works/.test(c.text("#loginHelp")), "seeded-email hint kept");
  const scripts = c.$$("script[src]").map((s) => s.getAttribute("src"));
  eq(scripts.join(","), "mock-data.js,hc-store.js,app.js", "script order");
  // sign in with a seeded email
  c.click('[data-fill="marcus.lim@example.com"]');
  eq(c.$("#loginEmail").value, "marcus.lim@example.com", "data-fill fills the email");
  c.input("#loginPass", "anything");
  c.submit("#loginForm");
  await c.tick();
  eq(db.session.get("parent"), db.familyByEmail("marcus.lim@example.com").id, "signed in as that family");
  noErrors(c, "login");
  c.close();

  section("Login · unknown email → demo family; demo button; stale session");
  c = await openPortal({ page: "login.html" });
  c.input("#loginEmail", "someone@nowhere.sg");
  c.submit("#loginForm");
  await c.tick();
  eq(c.HC.db.session.get("parent"), c.HC.db.familyByEmail(DEMO_EMAIL).id, "unknown email opens the demo family");
  ok(/demo family/.test(c.window.sessionStorage.getItem("hc_portal_flash") || ""), "flash queued for the portal");
  c.close();
  c = await openPortal({ page: "login.html" });
  c.click("#demoBtn");
  await c.tick();
  eq(c.HC.db.session.get("parent"), c.HC.db.familyByEmail(DEMO_EMAIL).id, "demo button signs in");
  noErrors(c, "demo button");
  c.close();
  // a session pointing at a family that no longer exists
  c = await openPortal({ page: "login.html", family: "F999" });
  c.click("#demoBtn");
  await c.tick();
  eq(c.HC.db.session.get("parent"), c.HC.db.familyByEmail(DEMO_EMAIL).id, "stale session → login still works");
  noErrors(c, "stale session on login");
  c.close();
  c = await openPortal({ family: "F999", hash: "#dashboard" });
  eq(c.$("#view-dashboard").innerHTML, "", "stale session renders no portal");
  ok(!c.$(".pt-balance") && !c.$("#creditsPill .pt-pill__wallets"), "no wallet UI painted for a stale session");
  noErrors(c, "stale session on the portal");
  c.close();
}

/* ============================================================ WALLETS */
async function wallets() {
  section("Wallets · app bar, dashboard and account show one wallet per credit type");
  const c = await openPortal({ page: "login.html" });
  const db0 = c.HC.db;
  const d0 = demo(db0);
  db0.adjustCredits(d0.fid, 3, { creditType: "elite", reason: "Correction", by: "admin" });
  const storage = c.storage;
  c.close();

  const p = await openPortal({ family: d0.fid, hash: "#dashboard", storage });
  const db = p.HC.db;
  const d = demo(db);
  const jr = db.balance(d.fid, "junior"), el = db.balance(d.fid, "elite");
  ok(jr > 0 && el === 3, "seeded Junior wallet plus an Elite one");
  eq(db.balance(d.fid), jr + el, "the store's total is every wallet");
  eq(pillWallets(p), "Junior " + jr + " · Elite " + el, "pill lists each wallet");
  ok(/Junior classes: \d+ credits, Elite classes: 3 credits/.test(p.$("#creditsPill").getAttribute("aria-label")), "pill label names the types: " + p.$("#creditsPill").getAttribute("aria-label"));
  // dashboard card
  eq(p.$$(".pt-balance .pt-wallet").length, 2, "a card row per wallet");
  eq(p.text(".pt-balance .pt-wallet:first-child"), jr + "Junior classesTop up", "first wallet row");
  ok(/Shared by Ethan & Chloe/.test(p.text(".pt-balance")), "shared-by note");
  p.click('.pt-balance .pt-wallet [data-action="credits-type"][data-arg="elite"]');
  await p.tick();
  eq(p.App.view(), "credits", "Top up → credits view");
  ok(p.$("#ptType-elite"), "the Elite group is on screen");
  // account
  await p.go("#account");
  eq(p.$$(".pt-acwallet").length, 2, "account lists both wallets");
  ok(/Junior classes/.test(p.text(".pt-acwallets")) && /Elite classes/.test(p.text(".pt-acwallets")), "wallet names");
  ok(!/one credit balance/.test(p.text(".pt-children")), "no single-balance wording left");
  // many wallets → a compact "Credits" pill
  db.adjustCredits(d.fid, 2, { creditType: "competitive", reason: "Correction", by: "admin" });
  await p.tick();
  ok(p.$("#creditsPill").classList.contains("pt-pill--short") && !p.$("#creditsPill .pt-pill__wallets"), "3 wallets → Credits pill");
  eq(p.text("#creditsPill"), "◆Credits", "compact pill text");
  ok(/Competitive/.test(p.$("#creditsPill").getAttribute("aria-label")), "label still lists every wallet");
  p.click("#creditsPill");
  await p.tick();
  eq(p.App.view(), "credits", "pill opens the credits view");
  noErrors(p, "wallets");
  const out = p.storage;
  p.close();
  return out;
}

/* ============================================================ SCHEDULE + BOOKING */
async function scheduleAndBooking(storage) {
  section("Schedule · every class shows which credits it uses");
  const p = await openPortal({ family: demoId(storage), hash: "#schedule", storage });
  const db2 = p.HC.db;
  const dd = demo(db2);
  setCredits(db2, dd.fid, "elite", 0);
  setCredits(db2, dd.fid, "competitive", 0);
  setCredits(db2, dd.fid, "junior", 8);
  await p.tick();
  ok(/Your family has Junior 8/.test(p.text("#view-schedule .view__sub")), "sub lists the wallets: " + p.text("#view-schedule .view__sub").slice(0, 120));
  await toWeek(p, 2);
  const jrOcc = freeClass(db2, dd.fid, 2, (o) => o.creditType === "junior");
  const elOcc = freeClass(db2, dd.fid, 2, (o) => o.creditType === "elite");
  eq(db2.creditTypeFor(jrOcc), "junior", "junior class needs junior credits");
  let ev = eventFor(p, jrOcc);
  ok(ev && /◆Junior/.test(ev.textContent), "each class names its credit type");
  ok(ev && ev.querySelector('[data-action="book"]'), "bookable with Junior credits");
  ev = eventFor(p, elOcc);
  const buy = ev && ev.querySelector(".cal__book--buy");
  ok(buy, "no Elite credits → a Buy button instead of Book");
  eq(buy.textContent, "Buy Elite credits", "Buy CTA names the type");
  eq(buy.getAttribute("data-arg"), "elite", "CTA carries the credit type");
  // the store refuses the wrong type too
  const refused = db2.book(elOcc.key, dd.ethan.id, { familyId: dd.fid, by: "parent:" + dd.fid });
  eq(refused.ok, false, "store refuses a class without its own credits");
  eq(refused.code, "credits", "code credits");
  eq(refused.creditType, "elite", "refusal names the type");
  p.click(buy);
  await p.tick();
  eq(p.App.view(), "credits", "Buy Elite credits → credits view");
  ok(p.$("#ptType-elite"), "Elite packages in view");
  await p.go("#schedule");
  await toWeek(p, 2);

  section("Booking · dropdown picks several children; the summary is in typed credits");
  const multi = freeClass(db2, dd.fid, 2, (o) => o.creditType === "junior" && o.spotsLeft >= 3);
  p.click('[data-action="book"][data-arg="' + multi.key + '"]');
  await p.tick();
  ok(p.$("#modal").classList.contains("is-open"), "dialog open");
  ok(/Junior/.test(p.text(".pt-classinfo")), "class info shows the credit chip");
  eq(p.$("#ptPickerBtn").getAttribute("aria-haspopup"), "true", "dropdown button");
  eq(p.text("#ptPickerValue"), "Ethan", "first child not booked is the default");
  eq(p.text(".pt-summary"), "Ethan · uses 1 Junior credit · Junior 8 → 7", "typed summary");
  await openPicker(p);
  eq(p.$$('#ptPickerPanel input[type="checkbox"][value]').length, 2, "a checkbox per child");
  p.input("#ptPickAll", true);
  await p.tick(5);
  eq(p.text("#ptPickerValue"), "Ethan & Chloe", "select all");
  eq(p.text(".pt-summary"), "Ethan & Chloe · uses 2 Junior credits · Junior 8 → 6", "summary for two");
  eq(p.text("#ptBookConfirm"), "Book Ethan & Chloe · 2 Junior credits", "confirm label");
  p.click("#ptPickerDone");
  await p.tick(5);
  p.click("#ptBookConfirm");
  await p.tick();
  eq(db2.balance(dd.fid, "junior"), 6, "two Junior credits used");
  eq(db2.bookings({ occKey: multi.key, familyId: dd.fid }).length, 2, "two bookings");
  ok(db2.bookings({ occKey: multi.key, familyId: dd.fid }).every((b) => b.creditType === "junior"), "bookings carry the type");
  ok(toasts(p).some((t) => /Booked! Ethan & Chloe/.test(t)), "success toast");
  eq(pillWallets(p), "Junior 6", "pill updated");

  section("Booking · not enough credits of that type");
  setCredits(db2, dd.fid, "junior", 1);
  await p.tick();
  const two = freeClass(db2, dd.fid, 2, (o) => o.creditType === "junior" && o.spotsLeft >= 2);
  p.click('[data-action="book"][data-arg="' + two.key + '"]');
  await p.tick();
  await openPicker(p);
  p.input("#ptPickAll", true);
  await p.tick(5);
  ok(/Not enough Junior credits — this class needs 2 and your family has 1\./.test(p.text("#modalContent")), "typed shortfall message: " + p.text("#modalContent .pt-alert"));
  ok(p.$("#ptBookConfirm").disabled, "confirm disabled");
  eq(p.text("#ptBuyCredits"), "Buy Junior credits", "CTA names the type");
  p.click("#ptBuyCredits");
  await p.tick();
  eq(p.App.view(), "credits", "→ credits view");
  ok(p.$("#ptType-junior"), "Junior group in view");
  noErrors(p, "schedule + booking");
  const out = p.storage;
  p.close();
  return out;
}

/* ============================================================ CREDITS */
async function credits(storage) {
  section("Credits · packages grouped by credit type, private types included");
  const p = await openPortal({ family: demoId(storage), hash: "#credits", storage });
  const db = p.HC.db;
  const d = demo(db);
  const pk = db.packagesFor(d.fid);
  ok(pk.length >= 10, "packagesFor returns the shop");
  // wallet bar
  ok(/Your credits/.test(p.text(".pt-walletbar")), "wallet bar");
  eq(p.$$(".pt-walletbar__w").length, db.balances(d.fid).length, "a wallet chip per type");
  // the family's own type first, the rest behind a toggle
  eq(p.$$(".pt-pkgs__title").map((t) => t.textContent).join("|"), "Junior classes", "only the family's type at first");
  eq(p.text("#ptType-junior .pt-pkgs__note"), "Credits for Junior classes only.", "group note");
  ok(/Ethan & Chloe train here/.test(p.text("#ptType-junior")), "group says who trains there");
  ok(/◆\d+ now/.test(p.text("#ptType-junior .pt-pkgs__bal")), "group shows that wallet");
  const jrCards = p.$$("#ptType-junior .pkg");
  eq(jrCards.length, pk.filter((x) => x.creditType === "junior" && !x.trial).length, "every Junior package card");
  ok(/5 Classes/.test(jrCards[0].textContent) && /\$220/.test(jrCards[0].textContent) && /Buy/.test(jrCards[0].textContent), "card: name, price, Buy");
  ok(/5 credits for Junior classes · \$44 per class/.test(jrCards[0].textContent), "card note names the type");
  eq(p.$("#ptOtherRates").getAttribute("aria-expanded"), "false", "other rates collapsed");
  p.click("#ptOtherRates");
  await p.tick();
  const titles = p.$$(".pt-pkgs__title").map((t) => t.textContent);
  ok(titles[0] === "Junior classes" && titles.indexOf("Elite classes") > 0, "own type first, others after");
  ok(titles.some((t) => /^Private \(Coach /.test(t)), "private credit types have their own group: " + titles.join(" | "));
  const priv = p.$$(".pt-pkgs").find((s) => /^Private \(Coach /.test(s.querySelector(".pt-pkgs__title").textContent));
  const privName = priv.querySelector(".pt-pkgs__title").textContent;
  eq(priv.querySelector(".pt-pkgs__note").textContent, "Credits for " + privName + " classes only.", "private group note");
  ok(/Single session/.test(priv.textContent) && /\$200|\$160/.test(priv.textContent), "private package cards");
  ok(!p.$(".pkg.is-trial"), "no trial card for an established family");

  section("Credits · PayNow adds to that type's wallet");
  const before = db.balance(d.fid, "elite");
  const eliteBtn = p.$("#ptType-elite .pkg__btn");
  p.click(eliteBtn);
  await p.tick();
  eq(p.text("#modalTitle"), "Complete payment", "PayNow modal");
  ok(/Elite classes/.test(p.text("#modalContent")), "PayNow names the credit type");
  p.click("#payConfirm");
  await p.tick();
  const bought = db.ledger({ familyId: d.fid, type: "purchase" })[0];
  eq(bought.creditType, "elite", "purchase lands in the Elite wallet");
  eq(db.balance(d.fid, "elite"), before + bought.delta, "wallet grew");
  ok(toasts(p).some((t) => /Elite credit/.test(t)), "toast names the type: " + toasts(p).slice(-1));

  section("Credits · history has a credit-type chip, that wallet's balance, and a type filter");
  const rows = db.ledgerWithBalance(d.fid);
  const first = p.$(".pt-ledger tbody tr");
  ok(/Credits purchased/.test(first.textContent), "newest row is the purchase");
  eq(first.querySelector(".pt-chip--credit").textContent, "Elite", "credit-type chip");
  eq(first.querySelector(".pt-ledger__bal").textContent.replace("Elite balance ", ""), String(rows[0].balanceAfter), "balance within that wallet");
  ok(p.$$(".pt-ledger tbody tr").some((r) => r.querySelector(".pt-chip--kid")), "class rows also name the child");
  eq(p.$("#ptLedgerType-all").getAttribute("aria-pressed"), "true", "type filter starts on All");
  p.click("#ptLedgerType-junior");
  await p.tick();
  const shown = p.$$(".pt-ledger tbody tr");
  ok(shown.length && shown.every((r) => r.querySelector(".pt-chip--credit").textContent === "Junior"), "filtered to Junior rows");
  const jrRows = rows.filter((l) => l.creditType === "junior");
  eq(shown[0].querySelector(".pt-ledger__bal").textContent.replace("Junior balance ", ""), String(jrRows[0].balanceAfter), "Junior wallet balance");
  p.click("#ptLedgerType-all");
  await p.tick();
  // child filter still works
  p.click("#ptLedgerKid-" + d.chloe.id);
  await p.tick();
  ok(p.$$(".pt-ledger tbody tr").every((r) => r.querySelector(".pt-chip--kid").textContent === "Chloe"), "child filter");
  p.click("#ptLedgerKid-all");
  await p.tick();
  noErrors(p, "credits");
  p.close();

  section("Credits · a brand-new family sees the trial card once");
  const b = await openPortal({ page: "login.html" });
  const nf = b.HC.db.createFamily({ parentName: "Nora Neo", email: "nora.neo@example.com", phone: "+65 9000 0001",
    children: [{ name: "Nia Neo", age: 6 }] }, { by: "admin" });
  ok(nf.ok && b.HC.db.trialEligible(nf.family.id), "new family is trial-eligible");
  const st = b.storage;
  b.close();
  const n = await openPortal({ family: nf.family.id, hash: "#credits", storage: st });
  const trial = n.$(".pkg.is-trial");
  ok(trial, "trial card shown");
  eq(trial.querySelector(".pkg__btn").textContent, "Claim free credit", "claimable");
  n.click(trial.querySelector(".pkg__btn"));
  await n.tick();
  eq(n.HC.db.balance(nf.family.id), 1, "trial credit added");
  eq(n.HC.db.ledger({ familyId: nf.family.id })[0].creditType, "junior", "trial lands in a typed wallet");
  ok(!n.$(".pkg.is-trial") || n.$(".pkg.is-trial .pkg__btn").disabled, "no second claim");
  eq(pillWallets(n), "Junior 1", "pill for the new family");
  noErrors(n, "trial");
  n.close();
}
function demoId(storage) {
  const db = JSON.parse(storage.hc_db);
  return (db.families.find((f) => f.email === DEMO_EMAIL) || {}).id;
}

/* ============================================================ NOTICES, BOOKINGS, PAGES */
async function rest(storage) {
  section("Dashboard · notices and coach feedback");
  const p = await openPortal({ family: demoId(storage), hash: "#dashboard", storage });
  const db = p.HC.db;
  const d = demo(db);
  const notices = db.notices(d.fid);
  ok(notices.length >= 1, "seed has a notice");
  ok(/cancelled by the studio/.test(p.text(".pt-notices")), "notice text");
  ok(!/national team/i.test(p.text(".pt-notices")), "staff reason stays private");
  const unread = notices.filter((n) => !n.read).length;
  eq(p.$$(".pt-notice.is-unread").length, unread, "unread highlighted");
  p.click("#ptReadAll");
  await p.tick();
  eq(db.notices(d.fid, { unreadOnly: true }).length, 0, "mark all as read");
  // the studio books a child, then removes them again
  const occ = freeClass(db, d.fid, 3, (o) => o.creditType === "junior");
  setCredits(db, d.fid, "junior", 5);
  const made = db.book(occ.key, d.chloe.id, { by: "admin", source: "staff" });
  ok(made.ok, "staff booking");
  await p.tick();
  eq(p.text(".pt-notice.is-unread .pt-notice__kind").replace(" (new)", ""), "Booked by the studio", "assigned notice label");
  ok(db.cancelBooking(made.booking.id, { by: "admin", notify: true }).ok, "studio removes the child");
  await p.tick();
  const rn = p.$$(".pt-notice.is-unread").find((n) => /removed from/.test(n.textContent));
  ok(rn, "removed notice");
  eq(rn.querySelector(".pt-notice__kind").textContent.replace(" (new)", ""), "Removed from a class", "removed notice label");
  eq(db.balance(d.fid, "junior"), 5, "the credit came back to the Junior wallet");

  section("My bookings · upcoming, past attendance and shared remarks");
  await p.go("#bookings");
  const up = db.upcomingBookings({ familyId: d.fid });
  eq(p.$$("#ptBookingsPanel .pt-bcard:not(.is-cancelled)").length, up.length, "a card per upcoming class");
  ok(p.$$("#ptBookingsPanel .pt-chip--kid").length >= 1, "child chips");
  p.click("#ptTab-past");
  await p.tick();
  const past = db.pastBookings({ familyId: d.fid });
  ok(past.length >= 1, "seed has past classes");
  ok(/Present|Late|Absent|Awaiting attendance/.test(p.text("#ptBookingsPanel")), "attendance chips");
  const withNote = past.find((b) => { const n = db.noteForBooking(b.id); return n && n.shared; });
  ok(withNote, "a past class with shared feedback");
  while (p.text("#ptBookingsPanel").indexOf(db.noteForBooking(withNote.id).text) < 0 && p.$("#ptMorePast")) { p.click("#ptMorePast"); await p.tick(5); }
  ok(p.text("#ptBookingsPanel").indexOf(db.noteForBooking(withNote.id).text) >= 0, "shared remark shown to the parent");
  const hidden = db.children(d.fid).flatMap((k) => db.notes({ childId: k.id, shared: false }));
  hidden.forEach((n) => ok(p.$$(".pt-fb__text").every((q) => q.textContent !== n.text), "staff-only note stays hidden"));
  // a coach marks attendance + shares a note live
  const yb = past[0];
  ok(db.setAttendance(yb.id, "late", { by: "coach-a" }).ok, "coach marks late");
  ok(db.saveNote({ childId: yb.childId, bookingId: yb.id, rating: 5, text: "Brilliant <i>focus</i>", shared: true }, { by: "coach-a" }).ok, "coach shares a note");
  await p.tick();
  const card = p.$$("#ptBookingsPanel .pt-bcard").find((x) => /Brilliant/.test(x.textContent));
  ok(card && /Late/.test(card.textContent) && /Outstanding/.test(card.textContent), "live attendance + rating");
  ok(card && card.textContent.indexOf("Brilliant <i>focus</i>") >= 0 && !card.querySelector(".pt-fb__text i"), "note escaped");
  noErrors(p, "notices + bookings");
  p.close();

  section("Public pages still load cleanly");
  const idx = await openPage("index.html");
  noErrors(idx, "index.html");
  ok(idx.window.HC && idx.window.HC.schedule && !idx.window.HC.app, "index keeps the static data, no portal app");
  idx.close();
  const terms = await openPage("terms.html");
  noErrors(terms, "terms.html");
  ok(/terms/i.test(terms.document.title), "terms page loaded");
  terms.close();
}

(async () => {
  await login();
  const s1 = await wallets();
  const s2 = await scheduleAndBooking(s1);
  await credits(s2);
  await rest(s2);
  console.log("\n" + checks + " checks passed");
})().catch((e) => { console.error("\nFAILED after " + checks + " checks:\n" + (e && e.stack || e)); process.exit(1); });
