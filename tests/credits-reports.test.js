/* Credits + Reports in the console (admin/js/credits.js, admin/js/reports.js) — v4.
   Credits are shared by the family and TYPED (Junior / Elite / Competitive /
   Private per coach): an adjustment names a family AND a wallet. Reports is a
   dashboard over a date range: balances as at "to", movement inside the range. */
const fs = require("fs");
const path = require("path");
const assert = require("assert");
const { openConsole, ROOT } = require("./dom-harness.js");

let checks = 0;
const ok = (cond, msg) => { checks++; assert.ok(cond, msg); };
const eq = (a, b, msg) => {
  checks++;
  assert.strictEqual(a, b, msg + " (got " + JSON.stringify(a) + ", want " + JSON.stringify(b) + ")");
};
const norm = (s) => String(s || "").replace(/\s+/g, " ").trim();
const lastToast = (c) => {
  const t = c.$$("#toastWrap .toast");
  return t.length ? norm(t[t.length - 1].textContent) : "";
};
const modalOpen = (c) => c.$("#modal").classList.contains("is-open");
const errText = (c, id) => norm(c.$("#" + id) ? c.$("#" + id).textContent : "");
const preview = (c) => norm(c.$$("#adjPreview > *").map((e) => e.textContent).join(" "));
const logRows = (c) => c.$$(".cr-log tbody tr");
const params = (el) => JSON.parse(el.getAttribute("data-params") || "{}");
const NOW = "2026-10-06T12:00";

/* ============================================================
   CREDITS — typed manual adjustments
   ============================================================ */
async function creditsPage() {
  const c = await openConsole({ staff: "admin", hash: "#credits", now: NOW });
  const db = c.HC.db;
  eq(c.$("#page").getAttribute("data-view"), "credits", "view is credits");
  eq(c.text(".page__title"), "Credits", "title");
  ok(c.$("#crAdjustBtn.btn--primary"), "primary Adjust credits button");
  ok(!c.$(".cr-tbl") && !c.$("#crSearch"), "no balances table (Students lists them)");
  ok(/one wallet per credit type/i.test(c.text(".cr-intro")), "explainer mentions one wallet per type");
  ok(/only books that kind of class/.test(c.text(".cr-intro")), "explainer: a credit books its own class type");
  eq(c.$("#crStudentsLink").getAttribute("data-go"), "students", "explainer links to Students");

  /* ---------- needs a top-up: one row per low wallet ---------- */
  const low = c.$$(".cr-low__item");
  ok(low.length > 0 && low.length <= 6, "top-up list has 1–6 wallets (" + low.length + ")");
  low.forEach((li) => {
    const famId = li.getAttribute("data-cr-low");
    const typeId = li.getAttribute("data-cr-low-type");
    ok(db.family(famId) && db.creditType(typeId), "top-up row names a family and a credit type");
    ok(db.balance(famId, typeId) <= 1, "only wallets with 1 credit or fewer");
    ok(li.querySelector(".cr-low__bal .chip--credit"), "row shows which credits (chip)");
    eq(li.querySelector('[data-cr-adjust="add"]').getAttribute("data-type"), typeId, "Add carries the credit type");
  });
  const lowFirst = low[0];
  const lowFam = lowFirst.getAttribute("data-cr-low");
  const lowType = lowFirst.getAttribute("data-cr-low-type");
  ok(lowFirst.querySelector("[data-open-family]"), "row opens the family");
  c.click(lowFirst.querySelector('[data-cr-adjust="add"]'));
  ok(modalOpen(c), "Add opens the modal");
  eq(c.$("#adjCreditType").value, lowType, "modal opens on that wallet");
  eq(c.$('[data-adj-mode="add"]').getAttribute("aria-pressed"), "true", "Add mode preselected");
  ok(c.text(".adj-fam").indexOf(db.family(lowFam).parentName) >= 0, "family preselected");
  c.Admin.closeModal();
  await c.tick();

  /* ---------- the log: credit chips + a type filter ---------- */
  eq(c.$$(".cr-log thead th").map((th) => norm(th.textContent)).join("|"),
    "When|Family|Change|Credits|Reason|Note to parent|By|Amount", "log columns include Credits");
  const manual = db.ledger({ type: "manual" });
  eq(logRows(c).length, manual.length, "every manual change is listed");
  ok(logRows(c).every((r) => r.querySelector(".cr-type .chip--credit")), "each row shows its credit type");
  const typeOpts = c.$$("#crType option").map((o) => o.value);
  eq(typeOpts[0], "all", "type filter starts with All credit types");
  db.creditTypes().forEach((t) => ok(typeOpts.indexOf(t.id) >= 0, "type filter offers " + t.id));
  const firstType = manual[0].creditType;
  c.input("#crType", firstType);
  await c.tick();
  eq(c.$("#crType").value, firstType, "type filter keeps its value");
  eq(logRows(c).length, manual.filter((l) => l.creditType === firstType).length, "log filtered by credit type");
  ok(c.text("#crLogSummary").indexOf(db.creditTypeName(firstType)) >= 0, "summary names the type");
  const months = Array.from(new Set(manual.map((l) => l.at.slice(0, 7))));
  const m = months[months.length - 1];
  c.input("#crMonth", m);
  await c.tick();
  eq(logRows(c).length, manual.filter((l) => l.creditType === firstType && l.at.slice(0, 7) === m).length,
    "month and type filters combine");
  c.input("#crType", "all");
  c.input("#crMonth", "all");
  await c.tick();
  eq(logRows(c).length, manual.length, "filters clear");

  eq(c.errors.length, 0, "no errors (credits page): " + c.errors.join("\n"));
  c.close();
}

async function adjustModal() {
  const c = await openConsole({ staff: "admin", hash: "#credits", now: NOW });
  const db = c.HC.db;
  const jane = db.familyByEmail("demo@huachengelite.com");
  const wallets = db.balances(jane.id);
  const main = wallets.slice().sort((a, b) => b.credits - a.credits)[0];

  /* ---------- wallet picker ---------- */
  c.Admin.adjustCreditsModal(jane.id, "deduct");
  ok(modalOpen(c), "modal opens for a family id");
  ok(/one wallet/.test(c.text(".modal__sub")), "subtitle says one wallet");
  ok(c.$("#adjCreditType"), "a 'which credits' picker is shown");
  eq(norm(c.text('label[for="adjCreditType"]')), "Which credits", "picker is labelled");
  eq(c.$("#adjCreditType").value, main.type.id, "defaults to the family's main wallet");
  const optText = c.$$("#adjCreditType option").map((o) => norm(o.textContent));
  db.creditTypes().forEach((t) => {
    const want = t.name + " — " + db.balance(jane.id, t.id) + " credit" + (db.balance(jane.id, t.id) === 1 ? "" : "s");
    ok(optText.indexOf(want) >= 0, "picker shows " + t.id + " with its balance (" + want + ")");
  });
  const walletLine = c.text(".adj-wallets");
  wallets.filter((w) => w.credits).forEach((w) => {
    ok(walletLine.indexOf(w.type.short) >= 0, "wallet chips list " + w.type.short);
  });
  eq(preview(c), "Jane Tan’s family · " + main.type.short + " " + main.credits + " → becomes " + (main.credits - 1) + " −1 credit",
    "preview names the family and the wallet");

  /* ---------- switching wallet changes the figures ---------- */
  const other = db.creditTypes().find((t) => t.id !== main.type.id);
  c.input("#adjCreditType", other.id);
  ok(preview(c).indexOf("Jane Tan’s family · " + db.creditTypeShort(other.id)) === 0, "preview follows the wallet: " + preview(c));
  ok(!c.$("#adjNeg").hidden, "deducting from an empty wallet warns about a negative balance");
  ok(c.text("#adjNegText").indexOf(db.creditTypeShort(other.id)) >= 0, "warning names the credit type");
  c.input("#adjCreditType", main.type.id);
  ok(c.$("#adjNeg").hidden, "no warning when the wallet covers it");

  /* ---------- a typed deduction ---------- */
  const before = db.balance(jane.id, main.type.id);
  const otherBefore = db.balance(jane.id, other.id);
  c.click('[data-adj-step="1"]');
  eq(c.$("#adjCredits").value, "2", "stepper +1");
  c.input("#adjReason", "Late cancellation / no-show");
  c.input("#adjNote", "Missed Saturday class");
  c.click("#adjSubmit");
  await c.tick(60);
  ok(!modalOpen(c), "modal closes on success");
  eq(db.balance(jane.id, main.type.id), before - 2, "that wallet is deducted");
  eq(db.balance(jane.id, other.id), otherBefore, "other wallets are untouched");
  eq(lastToast(c), "Deducted 2 " + main.type.short + " credits from Jane Tan’s family — " + (before - 2) + " left", "toast names the type");
  const entry = db.ledger({ type: "manual" })[0];
  eq(entry.familyId, jane.id, "ledger row is the family's");
  eq(entry.creditType, main.type.id, "ledger row is typed");
  eq(entry.delta, -2, "ledger delta");
  eq(entry.by, "admin", "logged against the admin");
  const row = logRows(c)[0];
  ok(row.classList.contains("is-fresh"), "new row highlighted");
  eq(norm(row.querySelector(".cr-type .chip--credit").textContent), main.type.short, "log row shows the type");

  /* ---------- the store refuses an untyped change; the form never sends one ---------- */
  const multi = db.families().filter(function (f) { return db.balances(f.id, { includeNeeded: false }).length > 1; })[0];
  if (multi) {
    const refused = db.adjustCredits(multi.id, -1, { by: "admin", reason: "Correction" });
    eq(refused.ok, false, "store refuses an untyped change when a family holds several wallets");
    eq(refused.code, "creditType", "refusal code");
  }
  const bad = db.adjustCredits(jane.id, -1, { by: "admin", reason: "Correction", creditType: "not-a-type" });
  eq(bad.ok, false, "store refuses an unknown credit type");
  eq(bad.code, "creditType", "unknown-type refusal code");
  c.click("#crAdjustBtn");
  ok(c.$("#adjFamilySearch"), "picker shown with no family");
  eq(c.$("#adjCreditType").value, "", "no wallet chosen yet");
  c.input("#adjReason", "Late cancellation / no-show");
  c.click("#adjSubmit");
  await c.tick();
  ok(modalOpen(c), "stays open when incomplete");
  eq(errText(c, "adjFamilyErr"), "Choose a family.", "family required");
  eq(errText(c, "adjTypeErr"), "Choose which credits to change.", "credit type required");
  const manualBefore = db.ledger({ type: "manual" }).length;
  c.input("#adjFamilySearch", "chloe");
  const radios = c.$$('#adjFamilyResults input[name="adjFamily"]');
  eq(radios.length, 1, "child search finds the family");
  c.input(radios[0], true);
  eq(c.$("#adjCreditType").value, main.type.id, "picking a family selects its main wallet");
  eq(errText(c, "adjTypeErr"), "", "type error clears");
  eq(db.ledger({ type: "manual" }).length, manualBefore, "nothing saved while invalid");

  /* ---------- payment at the studio quotes that wallet's package ---------- */
  c.click('[data-adj-mode="add"]');
  c.input("#adjReason", "Payment received at studio");
  ok(!c.$("#adjAmountField").hidden, "amount field shown for payments");
  c.input("#adjCredits", "10");
  const pack = db.packages({ creditType: main.type.id }).find((p) => !p.trial && p.credits === 10);
  ok(c.text("#adjAmountHint").indexOf(db.creditTypeName(main.type.id)) >= 0 &&
    c.text("#adjAmountHint").indexOf("S$" + pack.price) >= 0, "hint quotes that type's package: " + c.text("#adjAmountHint"));
  const addBefore = db.balance(jane.id, main.type.id);
  c.input("#adjAmount", String(pack.price));
  c.click("#adjSubmit");
  await c.tick(60);
  ok(!modalOpen(c), "payment saved");
  eq(db.balance(jane.id, main.type.id), addBefore + 10, "credits added to that wallet");
  eq(db.ledger({ type: "manual" })[0].amount, pack.price, "amount recorded");
  eq(lastToast(c), "Added 10 " + main.type.short + " credits to Jane Tan’s family — now has " + (addBefore + 10), "add toast");

  /* ---------- note hint (parents read it) and escaping ---------- */
  c.Admin.adjustCreditsModal(jane.id, "add");
  ok(/Note for the family/.test(c.text('label[for="adjNote"]')), "note is labelled for the family");
  ok(/Jane Tan sees this note in the family credit history/.test(c.text("#adjNoteHint")), "note hint names the parent");
  c.input("#adjReason", "Other");
  eq(norm(c.text("#adjNoteOpt")), "(required)", "note required for 'Other'");
  c.input("#adjNote", "  <b>Goodwill</b>  ");
  c.click("#adjSubmit");
  await c.tick(60);
  eq(db.ledger({ type: "manual" })[0].note, "<b>Goodwill</b>", "note trimmed");
  ok(!c.$(".cr-log b"), "note escaped in the log");
  ok(logRows(c)[0].textContent.indexOf("<b>Goodwill</b>") >= 0, "escaped note is visible");

  /* ---------- a child id still resolves to the family ---------- */
  const ethan = db.children(jane.id)[0];
  c.Admin.adjustCreditsModal(ethan.id, "add");
  ok(!c.$("#adjFamilySearch") && c.text(".adj-fam").indexOf("Jane Tan") >= 0, "child id opens that child's family");
  c.Admin.closeModal();
  c.Admin.adjustCreditsModal("nope");
  ok(c.$("#adjFamilySearch"), "unknown id opens the picker");
  c.Admin.closeModal();

  /* ---------- negative balance needs the tick box ---------- */
  const empty = db.creditTypes().find((t) => db.balance(jane.id, t.id) === 0);
  c.Admin.adjustCreditsModal(jane.id, "deduct", empty.id);
  eq(c.$("#adjCreditType").value, empty.id, "modal accepts a preselected wallet");
  c.input("#adjReason", "Private 1-to-1 lesson");
  c.click("#adjSubmit");
  await c.tick();
  ok(modalOpen(c), "blocked without allow-negative");
  ok(errText(c, "adjNegErr").indexOf("Tick the box") === 0, "negative tick box error");
  c.input("#adjAllowNeg", true);
  c.click("#adjSubmit");
  await c.tick(60);
  ok(!modalOpen(c), "saved once allowed");
  eq(db.balance(jane.id, empty.id), -1, "that wallet is now −1");
  eq(lastToast(c), "Deducted 1 " + db.creditTypeShort(empty.id) + " credit from Jane Tan’s family — now owes 1", "negative toast");

  eq(c.errors.length, 0, "no errors (adjust modal): " + c.errors.join("\n"));
  c.close();
}

async function coachCannotAdjust() {
  const c = await openConsole({ staff: "coach-a", hash: "#credits", now: NOW });
  await c.tick();
  eq(c.$("#page").getAttribute("data-view"), "schedule", "coach redirected to My classes");
  ok(!c.$('.nav[data-nav="credits"]'), "no Credits nav for a coach");
  ok(typeof c.Admin.adjustCreditsModal === "function", "entry point still exposed");
  c.Admin.adjustCreditsModal("F1", "deduct");
  ok(!modalOpen(c), "coach cannot open the modal");
  ok(/Only the studio admin/.test(lastToast(c)), "coach is told why: " + lastToast(c));
  eq(c.errors.length, 0, "no errors (coach): " + c.errors.join("\n"));
  c.close();
}

/* ============================================================
   REPORTS — ranged dashboard
   ============================================================ */
async function reportsDashboard() {
  const c = await openConsole({ staff: "admin", hash: "#reports", now: NOW });
  const db = c.HC.db;
  const today = db.todayISO();
  const rep = db.creditReport({ dormantDays: 21 });
  eq(c.$("#page").getAttribute("data-view"), "reports", "view is reports");
  eq(c.text(".page__title"), "Credits report", "title");
  eq(c.text(".page__eyebrow"), "As at " + db.formatDate(today, "long"), "eyebrow is the as-at date");
  ok(c.$("#repExport.btn--primary"), "Export CSV is primary");
  ok(!c.$(".rep-tbl") && !c.$("#repSearch"), "dashboard only — no per-family table");

  /* ---------- KPIs ---------- */
  const stats = c.$$(".rep-kpis .stat");
  eq(stats.length, 5, "5 KPI tiles");
  const statText = stats.map((s) => norm(Array.from(s.children).map((p) => p.textContent).join(" ")));
  ok(statText[0].indexOf("Total unutilised " + rep.totals.unutilised) === 0, "total unutilised: " + statText[0]);
  ok(statText[0].indexOf("as at " + db.formatDate(today, "day")) >= 0, "total tile says as at");
  ok(statText[3].indexOf("Families holding credits " + rep.totals.familiesWithCredits + " of " + rep.totals.families) === 0,
    "families tile: " + statText[3]);
  ok(statText[4].indexOf("Dormant " + rep.totals.dormantFamilies) === 0, "dormant tile: " + statText[4]);
  ok(/Every credit has a type/.test(c.text(".rep-defs")), "definitions explain typed credits");
  eq(c.$("#repHoldingLink").getAttribute("data-go"), "students", "holding tile links to Students");
  eq(JSON.stringify(params(c.$("#repHoldingLink"))), '{"credit":"holding"}', "holding link params");
  if (rep.totals.dormantFamilies) {
    eq(JSON.stringify(params(c.$("#repDormantLink"))), '{"credit":"dormant"}', "dormant link params");
  }
  eq(c.$("#repStudentsLink").getAttribute("data-go"), "students", "hand-off to Students");

  /* ---------- top families + idle, still per family ---------- */
  const holding = rep.rows.filter((r) => r.unutilised > 0)
    .sort((a, b) => b.unutilised - a.unutilised || a.family.parentName.localeCompare(b.family.parentName));
  const bars = c.$$(".rep-chart--top .rep-hbar");
  eq(bars.length, Math.min(12, holding.length), "top 12 families");
  eq(norm(bars[0].querySelector(".rep-hbar__name").textContent), holding[0].family.parentName, "bar names the parent");
  eq(bars[0].getAttribute("data-open-family"), holding[0].family.id, "bar opens the family");
  eq(bars[0].getAttribute("data-child"), holding[0].children[0].id, "bar keeps the first child in view");
  eq(c.$$(".rep-chart--idle .rep-col").length, 4, "4 idle buckets");
  rep.aging.forEach((a, i) => {
    eq(norm(c.$$(".rep-chart--idle .rep-col")[i].querySelector(".rep-col__val").textContent), String(a.credits),
      "idle bucket " + i + " credits");
  });

  /* ---------- credits by type ---------- */
  const typeBars = c.$$(".rep-chart--type .rep-tbar:not(.rep-tbar--pair)");
  eq(typeBars.length, rep.totals.byType.length, "one bar per credit type held");
  eq(norm(typeBars[0].querySelector(".chip--credit").textContent), rep.totals.byType[0].type.short, "biggest wallet type first");
  eq(norm(typeBars[0].querySelector(".rep-hbar__val").textContent), String(rep.totals.byType[0].credits), "bar value");
  ok(c.$$(".rep-chart--type .rep-tbar--pair").length > 0, "bought vs used bars");
  ok(/Bought/.test(c.text(".rep-chart--type .rep-legend")) && /Used/.test(c.text(".rep-chart--type .rep-legend")),
    "bought/used legend");
  c.click("#repView-type-table");
  await c.tick();
  const typeTable = c.$$(".rep-chart--type .rep-mini tbody tr");
  ok(typeTable.length >= rep.totals.byType.length, "table twin lists the types");
  eq(c.$$(".rep-chart--type .rep-mini thead th").map((t) => norm(t.textContent)).join("|"),
    "Credit type|Held|Bought|Used|Revenue", "type table columns");
  const junior = typeTable.map((r) => norm(r.textContent)).find((t) => t.indexOf("Junior") === 0);
  ok(junior && junior.indexOf(String(rep.totals.byType.find((x) => x.type.id === "junior").credits)) > 0,
    "Junior row carries its held total: " + junior);
  c.click("#repView-type-chart");
  await c.tick();
  ok(c.$(".rep-chart--type .rep-tbars"), "chart back");

  /* ---------- in this period: movement + activity ---------- */
  const month = c.text(".rep-month");
  ok(/In this period/.test(month), "movement card is about the period");
  ok(month.indexOf("S$" + rep.movement.revenue.toLocaleString("en-SG")) >= 0, "revenue shown");
  const netText = (rep.movement.net > 0 ? "+" : rep.movement.net < 0 ? "−" : "") + Math.abs(rep.movement.net);
  eq(norm(c.$$(".rep-flow__foot > div")[0].textContent).indexOf("Net change" + netText), 0,
    "net change comes from the store: " + norm(c.$$(".rep-flow__foot > div")[0].textContent));
  const act = rep.activity;
  ok(c.text(".rep-activity__lead").indexOf(String(act.classes)) >= 0 &&
    c.text(".rep-activity__lead").indexOf(String(act.booked)) >= 0, "classes and bookings in the period");
  const actList = c.$$(".rep-activity__list div").map((d) => norm(d.textContent));
  eq(actList.join("|"), "Present" + act.present + "|Late" + act.late + "|Absent" + act.absent + "|Not marked" + act.unmarked,
    "attendance breakdown");

  eq(c.errors.length, 0, "no errors (reports dashboard): " + c.errors.join("\n"));
  c.close();
}

async function reportsRange() {
  const c = await openConsole({ staff: "admin", hash: "#reports", now: NOW });
  const db = c.HC.db;
  const today = db.todayISO();

  /* ---------- presets ---------- */
  const presets = c.$$("[data-rep-range]").map((b) => b.getAttribute("data-rep-range"));
  eq(presets.join(","), "month,30,90,year", "four presets");
  eq(c.$("#repRange-month").getAttribute("aria-pressed"), "true", "this month is the default");
  eq(c.$("#repFrom").value, today.slice(0, 8) + "01", "from = 1st of this month");
  eq(c.$("#repTo").value, today, "to = today");
  eq(c.$("#repTo").getAttribute("max"), today, "to can never be after today");

  const monthRep = db.creditReport({ from: today.slice(0, 8) + "01", to: today });
  ok(c.text("#repRangeLabel").indexOf("balances as at") > 0, "range line explains the as-at date");

  c.click("#repRange-30");
  await c.tick(60);
  eq(c.window.location.hash, "#reports?from=" + db.addDays(today, -29) + "&to=" + today, "preset lands in the URL");
  eq(c.$("#repRange-30").getAttribute("aria-pressed"), "true", "Last 30 days is pressed");
  eq(c.$("#repFrom").value, db.addDays(today, -29), "from follows the preset");
  const rep30 = db.creditReport({ from: db.addDays(today, -29), to: today });
  ok(rep30.movement.used >= monthRep.movement.used, "a longer period uses at least as many credits");
  eq(norm(c.$$(".rep-flow__col--out .rep-flow__h span")[1].textContent),
    rep30.movement.used + rep30.movement.manualDeducted ? "−" + (rep30.movement.used + rep30.movement.manualDeducted) : "0",
    "credits out follow the range");

  c.click("#repRange-90");
  await c.tick(60);
  const rep90 = db.creditReport({ from: db.addDays(today, -89), to: today });
  ok(rep90.movement.purchased >= rep30.movement.purchased, "3 months buys at least as much as 30 days");
  eq(norm(c.$$(".rep-flow__col--in .rep-flow__h span")[1].textContent),
    "+" + (rep90.movement.purchased + rep90.movement.trial + rep90.movement.refunded + rep90.movement.manualAdded),
    "credits in follow the range");

  c.click("#repRange-year");
  await c.tick(60);
  eq(c.$("#repFrom").value, today.slice(0, 4) + "-01-01", "this year starts on 1 January");

  /* ---------- custom range, and it survives a reload ---------- */
  const from = db.addDays(today, -45), to = db.addDays(today, -15);
  c.input("#repFrom", from);
  await c.tick(60);
  c.input("#repTo", to);
  await c.tick(60);
  eq(c.window.location.hash, "#reports?from=" + from + "&to=" + to, "custom range in the URL");
  eq(c.$$("[data-rep-range]").filter((b) => b.getAttribute("aria-pressed") === "true").length, 0, "no preset pressed");
  ok(c.$("#repRangeReset"), "a reset button appears");
  ok(c.text("#repRangeLabel").indexOf(db.formatDate(to, "day")) > 0, "range line shows the chosen end: " + c.text("#repRangeLabel"));
  ok(c.text(".page__eyebrow").indexOf(db.formatDate(to, "long")) >= 0, "eyebrow follows the end of the range");
  const custom = db.creditReport({ from: from, to: to });
  eq(norm(c.$$(".rep-kpis .stat")[0].querySelector(".stat__v").textContent).split(" ")[0], String(custom.totals.unutilised),
    "KPI uses balances as at the end of the range");
  ok(custom.totals.unutilised !== db.creditReport().totals.unutilised, "an older end date gives different balances");

  const storage = c.storage;
  const hash = c.window.location.hash;
  c.close();
  const again = await openConsole({ staff: "admin", hash: hash, storage, now: NOW });
  eq(again.$("#repFrom").value, from, "a reload keeps the range (from)");
  eq(again.$("#repTo").value, to, "a reload keeps the range (to)");
  eq(again.errors.length, 0, "no errors after reload: " + again.errors.join("\n"));

  /* ---------- silly ranges are clamped ---------- */
  await again.go("#reports?from=2026-01-01&to=2099-12-31");
  eq(again.$("#repTo").value, today, "a future end date is clamped to today");
  await again.go("#reports?from=not-a-date&to=" + today);
  eq(again.$("#repFrom").value, today.slice(0, 8) + "01", "a broken from falls back to this month");
  await again.go("#reports?from=" + today + "&to=" + db.addDays(today, -10));
  eq(again.$("#repFrom").value <= again.$("#repTo").value, true, "from is never after to");
  again.click("#repRangeReset");
  await again.tick(60);
  eq(again.$("#repFrom").value, today.slice(0, 8) + "01", "reset goes back to this month");
  eq(again.errors.length, 0, "no errors (range): " + again.errors.join("\n"));
  again.close();
}

async function csvExport() {
  const c = await openConsole({ staff: "admin", hash: "#reports", now: NOW });
  const db = c.HC.db;
  const today = db.todayISO();

  c.click("#repExport");
  ok(/can’t save files/.test(lastToast(c)), "friendly guard when the browser can't save: " + lastToast(c));

  const tricky = db.createFamily({
    parentName: 'Tan, "Ah" Kow', email: "=cmd@example.com", phone: "+65 9000 0000",
    children: [{ name: "Wei, Jr", age: 8, level: "Junior" }],
  }, { by: "admin", trialCredit: true });
  ok(tricky.ok, "awkward family created");
  const dashy = db.createFamily({
    parentName: "-Dash Parent", email: "dash@example.com", phone: "+65-9123",
    children: [{ name: "Kid Dash", age: 9, level: "Elite" }],
  }, { by: "admin" });
  ok(dashy.ok, "dash family created");
  await c.tick(40);

  let csv = null, downloadName = null;
  c.window.Blob = function (parts, o) { this.parts = parts; this.type = o && o.type; };
  c.window.URL.createObjectURL = function (b) { csv = b.parts.join(""); return "blob:test"; };
  c.window.URL.revokeObjectURL = function () {};
  c.window.HTMLAnchorElement.prototype.click = function () { downloadName = this.download; };
  c.click("#repExport");
  ok(csv, "csv generated");
  const from = today.slice(0, 8) + "01";
  eq(downloadName, "huacheng-credits-" + from + "-to-" + today + ".csv", "filename carries the range");
  const rep = db.creditReport({ from: from, to: today });
  eq(lastToast(c), "Exported " + rep.rows.length + " families to " + downloadName, "export toast");
  eq(csv.charCodeAt(0), 0xFEFF, "BOM so Excel reads UTF-8");
  const lines = csv.replace(/^﻿/, "").split("\r\n").filter(Boolean);
  eq(lines[0], "Family,Children,Email,Phone,Available,By credit type,Reserved,Unutilised,Est. value (S$)," +
    "Avg price per credit (S$),Bought in period,Used in period,Refunded in period,Added by staff,Taken by staff," +
    "Revenue in period (S$),Classes attended in period,Last class,Idle days,Status", "csv header");
  eq(lines.length - 1, rep.rows.length, "one row per family");

  const jane = db.familyByEmail("demo@huachengelite.com");
  const janeRow = rep.rows.find((r) => r.family.id === jane.id);
  const janeLine = lines.find((l) => l.indexOf("Jane Tan,") === 0);
  const cells = janeLine.split(",");
  eq(cells[1], db.children(jane.id).map((k) => k.name).join("; "), "children in one cell");
  eq(cells[3], jane.phone, "phone exported as written (no apostrophe)");
  const walletText = janeRow.wallets.filter((w) => w.credits).map((w) => w.type.short + " " + w.credits).join("; ");
  ok(janeLine.indexOf(walletText) > 0, "per-type breakdown column: " + walletText);
  ok(janeLine.indexOf("," + janeRow.bought + "," + janeRow.spent + "," + janeRow.refunded + ",") > 0,
    "bought / used / refunded in the period: " + janeLine);
  ok(lines.slice(1).filter((l) => l.indexOf("Dash Parent") < 0).every((l) => l.indexOf(",'+65") < 0),
    "no apostrophe before any phone number");
  const trickyLine = lines.find((l) => l.indexOf("Kow") >= 0);
  ok(trickyLine.indexOf('"Tan, ""Ah"" Kow","Wei, Jr",') === 0, "quotes and commas escaped: " + trickyLine);
  ok(trickyLine.indexOf(",'=cmd@example.com,+65 9000 0000,") > 0, "formula guarded, phone left clean");
  ok(/,Trial only$/.test(trickyLine), "status column");
  const dashLine = lines.find((l) => l.indexOf("Dash Parent") >= 0);
  ok(dashLine.indexOf("'-Dash Parent,Kid Dash,dash@example.com,'+65-9123,") === 0,
    "guard kept for names and phone-like values with dashes: " + dashLine);

  /* ---------- the export follows the range ---------- */
  c.click("#repRange-90");
  await c.tick(60);
  csv = null;
  c.click("#repExport");
  const rep90 = db.creditReport({ from: db.addDays(today, -89), to: today });
  eq(downloadName, "huacheng-credits-" + db.addDays(today, -89) + "-to-" + today + ".csv", "filename follows the range");
  const lines90 = csv.replace(/^﻿/, "").split("\r\n").filter(Boolean);
  const jane90 = rep90.rows.find((r) => r.family.id === jane.id);
  ok(lines90.find((l) => l.indexOf("Jane Tan,") === 0).indexOf("," + jane90.bought + "," + jane90.spent + ",") > 0,
    "period figures change with the range");
  ok(jane90.spent >= janeRow.spent, "a longer period spends at least as much");

  eq(c.errors.length, 0, "no errors (csv): " + c.errors.join("\n"));
  c.close();
}

async function linksAndCoach() {
  const c = await openConsole({ staff: "admin", hash: "#reports", now: NOW });
  c.click("#repHoldingLink");
  await c.tick(60);
  eq(c.window.location.hash, "#students?credit=holding", "holding link → Students");
  eq(c.$("#page").getAttribute("data-view"), "students", "Students opens");
  await c.go("#reports");
  c.click("#repStudentsLink");
  await c.tick(60);
  eq(c.window.location.hash, "#students", "hand-off → Students");
  await c.go("#reports");
  const neg = c.$("#repNegativeLink");
  if (neg) eq(JSON.stringify(params(neg)), '{"credit":"negative"}', "negative link params");
  // a bar opens the family drawer (students.js)
  c.click(c.$(".rep-chart--top .rep-hbar .rep-hbar__track"));
  await c.tick(40);
  ok(c.$("#drawer").classList.contains("is-open"), "a bar opens the family drawer");
  c.Admin.closeDrawer();
  eq(c.errors.length, 0, "no errors (links): " + c.errors.join("\n"));
  c.close();

  const coach = await openConsole({ staff: "coach-a", hash: "#reports", now: NOW });
  await coach.tick();
  eq(coach.$("#page").getAttribute("data-view"), "schedule", "coach redirected away from Reports");
  ok(!coach.$('.nav[data-nav="reports"]'), "no Reports nav for a coach");
  ok(!coach.$(".rep"), "report not rendered for a coach");
  eq(coach.errors.length, 0, "no errors (coach reports): " + coach.errors.join("\n"));
  coach.close();
}

function styleGuards() {
  const css = {
    credits: fs.readFileSync(path.join(ROOT, "admin/css/credits.css"), "utf8"),
    reports: fs.readFileSync(path.join(ROOT, "admin/css/reports.css"), "utf8"),
  };
  Object.keys(css).forEach((k) => {
    eq((css[k].match(/\{/g) || []).length, (css[k].match(/\}/g) || []).length, k + ".css braces balance");
  });
  ok(/\.cr \.tbl-wrap \{ position: relative; \}/.test(css.credits), "scroll boxes contain their sr-only captions");
  ok(!/\.rep-tbl\b|\.rep-seg\b/.test(css.reports), "no leftover per-family table CSS");
  const js = {
    credits: fs.readFileSync(path.join(ROOT, "admin/js/credits.js"), "utf8"),
    reports: fs.readFileSync(path.join(ROOT, "admin/js/reports.js"), "utf8"),
  };
  Object.keys(js).forEach((k) => {
    ok(!/\bHC\.(coaches|staff)\b/.test(js[k]), k + ".js never reads HC.coaches / HC.staff");
    ok(!/\b(const|let)\s+[A-Za-z_$]/.test(js[k]) && !/=>/.test(js[k]), k + ".js stays ES5");
  });
}

(async () => {
  await creditsPage();
  await adjustModal();
  await coachCannotAdjust();
  await reportsDashboard();
  await reportsRange();
  await csvExport();
  await linksAndCoach();
  styleGuards();
  console.log(checks + " checks passed");
  process.exit(0);
})().catch((e) => {
  console.error("✗ " + (e && e.message ? e.message : e));
  if (e && e.stack) console.error(e.stack.split("\n").slice(1, 4).join("\n"));
  process.exit(1);
});
