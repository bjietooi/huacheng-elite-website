/* ============================================================
   HUACHENG ELITE — Coach & Admin console · credits (admin only)
   ------------------------------------------------------------
   Manual credit changes — what the studio does by hand in
   WordPress today. Credits are SHARED by the family, and each
   credit belongs to a TYPE (Junior / Elite / Competitive /
   Private with one coach) that only books that kind of class —
   so every change here is for one family's one wallet.

   The page: a short explainer, the families who need a top-up,
   and the manual adjustment log. Every student with their
   family's credits is listed in Students.

   Exposes:
     Admin.adjustCreditsModal(familyId?, mode?)   mode: "deduct" | "add"
     (a child id is accepted too and resolves to that child's family)
   ============================================================ */
(function () {
  "use strict";

  var Admin = window.Admin;
  var HC = window.HC;
  if (!Admin || !Admin.registerView || !HC || !HC.db) return;

  var db = HC.db;
  var esc = Admin.esc;
  var fmt = Admin.fmt;
  var h = Admin.h;

  var MAX_CREDITS = 50;
  var PAID_REASON = "Payment received at studio";
  var NOTE_REQUIRED = ["Other", "Correction"];
  var LOW_AT = 1;            // "needs a top-up": this many credits or fewer…
  var LOW_ACTIVE_DAYS = 30;  // …and booked in, or in class within this many days
  var LOW_LIMIT = 6;
  var RESULT_LIMIT = 6;

  /* ---------- view state (survives re-renders) ---------- */
  var ui = { month: "all", creditType: "all", fresh: null, reveal: false };

  /* ============================================================
     HELPERS
     ============================================================ */
  function num(n) { return n < 0 ? "−" + Math.abs(n) : String(n); }

  function firstName(name) { return String(name || "").trim().split(/\s+/)[0] || ""; }

  function credits(n) { return Admin.plural(n, "credit"); }

  function typeShort(id) { return db.creditTypeShort(id); }

  // "3 Elite credits" — a wallet in words
  function walletWords(typeId, n) { return n + " " + typeShort(typeId) + (Math.abs(n) === 1 ? " credit" : " credits"); }

  function canOpen() { return !!Admin.openFamily; }

  // "Jane Tan’s family"
  function famLabel(f) { return (f && f.parentName ? f.parentName : "This") + "’s family"; }

  // "Ethan & Chloe" · "Ethan, Chloe & Max" (first names)
  function kidNames(kids) {
    var n = (kids || []).map(function (c) { return firstName(c.name); });
    if (!n.length) return "";
    return n.length === 1 ? n[0] : n.slice(0, -1).join(", ") + " & " + n[n.length - 1];
  }

  function kidsLine(kids) {
    var n = kidNames(kids);
    return n ? (kids.length === 1 ? "Child: " : "Shared by ") + n : "No children added";
  }

  // parent (opens the family, keeping the first child in view) + children underneath
  function familyPerson(f, kids) {
    var inner = h.avatar(f.parentName, "sm") +
      '<span class="person__text"><span class="person__name">' + esc(f.parentName) + "</span>" +
      '<span class="person__sub">' + esc(kidsLine(kids)) + "</span></span>";
    return canOpen()
      ? '<button class="person" type="button" data-open-family="' + esc(f.id) + '"' +
          (kids && kids[0] ? ' data-child="' + esc(kids[0].id) + '"' : "") +
          ' title="Open ' + esc(famLabel(f)) + '">' + inner + "</button>"
      : '<div class="person">' + inner + "</div>";
  }

  function adjustBtn(mode, f, typeId) {
    var add = mode === "add";
    var what = typeId ? typeShort(typeId) + " credits" : "credits";
    return '<button class="btn ' + (add ? "btn--primary" : "btn--ghost") + ' btn--xs" type="button" data-cr-adjust="' + mode +
      '" data-family="' + esc(f.id) + '"' + (typeId ? ' data-type="' + esc(typeId) + '"' : "") +
      ' aria-label="' + (add ? "Add " + esc(what) + " to " : "Deduct " + esc(what) + " from ") + esc(famLabel(f)) + '">' +
      Admin.icon(add ? "plus" : "minus") + (add ? "Add" : "Deduct") + "</button>";
  }

  /* ============================================================
     EXPLAINER
     ============================================================ */
  function introHtml() {
    return '<section class="cr-intro" aria-labelledby="crIntroTitle">' +
        '<span class="cr-intro__ic">' + Admin.icon("wallet") + "</span>" +
        '<div class="cr-intro__text">' +
          '<h2 class="cr-intro__t" id="crIntroTitle">Credits are shared by the family — one wallet per credit type</h2>' +
          '<p class="cr-intro__d">Parents buy one package and any of their children can use it — but each credit has a type ' +
            "(Junior, Elite, Competitive or a coach’s private sessions) and only books that kind of class. Pick the family, then which credits to change. " +
            "Parents see it — with your note — in their family credit history.</p>" +
        "</div>" +
        '<button class="btn btn--ghost btn--sm cr-intro__go" type="button" id="crStudentsLink" data-go="students">' +
          Admin.icon("users") + "See all students</button>" +
      "</section>";
  }

  /* ============================================================
     NEEDS A TOP-UP
     ============================================================ */
  // A family's wallet is low when it holds LOW_AT credits or fewer of a type it
  // needs, and the family is still coming to class. One row per family + wallet.
  function lowRows() {
    var t = db.todayISO();
    var out = [];
    db.creditReport().rows.forEach(function (r) {
      if (!r.children.length) return;
      if (!(r.upcoming > 0 || (!!r.lastClass && db.daysBetween(r.lastClass, t) <= LOW_ACTIVE_DAYS))) return;
      db.balances(r.family.id).forEach(function (w) {
        if (w.credits > LOW_AT) return;
        out.push({ row: r, family: r.family, children: r.children, type: w.type, credits: w.credits });
      });
    });
    return out.sort(function (a, b) {
      return a.credits - b.credits || b.row.upcoming - a.row.upcoming ||
        a.family.parentName.localeCompare(b.family.parentName) || a.type.name.localeCompare(b.type.name);
    });
  }

  function lowCard() {
    var list = lowRows();
    if (!list.length) return "";
    var shown = list.slice(0, LOW_LIMIT);
    var items = shown.map(function (w) {
      var f = w.family;
      var meta = [
        w.credits < 0 ? "Owes " + walletWords(w.type.id, -w.credits)
          : w.credits === 0 ? "No " + typeShort(w.type.id) + " credits left"
          : walletWords(w.type.id, w.credits) + " left",
        w.row.upcoming ? Admin.plural(w.row.upcoming, "class", "classes") + " booked"
          : "Last class " + fmt.date(w.row.lastClass)
      ].join(" · ");
      return '<li class="cr-low__item' + (w.credits <= 0 ? " is-out" : "") + '" data-cr-low="' + esc(f.id) +
          '" data-cr-low-type="' + esc(w.type.id) + '">' +
          '<div class="cr-low__who">' + familyPerson(f, w.children) + "</div>" +
          '<div class="cr-low__bal">' + h.creditChip(w.type.id, w.credits) +
            '<span class="cr-low__meta">' + esc(meta) + "</span></div>" +
          '<div class="btn-row cr-low__actions">' + adjustBtn("deduct", f, w.type.id) + adjustBtn("add", f, w.type.id) + "</div>" +
        "</li>";
    }).join("");
    return '<section class="card cr-low" aria-labelledby="crLowTitle">' +
        '<div class="card__head">' +
          '<div><h2 class="card__title" id="crLowTitle">Needs a top-up</h2>' +
          '<p class="card__sub">Families still coming to class with ' + credits(LOW_AT) + " or fewer of a credit they need" +
            (list.length > shown.length ? " · showing " + shown.length + " of " + list.length : "") + "</p></div>" +
          (list.length > shown.length
            ? '<button class="btn btn--quiet btn--sm" type="button" data-go="students">See all in Students</button>' : "") +
        "</div>" +
        '<ul class="cr-low__list">' + items + "</ul>" +
      "</section>";
  }

  /* ============================================================
     MANUAL ADJUSTMENT LOG (one row per change to a family's credits)
     ============================================================ */
  function logCard() {
    var all = db.ledger({ type: "manual" });
    var typeIds = [];
    all.forEach(function (l) { if (typeIds.indexOf(l.creditType) < 0) typeIds.push(l.creditType); });
    if (ui.creditType !== "all" && !db.creditType(ui.creditType)) ui.creditType = "all";
    var months = [];
    all.forEach(function (l) {
      var m = l.at.slice(0, 7);
      if (months.indexOf(m) < 0) months.push(m);
    });
    months.sort().reverse();
    if (ui.month !== "all" && months.indexOf(ui.month) < 0) ui.month = "all";
    var list = all.filter(function (l) {
      return (ui.month === "all" || l.at.slice(0, 7) === ui.month) &&
        (ui.creditType === "all" || l.creditType === ui.creditType);
    });

    var added = 0, deducted = 0, paid = 0, fams = {};
    list.forEach(function (l) {
      if (l.delta > 0) added += l.delta; else deducted -= l.delta;
      paid += l.amount || 0;
      fams[l.familyId] = 1;
    });
    var summary = list.length
      ? Admin.plural(list.length, "change") + " for " + Admin.plural(Object.keys(fams).length, "family", "families") +
        (ui.creditType === "all" ? "" : " · " + db.creditTypeName(ui.creditType)) +
        " · +" + added + " added · −" + deducted + " deducted" +
        (paid ? " · " + fmt.money(paid) + " received" : "")
      : "No manual changes";

    var opts = [{ value: "all", label: "All time" }].concat(months.map(function (m) {
      return { value: m, label: fmt.date(m + "-01", "month") };
    }));

    var body;
    if (!list.length) {
      body = h.empty("wallet", ui.month === "all" && ui.creditType === "all" ? "No manual changes yet" : "No manual changes to show",
        "Deductions and additions made here are listed with the family, who made them and why.",
        '<button class="btn btn--primary btn--sm" type="button" data-cr-adjust="deduct">' + Admin.icon("wallet") + "Adjust credits</button>");
    } else {
      body = '<div class="tbl-wrap cr-logwrap"><table class="tbl cr-log">' +
        '<caption class="sr-only">Manual credit adjustments per family, newest first</caption>' +
        '<thead><tr><th scope="col">When</th><th scope="col">Family</th><th scope="col" class="num">Change</th>' +
        '<th scope="col">Credits</th>' +
        '<th scope="col">Reason</th><th scope="col">Note to parent</th><th scope="col">By</th><th scope="col" class="num">Amount</th></tr></thead><tbody>' +
        list.map(function (l) {
          var f = db.family(l.familyId);
          var kids = f ? db.children(f.id) : [];
          var who = f
            ? (canOpen()
                ? '<button class="cr-link" type="button" data-open-family="' + esc(f.id) + '"' +
                    (kids[0] ? ' data-child="' + esc(kids[0].id) + '"' : "") + ">" + esc(f.parentName) + "</button>"
                : '<span class="cell-main">' + esc(f.parentName) + "</span>") +
              '<span class="cell-sub cr-block">' + esc(kidsLine(kids)) + "</span>"
            : '<span class="cell-main">Removed account</span>';
          var plus = l.delta > 0;
          return '<tr class="' + (l.id === ui.fresh ? "is-fresh" : "") + '" data-cr-entry="' + esc(l.id) + '">' +
              '<td class="nowrap" data-label="When">' + esc(fmt.stamp(l.at)) + "</td>" +
              '<td class="cr-who" data-label="Family">' + who + "</td>" +
              '<td class="num" data-label="Change"><span class="cr-delta cr-delta--' + (plus ? "plus" : "minus") + '">' +
                esc(fmt.signed(l.delta)) + '</span><span class="sr-only"> ' + (plus ? "added" : "deducted") + "</span></td>" +
              '<td class="cr-type" data-label="Credits">' + h.creditChip(l.creditType) + "</td>" +
              '<td data-label="Reason">' + esc(l.reason) + "</td>" +
              '<td class="cr-note" data-label="Note to parent">' + (l.note ? esc(l.note) : '<span class="muted">—</span>') + "</td>" +
              '<td class="nowrap" data-label="By">' + esc(db.actorName(l.by)) + "</td>" +
              '<td class="num" data-label="Amount">' + (l.amount > 0 ? esc(fmt.money(l.amount)) : '<span class="muted">—</span>') + "</td>" +
            "</tr>";
        }).join("") +
        "</tbody></table></div>";
    }

    return '<section class="card cr-logcard" id="crLog" aria-labelledby="crLogTitle">' +
        '<div class="card__head">' +
          '<div><h2 class="card__title" id="crLogTitle">Manual adjustment log</h2>' +
          '<p class="card__sub" id="crLogSummary">' + esc(summary) + "</p></div>" +
          '<div class="cr-filters">' +
            '<label class="sr-only" for="crType">Show credit type</label>' +
            '<select class="input" id="crType">' + h.creditTypeOptions(ui.creditType, { all: true, allLabel: "All credit types" }) + "</select>" +
            '<label class="sr-only" for="crMonth">Show month</label>' +
            '<select class="input" id="crMonth">' + h.options(opts, ui.month) + "</select>" +
          "</div>" +
        "</div>" +
        '<div class="card__body' + (list.length ? " card__body--flush" : "") + '">' + body + "</div>" +
      "</section>";
  }

  /* ============================================================
     VIEW
     ============================================================ */
  function render(el) {
    if (!Admin.can("credits")) {
      el.innerHTML = h.pageHead({ title: "Credits" }) +
        h.empty("wallet", "Admins only", "Credit changes are handled by the studio admin.");
      return;
    }
    el.innerHTML = '<div class="cr">' +
        h.pageHead({
          title: "Credits",
          sub: esc("Deduct or add a family’s credits by hand. Every change is logged below."),
          actions: '<button class="btn btn--primary" type="button" id="crAdjustBtn">' + Admin.icon("wallet") + "Adjust credits</button>"
        }) +
        introHtml() +
        lowCard() +
        logCard() +
      "</div>";
    bind(el.querySelector(".cr"));
    if (ui.reveal) {
      ui.reveal = false;
      // after the core restores the scroll position
      setTimeout(revealFresh, 0);
    }
  }

  function revealFresh() {
    var row = document.querySelector('.cr-log tr.is-fresh');
    if (row && row.scrollIntoView) {
      try { row.scrollIntoView({ block: "nearest", behavior: "smooth" }); } catch (e) { row.scrollIntoView(); }
    }
  }

  // Listeners live on the freshly rendered root, so re-renders never stack them.
  function bind(root) {
    root.querySelector("#crMonth").addEventListener("change", function (e) {
      ui.month = e.target.value;
      Admin.refresh();
    });

    root.querySelector("#crType").addEventListener("change", function (e) {
      ui.creditType = e.target.value;
      Admin.refresh();
    });

    root.addEventListener("click", function (e) {
      var t = e.target;
      if (t.closest("#crAdjustBtn")) { Admin.adjustCreditsModal(); return; }
      var adj = t.closest("[data-cr-adjust]");
      if (adj) Admin.adjustCreditsModal(adj.getAttribute("data-family"), adj.getAttribute("data-cr-adjust"), adj.getAttribute("data-type") || null);
    });
  }

  Admin.registerView("credits", { render: render });

  /* ============================================================
     ADJUST-CREDITS MODAL — one family's shared credits
     ============================================================ */
  // Takes a family id; a child id (older callers, Students) resolves to
  // that child's family. Anything else opens the picker.
  function resolveFamily(id) {
    if (!id) return null;
    var f = db.family(id);
    if (f) return f.id;
    var ch = db.child(id);
    return ch && db.family(ch.familyId) ? ch.familyId : null;
  }

  function pickerHtml() {
    return '<label class="field__label" for="adjFamilySearch">Family</label>' +
      '<div class="search">' + Admin.icon("search") +
        '<input id="adjFamilySearch" type="search" autocomplete="off" placeholder="Parent’s or child’s name, email or phone" aria-describedby="adjFamilyErr" />' +
      "</div>" +
      '<div class="adj-results" id="adjFamilyResults" role="radiogroup" aria-label="Matching families"></div>' +
      '<p class="field-error form-error" id="adjFamilyErr"></p>';
  }

  function summaryHtml(familyId) {
    var f = db.family(familyId);
    var kids = db.children(f.id);
    return '<span class="field__label" id="adjFamilyLabel">Family</span>' +
      '<div class="adj-fam" role="group" aria-labelledby="adjFamilyLabel">' +
        h.avatar(f.parentName) +
        '<div class="person__text">' +
          '<div class="person__name adj-fam__name">' + esc(f.parentName) +
            kids.map(function (c) { return h.levelChip(c.level); }).filter(function (x, i, a) { return a.indexOf(x) === i; }).join("") +
          "</div>" +
          '<div class="person__sub">' + esc(kidsLine(kids)) + "</div>" +
        "</div>" +
        '<span class="adj-fam__bal"><span class="adj-fam__k">Family credits</span>' + h.credits(db.balance(f.id)) + "</span>" +
        '<button class="btn btn--quiet btn--xs" type="button" id="adjChange">Change<span class="sr-only"> family</span></button>' +
      "</div>";
  }

  // Families whose parent or children match, in the order their first child matched
  // (an empty search lists every family by parent name).
  function matchingFamilies(q) {
    if (!String(q || "").trim()) {
      return db.families().filter(function (f) { return db.children(f.id).length; })
        .sort(function (a, b) { return a.parentName.localeCompare(b.parentName); });
    }
    var seen = {}, out = [];
    db.searchChildren(q).forEach(function (ch) {
      if (seen[ch.familyId]) return;
      seen[ch.familyId] = 1;
      var f = db.family(ch.familyId);
      if (f) out.push(f);
    });
    return out;
  }

  function resultsHtml(st) {
    var list = matchingFamilies(st.q);
    var total = list.length;
    var shown = list.slice(0, RESULT_LIMIT);
    // keep the current choice visible even when the search moves past it
    if (st.familyId && !shown.some(function (f) { return f.id === st.familyId; })) {
      var cur = db.family(st.familyId);
      if (cur) shown.unshift(cur);
    }
    if (!shown.length) {
      return '<p class="adj-none">No families match “' + esc(st.q) + "”. Try a parent’s or child’s name, an email or a phone number.</p>";
    }
    return shown.map(function (f) {
      return '<label class="choice adj-choice">' +
          '<input type="radio" name="adjFamily" value="' + esc(f.id) + '"' + (f.id === st.familyId ? " checked" : "") + " />" +
          h.avatar(f.parentName, "sm") +
          '<span class="adj-choice__text"><span class="choice__t">' + esc(f.parentName) + "</span>" +
          '<span class="choice__d">' + esc(kidsLine(db.children(f.id))) + "</span></span>" +
          '<span class="adj-choice__bal"><span class="sr-only">Family credits </span>' + h.credits(db.balance(f.id)) + "</span>" +
        "</label>";
    }).join("") +
    (total > RESULT_LIMIT ? '<p class="field__hint adj-more">Showing ' + RESULT_LIMIT + " of " + total + " families — keep typing to narrow the list.</p>" : "");
  }

  function modalBody(st) {
    return '<form class="adj" id="adjForm" novalidate>' +
      '<div class="field" id="adjFamily"></div>' +
      '<div class="field">' +
        '<span class="field__label" id="adjModeLabel">Deduct or add</span>' +
        '<div class="seg adj-mode" role="group" aria-labelledby="adjModeLabel">' +
          '<button type="button" data-adj-mode="deduct" aria-pressed="' + (st.mode === "deduct") + '">' + Admin.icon("minus") + "Deduct</button>" +
          '<button type="button" data-adj-mode="add" aria-pressed="' + (st.mode === "add") + '">' + Admin.icon("plus") + "Add</button>" +
        "</div>" +
      "</div>" +
      '<div class="field-row">' +
        '<div class="field">' +
          '<label for="adjCredits">Credits</label>' +
          '<div class="adj-stepper">' +
            '<button class="btn btn--ghost btn--icon btn--sm" type="button" data-adj-step="-1" aria-label="One credit fewer">' + Admin.icon("minus") + "</button>" +
            '<input id="adjCredits" type="number" inputmode="numeric" min="1" max="' + MAX_CREDITS + '" step="1" value="1" aria-describedby="adjCreditsErr" />' +
            '<button class="btn btn--ghost btn--icon btn--sm" type="button" data-adj-step="1" aria-label="One credit more">' + Admin.icon("plus") + "</button>" +
          "</div>" +
          '<p class="field-error form-error" id="adjCreditsErr"></p>' +
        "</div>" +
        '<div class="field">' +
          '<label for="adjReason">Reason</label>' +
          '<select id="adjReason" aria-describedby="adjReasonErr"></select>' +
          '<p class="field-error form-error" id="adjReasonErr"></p>' +
        "</div>" +
      "</div>" +
      '<div class="field" id="adjAmountField" hidden>' +
        '<label for="adjAmount">Amount received (S$)</label>' +
        '<input id="adjAmount" type="number" inputmode="decimal" min="0" step="0.01" placeholder="e.g. 425" aria-describedby="adjAmountHint adjAmountErr" />' +
        '<p class="field__hint" id="adjAmountHint"></p>' +
        '<p class="field-error form-error" id="adjAmountErr"></p>' +
      "</div>" +
      '<div class="field">' +
        '<label for="adjNote">Note for the family <span class="field__opt" id="adjNoteOpt">(optional)</span></label>' +
        '<textarea id="adjNote" rows="3" maxlength="300" placeholder="e.g. Receipt #0418, or the class that was missed" aria-describedby="adjNoteHint adjNoteErr"></textarea>' +
        '<p class="field__hint adj-note-hint" id="adjNoteHint">' + Admin.icon("info") +
          '<span id="adjNoteHintText">Parents see this note in their family credit history — keep internal remarks out of it.</span></p>' +
        '<p class="field-error form-error" id="adjNoteErr"></p>' +
      "</div>" +
      '<div class="adj-preview" id="adjPreview" aria-live="polite"></div>' +
      '<div class="adj-neg" id="adjNeg" hidden>' +
        '<div class="notice notice--warn">' + Admin.icon("alert") + '<div id="adjNegText"></div></div>' +
        '<label class="check adj-neg__check">' +
          '<input type="checkbox" id="adjAllowNeg" aria-describedby="adjNegErr" />' +
          "<span><strong>Allow a negative balance</strong> (the family will owe credits)</span>" +
        "</label>" +
        '<p class="field-error form-error" id="adjNegErr"></p>' +
      "</div>" +
    "</form>";
  }

  function wireModal(card, st) {
    var form = card.querySelector("#adjForm");
    var famBox = form.querySelector("#adjFamily");
    var credits_ = form.querySelector("#adjCredits");
    var reason = form.querySelector("#adjReason");
    var note = form.querySelector("#adjNote");
    var amountField = form.querySelector("#adjAmountField");
    var amount = form.querySelector("#adjAmount");
    var negBox = form.querySelector("#adjNeg");
    var allowNeg = form.querySelector("#adjAllowNeg");
    var submit = card.querySelector("#adjSubmit");

    function fam() { return st.familyId ? db.family(st.familyId) : null; }
    function count() {
      var v = String(credits_.value).trim();
      return /^\d+$/.test(v) ? parseInt(v, 10) : NaN;
    }
    function countOk() { var k = count(); return k >= 1 && k <= MAX_CREDITS; }
    function isPaid() { return st.mode === "add" && reason.value === PAID_REASON; }
    function needsNote() { return NOTE_REQUIRED.indexOf(reason.value) >= 0; }
    function goesNegative() {
      return st.mode === "deduct" && !!st.familyId && countOk() && db.balance(st.familyId) - count() < 0;
    }

    function paintFamily() {
      famBox.innerHTML = st.picking ? pickerHtml() : summaryHtml(st.familyId);
      if (st.picking) {
        form.querySelector("#adjFamilySearch").value = st.q;
        paintResults();
      }
    }
    function paintResults() {
      var box = form.querySelector("#adjFamilyResults");
      if (box) box.innerHTML = resultsHtml(st);
    }
    function paintReasons() {
      var keep = reason.value;
      var list = db.adjustReasons[st.mode] || [];
      reason.innerHTML = '<option value="">Choose a reason…</option>' +
        h.options(list, list.indexOf(keep) >= 0 ? keep : "");
    }

    function paintPreview() {
      var box = form.querySelector("#adjPreview");
      var f = fam();
      if (!f) {
        box.innerHTML = '<span class="adj-preview__k">Family credits</span><span class="soft">Choose a family to preview the change.</span>';
        return;
      }
      var bal = db.balance(f.id);
      var ok = countOk();
      var delta = ok ? (st.mode === "deduct" ? -count() : count()) : 0;
      var next = bal + delta;
      box.innerHTML =
        '<span class="adj-preview__k">' + esc(famLabel(f)) + "</span>" +
        '<b class="adj-preview__n' + (bal < 0 ? " is-neg" : "") + '">' + num(bal) + "</b>" +
        '<span class="adj-preview__arrow" aria-hidden="true">→</span><span class="sr-only"> becomes </span>' +
        '<b class="adj-preview__n' + (ok && next < 0 ? " is-neg" : "") + (ok ? "" : " is-pending") + '">' + (ok ? num(next) : "?") + "</b>" +
        (ok ? '<span class="adj-preview__d">' + esc(fmt.signed(delta)) + " " + (Math.abs(delta) === 1 ? "credit" : "credits") + "</span>" : "");
    }

    function paintNegative() {
      var neg = goesNegative();
      negBox.hidden = !neg;
      if (!neg) { allowNeg.checked = false; return; }
      var f = fam();
      var bal = db.balance(f.id);
      var next = bal - count();
      form.querySelector("#adjNegText").innerHTML =
        "<p><strong>" + esc(famLabel(f)) + "</strong> has " + esc(num(bal) + (Math.abs(bal) === 1 ? " credit" : " credits")) +
        ". Deducting " + count() + " leaves the family at <strong>" + num(next) +
        "</strong> — they’ll owe " + esc(credits(-next)) + " until they top up.</p>";
    }

    function paintAmountHint() {
      var hint = form.querySelector("#adjAmountHint");
      var f = fam();
      var k = count();
      // package rates for the levels this family's children train at
      var packs = f && countOk() ? (db.packagesFor(f.id) || []).filter(function (p) {
        return p.id !== "trial" && p.suggested && p.price > 0 && p.credits === k;
      }) : [];
      if (packs.length) {
        hint.textContent = k + "-credit package: " + packs.map(function (p) {
          return p.tierLabel + " " + fmt.money(p.price);
        }).join(" · ") + ".";
      } else {
        hint.textContent = "Record what the family paid so the credit value report stays accurate.";
      }
    }

    function paintNoteHint() {
      var f = fam();
      form.querySelector("#adjNoteHintText").textContent = f
        ? f.parentName + " sees this note in the family credit history — keep internal remarks out of it."
        : "Parents see this note in their family credit history — keep internal remarks out of it.";
    }

    function update() {
      form.querySelectorAll("[data-adj-mode]").forEach(function (b) {
        b.setAttribute("aria-pressed", String(b.getAttribute("data-adj-mode") === st.mode));
      });
      amountField.hidden = !isPaid();
      form.querySelector("#adjNoteOpt").textContent = needsNote() ? "(required)" : "(optional)";
      paintAmountHint();
      paintNoteHint();
      paintPreview();
      paintNegative();
      var k = countOk() ? credits(count()) : "credits";
      submit.textContent = (st.mode === "deduct" ? "Deduct " : "Add ") + k;
      submit.className = "btn " + (st.mode === "deduct" ? "btn--ink" : "btn--primary");
      if (st.tried) validate();
    }

    // Returns the first invalid control (or null) and paints every message.
    function validate() {
      var first = null;
      function mark(el, errId, msg) {
        var e = form.querySelector("#" + errId);
        if (e) e.textContent = msg || "";
        if (el) {
          el.classList.toggle("invalid", !!msg);
          if (msg) el.setAttribute("aria-invalid", "true"); else el.removeAttribute("aria-invalid");
        }
        if (msg && !first) first = el || e;
      }
      var search = form.querySelector("#adjFamilySearch");
      mark(search, "adjFamilyErr", st.familyId ? "" : "Choose a family.");
      mark(credits_, "adjCreditsErr", countOk() ? "" : "Enter a whole number from 1 to " + MAX_CREDITS + ".");
      mark(reason, "adjReasonErr", reason.value ? "" : "Choose a reason.");
      if (isPaid()) {
        var amt = parseFloat(amount.value);
        mark(amount, "adjAmountErr", !(amt > 0) ? "Enter the amount received." :
          amt > 20000 ? "That looks too high — check the amount." : "");
      } else {
        mark(amount, "adjAmountErr", "");
      }
      mark(note, "adjNoteErr", needsNote() && !note.value.trim()
        ? "Add a note — it’s required for “" + reason.value + "”." : "");
      mark(allowNeg, "adjNegErr", goesNegative() && !allowNeg.checked
        ? "Tick the box to allow a negative balance, or deduct fewer credits." : "");
      return first;
    }

    function save() {
      st.tried = true;
      var bad = validate();
      if (bad) {
        try { bad.focus(); } catch (err) {}
        return;
      }
      var k = count();
      var delta = st.mode === "deduct" ? -k : k;
      var f = fam();
      var res = db.adjustCredits(f.id, delta, {
        by: Admin.by(),
        reason: reason.value,
        note: note.value.trim(),
        amount: isPaid() ? Math.round(parseFloat(amount.value) * 100) / 100 : 0,
        allowNegative: goesNegative() && allowNeg.checked
      });
      var msg = null;
      if (res && res.ok) {
        ui.fresh = res.entry.id;
        // make sure the new row is in the log's month, and bring it into view
        if (ui.month !== "all" && res.entry.at.slice(0, 7) !== ui.month) ui.month = "all";
        if (Admin.currentView && Admin.currentView() === "credits") ui.reveal = true;
        var b = res.balance;
        msg = delta < 0
          ? "Deducted " + credits(k) + " from " + famLabel(f) + " — " + (b < 0 ? "now owes " + (-b) : b + " left")
          : "Added " + credits(k) + " to " + famLabel(f) + " — " + (b < 0 ? "still owes " + (-b) : "now has " + b);
      }
      if (Admin.check(res, msg)) {
        Admin.closeModal();
        setTimeout(function () { if (ui.fresh === res.entry.id) ui.fresh = null; }, 4000);
      } else if (res && res.code === "insufficient") {
        update(); // balance moved underneath us — reveal the negative-balance option
      }
    }

    /* ---------- events (card is rebuilt per open, so these never stack) ---------- */
    form.addEventListener("submit", function (e) { e.preventDefault(); save(); });

    form.addEventListener("keydown", function (e) {
      if (e.key !== "Enter" || !e.target || e.target.id !== "adjFamilySearch") return;
      e.preventDefault(); // Enter in the search box picks a lone match instead of submitting
      var radios = form.querySelectorAll('input[name="adjFamily"]');
      if (radios.length === 1) {
        radios[0].checked = true;
        st.familyId = radios[0].value;
        update();
      }
    });

    form.addEventListener("input", function (e) {
      var id = e.target.id;
      if (id === "adjFamilySearch") {
        st.q = e.target.value;
        paintResults();
      } else if (id === "adjCredits") {
        update();
      } else if (st.tried) {
        validate();
      }
    });

    form.addEventListener("change", function (e) {
      var t = e.target;
      if (t.name === "adjFamily") { st.familyId = t.value; update(); }
      else if (t.id === "adjReason") update();
      else if (st.tried) validate();
    });

    form.addEventListener("click", function (e) {
      var t = e.target;
      var m = t.closest("[data-adj-mode]");
      if (m) {
        st.mode = m.getAttribute("data-adj-mode");
        paintReasons();
        update();
        return;
      }
      var step = t.closest("[data-adj-step]");
      if (step) {
        var k = count();
        if (isNaN(k)) k = 0;
        k = Math.max(1, Math.min(MAX_CREDITS, k + parseInt(step.getAttribute("data-adj-step"), 10)));
        credits_.value = k;
        update();
        return;
      }
      if (t.closest("#adjChange")) {
        st.picking = true;
        st.q = "";
        paintFamily();
        update();
        var s = form.querySelector("#adjFamilySearch");
        if (s) { try { s.focus(); } catch (err) {} }
      }
    });

    paintFamily();
    paintReasons();
    update();
  }

  Admin.adjustCreditsModal = function (familyId, mode) {
    if (!Admin.can("credits")) {
      Admin.toast("warn", "Only the studio admin can adjust credits.");
      return;
    }
    var fid = resolveFamily(familyId);
    var st = {
      familyId: fid,
      picking: !fid,
      q: "",
      mode: mode === "add" ? "add" : "deduct",
      tried: false
    };
    Admin.openModal({
      title: "Adjust credits",
      sub: "Changes one family’s shared credits. Logged with your name and shown in their family credit history.",
      body: modalBody(st),
      actions:
        '<button class="btn btn--ghost" type="button" data-close>Cancel</button>' +
        '<button class="btn btn--ink" type="submit" form="adjForm" id="adjSubmit">Deduct credits</button>',
      onOpen: function (card) { wireModal(card, st); }
    });
  };
})();
