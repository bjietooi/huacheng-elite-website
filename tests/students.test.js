/* The Students module of the console (admin/js/students.js) — v4.
   Students is THE list of every student with their family's typed credit
   wallets and status; admins create families, parents and students here
   (there is no public sign-up); a class only takes its own credit type. */
const assert = require("assert");
const { openConsole } = require("./dom-harness.js");

let checks = 0;
const ok = (cond, msg) => { checks++; assert.ok(cond, msg); };
const eq = (a, b, msg) => { checks++; assert.strictEqual(a, b, msg + " (got " + JSON.stringify(a) + ", want " + JSON.stringify(b) + ")"); };

const T = 60;
const safeId = (s) => String(s).replace(/[^\w-]/g, "_");
const rowIds = (c) => c.$$("#page .stu-table tbody tr").map((tr) => tr.getAttribute("data-open-student"));
const cardIds = (c) => c.$$("#page .stu-cards .stu-card__main").map((b) => b.getAttribute("data-open-student"));
const modalOpen = (c) => c.$("#modal").classList.contains("is-open");
const drawerOpen = (c) => c.$("#drawer").classList.contains("is-open");
const lastToast = (c) => { const t = c.$$("#toastWrap .toast"); return t.length ? t[t.length - 1].textContent : ""; };
const money = (n) => "S$" + Number(n || 0).toLocaleString("en-SG", { maximumFractionDigits: 0 });
const kid = (c, name) => c.HC.db.children(null, { includeInactive: true }).find((k) => k.name === name);
// one row per active student, carrying their family's credit figures (what the list shows)
const stuRows = (c, days) => c.HC.db.creditReport({ dormantDays: days || 21 }).rows
  .reduce((out, fr) => out.concat(fr.children.map((ch) => Object.assign({}, fr, { child: ch }))), []);
const openTab = async (c, childId, tab) => { c.Admin.openStudent(childId, tab); await c.tick(T); };

async function section(name, fn) {
  const before = checks;
  try { await fn(); }
  catch (e) { e.message = name + ": " + e.message; throw e; }
  console.log("  " + name + " — " + (checks - before) + " checks");
}

(async () => {
  /* ============================================================
     THE LIST — typed wallets, filters, totals
     ============================================================ */
  await section("list: students, wallets and columns", async () => {
    const c = await openConsole({ staff: "admin", hash: "#students" });
    const db = c.HC.db;
    const rows = stuRows(c);
    eq(c.$("#page").getAttribute("data-view"), "students", "view registered");
    eq(rowIds(c).length, rows.length, "one row per active student");
    eq(cardIds(c).length, rows.length, "card list mirrors the table");
    eq(rowIds(c).length, db.children().length, "every active student is listed");
    eq(c.$$(".stu-table thead th").map((t) => t.textContent.trim()).join("|"),
      "Student|Level|Credits|Unutilised|Est. value|Attendance|Last class|Next class|Status|Adjust credits", "admin columns");

    // the Credits cell shows the family's wallets as chips
    const ethan = kid(c, "Ethan Tan"), chloe = kid(c, "Chloe Tan");
    const tr = c.$('.stu-table tr[data-open-student="' + ethan.id + '"]');
    const wallets = db.balances(ethan.familyId, { includeNeeded: false });
    const cell = tr.querySelector(".stu-c-cred");
    eq(cell.querySelectorAll(".chip--credit").length, wallets.length, "one chip per wallet held");
    wallets.forEach((w) => {
      const chip = Array.from(cell.querySelectorAll(".chip--credit")).find((x) => x.getAttribute("title") === w.type.name);
      ok(chip && chip.querySelector("b").textContent === String(w.credits), "chip for " + w.type.name + " shows " + w.credits);
    });
    ok(cell.getAttribute("title").indexOf(db.creditTypeShort(wallets[0].type.id) + " " + wallets[0].credits) >= 0, "cell tooltip lists the wallets");
    eq(cell.querySelector(".cell-sub").textContent, "shared with Chloe", "siblings share the family's credits");
    eq(c.$('.stu-table tr[data-open-student="' + chloe.id + '"] .stu-c-cred').querySelectorAll(".chip--credit").length,
      wallets.length, "sibling row shows the same wallets");
    ok(/8 credits in total|credits in total/.test(cell.textContent), "the total is there for screen readers and sorting");

    // a multi-wallet family, for the rest of the checks
    const multi = stuRows(c).find((r) => r.wallets.length > 1);
    ok(multi, "fixture: a family holding more than one kind of credit");
    eq(c.$('.stu-table tr[data-open-student="' + multi.child.id + '"] .stu-c-cred').querySelectorAll(".chip--credit").length,
      multi.wallets.length, "several wallets shown side by side");

    // summary strip: per family, with a by-type line
    const withKids = db.creditReport({ dormantDays: 21 }).rows.filter((r) => r.children.length);
    const vals = c.$$(".stu-sum__v").map((v) => v.textContent);
    eq(vals[0], String(withKids.length), "summary counts each family once");
    eq(vals[3], String(withKids.reduce((s, r) => s + r.unutilised, 0)), "summary unutilised");
    eq(vals[4], money(withKids.reduce((s, r) => s + r.estValue, 0)), "summary est. value");
    const junior = withKids.reduce((s, r) => s + Math.max(0, r.byType.junior || 0), 0);
    ok(c.text(".stu-sum__types").indexOf("Junior " + junior) >= 0, "by-type line totals each wallet");

    eq(c.errors.length, 0, "no errors " + c.errors.join("\n"));
    c.close();
  });

  await section("list: credit-type filter and credit filters", async () => {
    const c = await openConsole({ staff: "admin", hash: "#students" });
    const db = c.HC.db;
    eq(c.$$("#stuCtype option").map((o) => o.value).join(","),
      ["all"].concat(db.creditTypes().map((t) => t.id)).join(","), "credit-type options");

    for (const type of ["elite", "competitive"]) {
      c.input("#stuCtype", type); await c.tick(T);
      const want = stuRows(c).filter((r) => r.byType[type]).map((r) => r.child.id).sort();
      ok(want.length, "fixture: families holding " + type + " credits");
      eq(rowIds(c).sort().join(","), want.join(","), "ctype=" + type + " lists only those students");
      ok(new RegExp("ctype=" + type).test(c.window.location.hash), "ctype in the URL");
      ok(c.text(".stu-count").indexOf("holding " + db.creditTypeShort(type) + " credits") >= 0, "count line explains the filter");
      ok(rowIds(c).every((id) => c.$('tr[data-open-student="' + id + '"] .chip--credit[title="' + db.creditTypeName(type) + '"]') != null),
        "every row really holds that wallet");
    }
    // arriving by deep link, and combining with a credit filter
    await c.go("#students?ctype=elite&credit=holding");
    const both = stuRows(c).filter((r) => r.byType.elite && r.unutilised > 0).map((r) => r.child.id).sort();
    eq(rowIds(c).sort().join(","), both.join(","), "ctype + credit filter combine");
    eq(c.$("#stuCtype").value, "elite", "select reflects the URL");
    await c.go("#students?ctype=nonsense");
    eq(c.$("#stuCtype").value, "all", "unknown credit type ignored");

    // the credit filters still work on the family total
    const tests = { holding: (r) => r.unutilised > 0, low: (r) => r.available >= 1 && r.available <= 2, none: (r) => r.available <= 0, dormant: (r) => r.dormant };
    for (const id of Object.keys(tests)) {
      c.click("#stuCredit-" + id); await c.tick(T);
      const want = stuRows(c).filter(tests[id]).map((r) => r.child.id).sort();
      eq(rowIds(c).sort().join(","), want.join(","), "credit=" + id);
      eq(c.$("#stuCredit-" + id + " .stu-seg__n").textContent, String(want.length), "count on " + id);
    }
    c.click("#stuCredit-all"); await c.tick(T);
    // sorting by credits uses the total
    c.input("#stuSort", "credits"); await c.tick(T);
    const totals = rowIds(c).map((id) => db.balance(db.child(id).familyId));
    ok(totals.every((b, i) => i === 0 || totals[i - 1] <= b), "sorted by total credits, lowest first");
    eq(c.errors.length, 0, "no errors " + c.errors.join("\n"));
    c.close();
  });

  await section("list: row actions hand the family and wallet to the credits module", async () => {
    const c = await openConsole({ staff: "admin", hash: "#students" });
    const db = c.HC.db;
    const calls = [];
    c.Admin.adjustCreditsModal = (...args) => calls.push(args);
    const one = stuRows(c).find((r) => r.wallets.length === 1);
    const many = stuRows(c).find((r) => r.wallets.length > 1);
    await c.go("#students?q=" + encodeURIComponent(one.child.name));
    c.click('.stu-table [data-stu-adjust="deduct"][data-family="' + one.family.id + '"]'); await c.tick(T);
    eq(JSON.stringify(calls[0]), JSON.stringify([one.family.id, "deduct", one.wallets[0].type.id]),
      "one wallet → (familyId, mode, creditType)");
    ok(!drawerOpen(c), "the row action does not open the drawer");
    await c.go("#students?q=" + encodeURIComponent(many.child.name));
    c.click('.stu-cards [data-stu-adjust="add"][data-family="' + many.family.id + '"]'); await c.tick(T);
    eq(JSON.stringify(calls[1]), JSON.stringify([many.family.id, "add", undefined]),
      "several wallets → the credits module asks which");
    eq(c.$('.stu-table [data-stu-adjust="add"]').getAttribute("aria-label"),
      "Add credits to " + many.family.parentName + "'s family", "labels name the family");
    const ids = c.$$("[id]").map((e) => e.id);
    eq(ids.length, new Set(ids).size, "table and card buttons keep unique ids");
    // an older credits module that only takes (familyId, mode) still works
    c.Admin.adjustCreditsModal = function (familyId, mode) { if (arguments.length > 2) throw new Error("too many"); calls.push(["legacy", familyId, mode]); };
    c.click('.stu-table [data-stu-adjust="deduct"]'); await c.tick(T);
    eq(calls[2][0], "legacy", "falls back when the third argument is refused");
    // no credits module at all
    delete c.Admin.adjustCreditsModal;
    c.Admin.refresh(); await c.tick(T);
    ok(!c.$("[data-stu-adjust]"), "no row actions without the credits module");
    eq(c.errors.length, 0, "no errors " + c.errors.join("\n"));
    c.close();
  });

  /* ============================================================
     ADD STUDENT — admins create families, parents and students
     ============================================================ */
  await section("add student: a new family", async () => {
    const c = await openConsole({ staff: "admin", hash: "#students" });
    const db = c.HC.db;
    const fams0 = db.families().length;
    ok(c.$("#stuAdd"), "primary Add student action");
    c.click("#stuAdd"); await c.tick(T);
    ok(modalOpen(c) && /Add student/.test(c.text("#modalTitle")), "modal opens");
    eq(c.$("#stuAddMode-new").getAttribute("aria-pressed"), "true", "New family by default");
    ok(!c.$("#stuAddNew").hidden && c.$("#stuAddExisting").hidden, "the new-family pane is showing");
    ok(/no public sign-up|There is no public sign-up/i.test(c.text("#stuAddNew")), "explains there is no public sign-up");
    ok(/sign in to the portal with this email/i.test(c.text("#stuAddNew")), "explains how the parent signs in");
    eq(c.$$(".stu-kidblock").length, 1, "one student block to start");

    // validation: parent, email and age
    c.click("#stuAddSave"); await c.tick(T);
    ok(modalOpen(c), "an empty form does not save");
    eq(db.families().length, fams0, "nothing created");
    ok(/Enter the parent's name/.test(c.text("#stuNewParentErr")), "parent name required");
    ok(/sign in with it|Enter the parent's email/.test(c.text("#stuNewEmailErr")), "email required");
    ok(/Enter the student's name/.test(c.text('[id^="stuNewNameErr-"]')), "student name required");
    c.input("#stuNewParent", "Tricia Neo");
    c.input("#stuNewEmail", "not-an-email");
    const kidSeq = c.$(".stu-kidblock").getAttribute("data-kid");
    c.input("#stuNewName-" + kidSeq, "Ivy Neo");
    c.input("#stuNewAge-" + kidSeq, "3");
    c.click("#stuAddSave"); await c.tick(T);
    ok(/valid email/.test(c.text("#stuNewEmailErr")), "email must look like an email");
    ok(/from age 4/.test(c.text("#stuNewAgeErr-" + kidSeq)), "students join from age 4");
    eq(db.families().length, fams0, "still nothing created");
    c.input("#stuNewEmail", "demo@huachengelite.com");
    c.input("#stuNewAge-" + kidSeq, "6");
    c.click("#stuAddSave"); await c.tick(T);
    ok(/already exists/.test(c.text("#stuNewEmailErr")), "duplicate email refused");
    eq(db.families().length, fams0, "duplicate did not create a family");

    // a second child, then save
    c.input("#stuNewEmail", "tricia.neo@example.com");
    c.input("#stuNewPhone", "+65 9000 1234");
    c.input("#stuNewLevel-" + kidSeq, "Elite");
    c.input('input[name="stuNewProg-' + kidSeq + '"][value="wushu-elite"]', true);
    c.click("#stuAddKid"); await c.tick(T);
    eq(c.$$(".stu-kidblock").length, 2, "Add another child");
    const seq2 = c.$$(".stu-kidblock")[1].getAttribute("data-kid");
    eq(c.$("#stuNewName-" + kidSeq).value, "Ivy Neo", "the first child's details survive");
    c.input("#stuNewName-" + seq2, "Owen <Neo>");
    c.input("#stuNewAge-" + seq2, "8");
    c.click("#stuAddSave"); await c.tick(T);

    ok(!modalOpen(c), "modal closes on success");
    eq(db.families().length, fams0 + 1, "family created");
    const fam = db.familyByEmail("tricia.neo@example.com");
    ok(fam && fam.parentName === "Tricia Neo" && fam.phone === "+65 9000 1234", "parent details stored");
    const kids = db.children(fam.id);
    eq(kids.length, 2, "both students created");
    const ivy = kids.find((k) => k.name === "Ivy Neo");
    ok(ivy && ivy.age === 6 && ivy.level === "Elite" && ivy.programmes.indexOf("wushu-elite") >= 0, "first student's details");
    ok(kids.find((k) => k.name === "Owen <Neo>" && k.age === 8 && k.level === "Junior"), "second student's details");
    ok(/2 students added/.test(lastToast(c)), "toast confirms");
    ok(drawerOpen(c) && c.text("#drawerTitle") === "Ivy Neo", "the new student's drawer opens");
    ok(!c.$("#drawer Neo"), "names are escaped");
    await c.go("#students?q=Neo");
    eq(rowIds(c).sort().join(","), kids.map((k) => k.id).sort().join(","), "both appear in the list");
    ok(/No credits/.test(c.text('tr[data-open-student="' + ivy.id + '"] .stu-c-status')), "a new family holds no credits yet");
    eq(c.errors.length, 0, "no errors " + c.errors.join("\n"));
    c.close();
  });

  await section("add student: an existing family, and coaches can't", async () => {
    const c = await openConsole({ staff: "admin", hash: "#students" });
    const db = c.HC.db;
    const jane = db.families().find((f) => f.parentName === "Jane Tan");
    const before = db.children(jane.id).length;
    c.click("#stuAdd"); await c.tick(T);
    c.click("#stuAddMode-existing"); await c.tick(T);
    ok(c.$("#stuAddNew").hidden && !c.$("#stuAddExisting").hidden, "switches to the existing-family pane");
    c.click("#stuAddSave"); await c.tick(T);
    ok(/Choose the family/.test(c.text("#stuFamErr")), "a family must be chosen");

    c.input("#stuFamSearch", "Ethan"); await c.tick(T);   // search by a child's name
    const opts = c.$$('input[name="stuAddFam"]').map((i) => i.value);
    ok(opts.indexOf(jane.id) >= 0, "family found by its child's name");
    ok(c.text("#stuFamList").indexOf("Ethan Tan") >= 0, "the picker lists the children");
    c.input("#stuFamSearch", "nobody-here"); await c.tick(T);
    ok(c.$("#stuFamNone"), "empty search explains itself");
    c.input("#stuFamSearch", "demo@huachengelite.com"); await c.tick(T);   // by email
    c.input("#stuFam-" + safeId(jane.id), true); await c.tick(T);
    const seq = c.$(".stu-kidblock").getAttribute("data-kid");
    c.input("#stuNewName-" + seq, "Ruby Tan");
    c.input("#stuNewAge-" + seq, "5");
    c.input('input[name="stuNewProg-' + seq + '"][value="tots"]', true);
    c.click("#stuAddSave"); await c.tick(T);
    ok(!modalOpen(c), "saved");
    const ruby = db.children(jane.id).find((k) => k.name === "Ruby Tan");
    eq(db.children(jane.id).length, before + 1, "child added to the existing family");
    ok(ruby && ruby.age === 5 && ruby.programmes[0] === "tots", "child details");
    ok(/added to Jane Tan's family/.test(lastToast(c)), "toast names the family");
    ok(drawerOpen(c) && c.text("#drawerTitle") === "Ruby Tan", "opens the new student");
    // she shares the family's credits
    await openTab(c, ruby.id, "family");
    ok(/shared by Ethan, Chloe & Ruby/.test(c.text("#drawer .stu-credit")), "the pool is now shared by three");
    eq(c.errors.length, 0, "no errors " + c.errors.join("\n"));
    c.close();

    const k = await openConsole({ staff: "coach-a", hash: "#students" });
    ok(!k.$("#stuAdd") && !k.$("#stuAddEmpty"), "coaches have no Add student button");
    const n0 = k.HC.db.families().length;
    k.Admin.openStudent && k.Admin.openStudent(kid(k, "Ethan Tan").id); await k.tick(T);
    ok(!k.$('#drawer [data-stu-act="add-child"]'), "coaches can't add a child either");
    eq(k.HC.db.families().length, n0, "no family created by a coach");
    eq(k.errors.length, 0, "no errors " + k.errors.join("\n"));
    k.close();
  });

  /* ============================================================
     DRAWER — wallets, history, family
     ============================================================ */
  await section("drawer: wallets, per-type adjust, tabs", async () => {
    const c = await openConsole({ staff: "admin", hash: "#students" });
    const db = c.HC.db;
    const calls = [];
    c.Admin.adjustCreditsModal = (...args) => calls.push(args);
    const ethan = kid(c, "Ethan Tan");
    // give the family a second wallet so both are on show
    db.adjustCredits(ethan.familyId, 3, { creditType: "elite", reason: "Make-up / goodwill credit", by: "admin" });
    await c.tick(T);
    await openTab(c, ethan.id);
    eq(c.$$('#drawer [role="tab"]').map((t) => t.getAttribute("data-stu-tab")).join(","),
      "overview,classes,credits,notes,family", "five tabs");
    const card = c.$("#drawer .stu-credit");
    ok(/Family credits/.test(card.textContent), "the card is the family's");
    ok(/Jane Tan's family · shared by/.test(card.textContent), "says who shares it");
    eq(c.$("#drawer .stu-credit__n .cred").textContent.replace("◆", ""), String(db.balance(ethan.familyId)), "total credits");
    const held = db.balances(ethan.familyId, { includeNeeded: false });
    eq(c.$$("#drawer .stu-wallet").length, held.length, "one row per wallet");
    held.forEach((w) => {
      const row = Array.from(c.$$("#drawer .stu-wallet")).find((el) => el.querySelector(".chip--credit").getAttribute("title") === w.type.name);
      ok(row && row.querySelector(".stu-wallet__n").textContent === String(w.credits), w.type.name + " wallet shows " + w.credits);
      ok(row.querySelector('[data-stu-act="adjust"][data-ctype="' + w.type.id + '"]'), w.type.name + " wallet has its own Adjust");
    });
    c.click('#drawer .stu-wallet [data-ctype="elite"]'); await c.tick(T);
    eq(JSON.stringify(calls[0]), JSON.stringify([ethan.familyId, undefined, "elite"]), "Adjust passes the family and the credit type");
    ok(c.text("#stuTab-credits").indexOf(String(db.balance(ethan.familyId))) >= 0, "the Credits tab badge is the family total");
    eq(c.errors.length, 0, "no errors " + c.errors.join("\n"));
    c.close();
  });

  await section("drawer: credit history by type and by child", async () => {
    const c = await openConsole({ staff: "admin", hash: "#students" });
    const db = c.HC.db;
    const ethan = kid(c, "Ethan Tan"), chloe = kid(c, "Chloe Tan");
    db.adjustCredits(ethan.familyId, 2, { creditType: "elite", reason: "Make-up / goodwill credit", note: "Missed <class> in June", by: "admin" });
    await openTab(c, ethan.id, "credits");
    const led = db.ledgerWithBalance(ethan.familyId);
    const rows = c.$$("#drawer .stu-ledger tbody tr");
    eq(rows.length, Math.min(25, led.length), "the whole family's history by default");
    eq(rows[0].querySelector(".stu-ledger__typecell .chip--credit").getAttribute("title"), db.creditTypeName("elite"), "each row shows its credit type");
    ok(/Make-up \/ goodwill credit/.test(rows[0].textContent) && /Missed <class> in June/.test(rows[0].textContent), "manual entry: reason and note");
    ok(!c.$("#drawer .stu-ledger class"), "the note is escaped");
    eq(rows[0].querySelector("td:last-child .cred").textContent.replace("◆", ""), String(led[0].balanceAfter), "wallet balance after the entry");
    ok(rows[0].querySelector("td:last-child").textContent.indexOf("total " + led[0].totalAfter) >= 0, "and the family total");
    const kidRow = led.findIndex((l) => l.childId === chloe.id);
    if (kidRow >= 0 && kidRow < 25) eq(rows[kidRow].querySelector(".stu-ledger__kid").textContent, "Chloe", "bookings name the child");

    // filter by credit type
    c.input("#stuLedgerType", "elite"); await c.tick(T);
    const elite = led.filter((l) => l.creditType === "elite");
    eq(c.$$("#drawer .stu-ledger tbody tr").length, Math.min(25, elite.length), "only Elite entries");
    ok(c.$$("#drawer .stu-ledger__typecell .chip--credit").every((x) => x.getAttribute("title") === db.creditTypeName("elite")), "every row is Elite");
    eq(c.window.document.activeElement.id, "stuLedgerType", "focus stays on the filter");
    c.input("#stuLedgerType", "competitive"); await c.tick(T);
    ok(new RegExp("No " + db.creditTypeShort("competitive") + " entries").test(c.text("#stuPanel")), "empty state names the type");
    c.input("#stuLedgerType", "all"); await c.tick(T);

    // and by child
    c.click("#stuLedgerScope-child"); await c.tick(T);
    const mine = led.filter((l) => l.childId === ethan.id);
    eq(c.$$("#drawer .stu-ledger tbody tr").length, Math.min(25, mine.length), "only Ethan's bookings and refunds");
    ok(/Purchases and adjustments go to the whole family/.test(c.text("#drawer .stu-ledger-bar")), "explains what is hidden");
    c.Admin.openStudent(kid(c, "Ryan Lim").id, "credits"); await c.tick(T);
    eq(c.$("#stuLedgerScope-family").getAttribute("aria-pressed"), "true", "another family resets the scope");
    eq(c.$("#stuLedgerType").value, "all", "and the type filter");
    eq(c.errors.length, 0, "no errors " + c.errors.join("\n"));
    c.close();
  });

  await section("drawer: family tab, remarks are the coach's", async () => {
    const c = await openConsole({ staff: "admin", hash: "#students" });
    const db = c.HC.db;
    const ethan = kid(c, "Ethan Tan");
    await openTab(c, ethan.id, "family");
    ok(c.$('#drawer a[href="mailto:demo@huachengelite.com"]') && c.$('#drawer a[href^="tel:"]'), "parent contact");
    eq(c.$$("#drawer .stu-credit").length, 1, "the pool is shown once");
    eq(c.$$("#drawer .stu-wallet").length, db.balances(ethan.familyId, { includeNeeded: false }).length, "family tab lists the wallets");
    eq(c.$$("#drawer .stu-kid").length, db.children(ethan.familyId).length, "one row per child");
    ok(!c.$("#drawer .stu-kid .cred"), "no per-child balances");
    ok(c.$("#stuAddChild") && c.$("#stuEditChild"), "Add child and Edit student stay where they were");
    // remarks: admins read, coaches write
    await openTab(c, ethan.id, "notes");
    ok(!c.$('#drawer [data-stu-act="add-note"]') && !c.$('#drawer [id^="stuNoteEdit-"]'), "admin cannot write remarks");
    ok(/Remarks are written by coaches\./.test(c.text("#drawer")), "and is told why");
    eq(c.errors.length, 0, "no errors " + c.errors.join("\n"));
    c.close();

    const k = await openConsole({ staff: "coach-a", hash: "#students" });
    const kdb = k.HC.db;
    const e2 = kid(k, "Ethan Tan");
    await openTab(k, e2.id, "overview");
    ok(!/S\$/.test(k.text("#drawer .stu-credit")) && !k.$("#drawer [data-stu-act='adjust']"), "coach: no money, no adjust");
    ok(/Only admins can adjust credits/.test(k.text("#drawer .stu-credit")), "coach: told why");
    ok(k.$("#drawer .stu-wallet"), "coach still sees the wallets");
    const before = kdb.notes({ childId: e2.id }).length;
    k.click('#drawer [data-stu-act="add-note"]'); await k.tick(T);
    k.input("#stuNoteText", "Great focus on stances");
    k.click("#stuNoteSave"); await k.tick(T);
    eq(kdb.notes({ childId: e2.id }).length, before + 1, "coach writes a general note");
    eq(k.errors.length, 0, "no errors " + k.errors.join("\n"));
    k.close();
  });

  /* ============================================================
     BOOKING — a class only takes its own credits
     ============================================================ */
  await section("booking: the class's own credit type", async () => {
    const c = await openConsole({ staff: "admin", hash: "#students" });
    const db = c.HC.db;
    const ethan = kid(c, "Ethan Tan");
    const nw = db.addDays(db.weekStart(db.todayISO()), 7);
    const week = db.occurrencesForWeek(nw).filter((o) => o.status === "open" && o.spotsLeft > 0 && !o.started);
    const junior = week.find((o) => o.creditType === "junior");
    const other = week.find((o) => o.creditType !== "junior" && db.balance(ethan.familyId, o.creditType) === 0);
    ok(junior && other, "fixture: a class the family can pay for, and one it can't");

    c.Admin.bookChildModal(ethan.id); await c.tick(T);
    ok(modalOpen(c) && /Book Ethan Tan/.test(c.text("#modalTitle")), "modal opens");
    ok(c.text("#stuBookSub").indexOf("Jane Tan's family") >= 0 && c.$("#stuBookSub .chip--credit"), "sub shows the family's wallets");
    c.click('[data-stu-week="' + nw + '"]'); await c.tick(T);

    // every class says which credits it takes
    const label = c.$("#stuBk-" + safeId(junior.key)).closest("label");
    const chip = label.querySelector(".chip--credit");
    eq(chip.getAttribute("title"), db.creditTypeName("junior"), "class chip names its credit type");
    eq(chip.querySelector("b").textContent, String(db.balance(ethan.familyId, "junior")), "…and how many the family holds");
    const shortLabel = c.$("#stuBk-" + safeId(other.key)).closest("label");
    ok(shortLabel.classList.contains("is-short") && /No .* credits/.test(shortLabel.textContent), "a class they can't pay for is flagged");

    // picking it refuses clearly
    c.input("#stuBk-" + safeId(other.key), true); await c.tick(T);
    const typeShort = db.creditTypeShort(other.creditType);
    ok(new RegExp("No " + typeShort + " credits left").test(c.text(".stu-book__opts")), "refusal names the type");
    ok(/Buy or add credits first/.test(c.text(".stu-book__opts")), "says what to do");
    const n0 = db.bookings({ childId: ethan.id }).length;
    c.click("#stuBookSubmit"); await c.tick(T);
    eq(db.bookings({ childId: ethan.id }).length, n0, "not booked");
    ok(new RegExp("No " + typeShort + " credits left").test(c.text(".stu-book__opts .notice--warn")), "inline error repeats it");
    eq(c.window.document.activeElement.id, "stuBkNeg", "focus moves to the override");
    c.input("#stuBkNeg", true); await c.tick(T);
    c.click("#stuBookSubmit"); await c.tick(T);
    eq(db.bookings({ childId: ethan.id }).length, n0 + 1, "an admin can still book it");
    eq(db.balance(ethan.familyId, other.creditType), -other.cost, "that wallet goes negative");

    // the right wallet is charged, and only that one
    const jr0 = db.balance(ethan.familyId, "junior"), el0 = db.balance(ethan.familyId, "elite");
    c.input("#stuBk-" + safeId(junior.key), true); await c.tick(T);
    ok(/Deduct 1 Junior credit/.test(c.text(".stu-book__opts")), "deduct wording names the type");
    c.click("#stuBookSubmit"); await c.tick(T);
    const bk = db.bookings({ occKey: junior.key }).find((b) => b.childId === ethan.id);
    ok(bk && bk.creditType === "junior", "booking is typed");
    eq(db.balance(ethan.familyId, "junior"), jr0 - 1, "Junior wallet charged");
    eq(db.balance(ethan.familyId, "elite"), el0, "other wallets untouched");
    ok(/Junior credit deducted/.test(c.text("#stuBookDone")), "the receipt line names the type");
    c.click("#modalCard [data-close]"); await c.tick(T);
    eq(c.errors.length, 0, "no errors " + c.errors.join("\n"));
    c.close();
  });

  await section("booking: coaches book their own classes and always charge", async () => {
    const c = await openConsole({ staff: "coach-a", hash: "#students" });
    const db = c.HC.db;
    const ethan = kid(c, "Ethan Tan");
    c.Admin.bookChildModal(ethan.id); await c.tick(T);
    const keys = c.$$('#modalCard input[name="stuBookOcc"]').map((i) => i.value);
    ok(keys.length && keys.every((k) => db.occurrence(k).coach === "Coach A"), "only their own classes");
    ok(/your classes only/.test(c.text(".stu-book__range")), "explains the scope");
    const free = keys.find((k) => !db.bookings({ occKey: k }).some((b) => b.childId === ethan.id));
    c.input("#stuBk-" + safeId(free), true); await c.tick(T);
    ok(c.$("#stuBkCharge").disabled && c.$("#stuBkCharge").checked, "a coach cannot waive the credit");
    ok(/Only admins can book without deducting credits/.test(c.text(".stu-book__opts")), "and is told why");
    eq(c.errors.length, 0, "no errors " + c.errors.join("\n"));
    c.close();
  });

  /* ============================================================
     COACH LIST + housekeeping
     ============================================================ */
  await section("coach list and re-render stability", async () => {
    const c = await openConsole({ staff: "coach-a", hash: "#students" });
    const db = c.HC.db;
    ok(c.$("#stuMine") && c.$("#stuMine").checked, "only-my-students on by default");
    const mine = rowIds(c);
    ok(mine.length && mine.length < stuRows(c).length, "a subset of the students");
    eq(c.$$(".stu-table thead th").map((t) => t.textContent.trim()).join("|"),
      "Student|Level|Credits|Attendance|Last class|Next class|Status", "coach columns: no money, no row actions");
    ok(!/S\$/.test(c.text("#page")), "no money figures for coaches");
    ok(!c.$(".stu-sum") && !c.$("#stuExport"), "no totals strip or export");
    ok(c.$(".stu-c-cred .chip--credit"), "coaches still see the wallets");
    eq(c.$$("[data-credit]").map((b) => b.getAttribute("data-credit")).join(","), "all,low,none", "basic credit filters only");
    c.input("#stuMine", false); await c.tick(T);
    eq(rowIds(c).length, stuRows(c).length, "unticking shows everyone");
    eq(c.errors.length, 0, "no errors " + c.errors.join("\n"));
    c.close();

    const a = await openConsole({ staff: "admin", hash: "#students" });
    const adb = a.HC.db;
    const ethan = kid(a, "Ethan Tan");
    await openTab(a, ethan.id, "overview");
    for (let i = 0; i < 3; i++) { adb.adjustCredits(ethan.familyId, 1, { creditType: "junior", reason: "Correction", by: "admin" }); await a.tick(30); }
    eq(a.$("#drawer .stu-credit__n .cred").textContent.replace("◆", ""), String(adb.balance(ethan.familyId)), "the card follows the data");
    let opened = 0;
    const origModal = a.Admin.openModal;
    a.Admin.openModal = function (o) { opened++; return origModal.call(this, o); };
    a.click('#drawer [data-stu-act="book"]'); await a.tick(T);
    eq(opened, 1, "one modal per click after repaints");
    a.Admin.closeModal(); await a.tick(T);
    a.Admin.closeDrawer();
    let sets = 0;
    const origSet = a.Admin.setParams;
    a.Admin.setParams = function (p) { sets++; return origSet.call(this, p); };
    a.click('[data-level="Junior"]'); await a.tick(T);
    a.click("#stuCredit-low"); await a.tick(T);
    eq(sets, 2, "one setParams per click after re-renders");
    eq(a.errors.length, 0, "no errors " + a.errors.join("\n"));
    a.close();
  });

  console.log(checks + " checks passed");
})().catch((e) => {
  console.error("✗ " + e.message);
  process.exit(1);
});
