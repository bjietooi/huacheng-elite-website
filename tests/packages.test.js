/* Packages view (admin/js/packages.js) — what parents can buy.
   Grouping by credit type, add / edit / off sale, validation,
   private 1-to-1 packages, and the admin-only guard. */
const { openConsole } = require("./dom-harness.js");

let checks = 0, failed = 0;
function ok(cond, msg) { checks++; if (!cond) { failed++; console.log("  ✗ " + msg); } }
function eq(a, b, msg) { ok(a === b, msg + " (got " + JSON.stringify(a) + ", want " + JSON.stringify(b) + ")"); }
function section(t) { console.log("— " + t); }

(async () => {
  const errors = [];
  const c = await openConsole({ staff: "admin", hash: "#packages", now: "2026-10-06T12:00" });
  const db = c.HC.db;
  const t = (ms) => c.tick(ms || 50);
  const modal = () => c.text("#modalCard");
  const toasts = () => c.text("#toastWrap");
  const group = (id) => c.$("#pkgType-" + id);
  const groupText = (id) => c.text("#pkgType-" + id);
  const cardsIn = (id) => c.$$("#pkgType-" + id + " .pkg-cards:not(.pkg-cards--off) .pkg-card");

  section("the view lists packages grouped by credit type");
  eq(c.$("#page").getAttribute("data-view"), "packages", "view is packages");
  eq(c.text(".page__title"), "Packages", "title");
  ok(/only book that type’s classes/.test(c.text(".page__sub")), "sub explains typed credits");
  ok(!!c.$("#pkgAdd"), "Add package button");

  const types = db.creditTypes();
  eq(c.$$(".pkg-group").length, types.length, "one group per credit type");
  eq(c.$$(".pkg-group").map((g) => g.getAttribute("data-type")).join(","),
    types.map((x) => x.id).join(","), "groups follow creditTypes() order");
  eq(c.$$(".pkg-card").length, db.packages().length, "every package on sale is shown");
  eq(cardsIn("junior").length, db.packages({ creditType: "junior" }).length, "junior group holds the junior packages");

  section("each group says what its credits book");
  ok(/Wushu Tots/.test(c.text("#pkgType-junior .pkg-group__books")), "class type lists its programmes");
  eq(c.text("#pkgType-private-coach-a .pkg-group__books"), "Private 1-to-1 with Coach A", "private type names its coach");
  ok(/famil(y|ies) hold/.test(c.text("#pkgType-junior .pkg-group__hold")), "how many families hold these credits");
  ok(/Private · Coach A/.test(c.text("#pkgType-private-coach-a .pkg-group__title")), "credit chip on the group");

  section("a package card shows what parents pay");
  const p10 = db.packages({ creditType: "junior" }).find((p) => p.credits === 10);
  const card10 = c.$('.pkg-card[data-pkg="' + p10.id + '"]');
  ok(!!card10, "card for the 10-class package");
  eq(c.text('.pkg-card[data-pkg="' + p10.id + '"] .pkg-card__n'), "10", "credits");
  ok(/S\$425/.test(c.text('.pkg-card[data-pkg="' + p10.id + '"] .pkg-card__price')), "price");
  ok(/S\$42\.50 per class/.test(c.text('.pkg-card[data-pkg="' + p10.id + '"] .pkg-card__price')), "price per class");
  ok(/Popular/.test(c.text('.pkg-card[data-pkg="' + p10.id + '"]')), "tag");
  const priv = db.packages({ creditType: "private-coach-b" })[0];
  ok(/Coach B/.test(c.text('.pkg-card[data-pkg="' + priv.id + '"] .pkg-card__meta')), "private card names the coach");
  ok(/per session/.test(c.text('.pkg-card[data-pkg="' + priv.id + '"] .pkg-card__price')), "private packages are priced per session");
  const trial = db.packages().find((p) => p.price === 0);
  ok(/Free/.test(c.text('.pkg-card[data-pkg="' + trial.id + '"] .pkg-card__price')), "a free package reads Free");

  section("add a package — validation");
  c.click("#pkgAdd"); await t();
  ok(c.Admin.modalOpen() && /Add a package/.test(modal()), "add modal opens");
  c.click("#pkgSave"); await t();
  ok(/Give the package a name/.test(c.text("#pkgNameErr")), "name is required");
  ok(c.Admin.modalOpen(), "modal stays open");
  c.input("#pkgName", "Trial Pack");
  c.input("#pkgCredits", "0"); await t();
  ok(/whole number between 1 and 200/.test(c.text("#pkgCreditsErr")), "credits must be 1–200");
  c.input("#pkgCredits", "201"); c.click("#pkgSave"); await t();
  ok(/between 1 and 200/.test(c.text("#pkgCreditsErr")), "200 is the ceiling");
  c.input("#pkgCredits", "5");
  c.input("#pkgPrice", "-5"); c.click("#pkgSave"); await t();
  ok(/Enter a price/.test(c.text("#pkgPriceErr")), "price can't be negative");
  c.input("#pkgPrice", "220");
  c.input("#pkgType", "junior"); await t();
  c.click("#pkgSave"); await t();
  ok(/already a package like that/.test(c.text("#pkgNameErr") + c.text("#pkgFormErr")),
    "the store refuses a duplicate price point: " + c.text("#pkgFormErr"));
  ok(c.Admin.modalOpen(), "stays open on a store error");

  section("add a package — success");
  c.input("#pkgName", "Holiday Bundle");
  c.input("#pkgCredits", "8");
  c.input("#pkgPrice", "360");
  c.input("#pkgTag", "Holidays");
  c.input("#pkgNote", "Use any Junior class in the school holidays"); await t();
  ok(/Parents see/.test(c.text("#pkgPreview")), "live preview");
  ok(c.text("#pkgPreview").includes("Holiday Bundle · Junior · S$360 (S$45 per class)"),
    "preview reads like the portal: " + c.text("#pkgPreview"));
  c.click("#pkgSave"); await t(80);
  ok(!c.Admin.modalOpen(), "modal closed");
  const made = db.packages({ creditType: "junior" }).find((p) => p.name === "Holiday Bundle");
  ok(!!made && made.credits === 8 && made.price === 360 && made.tag === "Holidays", "package stored");
  ok(/Holiday Bundle is on sale/.test(toasts()), "success toast: " + toasts().slice(0, 70));
  ok(!!c.$('.pkg-card[data-pkg="' + made.id + '"]'), "card appears in the junior group");
  ok(/Use any Junior class/.test(c.text('.pkg-card[data-pkg="' + made.id + '"]')), "parent note shown");

  section("a private package for one coach");
  c.click("#pkgAdd-private-coach-a"); await t();
  ok(/1-to-1 sessions with Coach A only/.test(c.text("#pkgTypeHint")), "the picker explains private credits");
  eq(c.$("#pkgType").value, "private-coach-a", "type pre-selected from the group");
  c.input("#pkgName", "10 Sessions");
  c.input("#pkgCredits", "10");
  c.input("#pkgPrice", "1800"); await t();
  ok(/S\$180 per session/.test(c.text("#pkgPreview")), "private preview is per session: " + c.text("#pkgPreview"));
  c.click("#pkgSave"); await t(80);
  const made2 = db.packages({ creditType: "private-coach-a" }).find((p) => p.name === "10 Sessions");
  ok(!!made2 && made2.creditType === "private-coach-a", "private package stored against the coach's type");
  ok(cardsIn("private-coach-a").some((el) => el.getAttribute("data-pkg") === made2.id), "shown in that coach's group");

  section("edit a package");
  c.click("#pkgEdit-" + made.id); await t();
  ok(/Edit Holiday Bundle/.test(modal()) && !!c.$("#pkgActive"), "edit modal with the On sale toggle");
  eq(c.$("#pkgPrice").value, "360", "price pre-filled");
  c.input("#pkgPrice", "340");
  c.input("#pkgTag", "Best value"); await t();
  c.click("#pkgSave"); await t(80);
  eq(db.packageById(made.id).price, 340, "price saved");
  eq(db.packageById(made.id).tag, "Best value", "tag saved");
  ok(/Saved Holiday Bundle · Junior/.test(toasts()), "edit toast");
  ok(/S\$340/.test(c.text('.pkg-card[data-pkg="' + made.id + '"]')), "card re-rendered");

  section("moving a package to another credit type");
  c.click("#pkgEdit-" + made.id); await t();
  c.input("#pkgType", "elite"); await t();
  ok(/Books Wushu Elite/.test(c.text("#pkgTypeHint")), "hint follows the type");
  c.click("#pkgSave"); await t(80);
  eq(db.packageById(made.id).creditType, "elite", "credit type changed");
  ok(cardsIn("elite").some((el) => el.getAttribute("data-pkg") === made.id), "card moved to the elite group");
  ok(!cardsIn("junior").some((el) => el.getAttribute("data-pkg") === made.id), "and left the junior group");

  section("take off sale / put back on sale");
  ok(!c.$("#pkgOffToggle-elite"), "no off-sale list while nothing is retired");
  c.click("#pkgOff-" + made.id); await t();
  ok(/Take Holiday Bundle off sale\?/.test(modal()) && /Credits already bought keep working/.test(modal()),
    "confirm explains what happens");
  c.click("#confirmOk"); await t(80);
  eq(db.packageById(made.id).active, false, "package retired, not deleted");
  ok(/off sale/.test(toasts()), "toast");
  ok(!!c.$("#pkgOffToggle-elite"), "off-sale list appears");
  eq(c.$("#pkgOffToggle-elite").getAttribute("aria-expanded"), "true", "opened where the package went");
  ok(/Off sale/.test(c.text('.pkg-card[data-pkg="' + made.id + '"]')), "card marked off sale");
  ok(!cardsIn("elite").some((el) => el.getAttribute("data-pkg") === made.id), "no longer on sale");
  eq(db.packages().filter((p) => p.id === made.id).length, 0, "packages() skips it");
  c.click("#pkgOffToggle-elite"); await t();
  ok(c.$("#pkgOffList-elite").hidden, "the off-sale list collapses");
  c.click("#pkgOffToggle-elite"); await t();
  c.click("#pkgOn-" + made.id); await t(80);
  ok(db.packageById(made.id).active !== false, "put back on sale");
  ok(/back on sale/.test(toasts()), "toast");
  ok(cardsIn("elite").some((el) => el.getAttribute("data-pkg") === made.id), "back in the group");

  section("a deep link from a coach's profile");
  await c.go("#packages?type=private-coach-b");
  ok(!!group("private-coach-b") && group("private-coach-b").classList.contains("is-focus"), "the linked type is highlighted");
  await c.go("#packages?type=private-coach-b&add=1"); await t(80);
  ok(c.Admin.modalOpen() && c.$("#pkgType").value === "private-coach-b", "add=1 opens the modal on that type");
  c.click("#modalCard [data-close]"); await t();
  ok(!/add=1/.test(c.window.location.hash), "the add flag is cleared from the URL");
  await c.go("#packages");

  section("retired credit type (deactivated coach) still shows its packages");
  const mei = db.addCoach({ name: "Coach Mei" }, { by: "admin" }).coach;
  await t(80);
  ok(!!db.creditType("private-coach-mei"), "adding a coach creates their private credit type");
  ok(!!group("private-coach-mei"), "a group appears for the new coach");
  ok(/Nothing on sale for these credits yet/.test(groupText("private-coach-mei")), "empty group invites a package");
  db.addPackage({ name: "Taster", creditType: "private-coach-mei", credits: 1, price: 190 }, { by: "admin" });
  await t(80);
  eq(cardsIn("private-coach-mei").length, 1, "package added from the store shows up");
  db.updateCoach(mei.id, { active: false }, { by: "admin" });
  await t(80);
  ok(!!group("private-coach-mei") && group("private-coach-mei").classList.contains("pkg-group--retired"),
    "an inactive coach's type is kept while it has packages");
  ok(/Coach inactive/.test(groupText("private-coach-mei")), "and is labelled");

  errors.push(...c.errors);
  c.close();

  section("coaches can't manage packages");
  const k = await openConsole({ staff: "coach-a", hash: "#packages", now: "2026-10-06T12:00" });
  eq(k.$("#page").getAttribute("data-view"), "schedule", "a coach is redirected away from #packages");
  ok(!k.$('[data-nav="packages"]'), "no Packages in the coach nav");
  k.Admin.addPackage("junior"); await k.tick(40);
  ok(!k.Admin.modalOpen(), "Admin.addPackage does nothing for a coach");
  k.Admin.editPackage(k.HC.db.packages()[0].id); await k.tick(40);
  ok(!k.Admin.modalOpen(), "Admin.editPackage does nothing for a coach");
  errors.push(...k.errors);
  k.close();

  section("the admins-only state");
  const g = await openConsole({ staff: "admin", hash: "#packages", now: "2026-10-06T12:00" });
  // the router sends coaches away before this, so drive the guard itself:
  // the view asks Admin.can("packages"), the shell asks Admin.isAdmin()
  const realCan = g.Admin.can;
  g.Admin.can = () => false;
  g.Admin.refresh(); await g.tick(40);
  ok(/Only the studio admin sets packages/.test(g.text("#page")), "non-admins get an explanation, not a blank page");
  ok(!g.$("#pkgAdd"), "and no Add package button");
  g.Admin.can = realCan;
  g.Admin.refresh(); await g.tick(40);
  ok(!!g.$("#pkgAdd"), "and it comes back for an admin");
  errors.push(...g.errors);
  g.close();

  eq(errors.length, 0, "no console errors " + JSON.stringify(errors.slice(0, 3)));
  if (failed) { console.log(failed + " of " + checks + " checks FAILED"); process.exit(1); }
  console.log(checks + " checks passed");
})().catch((err) => { console.error(err); process.exit(1); });
