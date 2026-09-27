/* ============================================================
   HUACHENG ELITE — Coach & Admin console · Packages (admin only)
   ------------------------------------------------------------
   What parents can buy. Every package grants credits of ONE
   credit type, and those credits only book that type's classes
   (Junior / Elite / Competitive, or Private 1-to-1 with one
   coach). Packages are never deleted — past purchases point at
   them — so they are taken off sale and can be put back.

   - #packages[?type=<creditType>][&add=1]
       packages grouped by credit type, each group with what its
       credits book, who holds them, and an "Off sale" list
   - Admin.addPackage(creditTypeId) / Admin.editPackage(id)
       the add / edit modal

   Store: HC.db.creditTypes / packages / addPackage /
   updatePackage / retirePackage.
   ============================================================ */
(function () {
  "use strict";

  var HC = window.HC;
  var Admin = window.Admin;
  if (!HC || !HC.db || !Admin || !Admin.registerView) return;
  var db = HC.db;
  var esc = Admin.esc;
  var fmt = Admin.fmt;   // dates, money
  var h = Admin.h;

  var NAME_MAX = 40;
  var TAG_MAX = 24;
  var NOTE_MAX = 120;
  var CREDITS_MAX = 200;

  var ui = { off: {}, flashed: null };
  var addPending = false;

  /* ============================================================
     HELPERS
     ============================================================ */
  function denied() { return !Admin.can("packages"); }

  // S$425 · S$42.50 — cents only when the amount has any
  function money(n) {
    var v = Number(n || 0);
    var dp = Math.round(v * 100) % 100 === 0 ? 0 : 2;
    return "S$" + v.toLocaleString("en-SG", { minimumFractionDigits: dp, maximumFractionDigits: dp });
  }

  function unitWord(type) { return type && type.kind === "private" ? "session" : "class"; }

  function perCredit(p, type) {
    if (!p.credits) return "";
    if (!p.price) return p.trial ? "One per new family" : "Free";
    return money(p.price / p.credits) + " per " + unitWord(type);
  }

  function typeBooks(t) {
    if (t.kind === "private") return "Private 1-to-1 with " + t.coach;
    var names = (t.programmes || []).map(function (id) {
      var p = db.programme(id);
      return p ? p.name : id;
    });
    return names.length ? names.join(" · ") : "Classes at this level";
  }

  function packageLine(p, type) {
    var per = perCredit(p, type);
    return p.name + " · " + db.creditTypeShort(p.creditType) + " · " + (p.price ? money(p.price) : "Free") +
      (per && p.price ? " (" + per + ")" : "");
  }

  // families holding each type of credit, from one report pass
  function holdings() {
    var out = {};
    var report;
    try { report = db.creditReport(); } catch (e) { return out; }
    (report.totals.byType || []).forEach(function (row) {
      out[row.type.id] = { credits: row.credits, families: 0 };
    });
    (report.rows || []).forEach(function (r) {
      Object.keys(r.byType || {}).forEach(function (id) {
        if (!r.byType[id]) return;
        if (!out[id]) out[id] = { credits: 0, families: 0 };
        out[id].families++;
      });
    });
    return out;
  }

  /* ============================================================
     LIST
     ============================================================ */
  function packageCard(p, type, off) {
    var id = esc(p.id);
    var per = perCredit(p, type);
    return '<article class="pkg-card' + (off ? " pkg-card--off" : "") + '" data-pkg="' + id + '" aria-labelledby="pkgName-' + id + '">' +
        '<div class="pkg-card__credits" aria-hidden="true">' +
          '<span class="pkg-card__n">' + esc(p.credits) + "</span>" +
          '<span class="pkg-card__u">' + esc(p.credits === 1 ? "credit" : "credits") + "</span>" +
        "</div>" +
        '<div class="pkg-card__main">' +
          '<h4 class="pkg-card__name" id="pkgName-' + id + '">' + esc(p.name) +
            (p.tag ? " " + h.chip(p.tag, p.trial ? "oneoff" : "info") : "") +
            (off ? " " + h.chip("Off sale", "muted") : "") + "</h4>" +
          '<p class="pkg-card__meta">' + esc(Admin.plural(p.credits, db.creditTypeShort(p.creditType) + " credit")) +
            (type && type.kind === "private" ? " · " + esc(type.coach) : "") + "</p>" +
          (p.note ? '<p class="pkg-card__note">' + Admin.icon("info") + "<span>" + esc(p.note) + "</span></p>" : "") +
        "</div>" +
        '<div class="pkg-card__price">' +
          "<strong>" + esc(p.price ? money(p.price) : "Free") + "</strong>" +
          (per ? "<span>" + esc(per) + "</span>" : "") +
        "</div>" +
        '<div class="pkg-card__acts">' +
          '<button type="button" class="btn btn--ghost btn--sm" data-pkg-act="edit" data-pkg="' + id + '" id="pkgEdit-' + id + '"' +
            ' aria-label="' + esc("Edit " + p.name + " (" + db.creditTypeName(p.creditType) + ")") + '">' + Admin.icon("edit") + "Edit</button>" +
          (off
            ? '<button type="button" class="btn btn--quiet btn--sm" data-pkg-act="restore" data-pkg="' + id + '" id="pkgOn-' + id + '"' +
                ' aria-label="' + esc("Put " + p.name + " back on sale") + '">' + Admin.icon("undo") + "Put back on sale</button>"
            : '<button type="button" class="btn btn--quiet btn--sm" data-pkg-act="retire" data-pkg="' + id + '" id="pkgOff-' + id + '"' +
                ' aria-label="' + esc("Take " + p.name + " off sale") + '">' + Admin.icon("ban") + "Take off sale</button>") +
        "</div>" +
      "</article>";
  }

  function groupHtml(type, held, focus) {
    var id = esc(type.id);
    var live = db.packages({ creditType: type.id });
    var off = db.packages({ includeInactive: true, creditType: type.id }).filter(function (p) { return p.active === false; });
    var openOff = !!ui.off[type.id];
    var hold = held[type.id];
    var holdText = hold && hold.credits
      ? Admin.plural(hold.families, "family", "families") + (hold.families === 1 ? " holds " : " hold ") +
        Admin.plural(hold.credits, "credit")
      : "No credits of this type held yet";

    return '<section class="pkg-group' + (focus ? " is-focus" : "") + (type.active === false ? " pkg-group--retired" : "") +
        '" id="pkgType-' + id + '" data-type="' + id + '" aria-labelledby="pkgTypeH-' + id + '" tabindex="-1">' +
        '<header class="pkg-group__head">' +
          '<div class="pkg-group__who">' +
            '<h3 class="pkg-group__title" id="pkgTypeH-' + id + '">' + h.creditChip(type.id) +
              "<span>" + esc(type.name) + "</span>" +
              (type.active === false ? h.chip("Coach inactive", "muted") : "") + "</h3>" +
            '<p class="pkg-group__books">' + Admin.icon("calendar") + "<span>" + esc(typeBooks(type)) + "</span></p>" +
          "</div>" +
          '<div class="pkg-group__meta">' +
            '<p class="pkg-group__hold">' + Admin.icon("wallet") + "<span>" + esc(holdText) + "</span></p>" +
            '<button type="button" class="btn btn--quiet btn--sm" data-pkg-act="add" data-type="' + id + '" id="pkgAdd-' + id + '"' +
              ' aria-label="' + esc("Add a package for " + type.name) + '">' + Admin.icon("plus") + "Add package</button>" +
          "</div>" +
        "</header>" +
        (live.length
          ? '<div class="pkg-cards">' + live.map(function (p) { return packageCard(p, type, false); }).join("") + "</div>"
          : '<p class="pkg-empty">' + Admin.icon("tag") + "<span>Nothing on sale for these credits yet.</span></p>") +
        (off.length
          ? '<div class="pkg-offsale">' +
              '<button type="button" class="pkg-toggle" data-pkg-act="toggle-off" data-type="' + id + '" id="pkgOffToggle-' + id + '"' +
                ' aria-expanded="' + openOff + '" aria-controls="pkgOffList-' + id + '">' +
                Admin.icon("chevron-right", "pkg-toggle__chev") + "Off sale<span class=\"pkg-count\">" + off.length + "</span></button>" +
              '<div class="pkg-cards pkg-cards--off" id="pkgOffList-' + id + '"' + (openOff ? "" : " hidden") + ">" +
                off.map(function (p) { return packageCard(p, type, true); }).join("") +
              "</div>" +
            "</div>"
          : "") +
      "</section>";
  }

  function summaryHtml(types, held) {
    var live = db.packages().length;
    var off = db.packages({ includeInactive: true }).length - live;
    var privates = types.filter(function (t) { return t.kind === "private"; }).length;
    function cell(k, v, d) {
      return '<div class="pkg-sum"><span class="pkg-sum__k">' + esc(k) + "</span>" +
        '<span class="pkg-sum__v">' + esc(v) + "</span>" +
        '<span class="pkg-sum__d">' + esc(d) + "</span></div>";
    }
    return '<section class="pkg-summary" aria-label="Packages at a glance">' +
        cell("On sale", live, Admin.plural(off, "package") + " off sale") +
        cell("Credit types", types.length, privates + " private · " + (types.length - privates) + " class") +
        cell("Credits held", (held.__all || 0), "bought and not yet used") +
      "</section>";
  }

  function renderList(el, params) {
    if (denied()) {
      el.innerHTML = h.pageHead({ title: "Packages" }) +
        h.empty("tag", "Only the studio admin sets packages",
          "Packages decide what parents can buy. Ask the studio admin if a price or a package needs to change.");
      return;
    }

    var held = holdings();
    held.__all = Object.keys(held).reduce(function (n, k) { return k === "__all" ? n : n + (held[k].credits || 0); }, 0);

    // active types, plus retired ones (a deactivated coach) that still have packages
    var types = db.creditTypes({ includeInactive: true }).filter(function (t) {
      return t.active !== false || db.packages({ includeInactive: true, creditType: t.id }).length;
    });
    var focus = params && params.type && db.creditType(params.type) ? params.type : "";

    el.innerHTML = '<div class="pkg-view" id="pkgRoot">' +
        h.pageHead({
          title: "Packages",
          sub: "What parents can buy. Each package gives credits of one type, and those credits only book that type’s classes — " +
            "so Private credits book 1-to-1 sessions with that coach and nothing else.",
          actions: '<button type="button" class="btn btn--primary" data-pkg-act="add" id="pkgAdd">' +
            Admin.icon("plus") + "Add package</button>"
        }) +
        (types.length
          ? summaryHtml(types, held) +
            '<div class="pkg-groups">' + types.map(function (t) {
              return groupHtml(t, held, focus === t.id);
            }).join("") + "</div>"
          : h.empty("tag", "No credit types yet", "Credit types come from the programmes and coaches you run.")) +
      "</div>";

    el.querySelector("#pkgRoot").addEventListener("click", onRootClick);

    if (focus && ui.flashed !== focus) {
      ui.flashed = focus;
      var group = el.querySelector("#pkgType-" + focus.replace(/[^\w-]/g, ""));
      if (group) {
        setTimeout(function () {
          try { group.scrollIntoView({ block: "center" }); } catch (e) {}
          try { group.focus({ preventScroll: true }); } catch (e) {}
        }, 40);
      }
    }
    if (!focus) ui.flashed = null;

    if (params && params.add === "1" && !addPending) {
      addPending = true;
      setTimeout(function () {
        addPending = false;
        Admin.setParams({ add: "" });
        openPackageForm(null, focus);
      }, 0);
    }
  }

  function onRootClick(e) {
    var t = e.target.closest("[data-pkg-act]");
    if (!t || t.disabled) return;
    e.preventDefault();
    var act = t.getAttribute("data-pkg-act");
    var id = t.getAttribute("data-pkg");
    switch (act) {
      case "add": openPackageForm(null, t.getAttribute("data-type") || ""); break;
      case "edit": openPackageForm(id); break;
      case "retire": retire(id); break;
      case "restore": restore(id); break;
      case "toggle-off":
        var type = t.getAttribute("data-type");
        ui.off[type] = !ui.off[type];
        Admin.refresh();
        break;
    }
  }

  Admin.registerView("packages", { render: renderList });

  Admin.addPackage = function (typeId) { if (!denied()) openPackageForm(null, typeId || ""); };
  Admin.editPackage = function (id) { if (!denied()) openPackageForm(id); };

  /* ============================================================
     ADD / EDIT
     ============================================================ */
  function openPackageForm(id, typeId) {
    if (denied()) return;
    var p = id ? db.packageById(id) : null;
    if (id && !p) { Admin.toast("warn", "Package not found."); return; }
    var types = db.creditTypes();
    if (!types.length) { Admin.toast("warn", "There are no credit types to sell yet."); return; }
    var d = p || {
      name: "", creditType: (db.creditType(typeId) ? typeId : types[0].id),
      credits: 10, price: "", tag: "", note: "", active: true
    };

    var body =
      '<form id="pkgForm" class="pkg-form" novalidate>' +
        '<div class="field"><label for="pkgName">Package name</label>' +
          '<input type="text" id="pkgName" maxlength="' + NAME_MAX + '" autocomplete="off" required placeholder="e.g. 10 Classes"' +
            ' value="' + esc(d.name) + '" aria-describedby="pkgNameErr" />' +
          '<p class="field-error" id="pkgNameErr" role="alert"></p></div>' +
        '<div class="field"><label for="pkgType">Credits it gives</label>' +
          '<select id="pkgType" aria-describedby="pkgTypeHint pkgTypeErr">' + h.creditTypeOptions(d.creditType) + "</select>" +
          '<p class="field__hint" id="pkgTypeHint"></p>' +
          '<p class="field-error" id="pkgTypeErr" role="alert"></p></div>' +
        '<div class="field-row">' +
          '<div class="field"><label for="pkgCredits">How many credits</label>' +
            '<input type="number" id="pkgCredits" min="1" max="' + CREDITS_MAX + '" step="1" inputmode="numeric" required' +
              ' value="' + esc(d.credits) + '" aria-describedby="pkgCreditsErr" />' +
            '<p class="field-error" id="pkgCreditsErr" role="alert"></p></div>' +
          '<div class="field"><label for="pkgPrice">Price</label>' +
            '<div class="pkg-money"><span class="pkg-money__cur" aria-hidden="true">S$</span>' +
              '<input type="number" id="pkgPrice" min="0" step="0.01" inputmode="decimal" required placeholder="0.00"' +
                ' value="' + esc(d.price === "" ? "" : d.price) + '" aria-describedby="pkgPriceHint pkgPriceErr" /></div>' +
            '<p class="field__hint" id="pkgPriceHint">0 for a free trial.</p>' +
            '<p class="field-error" id="pkgPriceErr" role="alert"></p></div>' +
        "</div>" +
        '<div class="field"><label for="pkgTag">Tag <span class="field__opt">(optional)</span></label>' +
          '<input type="text" id="pkgTag" maxlength="' + TAG_MAX + '" autocomplete="off" placeholder="e.g. Popular, Best value"' +
            ' value="' + esc(d.tag) + '" aria-describedby="pkgTagHint" />' +
          '<p class="field__hint" id="pkgTagHint">A short label on the package in the parent portal.</p></div>' +
        '<div class="field"><label for="pkgNote">Note for parents <span class="field__opt">(optional)</span></label>' +
          '<input type="text" id="pkgNote" maxlength="' + NOTE_MAX + '" autocomplete="off" placeholder="e.g. Credits for Private (Coach A) classes only"' +
            ' value="' + esc(d.note) + '" /></div>' +
        (p
          ? '<label class="choice pkg-sale" for="pkgActive">' +
              '<input type="checkbox" id="pkgActive"' + (p.active !== false ? " checked" : "") + ' aria-describedby="pkgActiveDesc" />' +
              "<span><span class=\"choice__t\">On sale</span>" +
              '<span class="choice__d" id="pkgActiveDesc">Off sale hides it from parents. Credits already bought keep working and past purchases still show it.</span></span>' +
            "</label>"
          : "") +
        '<div class="pkg-preview" id="pkgPreview" aria-live="polite"></div>' +
        '<div id="pkgFormErr" role="alert"></div>' +
        '<button type="submit" hidden tabindex="-1" aria-hidden="true"></button>' +
      "</form>";

    Admin.openModal({
      title: p ? "Edit " + p.name : "Add a package",
      sub: p
        ? esc(db.creditTypeName(p.creditType) + (p.active === false ? " · off sale" : ""))
        : "Parents see it in their portal straight away.",
      body: body,
      actions:
        '<button type="button" class="btn btn--ghost" data-close>Cancel</button>' +
        '<button type="button" class="btn btn--primary" id="pkgSave">' + (p ? "Save changes" : "Add package") + "</button>",
      onOpen: function (card) { bindForm(card, p); }
    });
  }

  function bindForm(card, p) {
    var form = card.querySelector("#pkgForm");
    var f = {
      name: card.querySelector("#pkgName"),
      creditType: card.querySelector("#pkgType"),
      credits: card.querySelector("#pkgCredits"),
      price: card.querySelector("#pkgPrice"),
      tag: card.querySelector("#pkgTag"),
      note: card.querySelector("#pkgNote"),
      active: card.querySelector("#pkgActive")
    };
    var errIds = { name: "#pkgNameErr", creditType: "#pkgTypeErr", credits: "#pkgCreditsErr", price: "#pkgPriceErr" };
    var preview = card.querySelector("#pkgPreview");
    var typeHint = card.querySelector("#pkgTypeHint");
    var formErr = card.querySelector("#pkgFormErr");
    var tried = false;

    function read() {
      return {
        name: f.name.value.trim(),
        creditType: f.creditType.value,
        credits: f.credits.value.trim(),
        price: f.price.value.trim(),
        tag: f.tag.value.trim(),
        note: f.note.value.trim(),
        active: f.active ? f.active.checked : true
      };
    }

    function validate(v) {
      var errs = {};
      if (!v.name) errs.name = "Give the package a name.";
      if (!db.creditType(v.creditType)) errs.creditType = "Choose which credits this package gives.";
      var credits = Number(v.credits);
      if (v.credits === "" || !isFinite(credits) || Math.floor(credits) !== credits || credits < 1 || credits > CREDITS_MAX) {
        errs.credits = "Credits must be a whole number between 1 and " + CREDITS_MAX + ".";
      }
      var price = Number(v.price);
      if (v.price === "" || !isFinite(price) || price < 0) errs.price = "Enter a price — 0 for a free trial.";
      return errs;
    }

    function setErr(key, msg) {
      var input = f[key];
      if (!input) return;
      input.classList.toggle("invalid", !!msg);
      if (msg) input.setAttribute("aria-invalid", "true"); else input.removeAttribute("aria-invalid");
      var el = card.querySelector(errIds[key]);
      if (el) el.textContent = msg || "";
    }

    function paint() {
      var v = read();
      var type = db.creditType(v.creditType);
      typeHint.textContent = type
        ? (type.kind === "private" ? "Books 1-to-1 sessions with " + type.coach + " only." : "Books " + typeBooks(type) + ".")
        : "";
      var credits = Math.floor(Number(v.credits)) || 0;
      var price = Number(v.price);
      if (v.name && type && credits > 0 && isFinite(price) && price >= 0) {
        var fake = { name: v.name, credits: credits, price: price, creditType: v.creditType, trial: !!(p && p.trial) };
        preview.innerHTML = '<p class="pkg-preview__t">Parents see</p>' +
          '<p class="pkg-preview__v">' + esc(packageLine(fake, type)) + "</p>" +
          (v.note ? '<p class="pkg-preview__n">' + esc(v.note) + "</p>" : "");
      } else {
        preview.innerHTML = "";
      }
      if (tried) {
        var errs = validate(v);
        Object.keys(errIds).forEach(function (k) { setErr(k, errs[k] || ""); });
      }
      formErr.innerHTML = "";
    }

    function storeField(msg) {
      if (/name/i.test(msg)) return "name";
      if (/credits must/i.test(msg)) return "credits";
      if (/price/i.test(msg)) return "price";
      if (/which credits/i.test(msg)) return "creditType";
      return null;
    }

    function save(e) {
      if (e) e.preventDefault();
      tried = true;
      formErr.innerHTML = "";
      var v = read();
      var errs = validate(v);
      Object.keys(errIds).forEach(function (k) { setErr(k, errs[k] || ""); });
      var bad = ["name", "creditType", "credits", "price"].filter(function (k) { return errs[k]; })[0];
      if (bad) { f[bad].focus(); return; }

      var payload = {
        name: v.name, creditType: v.creditType,
        credits: Math.floor(Number(v.credits)), price: Number(v.price),
        tag: v.tag, note: v.note
      };
      if (p) payload.active = v.active;
      var res = p
        ? db.updatePackage(p.id, payload, { by: Admin.by() })
        : db.addPackage(payload, { by: Admin.by() });
      if (!res || !res.ok) {
        var msg = (res && res.error) || "Something went wrong.";
        var key = storeField(msg);
        if (key) { setErr(key, msg); f[key].focus(); }
        else formErr.innerHTML = h.notice("warn", "<p>" + esc(msg) + "</p>");
        return;
      }
      Admin.closeModal();
      var type = db.creditType(res.package.creditType);
      Admin.toast("ok", p
        ? "Saved " + res.package.name + " · " + db.creditTypeShort(res.package.creditType) + "."
        : res.package.name + " is on sale — " + packageLine(res.package, type) + ".");
    }

    form.addEventListener("submit", save);
    card.querySelector("#pkgSave").addEventListener("click", save);
    [f.name, f.credits, f.price, f.tag, f.note].forEach(function (i) { i.addEventListener("input", paint); });
    f.creditType.addEventListener("change", paint);
    if (f.active) f.active.addEventListener("change", paint);
    paint();
  }

  /* ============================================================
     ON / OFF SALE
     ============================================================ */
  function retire(id) {
    var p = db.packageById(id);
    if (!p || p.active === false) return;
    Admin.confirm({
      title: "Take " + p.name + " off sale?",
      sub: esc(db.creditTypeName(p.creditType)),
      body: "<p>Parents won’t see it in their portal any more.</p>" +
        "<p>Credits already bought keep working, and past purchases still show <strong>" + esc(p.name) +
        "</strong>. You can put it back on sale at any time.</p>",
      confirmLabel: "Take off sale",
      cancelLabel: "Keep on sale",
      danger: true
    }).then(function (yes) {
      if (!yes) return;
      var res = db.retirePackage(id, { by: Admin.by() });
      if (!res || !res.ok) { Admin.check(res); return; }
      ui.off[p.creditType] = true; // show it where it went
      Admin.toast("ok", p.name + " is off sale — find it under “Off sale”.");
    });
  }

  function restore(id) {
    var p = db.packageById(id);
    if (!p || p.active !== false) return;
    var res = db.updatePackage(id, { active: true }, { by: Admin.by() });
    Admin.check(res, p.name + " is back on sale.");
  }
})();
