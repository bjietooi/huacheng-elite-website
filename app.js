/* ============================================================
   HUACHENG ELITE — Parent booking portal
   ------------------------------------------------------------
   Loaded on BOTH login.html and portal.html, after
   mock-data.js → hc-store.js. Everything reads and writes the
   shared mock database (HC.db), so what staff do in the coach &
   admin console (blocked classes, leave, one-off classes,
   attendance, feedback, credit adjustments) shows up here, and
   parent bookings show up there.

   Session: HC.db.session "parent" → family id. Credits are ONE
   shared pool per family: a parent buys a package once and any of
   their children can use it. Bookings, refunds and packages all go
   through the family balance; the free trial is per new family.
   ============================================================ */
(function () {
  "use strict";

  var HC = window.HC;
  if (!HC || !HC.db) {
    console.warn("[HC] mock-data.js and hc-store.js must load before app.js");
    return;
  }
  var db = HC.db;

  var LEGACY_KEYS = ["hc_session", "hc_state"]; // the pre-shared-database mockup
  var FLASH_KEY = "hc_portal_flash";            // one toast carried across login → portal
  var VIEWS = ["dashboard", "schedule", "bookings", "credits", "account"];
  var WEEKS_AHEAD = 3;                           // this week + 3 more
  var WEEK_LABELS = ["This week", "Next week", "In 2 weeks", "In 3 weeks"];
  var PAST_PAGE = 10;
  var LEDGER_PAGE = 12;
  var UPCOMING_ON_DASH = 5;
  var LOW_CREDITS = 2;                           // "running low" at or below this
  var MIN_AGE = 4;                               // classes start from age 4 (Wushu Tots)
  var PILL_WALLETS_MAX = 2;                      // more wallets → a plain "Credits" pill
  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  var App = (HC.app = {});
  var leaving = false; // set once we navigate away, so nothing renders after

  /* ============================================================
     SESSION
     ============================================================ */
  function clearLegacy() {
    LEGACY_KEYS.forEach(function (k) {
      try { localStorage.removeItem(k); } catch (e) { /* private mode */ }
    });
  }

  function go(href) {
    leaving = true;
    location.href = href;
  }

  // The signed-in family id, or null (no session, or the family no longer exists).
  App.familyId = function () {
    var id = db.session.get("parent");
    return id && db.family(id) ? id : null;
  };

  App.hasSession = function () { return !!App.familyId(); };

  // Jane Tan (Ethan & Chloe) in the seed; falls back to the first family if her email was edited.
  App.demoFamily = function () {
    return db.familyByEmail(HC.demoAccount && HC.demoAccount.email) || db.families()[0] || null;
  };

  App.login = function (familyId, flash) {
    db.session.set("parent", familyId);
    if (flash) {
      try { sessionStorage.setItem(FLASH_KEY, flash); } catch (e) {}
    }
    go("portal.html");
  };

  // Clears only the parent session — the shared demo data stays.
  App.logout = function () {
    db.session.clear("parent");
    go("login.html");
  };

  // Re-seeds the whole shared database (staff console included), then logs out.
  App.reset = function () {
    leaving = true;
    db.reset();
    App.logout();
  };

  // Current portal view, and a way to switch it (handy for demos and tests).
  App.view = function () { return ui.view; };
  App.show = function (view) { showView(view); };

  function takeFlash() {
    try {
      var msg = sessionStorage.getItem(FLASH_KEY);
      sessionStorage.removeItem(FLASH_KEY);
      return msg;
    } catch (e) { return null; }
  }

  /* ============================================================
     HELPERS
     ============================================================ */
  function byId(id) { return document.getElementById(id); }

  function val(id) {
    var el = byId(id);
    return el ? String(el.value || "").trim() : "";
  }

  function esc(str) {
    return String(str == null ? "" : str)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function plural(n, one, many) { return n + " " + (n === 1 ? one : (many || one + "s")); }
  function creditsText(n) { return plural(n, "credit"); }
  function signed(n) { return (n > 0 ? "+" : n < 0 ? "−" : "") + Math.abs(n); }
  function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }
  function dia(n) { return '<span class="dia" aria-hidden="true">◆</span>' + n; }

  function joinNames(list) {
    if (list.length <= 1) return list.join("");
    return list.slice(0, -1).join(", ") + " & " + list[list.length - 1];
  }

  function words(name) { return String(name || "").trim().split(/\s+/).filter(Boolean); }

  // Given name for display. When a child's first word matches the parent's first
  // word ("Chen Yu Xuan" / "Chen Wei Ling") it's the family name, so show the rest.
  function childFirst(ch) {
    if (!ch) return "Removed child";
    var w = words(ch.name);
    var fam = db.family(ch.familyId);
    var p = words(fam && fam.parentName);
    if (w.length > 1 && p.length && w[0].toLowerCase() === p[0].toLowerCase()) return w.slice(1).join(" ");
    return w[0] || ch.name;
  }

  // Parent's given name for the greeting — skips a leading family name shared with a child.
  function parentFirst(fam, kids) {
    var p = words(fam && fam.parentName);
    if (!p.length) return "there";
    var surname = p[0].toLowerCase();
    var shared = p.length > 1 && kids.some(function (k) {
      var w = words(k.name);
      return w.length > 1 && (w[0].toLowerCase() === surname || w[w.length - 1].toLowerCase() === surname);
    });
    return shared ? p.slice(1).join(" ") : p[0];
  }

  function parseAge(str) {
    var s = String(str == null ? "" : str).trim();
    if (!/^\d{1,2}$/.test(s)) return null;
    var n = parseInt(s, 10);
    return n >= 1 && n <= 99 ? n : null;
  }

  // Why a typed age can't be saved ("" when it's fine or left blank).
  function ageProblem(str, example) {
    var s = String(str == null ? "" : str).trim();
    if (!s) return "";
    var n = parseAge(s);
    if (n === null) return "Enter an age in years, e.g. " + (example || 7) + ".";
    if (n < MIN_AGE) return "Classes start from age " + MIN_AGE + ".";
    return "";
  }

  function escRe(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

  function possessive(name) { return name + "’s"; }

  /* ---------- credits (one shared pool per family) ---------- */
  function creditState(bal) {
    return bal < 0 ? "neg" : bal === 0 ? "empty" : bal <= LOW_CREDITS ? "low" : "ok";
  }

  function creditStatusText(bal) {
    var s = creditState(bal);
    if (s === "neg") return "Balance below zero — please top up";
    if (s === "empty") return "No credits left — top up to book";
    if (s === "low") return "Running low — enough for " + plural(bal, "more class", "more classes");
    return "Enough for " + plural(bal, "more class", "more classes");
  }

  // "Shared by Ethan & Chloe" (or "For Aisyah" with one child)
  function sharedByText(kids) {
    if (!kids.length) return "";
    return (kids.length > 1 ? "Shared by " : "For ") + joinNames(kids.map(childFirst));
  }

  // ", shared by Ethan & Chloe" mid-sentence (nothing for one child)
  function sharedByTail(kids) {
    return kids.length > 1 ? ", shared by " + joinNames(kids.map(childFirst)) : "";
  }

  /* ---------- typed credits ----------
     A credit belongs to a credit TYPE (Junior / Elite / Competitive /
     Private with one coach) and only books that type's classes. The family
     shares one wallet per type. */
  function wallets() { return db.balances(fid); }

  // "Junior 8 · Elite 2 · Private · Coach A 1"
  function walletsText(list, sep) {
    return list.map(function (w) { return w.type.short + " " + w.credits; }).join(sep || " · ");
  }

  function walletsLabel(list) {
    return list.length
      ? list.map(function (w) { return w.type.name + ": " + creditsText(w.credits); }).join(", ")
      : "no credits yet";
  }

  function creditChip(typeId, credits) {
    var t = db.creditType(typeId);
    var name = t ? t.short || t.name : db.creditTypeShort(typeId);
    return '<span class="pt-chip pt-chip--credit ' + (t && t.kind === "private" ? "is-private" : "is-" + esc(typeId)) + '">' +
      esc(name) + (credits == null ? "" : " " + credits) + "</span>";
  }

  function tierLabel(tier) {
    var t = String(tier || "");
    return t.charAt(0).toUpperCase() + t.slice(1);
  }

  function perClass(p) {
    if (!p.credits || !p.price) return "";
    var v = p.price / p.credits;
    return "$" + (v % 1 ? v.toFixed(2) : String(v));
  }

  function timeRange(o) {
    return HC.formatTime(o.time) + (o.endTime ? " – " + HC.formatTime(o.endTime) : "");
  }

  function whenText(o) {
    return db.formatDate(o.date) + " at " + HC.formatTime(o.time);
  }

  // Occurrence for a booking; falls back to the booking's own fields if the class is gone.
  function occFor(b) {
    var o = db.occurrence(b.occKey);
    if (o) return o;
    var p = HC.getProgramme(b.programmeId) || { name: "Class", level: "", credits: 1 };
    return {
      key: b.occKey, date: b.date, time: b.time, endTime: null, name: p.name, level: p.level,
      coach: "", oneOff: !!b.oneOffId, note: "", status: "removed", cost: p.credits || 1
    };
  }

  function coachName(by) {
    var s = by ? db.staffById(by) : null;
    return s && s.role === "coach" ? s.name : "Huacheng Elite coaching team";
  }

  // Stable colour per child (by position on the account, removed children included).
  function kidTint(childId) {
    var all = db.children(App.familyId() || "", { includeInactive: true });
    for (var i = 0; i < all.length; i++) {
      if (all[i].id === childId) return "pt-kid--" + (i % 5);
    }
    return "pt-kid--0";
  }

  function initials(name) {
    var w = words(name);
    return ((w[0] || "?").charAt(0) + (w.length > 1 ? w[w.length - 1].charAt(0) : "")).toUpperCase();
  }

  function avatarHTML(ch) {
    return '<span class="pt-avatar ' + kidTint(ch.id) + '" aria-hidden="true">' + esc(initials(ch.name)) + "</span>";
  }

  function kidChip(childId) {
    return '<span class="pt-chip pt-chip--kid ' + kidTint(childId) + '">' + esc(childFirst(db.child(childId))) + "</span>";
  }

  function chip(label, kind, title) {
    return '<span class="pt-chip pt-chip--' + kind + '"' + (title ? ' title="' + esc(title) + '"' : "") + ">" + esc(label) + "</span>";
  }

  function specialChip(note) {
    return '<span class="pt-chip pt-chip--special"' + (note ? ' title="' + esc(note) + '"' : "") + ">" +
      icon("spark") + "Special class</span>";
  }

  function kidSub(ch) {
    var bits = [];
    if (ch.age !== "" && ch.age != null) bits.push("Age " + ch.age);
    bits.push(ch.level + " level");
    return esc(bits.join(" · "));
  }

  function levelHint(ch, o) {
    if (!o || !o.programme || db.levelFits(ch, o.programme)) return "";
    return '<span class="pt-kid__hint">This class is for ' + esc(o.level) + " level</span>";
  }

  function ratingHTML(v) {
    if (!v) return "";
    var label = v + "/5";
    db.noteScale.forEach(function (s) { if (s.v === v) label = s.label; });
    var dots = "";
    for (var i = 1; i <= 5; i++) dots += '<i class="' + (i <= v ? "on" : "") + '"></i>';
    return '<p class="pt-rating"><span class="pt-rating__dots" aria-hidden="true">' + dots + "</span>" +
      '<span class="pt-rating__label">' + esc(label) + '</span><span class="sr-only"> (' + v + " out of 5)</span></p>";
  }

  function attendanceChip(status) {
    if (status === "present") return chip("Present", "ok");
    if (status === "late") return chip("Late", "info");
    if (status === "absent") return chip("Absent", "warn");
    return chip("Awaiting attendance", "muted", "Your coach hasn’t marked this class yet");
  }

  // Inline notice. Pass live=true inside modals so screen readers announce it.
  function alertHTML(kind, html, live) {
    return '<div class="pt-alert pt-alert--' + kind + '"' + (live ? ' role="' + (kind === "warn" ? "alert" : "status") + '"' : "") + ">" +
      icon(kind === "warn" ? "alert" : kind === "ok" ? "check" : "info") + "<div>" + html + "</div></div>";
  }

  function emptyHTML(ic, title, desc, action) {
    return '<div class="empty">' +
        '<span class="empty__ic">' + icon(ic) + "</span>" +
        '<p class="empty__t">' + esc(title) + "</p>" +
        (desc ? '<p class="empty__d">' + desc + "</p>" : "") +
        (action || "") +
      "</div>";
  }

  function scheduleCTA(label) {
    return '<button class="btn btn--primary" type="button" data-view="schedule">' + esc(label || "Browse the schedule") +
      ' <span class="btn__arrow" aria-hidden="true">→</span></button>';
  }

  function setFieldError(inputId, errId, msg) {
    var input = byId(inputId), err = byId(errId);
    if (input) {
      input.classList.toggle("invalid", !!msg);
      if (msg) input.setAttribute("aria-invalid", "true"); else input.removeAttribute("aria-invalid");
    }
    if (err) err.textContent = msg || "";
  }

  /* ============================================================
     LOGIN PAGE
     ============================================================ */
  // Accounts are created by the studio — the portal only signs parents in.
  function initLogin() {
    clearLegacy();
    // already signed in? straight to the portal
    if (App.hasSession()) {
      go("portal.html");
      return;
    }

    // LOG IN — any password; unknown emails open the demo family
    byId("loginForm").addEventListener("submit", function (e) {
      e.preventDefault();
      var email = val("loginEmail");
      var fam = email ? db.familyByEmail(email) : null;
      var flash = null;
      if (!fam) {
        fam = App.demoFamily();
        if (email && fam) {
          flash = "No account matches " + email + " in this demo, so you’re viewing the demo family (" + fam.parentName + ").";
        }
      }
      if (!fam) {
        setFieldError("loginEmail", "loginError", "The demo data couldn’t be loaded — try refreshing the page.");
        return;
      }
      App.login(fam.id, flash);
    });

    // "e.g. marcus.lim@example.com" fills the email field
    document.querySelectorAll("[data-fill]").forEach(function (b) {
      b.addEventListener("click", function () {
        var input = byId("loginEmail");
        input.value = b.getAttribute("data-fill");
        setFieldError("loginEmail", "loginError", "");
        try { byId("loginPass").focus(); } catch (e) {}
      });
    });

    // forgot password — mocked note
    byId("forgotLink").addEventListener("click", function (e) {
      e.preventDefault();
      byId("forgotHint").classList.add("is-shown");
    });

    byId("loginEmail").addEventListener("input", function () { setFieldError("loginEmail", "loginError", ""); });

    // "New here?" — the studio sets accounts up, so point at WhatsApp / the phone
    var wa = byId("loginWhatsApp");
    if (wa) {
      wa.setAttribute("href", "https://wa.me/" + HC.brand.whatsapp + "?text=" +
        encodeURIComponent("Hi Huacheng Elite, I’d like to set up a booking account for my child."));
    }
    var tel = byId("loginPhone");
    if (tel) {
      tel.setAttribute("href", "tel:" + HC.brand.phoneDisplay.replace(/[^\d+]/g, ""));
      tel.textContent = HC.brand.phoneDisplay;
    }

    // DEMO ACCOUNT
    byId("demoBtn").addEventListener("click", function () {
      var fam = App.demoFamily();
      if (fam) App.login(fam.id);
    });
  }

  /* ============================================================
     PORTAL — state & render pipeline
     Views render purely from `ui` + HC.db, so any change (ours,
     staff in another tab, a demo reset) can re-render them.
     ============================================================ */
  var fid = null;
  var ui = {
    view: "dashboard",
    week: 0,             // 0 = this week … WEEKS_AHEAD
    scrollCal: true,     // scroll the week grid to today on the next render
    tab: "upcoming",     // bookings: upcoming | past
    kid: "all",          // bookings child filter
    pastLimit: PAST_PAGE,
    ledgerKid: "all",    // credits: history for every child, or one child's classes
    ledgerType: "all",   // credits: history for one credit type
    creditType: null,    // credits: a credit type to scroll to / highlight
    otherRates: false,   // credits: show the credit types the children don't train at
    ledgerLimit: LEDGER_PAGE,
    noticesAll: false
  };
  var batching = 0, batchDirty = false;
  var pendingRender = false;   // a change arrived while a modal was open
  var resetFormId = null;      // form whose typed values should NOT survive the next render
  var lastBalance = null;      // "junior:8|elite:2" — bumps the pill when a wallet changes
  var scrollToHistory = false; // credits: jump to the history after the next render

  var RENDER = {
    dashboard: renderDashboard,
    schedule: renderSchedule,
    bookings: renderBookings,
    credits: renderCredits,
    account: renderAccount
  };

  function initPortal() {
    clearLegacy();
    fid = App.familyId();
    if (!fid) {
      go("login.html");
      return;
    }

    document.addEventListener("click", onClick);
    document.addEventListener("submit", onSubmit);
    document.addEventListener("keydown", onKey);
    window.addEventListener("hashchange", function () {
      var v = (location.hash || "").replace("#", "");
      if (VIEWS.indexOf(v) >= 0 && v !== ui.view) showView(v, true);
    });
    // signed in/out in another tab
    window.addEventListener("storage", function (e) {
      if (leaving || (e.key !== "hc_parent" && e.key !== null)) return;
      var now = App.familyId();
      if (now !== fid) go(now ? "portal.html" : "login.html");
    });
    db.onChange(onDbChange);

    paintAppbar();
    var initial = (location.hash || "").replace("#", "");
    showView(VIEWS.indexOf(initial) >= 0 ? initial : "dashboard", true);

    var flash = takeFlash();
    if (flash) toast("info", flash);
  }

  function onDbChange() {
    if (leaving) return;
    if (App.familyId() !== fid) {
      // the family vanished (e.g. demo reset in another tab)
      go("login.html");
      return;
    }
    if (batching) { batchDirty = true; return; }
    renderAll();
  }

  // Run several store writes, then render once.
  function batch(fn) {
    batching++;
    try { fn(); }
    finally { batching--; }
    if (!batching && batchDirty) {
      batchDirty = false;
      renderAll();
    }
  }

  // Store write from a form: that form renders fresh (e.g. cleared) afterwards.
  function mutate(formId, fn) {
    resetFormId = formId;
    try { return fn(); }
    finally { resetFormId = null; }
  }

  function renderAll() {
    if (leaving || !fid) return;
    paintAppbar();
    if (modal.open) {
      pendingRender = true;
      if (modal.refresh) modal.refresh();
      return;
    }
    renderView(true);
  }

  function renderView(preserve) {
    var el = byId("view-" + ui.view);
    if (!el) return;
    var saved = preserve ? snapshot(el) : null;
    pendingRender = false;
    RENDER[ui.view](el);
    if (saved) restore(el, saved);
  }

  // Typed-but-unsaved values, focus and scroll, so a background change doesn't wipe them.
  function snapshot(el) {
    var s = { values: [], focus: null, cal: null, y: window.pageYOffset || 0 };
    el.querySelectorAll("input[id], textarea[id]").forEach(function (f) {
      if (resetFormId && f.form && f.form.id === resetFormId) return;
      if (f.type === "checkbox" || f.type === "radio") {
        if (f.checked !== f.defaultChecked) s.values.push({ id: f.id, checked: f.checked });
      } else if (f.value !== f.defaultValue) {
        s.values.push({ id: f.id, value: f.value });
      }
    });
    var a = document.activeElement;
    if (a && a.id && el.contains(a)) {
      s.focus = { id: a.id, start: null, end: null };
      try { s.focus.start = a.selectionStart; s.focus.end = a.selectionEnd; } catch (e) {}
    }
    var cal = el.querySelector(".cal");
    if (cal && !ui.scrollCal) s.cal = cal.scrollLeft;
    return s;
  }

  function restore(el, s) {
    s.values.forEach(function (v) {
      var f = byId(v.id);
      if (!f || !el.contains(f)) return;
      if ("checked" in v && (f.type === "checkbox" || f.type === "radio")) f.checked = v.checked;
      else if ("value" in v) f.value = v.value;
    });
    if (s.focus) {
      var f = byId(s.focus.id);
      if (f && el.contains(f) && !f.disabled) {
        try {
          f.focus({ preventScroll: true });
          if (s.focus.start != null) f.setSelectionRange(s.focus.start, s.focus.end);
        } catch (e) {}
      }
    }
    var cal = el.querySelector(".cal");
    if (cal && s.cal != null) cal.scrollLeft = s.cal;
    if ((window.pageYOffset || 0) !== s.y) {
      try { window.scrollTo(0, s.y); } catch (e) {}
    }
  }

  function showView(view, fromHash) {
    if (VIEWS.indexOf(view) < 0) view = "dashboard";
    var changed = view !== ui.view;
    ui.view = view;

    document.querySelectorAll(".view").forEach(function (v) {
      v.classList.toggle("is-active", v.id === "view-" + view);
    });
    document.querySelectorAll(".navitem[data-view]").forEach(function (n) {
      var on = n.getAttribute("data-view") === view;
      n.classList.toggle("is-active", on);
      if (on) n.setAttribute("aria-current", "page"); else n.removeAttribute("aria-current");
    });

    if (!fromHash) {
      try { history.replaceState(null, "", "#" + view); } catch (e) { location.hash = view; }
    }
    if (view === "schedule") ui.scrollCal = true;
    renderView(false);

    if (changed || !fromHash) {
      try { window.scrollTo(0, 0); } catch (e) {}
    }
  }

  /* ---------- delegated events ---------- */
  var ACTIONS = {
    logout: function () { App.logout(); },
    reset: function () { openConfirmReset(); },
    book: function (key) { openBookModal(key); },
    buy: function (id) { purchase(id); },
    "credit-history": function () { openCredits(true); },
    // Credits view with one credit type in view (dashboard, schedule, booking dialog)
    "credits-type": function (typeId) { openCredits(false, typeId); },
    "ledger-kid": function (arg) {
      ui.ledgerKid = arg || "all";
      ui.ledgerLimit = LEDGER_PAGE;
      renderView(true);
    },
    "other-rates": function () { ui.otherRates = !ui.otherRates; renderView(true); },
    "ledger-type": function (arg) {
      ui.ledgerType = arg || "all";
      ui.ledgerLimit = LEDGER_PAGE;
      renderView(true);
    },
    "all-feedback": function () {
      ui.tab = "past";
      ui.kid = "all";
      ui.pastLimit = PAST_PAGE;
      showView("bookings");
    },
    "cancel-help": function (id) { openCancelNotice(id); },
    "read-all": function () {
      db.markNoticesRead(fid);
      toast("ok", "All notices marked as read.");
    },
    "notices-all": function () { ui.noticesAll = !ui.noticesAll; renderView(true); },
    week: function (arg) {
      ui.week = clamp(parseInt(arg, 10) || 0, 0, WEEKS_AHEAD);
      ui.scrollCal = true;
      renderView(true);
    },
    tab: function (arg) {
      ui.tab = arg === "past" ? "past" : "upcoming";
      renderView(true);
    },
    kid: function (arg) {
      ui.kid = arg || "all";
      ui.pastLimit = PAST_PAGE;
      renderView(true);
    },
    "more-past": function () { ui.pastLimit += PAST_PAGE; renderView(true); },
    "more-ledger": function () { ui.ledgerLimit += LEDGER_PAGE; renderView(true); },
    "edit-child": function (id) { openEditChild(id); },
    "remove-child": function (id) { openRemoveChild(id); }
  };

  function onClick(e) {
    if (modal.open && modal.onDocClick) modal.onDocClick(e);
    var t = e.target && e.target.closest ? e.target.closest("[data-close],[data-view],[data-action]") : null;
    if (!t || t.disabled) return;
    if (t.hasAttribute("data-close")) {
      e.preventDefault();
      closeModal();
      return;
    }
    if (t.hasAttribute("data-view")) {
      e.preventDefault();
      if (modal.open) closeModal();
      showView(t.getAttribute("data-view"));
      return;
    }
    var fn = ACTIONS[t.getAttribute("data-action")];
    if (fn) {
      e.preventDefault();
      fn(t.getAttribute("data-arg"), t);
    }
  }

  function onSubmit(e) {
    var form = e.target;
    if (form.id === "accountForm") { e.preventDefault(); saveAccount(form); }
    else if (form.id === "addChildForm") { e.preventDefault(); addChild(form); }
  }

  function onKey(e) {
    if (!modal.open) return;
    if (e.key === "Escape") {
      // an open dropdown inside the dialog closes first
      if (modal.onEscape && modal.onEscape()) { e.preventDefault(); return; }
      closeModal();
    } else if (e.key === "Tab") {
      // keep keyboard focus inside the open dialog
      var card = byId("modalContent");
      var items = Array.prototype.filter.call(
        card.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'),
        function (x) { return !x.disabled && !x.closest("[hidden]"); });
      if (!items.length) return;
      var first = items[0], last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      else if (!card.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
    }
  }

  /* ============================================================
     APP BAR
     ============================================================ */
  function openCredits(toHistory, typeId) {
    if (modal.open) closeModal();
    scrollToHistory = !!toHistory;
    ui.creditType = typeId && db.creditType(typeId) ? typeId : null;
    if (ui.creditType) ui.otherRates = true;   // make sure its group is on screen
    showView("credits");
  }

  function paintAppbar() {
    var fam = db.family(fid);
    if (!fam) return;
    var kids = db.children(fid);
    var list = wallets();
    var sig = list.map(function (w) { return w.type.id + ":" + w.credits; }).join("|");

    var pill = byId("creditsPill");
    if (pill) {
      var named = list.length > 0 && list.length <= PILL_WALLETS_MAX;
      var chars = list.reduce(function (n, w) { return n + w.type.short.length; }, 0);
      pill.innerHTML = '<span class="dia" aria-hidden="true">◆</span>' +
        (named
          ? '<span class="pt-pill__wallets">' + list.map(function (w) {
              return '<span class="pt-pill__w">' + esc(w.type.short) +
                ' <b class="pt-pill__n is-' + creditState(w.credits) + '">' + w.credits + "</b></span>";
            }).join('<span class="pt-pill__sep"> · </span>') + "</span>"
          : "") +
        '<span class="pt-pill__short">Credits</span>' +
        (list.some(function (w) { return w.credits <= 0; }) ? '<i class="pt-pill__alert" aria-hidden="true"></i>' : "");
      pill.className = "credits-pill " + (named ? "pt-pill--named" : "pt-pill--short") +
        (named && chars > 12 ? " pt-pill--long" : "") + (pill.classList.contains("bump") ? " bump" : "");
      var label = "Family credits — " + walletsLabel(list) + sharedByTail(kids) + ". Open credits";
      pill.setAttribute("aria-label", label);
      pill.setAttribute("title", label);
      if (lastBalance !== null && sig !== lastBalance) {
        pill.classList.remove("bump");
        void pill.offsetWidth; // restart the animation
        pill.classList.add("bump");
      }
    }
    lastBalance = sig;

    var name = byId("whoName");
    var sub = byId("whoSub");
    if (name) name.textContent = fam.parentName || "Parent";
    if (sub) {
      sub.textContent = kids.length ? "Parent of " + joinNames(kids.map(childFirst)) : fam.email;
    }

    var badge = byId("bookingsBadge");
    if (badge) {
      var n = db.upcomingBookings({ familyId: fid }).length;
      badge.textContent = n;
      badge.style.display = n ? "" : "none";
      badge.setAttribute("aria-label", plural(n, "upcoming class", "upcoming classes"));
    }
  }

  /* ============================================================
     DASHBOARD
     ============================================================ */
  function renderDashboard(el) {
    var fam = db.family(fid);
    var kids = db.children(fid);
    var names = joinNames(kids.map(childFirst));
    var ups = db.upcomingBookings({ familyId: fid });

    var sub = kids.length
      ? "Here’s " + esc(names) + "’s training at a glance."
      : "Add your child to your account to start booking classes.";

    el.innerHTML =
      '<div class="view__head">' +
        '<h1 class="view__title">Welcome back, ' + esc(parentFirst(fam, kids)) + ".</h1>" +
        '<p class="view__sub">' + sub + "</p>" +
      "</div>" +

      '<div class="pt-dash-top">' +
        balanceCardHTML(kids) +
        noticesCardHTML() +
      "</div>" +

      '<p class="section-label">Upcoming classes</p>' +
      upcomingHTML(ups, kids) +

      feedbackSectionHTML(kids) +

      '<p class="section-label">Quick actions</p>' +
      '<div class="tiles">' +
        tileHTML("schedule", "calendar", "Book a class", "Browse the next four weeks") +
        tileHTML("bookings", "ticket", "My bookings", "Upcoming, past & feedback") +
        tileHTML("credits", "wallet", "Buy credits", "Top up your family balance via PayNow") +
        tileHTML("account", "user", "My account", "Parent & children’s details") +
      "</div>";
  }

  // The family's one shared credit balance.
  function balanceCardHTML(kids) {
    var list = wallets();
    var total = db.balance(fid);
    var rows = list.length
      ? '<ul class="pt-wallets">' + list.map(function (w) {
          return '<li class="pt-wallet is-' + creditState(w.credits) + '">' +
              '<span class="pt-wallet__n">' + w.credits + "</span>" +
              '<span class="pt-wallet__t">' + esc(w.type.name) + "</span>" +
              '<button class="pt-linkbtn pt-wallet__buy" type="button" data-action="credits-type" data-arg="' + esc(w.type.id) + '"' +
                ' aria-label="Buy ' + esc(w.type.name) + ' credits">Top up</button>' +
            "</li>";
        }).join("") + "</ul>"
      : '<p class="pt-balance-status">No credits yet — buy a package to start booking.</p>';
    return '<section class="balance-card pt-balance is-' + creditState(total) + '" aria-labelledby="ptBalanceTitle">' +
        '<div class="balance-card__info">' +
          '<h2 class="balance-card__k" id="ptBalanceTitle">Family credits</h2>' +
          rows +
          (kids.length ? '<p class="pt-balance-note">' + esc(sharedByText(kids)) +
            " — each class uses credits of its own type.</p>" : "") +
        "</div>" +
        '<div class="balance-card__actions">' +
          '<button class="btn btn--primary" type="button" id="ptBuyFromCard" data-view="credits">Buy credits</button>' +
          '<button class="btn pt-btn-light" type="button" id="ptHistoryFromCard" data-action="credit-history">History</button>' +
        "</div>" +
      "</section>";
  }

  function noticesCardHTML() {
    var list = db.notices(fid);
    var unread = list.filter(function (n) { return !n.read; }).length;
    var limit = ui.noticesAll ? list.length : Math.max(3, unread);
    var shown = list.slice(0, limit);

    var body = list.length
      ? '<ul class="pt-notice-list">' + shown.map(noticeHTML).join("") + "</ul>"
      : '<p class="pt-card__empty">No notices right now — if the studio changes one of your classes, you’ll see it here.</p>';

    return '<section class="pt-card pt-notices" aria-labelledby="ptNoticesTitle">' +
        '<header class="pt-card__head">' +
          '<h2 class="pt-card__title" id="ptNoticesTitle">' + icon("bell") + "Notices" +
            (unread ? ' <span class="pt-count">' + unread + " new</span>" : "") + "</h2>" +
          (unread ? '<button class="pt-linkbtn" type="button" id="ptReadAll" data-action="read-all">Mark all as read</button>' : "") +
        "</header>" +
        body +
        (list.length > limit || ui.noticesAll && list.length > 3
          ? '<button class="pt-linkbtn pt-card__more" type="button" id="ptNoticesAll" data-action="notices-all">' +
              (ui.noticesAll ? "Show fewer" : "Show all " + list.length) + "</button>"
          : "") +
      "</section>";
  }

  var NOTICE_KINDS = {
    cancelled: "Class cancelled",
    removed: "Removed from a class",
    assigned: "Booked by the studio"
  };

  function noticeHTML(n) {
    return '<li class="pt-notice' + (n.read ? "" : " is-unread") + '">' +
        '<span class="pt-notice__dot" aria-hidden="true"></span>' +
        '<div class="pt-notice__body">' +
          '<p class="pt-notice__kind">' + esc(NOTICE_KINDS[n.kind] || "Update") +
            (n.read ? "" : '<span class="sr-only"> (new)</span>') + "</p>" +
          '<p class="pt-notice__text">' + esc(n.text) + "</p>" +
          '<p class="pt-notice__time">' + esc(db.formatStamp(n.at)) + "</p>" +
        "</div>" +
      "</li>";
  }

  // [{ date, items: [{ key, occ, bookings[] }] }] — siblings in one class share an item.
  function groupUpcoming(list) {
    var days = [], byDate = {};
    list.forEach(function (b) {
      var d = byDate[b.date];
      if (!d) { d = byDate[b.date] = { date: b.date, items: [], byKey: {} }; days.push(d); }
      var it = d.byKey[b.occKey];
      if (!it) { it = d.byKey[b.occKey] = { key: b.occKey, occ: occFor(b), bookings: [] }; d.items.push(it); }
      it.bookings.push(b);
    });
    return days;
  }

  function upcomingHTML(ups, kids) {
    if (!ups.length) {
      return emptyHTML("calendar", "No classes booked yet",
        "Browse the schedule and book " + esc(kids.length ? joinNames(kids.map(childFirst)) : "your child") +
        "’s next class — it only takes a tap.", scheduleCTA());
    }
    var shown = 0, more = 0;
    var html = groupUpcoming(ups).map(function (d) {
      var items = d.items.filter(function () {
        if (shown < UPCOMING_ON_DASH) { shown++; return true; }
        more++;
        return false;
      });
      if (!items.length) return "";
      var rel = db.formatDate(d.date, "relative");
      var label = rel === "Today" || rel === "Tomorrow" ? rel + " · " + db.formatDate(d.date) : db.formatDate(d.date);
      return '<div class="pt-daygroup">' +
          '<p class="pt-daylabel">' + esc(label) + "</p>" +
          '<div class="upcoming">' + items.map(upItemHTML).join("") + "</div>" +
        "</div>";
    }).join("");
    if (more) {
      html += '<p class="pt-more-line">+ ' + plural(more, "more class", "more classes") +
        ' in <button class="pt-linkbtn" type="button" data-view="bookings">My bookings</button></p>';
    }
    return html;
  }

  function upItemHTML(it) {
    var o = it.occ;
    var cost = it.bookings.reduce(function (s, b) { return s + (b.cost || 0); }, 0);
    var t = HC.formatTime(o.time).split(" ");
    return '<div class="up-item">' +
        '<div class="up-item__date">' +
          '<div class="pt-up-time">' + esc(t[0]) + "</div>" +
          '<div class="up-item__day">' + esc(t[1] || "") + "</div>" +
        "</div>" +
        '<div class="up-item__body">' +
          '<div class="up-item__name">' + esc(o.name) + "</div>" +
          '<div class="up-item__meta">' + esc(timeRange(o)) +
            (o.coach ? ' · <span class="pt-nowrap">' + esc(o.coach) + "</span>" : "") + "</div>" +
          '<div class="pt-chips">' + it.bookings.map(function (b) { return kidChip(b.childId); }).join("") +
            (o.oneOff ? specialChip(o.note) : "") + "</div>" +
        "</div>" +
        '<div class="up-item__cost" title="Credits used">' + dia(cost) + "</div>" +
      "</div>";
  }

  // A shared note stays visible unless its booking was cancelled (then the
  // class didn't happen for this child — matches the Past list).
  function noteVisible(n) {
    if (!n.shared) return false;
    var b = n.bookingId ? db.booking(n.bookingId) : null;
    return !b || b.status !== "cancelled";
  }

  function sharedNotes(kids) {
    var all = [];
    kids.forEach(function (k) { all = all.concat(db.notes({ childId: k.id, shared: true }).filter(noteVisible)); });
    return all.sort(function (a, b) { return (b.date + (b.at || "")).localeCompare(a.date + (a.at || "")); });
  }

  // Newest shared coach notes across the family's children.
  function feedbackSectionHTML(kids) {
    var all = sharedNotes(kids);
    var latest = all.slice(0, 2);
    var body = latest.length
      ? '<div class="pt-feedback">' + latest.map(function (n) { return feedbackHTML(n, false); }).join("") + "</div>" +
        '<p class="pt-more-line"><button class="pt-linkbtn" type="button" id="ptAllFeedback" data-action="all-feedback">' +
          (all.length > latest.length ? "See all " + all.length + " notes from your coaches" : "See past classes & feedback") +
        "</button></p>"
      : '<p class="pt-card__empty pt-card__empty--box">After a class, your coach’s ratings and notes will appear here.</p>';
    return '<p class="section-label">Latest coach feedback</p>' + body;
  }

  function feedbackHTML(n, compact) {
    var prog = HC.getProgramme(n.programmeId);
    var what = prog ? prog.name : n.bookingId ? "Class" : "Progress note";
    var head = compact ? "" :
      '<div class="pt-fb__head">' + kidChip(n.childId) +
        '<span class="pt-fb__class">' + esc(what + " · " + db.formatDate(n.date)) + "</span>" +
      "</div>";
    return '<figure class="pt-fb' + (compact ? " pt-fb--compact" : "") + '">' +
        head +
        ratingHTML(n.rating) +
        (n.text ? '<blockquote class="pt-fb__text">' + esc(n.text) + "</blockquote>" : "") +
        '<figcaption class="pt-fb__by">— ' + esc(coachName(n.by)) + "</figcaption>" +
      "</figure>";
  }

  function tileHTML(view, ic, title, desc) {
    return '<button class="tile" type="button" data-view="' + view + '">' +
        '<span class="tile__ic">' + icon(ic) + "</span>" +
        '<span class="tile__t">' + esc(title) + "</span>" +
        '<span class="tile__d">' + esc(desc) + "</span>" +
      "</button>";
  }

  /* ============================================================
     SCHEDULE — this week and up to WEEKS_AHEAD weeks ahead
     ============================================================ */
  function renderSchedule(el) {
    ui.week = clamp(ui.week, 0, WEEKS_AHEAD);
    var ws = db.addDays(db.weekStart(db.todayISO()), ui.week * 7);
    var days = db.weekDates(ws);
    var kids = db.children(fid);
    var list = wallets();
    var bal = db.balance(fid);

    var cols = days.map(function (d) {
      var occs = db.occurrencesForDate(d.iso);
      var events = occs.length
        ? occs.map(function (o) { return calEventHTML(o, kids); }).join("")
        : '<p class="cal__none">No classes</p>';
      return '<div class="cal__col' + (d.isToday ? " is-today" : "") + (d.isPast ? " is-past" : "") +
          '" role="group" aria-label="' + esc(db.formatDate(d.iso, "long") + (d.isToday ? " (today)" : "")) + '">' +
          '<div class="cal__head">' +
            '<span class="cal__dow">' + esc(d.short) + (d.isToday ? " · Today" : "") + "</span>" +
            '<span class="cal__date">' + d.date + " " + esc(d.month) + "</span>" +
          "</div>" +
          '<div class="cal__events">' + events + "</div>" +
        "</div>";
    }).join("");

    el.innerHTML =
      '<div class="view__head">' +
        '<h1 class="view__title">Class schedule</h1>' +
        '<p class="view__sub">Book up to four weeks ahead — every class uses ' + dia(1) + " credit of its own type. " +
          (list.length
            ? 'Your family has <strong class="pt-nowrap">' + esc(walletsText(list)) + "</strong>" + esc(sharedByTail(kids)) + "."
            : "Your family has no credits yet.") + "</p>" +
      "</div>" +
      '<div class="pt-schedbar">' + weekNavHTML(ws) + legendHTML() + "</div>" +
      (bal <= 0
        ? alertHTML("warn", '<span class="pt-alert__text">You’re out of credits — top up to book the next class.</span>' +
            '<button class="btn btn--primary btn--sm pt-alert__cta" type="button" data-view="credits">Buy credits</button>')
        : "") +
      '<div class="cal cal--portal" aria-label="Classes for the week of ' + esc(db.formatDate(ws, "long")) + '">' + cols + "</div>";

    var cal = el.querySelector(".cal");
    if (cal && ui.scrollCal) {
      ui.scrollCal = false;
      var today = cal.querySelector(".is-today");
      cal.scrollLeft = today && ui.week === 0 ? Math.max(0, today.offsetLeft - cal.offsetLeft) : 0;
    }
  }

  function weekNavHTML(ws) {
    var we = db.addDays(ws, 6);
    var atEnd = ui.week >= WEEKS_AHEAD;
    return '<div class="pt-weeknav" role="group" aria-label="Choose week">' +
        '<button class="pt-weeknav__btn" type="button" id="ptWeekPrev" data-action="week" data-arg="' + (ui.week - 1) +
          '" aria-label="Previous week"' + (ui.week <= 0 ? " disabled" : "") + ">" + icon("chev-left") + "</button>" +
        '<div class="pt-weeknav__label" aria-live="polite">' +
          "<strong>" + esc(db.formatDate(ws, "day") + " – " + db.formatDate(we, "day")) + "</strong>" +
          "<span>" + esc(WEEK_LABELS[ui.week]) + "</span>" +
        "</div>" +
        '<button class="pt-weeknav__btn" type="button" id="ptWeekNext" data-action="week" data-arg="' + (ui.week + 1) +
          '" aria-label="Next week"' + (atEnd ? ' disabled title="Bookings open up to four weeks ahead"' : "") + ">" +
          icon("chev-right") + "</button>" +
        (ui.week > 0
          ? '<button class="pt-linkbtn pt-weeknav__now" type="button" id="ptWeekNow" data-action="week" data-arg="0">Back to this week</button>'
          : "") +
      "</div>";
  }

  function legendHTML() {
    function item(cls, label) {
      return '<li><i class="pt-legend__sw ' + cls + '" aria-hidden="true"></i>' + label + "</li>";
    }
    return '<ul class="pt-legend" aria-label="Legend">' +
        item("is-open", "Open") + item("is-booked", "Booked") + item("is-full", "Full") +
        item("is-blocked", "Unavailable") + item("is-special", "Special class") +
      "</ul>";
  }

  function calEventHTML(o, kids) {
    var mine = db.bookings({ occKey: o.key, familyId: fid });
    var bookedIds = mine.map(function (b) { return b.childId; });
    var bookedNames = mine.map(function (b) { return childFirst(db.child(b.childId)); });
    var free = kids.filter(function (k) { return bookedIds.indexOf(k.id) < 0; });
    var label = o.name + " on " + whenText(o);
    var tag = mine.length
      ? '<span class="cal__tag">' + icon("check") + "<span>" + esc(joinNames(bookedNames)) + " booked</span></span>"
      : "";
    var cls = "", spots = "", action = "";

    if (o.status === "blocked") {
      // staff reasons stay private — parents only see the kind of change
      cls = " is-blocked";
      action = '<button class="cal__book" type="button" disabled>Unavailable</button>' +
        '<span class="pt-cal-why">' + (o.blockKind === "leave" ? "Coach unavailable" : "Cancelled by the studio") + "</span>";
    } else if (o.started) {
      cls = " is-closed" + (mine.length ? " is-booked" : "");
      action = tag + '<button class="cal__book" type="button" disabled>Closed</button>';
    } else if (mine.length) {
      cls = " is-booked";
      spots = o.spotsLeft ? o.spotsLeft + " left" : "Full";
      action = tag + (free.length && o.spotsLeft > 0
        ? '<button class="pt-cal-more" type="button" data-action="book" data-arg="' + esc(o.key) +
            '" aria-label="Book another child into ' + esc(label) + '">+ Book another child</button>'
        : "");
    } else if (o.spotsLeft <= 0) {
      cls = " is-full";
      spots = "Full";
      action = '<button class="cal__book" type="button" disabled>Full</button>';
    } else if (db.balance(fid, o.creditType) < o.cost) {
      // the family holds no credits of this class's type
      cls = o.spotsLeft <= 2 ? " is-low" : "";
      spots = o.spotsLeft + " left";
      action = '<button class="cal__book cal__book--buy" type="button" data-action="credits-type" data-arg="' + esc(o.creditType) +
        '" aria-label="Buy ' + esc(o.creditTypeName) + ' credits to book ' + esc(label) + '">Buy ' + esc(o.creditTypeName) + " credits</button>";
    } else {
      cls = o.spotsLeft <= 2 ? " is-low" : "";
      spots = o.spotsLeft + " left";
      action = '<button class="cal__book" type="button" data-action="book" data-arg="' + esc(o.key) +
        '" aria-label="Book ' + esc(label) + ' with ' + esc(o.creditTypeName) + ' credits">Book ' + dia(o.cost) + "</button>";
    }

    var title = o.name + (o.level ? " · " + o.level : "") + " · " + o.coach + " · " + timeRange(o) +
      " · uses " + o.creditTypeName + " credits";
    return '<div class="cal__event cal__event--p' + cls + (o.oneOff ? " is-special" : "") + '" title="' + esc(title) + '">' +
        (o.oneOff ? '<span class="pt-special">' + icon("spark") + "Special class</span>" : "") +
        '<span class="cal__time">' + esc(HC.formatTime(o.time)) + "</span>" +
        '<span class="cal__prog">' + esc(o.name) + "</span>" +
        (o.oneOff && o.note ? '<span class="pt-cal-note">' + esc(o.note) + "</span>" : "") +
        '<span class="cal__erow">' +
          '<span class="cal__coach">' + esc(o.coach) + "</span>" +
          (spots ? '<span class="cal__spots">' + spots + "</span>" : "") +
        "</span>" +
        '<span class="pt-cal-credit" title="' + esc("Uses " + o.creditTypeName + " credits") + '">' +
          '<span class="dia" aria-hidden="true">◆</span>' + esc(o.creditTypeName) + "</span>" +
        action +
      "</div>";
  }

  /* ---------- booking modal ----------
     Who's coming is a dropdown: a select-style button opens a panel with a
     checkbox per child (several children can be booked at once — e.g. three
     siblings into one Competitive Private Group session). Every place is paid
     from the family's wallet for THIS class's credit type. */
  function openBookModal(key) {
    if (!db.occurrence(key)) {
      toast("warn", "That class is no longer on the schedule.");
      return;
    }
    var sel = {};          // childId → true
    var err = "";
    var errCredits = false;
    var errType = null;
    var pickerOpen = false;

    // default: the first child who isn't already booked into this class
    var first = db.children(fid).filter(function (k) {
      return !db.bookings({ occKey: key, childId: k.id }).length;
    })[0];
    if (first) sel[first.id] = true;

    // Fresh view of the class every time, so staff changes land in the open dialog.
    function state() {
      var o = db.occurrence(key);
      var kids = db.children(fid);
      var booked = {};
      if (o) db.bookings({ occKey: key, familyId: fid }).forEach(function (b) { booked[b.childId] = true; });
      Object.keys(sel).forEach(function (id) {
        var stillHere = kids.some(function (k) { return k.id === id; });
        if (booked[id] || !stillHere) delete sel[id];
      });
      // [PORT-7] one child has no picker, so they're always the pick
      if (kids.length === 1 && !booked[kids[0].id] && !Object.keys(sel).length) sel[kids[0].id] = true;
      var chosen = kids.filter(function (k) { return sel[k.id]; });
      var waiting = kids.filter(function (k) { return !booked[k.id]; });
      var closed = !o ? "This class is no longer on the schedule."
        : o.status === "removed" ? "This class has been cancelled by the studio."
        : o.status === "blocked" ? (o.blockKind === "leave"
            ? "The coach is unavailable, so this class can’t be booked."
            : "This class has been cancelled by the studio.")
        : o.started ? "This class has already started, so booking is closed."
        // [PORT-8] full while someone is still to book → say so straight away
        : o.spotsLeft <= 0 && waiting.length ? "Sorry, this class is now full." : "";
      var type = o ? o.creditType : null;
      return {
        o: o, kids: kids, booked: booked, chosen: chosen, waiting: waiting, closed: closed,
        type: type, typeName: o ? o.creditTypeName : "",
        bal: type ? db.balance(fid, type) : 0, cost: o ? chosen.length * o.cost : 0
      };
    }

    function pickedText(list) {
      if (!list.length) return "Choose a child";
      return list.length > 3 ? plural(list.length, "child", "children") : joinNames(list.map(childFirst));
    }

    function pickerHTML(s) {
      var off = !!s.closed;
      var open = pickerOpen && !off;
      var allOn = s.waiting.length > 0 && s.waiting.every(function (k) { return sel[k.id]; });
      var someOn = s.waiting.some(function (k) { return sel[k.id]; });
      return '<div class="pt-picker' + (open ? " is-open" : "") + '" id="ptPicker">' +
          '<span class="pt-picker__label" id="ptPickerLabel">Who’s coming?</span>' +
          '<button class="pt-picker__btn" type="button" id="ptPickerBtn" aria-haspopup="true" aria-expanded="' + open + '"' +
            ' aria-controls="ptPickerPanel" aria-labelledby="ptPickerLabel ptPickerValue"' + (off ? " disabled" : "") + ">" +
            '<span class="pt-picker__value' + (s.chosen.length ? "" : " is-empty") + '" id="ptPickerValue">' + esc(pickedText(s.chosen)) + "</span>" +
            '<span class="pt-picker__chev">' + icon("chev-down") + "</span>" +
          "</button>" +
          '<div class="pt-picker__panel" id="ptPickerPanel" role="group" aria-labelledby="ptPickerLabel"' + (open ? "" : " hidden") + ">" +
            '<label class="pt-opt pt-opt--all' + (allOn ? " is-checked" : "") + (s.waiting.length ? "" : " is-disabled") + '" for="ptPickAll">' +
              '<input type="checkbox" id="ptPickAll"' + (allOn ? " checked" : "") + (s.waiting.length ? "" : " disabled") +
                (someOn && !allOn ? ' aria-checked="mixed" data-mixed="1"' : "") + ">" +
              '<span class="pt-opt__text"><span class="pt-opt__name">Select all</span>' +
                '<span class="pt-opt__sub">' + esc(s.waiting.length === s.kids.length
                  ? "All " + s.kids.length + " children"
                  : plural(s.waiting.length, "child", "children") + " not booked yet") + "</span></span>" +
            "</label>" +
            s.kids.map(function (k) {
              var booked = !!s.booked[k.id];
              var id = "ptPick-" + k.id;
              return '<label class="pt-opt' + (booked ? " is-booked is-disabled" : sel[k.id] ? " is-checked" : "") + '" for="' + esc(id) + '">' +
                  '<input type="checkbox" id="' + esc(id) + '" value="' + esc(k.id) + '"' +
                    (booked || sel[k.id] ? " checked" : "") + (booked ? " disabled" : "") + ">" +
                  avatarHTML(k) +
                  '<span class="pt-opt__text">' +
                    '<span class="pt-opt__name">' + esc(k.name) + "</span>" +
                    '<span class="pt-opt__sub">' + kidSub(k) + "</span>" +
                    levelHint(k, s.o) +
                  "</span>" +
                  (booked ? '<span class="pt-kid__tag">Already booked</span>' : "") +
                "</label>";
            }).join("") +
            '<div class="pt-picker__foot"><button class="btn btn--primary btn--sm" type="button" id="ptPickerDone">Done</button></div>' +
          "</div>" +
        "</div>";
    }

    function build(s) {
      var o = s.o;
      var n = s.chosen.length;
      var single = s.kids.length === 1;
      var html = modalHead(single ? "Book " + childFirst(s.kids[0]) + "’s class" : "Book a class", "");
      if (o) html += classInfoHTML(o);

      // who's coming
      if (!s.kids.length) {
        html += alertHTML("info", "Add your child to your account before booking. " +
          '<button class="pt-linkbtn" type="button" data-view="account">Add a child</button>', true);
      } else if (single) {
        var k = s.kids[0];
        html += '<div class="pt-who">' + avatarHTML(k) +
            '<div class="pt-kid__text"><span class="pt-kid__label">For</span>' +
              '<span class="pt-kid__name">' + esc(k.name) + "</span>" +
              '<span class="pt-kid__sub">' + kidSub(k) + "</span>" + levelHint(k, o) +
            "</div>" +
            (s.booked[k.id] ? '<span class="pt-kid__tag">Already booked</span>' : "") +
          "</div>";
      } else {
        html += pickerHTML(s);
      }

      // problems — credits are checked against the FAMILY balance
      var everyone = s.kids.length > 0 && !s.waiting.length;
      var open = !s.closed && !everyone && s.kids.length > 0;
      var tooMany = open && o && n > o.spotsLeft;
      // warn early when even one place is unaffordable, not only once children are ticked
      var short = open && o && s.bal < Math.max(s.cost, o.cost);
      if (s.closed) {
        html += alertHTML("warn", esc(s.closed), true);
      } else if (everyone) {
        html += alertHTML("ok", single
          ? esc(childFirst(s.kids[0])) + " is already booked into this class."
          : "Everyone on your account is already booked into this class.", true);
      } else if (tooMany) {
        html += alertHTML("warn", "Only " + plural(o.spotsLeft, "spot") + " left — please choose " +
          (o.spotsLeft === 1 ? "one child" : o.spotsLeft + " children") + ".", true);
      }
      if (short || (err && errCredits)) {
        html += alertHTML("warn", '<span class="pt-alert__text">' + (n
            ? "Not enough " + esc(s.typeName) + " credits — this class needs " + s.cost + " and your family has " + s.bal + "."
            : "Your family has " + s.bal + " " + esc(s.typeName) + " credits — top up to book this class.") + "</span>" +
          '<button class="btn btn--primary btn--sm pt-alert__cta" type="button" id="ptBuyCredits" data-action="credits-type"' +
          ' data-arg="' + esc(s.type || "") + '">Buy ' + esc(s.typeName) + " credits</button>", true);
      }
      if (err && !errCredits) html += alertHTML("warn", esc(err), true);

      // summary: who, what it uses, and the family balance before → after
      if (o && !s.closed && s.kids.length && !everyone) {
        html += '<p class="pt-summary' + (short ? " is-short" : "") + '" aria-live="polite">' + (n
          ? esc(joinNames(s.chosen.map(childFirst))) + " · uses <strong>" + s.cost + " " + esc(s.typeName) +
            " credit" + (s.cost === 1 ? "" : "s") + "</strong>" +
            ' · <span class="pt-nowrap">' + esc(s.typeName) + " " + s.bal + " → <strong>" + (s.bal - s.cost) + "</strong></span>"
          : "Choose who’s coming — this class uses " + esc(s.typeName) + " credits.") + "</p>";
      }

      var disabled = !o || !!s.closed || !n || tooMany || short;
      var label = n
        ? "Book " + joinNames(s.chosen.map(childFirst)) + " · " + s.cost + " " + s.typeName + " credit" + (s.cost === 1 ? "" : "s")
        : "Confirm booking";
      html += '<div class="modal__actions">' +
          (s.kids.length && !everyone
            ? '<button class="btn btn--primary btn--block" type="button" id="ptBookConfirm"' + (disabled ? " disabled" : "") + ">" + esc(label) + "</button>"
            : "") +
          '<button class="btn btn--ghost btn--block" type="button" data-close>' + (everyone || !s.kids.length ? "Close" : "Cancel") + "</button>" +
        "</div>";
      return html;
    }

    function setPicker(open, focusBtn) {
      pickerOpen = open;
      paint();
      if (open) {
        var items = pickerItems();
        if (items[0]) { try { items[0].focus(); } catch (e) {} }
      } else if (focusBtn) {
        var b = byId("ptPickerBtn");
        if (b) { try { b.focus(); } catch (e) {} }
      }
    }

    function pickerItems() {
      var panel = byId("ptPickerPanel");
      return panel ? Array.prototype.filter.call(panel.querySelectorAll('input[type="checkbox"]'), function (x) { return !x.disabled; }) : [];
    }

    function bind(card) {
      var all = card.querySelector("#ptPickAll");
      if (all) {
        if (all.getAttribute("data-mixed")) all.indeterminate = true;
        all.addEventListener("change", function () {
          var s = state();
          s.waiting.forEach(function (k) { if (all.checked) sel[k.id] = true; else delete sel[k.id]; });
          err = "";
          paint();
        });
      }
      card.querySelectorAll('#ptPickerPanel input[type="checkbox"][value]').forEach(function (cb) {
        cb.addEventListener("change", function () {
          if (cb.checked) sel[cb.value] = true; else delete sel[cb.value];
          err = "";
          errCredits = false;
          paint();
        });
      });
      var btn = card.querySelector("#ptPickerBtn");
      if (btn) btn.addEventListener("click", function () { setPicker(!pickerOpen, false); });
      var done = card.querySelector("#ptPickerDone");
      if (done) done.addEventListener("click", function () { setPicker(false, true); });
      var panel = card.querySelector("#ptPickerPanel");
      if (panel) {
        panel.addEventListener("keydown", function (e) {
          var items = pickerItems();
          var i = items.indexOf(document.activeElement);
          var next = null;
          if (e.key === "ArrowDown") next = items[(i + 1) % items.length];
          else if (e.key === "ArrowUp") next = items[(i - 1 + items.length) % items.length];
          else if (e.key === "Home") next = items[0];
          else if (e.key === "End") next = items[items.length - 1];
          if (next) { e.preventDefault(); next.focus(); }
        });
      }
      var picker = card.querySelector("#ptPicker");
      if (picker) {
        // keyboard focus leaving the dropdown closes it
        picker.addEventListener("focusout", function () {
          setTimeout(function () {
            var pk = byId("ptPicker");
            var a = document.activeElement;
            if (pickerOpen && modal.open && pk && a && a !== document.body && !pk.contains(a)) setPicker(false, false);
          }, 0);
        });
      }
      var ok = card.querySelector("#ptBookConfirm");
      if (ok) ok.addEventListener("click", confirmBooking);
    }

    function paint() {
      var focusId = document.activeElement && document.activeElement.id;
      setModal(build(state()), bind);
      var f = focusId && byId(focusId);
      if (f && !f.disabled && !f.closest("[hidden]")) { try { f.focus(); } catch (e) {} }
    }

    // HC.db.book re-checks everything (status, spots, the right credits, duplicates) per child.
    function confirmBooking() {
      var s = state();
      if (!s.o || s.closed || !s.chosen.length) { paint(); return; }
      pickerOpen = false;
      var ok = [], failed = [];
      batch(function () {
        s.chosen.forEach(function (k) {
          var res = db.book(key, k.id, { familyId: fid, by: "parent:" + fid, source: "parent" });
          if (res.ok) { ok.push(childFirst(k)); delete sel[k.id]; }
          else failed.push({ name: childFirst(k), error: res.error, code: res.code, creditType: res.creditType });
        });
      });
      var when = s.o.name + ", " + whenText(s.o);
      if (!failed.length) {
        closeModal();
        toast("ok", "Booked! " + joinNames(ok) + " · " + when + ".");
      } else if (ok.length) {
        closeModal();
        toast("warn", "Booked " + joinNames(ok) + " for " + when + ", but " +
          joinNames(failed.map(function (f) { return f.name; })) + " couldn’t be booked: " + failed[0].error);
      } else {
        err = failed[0].error;
        errCredits = failed[0].code === "credits";
        if (errCredits && failed[0].creditType) errType = failed[0].creditType;
        paint();
        toast("warn", "Couldn’t book: " + failed[0].error);
      }
    }

    openModal(build(state()), {
      bind: bind,
      refresh: paint,
      // clicks elsewhere in the dialog close the dropdown (focus stays put)
      onDocClick: function (e) {
        if (!pickerOpen || !e.target || !document.contains(e.target)) return;
        var pk = byId("ptPicker");
        if (pk && !pk.contains(e.target)) setPicker(false, false);
      },
      onEscape: function () {
        if (!pickerOpen) return false;
        setPicker(false, true);
        return true;
      }
    });
  }

  function classInfoHTML(o) {
    var meta = [o.coach, o.level ? o.level + " level" : "", o.status === "open" && !o.started ? plural(o.spotsLeft, "spot") + " left" : ""]
      .filter(Boolean).join(" · ");
    return '<div class="pt-classinfo">' +
        (o.oneOff ? specialChip() : "") + creditChip(o.creditType) +
        '<p class="pt-classinfo__name">' + esc(o.name) + "</p>" +
        '<p class="pt-classinfo__when">' + esc(db.formatDate(o.date, "full") + " · " + timeRange(o)) + "</p>" +
        '<p class="pt-classinfo__meta">' + esc(meta) + "</p>" +
        (o.oneOff && o.note ? '<p class="pt-classinfo__note">' + esc(o.note) + "</p>" : "") +
      "</div>";
  }

  /* ============================================================
     MY BOOKINGS
     ============================================================ */
  function cancelledBookings(childId, future) {
    return db.bookings({ familyId: fid, includeCancelled: true }).filter(function (b) {
      return b.status === "cancelled" && (!childId || b.childId === childId) && db.hasStarted(b) !== future;
    });
  }

  // Past timeline: attended/booked classes, classes the studio cancelled (once
  // their date has passed — future ones sit with Upcoming), and shared coach
  // notes that aren't tied to a class. [{ booking | note, key, at }]
  function pastList(childId) {
    var items = db.pastBookings({ familyId: fid }).concat(cancelledBookings(childId, false))
      .filter(function (b) { return !childId || b.childId === childId; })
      .map(function (b) { return { booking: b, key: b.date + "T" + b.time, at: b.at || "" }; });
    db.children(fid, { includeInactive: true }).forEach(function (k) {
      if (childId && k.id !== childId) return;
      db.notes({ childId: k.id, shared: true }).forEach(function (n) {
        if (n.bookingId) return;
        var at = n.at || "";
        items.push({ note: n, key: n.date + "T" + (at.slice(0, 10) === n.date ? at.slice(11, 16) : "23:59"), at: at });
      });
    });
    return items.sort(function (a, b) { return b.key.localeCompare(a.key) || b.at.localeCompare(a.at); });
  }

  function renderBookings(el) {
    var kids = db.children(fid);
    if (ui.kid !== "all" && !kids.some(function (k) { return k.id === ui.kid; })) ui.kid = "all";
    var only = ui.kid === "all" ? null : ui.kid;
    var onlyName = only ? childFirst(db.child(only)) : "";

    var up = db.upcomingBookings({ familyId: fid })
      .filter(function (b) { return !only || b.childId === only; });
    var past = pastList(only);
    var isPast = ui.tab === "past";

    var tabs = '<div class="pt-tabs" role="tablist" aria-label="Bookings">' +
        tabHTML("upcoming", "Upcoming", up.length) +
        tabHTML("past", "Past", null) +
      "</div>";

    var filter = kids.length > 1
      ? '<div class="pt-seg" role="group" aria-label="Show bookings for">' +
          segHTML("all", "All children") +
          kids.map(function (k) { return segHTML(k.id, childFirst(k)); }).join("") +
        "</div>"
      : "";

    var body;
    if (!isPast) {
      var gone = cancelledBookings(only, true).sort(function (a, b) {
        return (a.date + a.time).localeCompare(b.date + b.time);
      });
      body = (up.length
        ? '<div class="bookings">' + up.map(upcomingCardHTML).join("") + "</div>"
        : emptyHTML("ticket", only ? "No upcoming classes for " + onlyName : "No upcoming classes",
            "When you book a class it will appear here, with the date, time and coach.", scheduleCTA())) +
        (gone.length
          ? '<h2 class="pt-grouplabel">Cancelled by the studio</h2>' +
            '<div class="bookings">' + gone.map(pastCardHTML).join("") + "</div>"
          : "");
    } else if (!past.length) {
      body = emptyHTML("ticket", only ? "No past classes for " + onlyName : "No past classes yet",
        "Attended classes, attendance and coach feedback will appear here.", "");
    } else {
      var shown = past.slice(0, ui.pastLimit);
      body = '<div class="bookings">' + shown.map(function (it) {
          return it.note ? noteCardHTML(it.note) : pastCardHTML(it.booking);
        }).join("") + "</div>" +
        (past.length > shown.length
          ? '<div class="pt-more"><button class="btn btn--ghost btn--sm" type="button" id="ptMorePast" data-action="more-past">Show more (' +
              (past.length - shown.length) + " left)</button></div>"
          : "");
    }

    el.innerHTML =
      '<div class="view__head">' +
        '<h1 class="view__title">My bookings</h1>' +
        '<p class="view__sub">' + (isPast
          ? "Past classes with attendance and coach feedback, plus any classes the studio cancelled or removed your child from."
          : "Your upcoming classes" + (up.length ? " — " + plural(up.length, "class", "classes") + " booked." : ".")) + "</p>" +
      "</div>" +
      '<div class="pt-filters">' + tabs + filter + "</div>" +
      '<div id="ptBookingsPanel" role="tabpanel" aria-labelledby="ptTab-' + ui.tab + '">' + body + "</div>";
  }

  function tabHTML(id, label, count) {
    var on = ui.tab === id;
    return '<button class="pt-tabs__btn" type="button" role="tab" id="ptTab-' + id + '" aria-selected="' + on +
        '" aria-controls="ptBookingsPanel" data-action="tab" data-arg="' + id + '">' + esc(label) +
        (count ? ' <span class="pt-tabs__n">' + count + "</span>" : "") + "</button>";
  }

  function segHTML(id, label) {
    return '<button class="pt-seg__btn" type="button" id="ptFilter-' + esc(id) + '" aria-pressed="' + (ui.kid === id) +
      '" data-action="kid" data-arg="' + esc(id) + '">' + esc(label) + "</button>";
  }

  function dateBlockHTML(iso) {
    var parts = db.formatDate(iso, "day").split(" "); // ["24", "Sep"]
    return '<div class="pt-date" aria-hidden="true">' +
        '<span class="pt-date__dow">' + esc(HC.dayShort[db.dayIndex(iso)]) + "</span>" +
        '<span class="pt-date__n">' + esc(parts[0]) + "</span>" +
        '<span class="pt-date__m">' + esc(parts[1] || "") + "</span>" +
      "</div>";
  }

  function upcomingCardHTML(b) {
    var o = occFor(b);
    var rel = db.formatDate(b.date, "relative");
    var meta = (rel === "Today" || rel === "Tomorrow" ? rel + " · " : "") + timeRange(o) + (o.coach ? " · " + o.coach : "");
    return '<article class="booking-card pt-bcard">' +
        '<div class="pt-bcard__main">' +
          dateBlockHTML(b.date) +
          '<div class="pt-bcard__body">' +
            '<h3 class="booking-card__name">' + esc(o.name) + '<span class="sr-only">, ' + esc(db.formatDate(b.date, "long")) + "</span></h3>" +
            '<p class="booking-card__meta">' + esc(meta) + "</p>" +
            '<div class="pt-chips">' + kidChip(b.childId) + (o.oneOff ? specialChip(o.note) : "") + "</div>" +
          "</div>" +
        "</div>" +
        '<div class="pt-bcard__side">' +
          '<span class="booking-card__cost">' + dia(b.cost) + " used</span>" +
          '<button class="btn btn--ghost btn--sm" type="button" data-action="cancel-help" data-arg="' + esc(b.id) + '"' +
            ' aria-label="Cancel ' + esc(childFirst(db.child(b.childId)) + "’s " + o.name + " on " + db.formatDate(b.date)) + '">Cancel</button>' +
        "</div>" +
      "</article>";
  }

  function pastCardHTML(b) {
    var o = occFor(b);
    var cancelled = b.status === "cancelled";
    var note = cancelled ? null : db.noteForBooking(b.id);
    var status = cancelled
      ? chip(b.cancelKind === "removed" ? "Removed by the studio" : "Cancelled by the studio", "warn") +
        (b.refunded ? chip("Credit refunded", "ok") : "")
      : attendanceChip(b.attendance);
    return '<article class="booking-card pt-bcard pt-bcard--past' + (cancelled ? " is-cancelled" : "") + '">' +
        '<div class="pt-bcard__main">' +
          dateBlockHTML(b.date) +
          '<div class="pt-bcard__body">' +
            '<h3 class="booking-card__name">' + esc(o.name) + '<span class="sr-only">, ' + esc(db.formatDate(b.date, "long")) + "</span></h3>" +
            '<p class="booking-card__meta">' + esc(timeRange(o) + (o.coach ? " · " + o.coach : "")) + "</p>" +
            '<div class="pt-chips">' + kidChip(b.childId) + (o.oneOff ? specialChip(o.note) : "") + "</div>" +
          "</div>" +
        "</div>" +
        '<div class="pt-bcard__side pt-chips">' + status + "</div>" +
        (note && note.shared ? feedbackHTML(note, true) : "") +
      "</article>";
  }

  // A shared progress note that isn't tied to a class.
  function noteCardHTML(n) {
    return '<article class="booking-card pt-bcard pt-bcard--past pt-bcard--note">' +
        '<div class="pt-bcard__main">' +
          dateBlockHTML(n.date) +
          '<div class="pt-bcard__body">' +
            '<h3 class="booking-card__name">Progress note<span class="sr-only">, ' + esc(db.formatDate(n.date, "long")) + "</span></h3>" +
            '<p class="booking-card__meta">From ' + esc(coachName(n.by)) + " — not tied to a class</p>" +
            '<div class="pt-chips">' + kidChip(n.childId) + "</div>" +
          "</div>" +
        "</div>" +
        '<div class="pt-bcard__side pt-chips">' + chip("Coach feedback", "info") + "</div>" +
        feedbackHTML(n, true) +
      "</article>";
  }

  /* ============================================================
     CREDITS — one family balance: packages by level + history
     ============================================================ */
  function renderCredits(el) {
    var kids = db.children(fid);
    var bal = db.balance(fid);
    var pk = db.packagesFor(fid);
    var trial = pk.filter(function (p) { return p.price === 0; })[0];
    var packs = pk.filter(function (p) { return p.price > 0; });

    // which children train at each pricing level
    var kidsAt = {};
    kids.forEach(function (k) {
      var t = k.level === "Competitive" ? "competitive" : k.level === "Elite" ? "elite" : "junior";
      (kidsAt[t] = kidsAt[t] || []).push(k);
    });
    var mine = TIERS.filter(function (t) { return packs.some(function (p) { return p.tier === t && p.suggested; }); });
    var others = TIERS.filter(function (t) { return mine.indexOf(t) < 0 && packs.some(function (p) { return p.tier === t; }); });

    function group(tier) {
      var list = packs.filter(function (p) { return p.tier === tier; });
      var who = kidsAt[tier] || [];
      return '<section class="pt-pkgs" aria-labelledby="ptPkgs-' + tier + '">' +
          '<div class="pt-pkgs__head">' +
            '<h3 class="pt-pkgs__title" id="ptPkgs-' + tier + '">' + esc((list[0] && list[0].tierLabel) || tierLabel(tier)) + " rates</h3>" +
            (who.length ? chip(joinNames(who.map(childFirst)) + (who.length > 1 ? " train" : " trains") + " at this level", "ok") : "") +
          "</div>" +
          '<div class="packages">' + list.map(packageCardHTML).join("") + "</div>" +
        "</section>";
    }

    var trialHTML = trial
      ? '<section class="pt-pkgs pt-pkgs--trial" aria-label="Free trial"><div class="packages">' + packageCardHTML(trial) + "</div></section>"
      : "";

    if (ui.ledgerKid !== "all" && !kids.some(function (k) { return k.id === ui.ledgerKid; })) ui.ledgerKid = "all";
    var rows = db.ledgerWithBalance(fid);
    if (ui.ledgerKid !== "all") rows = rows.filter(function (l) { return l.childId === ui.ledgerKid; });
    var shown = rows.slice(0, ui.ledgerLimit);
    var onlyName = ui.ledgerKid === "all" ? "" : childFirst(db.child(ui.ledgerKid));

    var filter = kids.length > 1
      ? '<div class="pt-seg" role="group" aria-label="Show history for">' +
          ledgerSeg("all", "All") +
          kids.map(function (k) { return ledgerSeg(k.id, childFirst(k)); }).join("") +
        "</div>"
      : "";

    var history = rows.length
      ? (onlyName ? '<p class="muted pt-ledger-hint">' + esc(possessive(onlyName)) +
            " classes and refunds — the balance is your family balance after each change.</p>" : "") +
        '<div class="pt-tablewrap"><table class="pt-ledger">' +
          '<caption class="sr-only">' + esc(onlyName ? "Family credit history for " + onlyName + "’s classes" : "Family credit history") +
            ", newest first</caption>" +
          '<thead><tr><th scope="col">Date</th><th scope="col">Description</th>' +
            '<th scope="col" class="num">Change</th><th scope="col" class="num">Balance</th></tr></thead>' +
          "<tbody>" + shown.map(ledgerRowHTML).join("") + "</tbody>" +
        "</table></div>" +
        (rows.length > shown.length
          ? '<div class="pt-more"><button class="btn btn--ghost btn--sm" type="button" id="ptMoreLedger" data-action="more-ledger">Show older (' +
              (rows.length - shown.length) + " left)</button></div>"
          : "")
      : '<p class="pt-card__empty pt-card__empty--box">' +
          esc(onlyName ? "No classes or refunds for " + onlyName + " yet." : "No credit activity yet.") + "</p>";

    el.innerHTML =
      '<div class="view__head">' +
        '<h1 class="view__title">Credits</h1>' +
        '<p class="view__sub">One credit books one class for one child, and your whole family shares one balance. Checkout is a PayNow mock.</p>' +
      "</div>" +
      '<div class="balance-strip pt-credit-strip is-' + creditState(bal) + '">' +
        '<span class="balance-strip__k">Family credits</span>' +
        '<span class="balance-strip__v">' + dia(bal) + " credit" + (bal === 1 ? "" : "s") + "</span>" +
        (kids.length ? '<span class="pt-credit-strip__who">' + esc(sharedByText(kids)) + "</span>" : "") +
        '<span class="pt-credit-strip__status">' + esc(creditStatusText(bal)) + "</span>" +
      "</div>" +
      '<h2 class="pt-h2 pt-h2--first">Buy credits</h2>' +
      '<p class="muted pt-h2-sub">Credits go into your family balance and can be used by any of your children — ' +
        "pick the level that matches their classes." + (mine.length ? " Your children’s levels come first." : "") + "</p>" +
      (trial && trial.eligible ? trialHTML : "") +
      mine.map(group).join("") +
      (others.length
        ? '<div class="pt-otherlevels">' +
            '<button class="btn btn--ghost btn--sm" type="button" id="ptOtherLevels" data-action="other-levels" aria-expanded="' + ui.otherLevels + '"' +
              ' aria-controls="ptOtherLevelsPanel">' +
              (ui.otherLevels ? "Hide " : "Show ") + esc(joinNames(others.map(tierLabel))) + " rates</button>" +
            '<div id="ptOtherLevelsPanel"' + (ui.otherLevels ? "" : " hidden") + ">" + (ui.otherLevels ? others.map(group).join("") : "") + "</div>" +
          "</div>"
        : "") +
      (trial && !trial.eligible ? trialHTML : "") +
      '<div class="pt-h2row" id="ptHistory"><h2 class="pt-h2">Credit history</h2>' + filter + "</div>" +
      history;

    if (scrollToHistory) {
      scrollToHistory = false;
      var h = byId("ptHistory");
      if (h && h.scrollIntoView) { try { h.scrollIntoView({ block: "start" }); } catch (e) {} }
    }

    function ledgerSeg(id, label) {
      return '<button class="pt-seg__btn" type="button" id="ptLedgerKid-' + esc(id) + '" aria-pressed="' + (ui.ledgerKid === id) +
        '" data-action="ledger-kid" data-arg="' + esc(id) + '">' + esc(label) + "</button>";
    }
  }

  function packageCardHTML(p) {
    var isTrial = p.price === 0;
    var featured = !isTrial && (p.tag === "Popular" || p.tag === "Best value");
    var off = isTrial && !p.eligible;
    var badge = isTrial ? (p.claimed ? "Claimed" : p.tag) : p.tag;
    var level = p.tierLabel || tierLabel(p.tier);
    var note = isTrial
      ? (p.claimed ? "Your family has already used its free trial credit."
        : p.eligible ? "One complimentary class for a new family — any of your children can use it."
        : "The free trial is for new families.")
      : creditsText(p.credits) + " · " + level + " rate" + (p.credits > 1 ? " · " + perClass(p) + " per class" : "");
    var btn = off
      ? '<button class="btn btn--ghost pkg__btn" type="button" disabled>' + (p.claimed ? "Already claimed" : "For new families") + "</button>"
      : '<button class="btn ' + (featured || isTrial ? "btn--primary" : "btn--ghost") + ' pkg__btn" type="button" data-action="buy"' +
          ' data-arg="' + esc(p.id) + '"' + (isTrial ? "" : ' aria-label="' + esc("Buy " + p.name.toLowerCase() + " at the " + level + " rate") + '"') + ">" +
          (isTrial ? "Claim free credit" : "Buy " + esc(p.name.toLowerCase())) + "</button>";
    return '<article class="pkg' + (featured ? " is-featured" : "") + (off ? " is-claimed" : "") + (isTrial ? " is-trial" : "") + '">' +
        (badge ? '<span class="pkg__badge">' + esc(badge) + "</span>" : "") +
        '<h3 class="pkg__name">' + esc(p.name) + "</h3>" +
        '<div class="pkg__credits"><span class="n">' + p.credits + '</span><span class="u">credit' + (p.credits === 1 ? "" : "s") + "</span></div>" +
        '<div class="pkg__price">' + (isTrial ? '<span class="free">Free</span>' : esc(HC.formatPrice(p.price))) + "</div>" +
        '<p class="pkg__note">' + esc(note) + "</p>" +
        btn +
      "</article>";
  }

  var LEDGER_KINDS = { booking: "Class booked", refund: "Credit refunded", purchase: "Credits purchased", trial: "Free trial credit" };

  function ledgerRowHTML(l) {
    var date = l.at.slice(0, 10);
    var what, detail = "", extra = "";
    if (l.type === "manual") {
      what = l.reason || "Adjustment";
      detail = "Adjusted by the studio";
      if (l.note) extra = '<span class="pt-ledger__note">' + esc(l.note) + "</span>";
    } else if (l.type === "refund") {
      what = LEDGER_KINDS.refund;
      detail = String(l.reason || "").replace(/^Refund · /, "");
    } else if (l.type === "purchase") {
      what = LEDGER_KINDS.purchase;
      detail = (l.reason || "") + (l.amount ? " · " + HC.formatPrice(l.amount) : "");
    } else if (l.type === "trial") {
      what = LEDGER_KINDS.trial;
      detail = "Welcome to Huacheng Elite";
    } else {
      what = LEDGER_KINDS[l.type] || "Credit change";
      detail = l.reason || "";
    }
    // booking/refund rows say which child — as a chip, so drop the name from the text
    var kid = l.childId ? db.child(l.childId) : null;
    if (kid) detail = detail.replace(new RegExp(" · " + escRe(kid.name) + "(?= · |$)"), "");
    var year = date.slice(0, 4) !== db.todayISO().slice(0, 4) ? " " + date.slice(0, 4) : "";
    return '<tr class="pt-ledger__row is-' + esc(l.type) + '">' +
        '<td class="pt-ledger__date">' + esc(db.formatDate(date) + year) +
          '<span class="pt-sub">' + esc(HC.formatTime(l.at.slice(11, 16) || "00:00")) + "</span></td>" +
        '<td class="pt-ledger__desc">' + (l.childId ? '<span class="pt-ledger__kid">' + kidChip(l.childId) + "</span>" : "") +
          '<span class="pt-ledger__what">' + esc(what) + "</span>" +
          (detail ? '<span class="pt-sub">' + esc(detail) + "</span>" : "") + extra + "</td>" +
        '<td class="num pt-ledger__chg ' + (l.delta < 0 ? "is-neg" : "is-pos") + '">' +
          '<span class="sr-only">' + (l.delta < 0 ? "Used " : "Added ") + "</span>" + esc(signed(l.delta)) + "</td>" +
        '<td class="num pt-ledger__bal"><span class="pt-ledger__balk">Family balance </span>' + l.balanceAfter + "</td>" +
      "</tr>";
  }

  function purchase(packageId) {
    var p = db.packagesFor(fid).filter(function (x) { return x.id === packageId; })[0];
    if (!p) {
      toast("warn", "That package isn’t available any more — please choose again.");
      return;
    }
    if (p.price === 0) {
      var res = db.purchase(fid, p.id, { by: "parent:" + fid });
      if (res.ok) toast("ok", "Free trial credit added to your family balance — enjoy your first class!");
      else toast("warn", res.error);
      return;
    }
    openPayNow(p.id);
  }

  /* ============================================================
     ACCOUNT
     ============================================================ */
  function renderAccount(el) {
    var fam = db.family(fid);
    var kids = db.children(fid);
    var only = kids.length === 1;

    var kidRows = kids.length
      ? '<ul class="pt-kidlist">' + kids.map(function (k) {
          var n = db.upcomingBookings({ childId: k.id }).length;
          return '<li class="pt-kidrow">' +
              avatarHTML(k) +
              '<div class="pt-kidrow__text">' +
                '<p class="pt-kidrow__name">' + esc(k.name) + "</p>" +
                '<p class="pt-kidrow__meta">' + (k.age !== "" && k.age != null ? "Age " + esc(k.age) + " · " : "") +
                  '<span class="pt-level">' + esc(k.level) + " level</span>" +
                  ' <span class="pt-hint">Set by your coach</span></p>' +
                '<p class="pt-kidrow__meta">' + (n ? plural(n, "upcoming class", "upcoming classes") : "No upcoming classes") + "</p>" +
              "</div>" +
              '<div class="pt-kidrow__actions">' +
                '<button class="btn btn--ghost btn--sm" type="button" data-action="edit-child" data-arg="' + esc(k.id) + '"' +
                  ' aria-label="Edit ' + esc(k.name) + '’s details">Edit</button>' +
                '<button class="btn btn--danger btn--sm" type="button" data-action="remove-child" data-arg="' + esc(k.id) + '"' +
                  ' aria-label="Remove ' + esc(k.name) + '"' +
                  (only ? ' disabled title="Your account needs at least one child"' : "") + ">Remove</button>" +
              "</div>" +
            "</li>";
        }).join("") + "</ul>" +
        (only ? '<p class="muted pt-kidlist__hint">Your account needs at least one child — add another before removing ' + esc(childFirst(kids[0])) + ".</p>" : "")
      : '<p class="pt-card__empty pt-card__empty--box">No children on your account yet — add one below to start booking.</p>';

    el.innerHTML =
      '<div class="view__head">' +
        '<h1 class="view__title">My account</h1>' +
        '<p class="view__sub">Your details and your children — changes are saved to the studio’s records straight away.</p>' +
      "</div>" +

      '<form class="panel" id="accountForm" novalidate>' +
        '<h2 class="panel__title">Parent details</h2>' +
        '<div class="field">' +
          '<label for="acParent">Parent’s name</label>' +
          '<input id="acParent" type="text" autocomplete="name" value="' + esc(fam.parentName) + '" aria-describedby="acParentError" />' +
          '<p class="field-error" id="acParentError"></p>' +
        "</div>" +
        '<div class="field-row">' +
          '<div class="field"><label for="acEmail">Email</label>' +
            '<input id="acEmail" type="email" autocomplete="email" value="' + esc(fam.email) + '" aria-describedby="acEmailError" />' +
            '<p class="field-error" id="acEmailError"></p></div>' +
          '<div class="field"><label for="acPhone">Phone</label>' +
            '<input id="acPhone" type="tel" autocomplete="tel" value="' + esc(fam.phone) + '" /></div>' +
        "</div>" +
        '<button class="btn btn--primary" type="submit" style="margin-top:1.4rem;">Save changes</button>' +
      "</form>" +

      '<section class="panel pt-children" aria-labelledby="ptChildrenTitle">' +
        '<h2 class="panel__title" id="ptChildrenTitle">Children</h2>' +
        '<p class="muted pt-panel-intro">One account and one credit balance for the whole family — any of your children can use the credits, and you choose who’s coming each time you book.</p>' +
        kidRows +
        '<form class="pt-addchild" id="addChildForm" novalidate>' +
          '<h3 class="pt-h3">Add a child</h3>' +
          '<div class="pt-addchild__row">' +
            '<div class="field"><label for="acNewName">Child’s name</label>' +
              '<input id="acNewName" type="text" autocomplete="off" placeholder="e.g. Chloe Tan" /></div>' +
            '<div class="field pt-addchild__age"><label for="acNewAge">Age</label>' +
              '<input id="acNewAge" type="text" inputmode="numeric" autocomplete="off" placeholder="e.g. 5" /></div>' +
            '<button class="btn btn--primary pt-addchild__btn" type="submit">Add child</button>' +
          "</div>" +
          '<p class="field-error" id="acNewError" role="alert"></p>' +
          '<p class="muted">Classes start from age ' + MIN_AGE + ". New children start at Junior level — your coach will update this after an assessment.</p>" +
        "</form>" +
      "</section>" +

      '<div class="panel">' +
        '<h2 class="panel__title">Help &amp; info</h2>' +
        '<div class="panel__links">' +
          '<a href="terms.html" target="_blank" rel="noopener">Terms &amp; Conditions ↗</a>' +
          '<a href="index.html">Back to main site ↗</a>' +
        "</div>" +
      "</div>" +

      '<div class="panel danger-zone">' +
        '<h2 class="panel__title">Demo controls</h2>' +
        '<p class="muted" style="margin-bottom:1.1rem;">This portal is a UX concept. It shares its demo data with the coach &amp; admin console on this device — Reset re-seeds both.</p>' +
        '<div class="panel__links">' +
          '<button class="btn btn--danger btn--sm" type="button" data-action="reset">Reset demo</button>' +
          '<button class="btn btn--ghost btn--sm" type="button" data-action="logout">Log out</button>' +
        "</div>" +
      "</div>";
  }

  function saveAccount(form) {
    var name = val("acParent"), email = val("acEmail"), phone = val("acPhone");
    setFieldError("acParent", "acParentError", "");
    setFieldError("acEmail", "acEmailError", "");
    var ok = true;
    if (!name) { setFieldError("acParent", "acParentError", "Please enter your name."); ok = false; }
    if (!email) {
      setFieldError("acEmail", "acEmailError", "Please enter your email.");
      ok = false;
    } else if (!EMAIL_RE.test(email)) {
      setFieldError("acEmail", "acEmailError", "Please enter a valid email address.");
      ok = false;
    } else {
      var other = db.familyByEmail(email);
      if (other && other.id !== fid) {
        setFieldError("acEmail", "acEmailError", "Another account already uses this email.");
        ok = false;
      }
    }
    if (!ok) {
      var bad = form.querySelector(".invalid");
      if (bad) bad.focus();
      return;
    }
    var res = mutate(form.id, function () {
      return db.updateFamily(fid, { parentName: name, email: email, phone: phone }, { by: "parent:" + fid });
    });
    if (res.ok) toast("ok", "Your details have been saved.");
    else toast("warn", res.error);
  }

  function addChild(form) {
    var name = val("acNewName");
    var ageRaw = val("acNewAge");
    var age = parseAge(ageRaw);
    setFieldError("acNewName", "acNewError", "");
    setFieldError("acNewAge", null, "");
    if (!name) {
      setFieldError("acNewName", "acNewError", "Please enter your child’s name.");
      byId("acNewName").focus();
      return;
    }
    if (ageProblem(ageRaw, 5)) {
      setFieldError("acNewAge", "acNewError", ageProblem(ageRaw, 5));
      byId("acNewAge").focus();
      return;
    }
    var res = mutate(form.id, function () {
      return db.addChild(fid, { name: name, age: age === null ? "" : age }, { by: "parent:" + fid });
    });
    if (!res.ok) {
      setFieldError("acNewName", "acNewError", res.error);
      return;
    }
    toast("ok", res.child.name + " has been added to your account.");
    var input = byId("acNewName");
    if (input) input.focus();
  }

  function openEditChild(id) {
    var ch = db.child(id);
    if (!ch || ch.familyId !== fid || ch.active === false) return;
    openModal(
      modalHead("Edit " + childFirst(ch) + "’s details", "") +
      '<form id="editChildForm" novalidate>' +
        '<div class="field"><label for="ecName">Child’s name</label>' +
          '<input id="ecName" type="text" autocomplete="off" value="' + esc(ch.name) + '" /></div>' +
        '<div class="field"><label for="ecAge">Age</label>' +
          '<input id="ecAge" type="text" inputmode="numeric" autocomplete="off" value="' + esc(ch.age) + '" /></div>' +
        '<p class="field-error" id="ecError" role="alert"></p>' +
        '<p class="pt-hint pt-hint--block">Level: <strong>' + esc(ch.level) + "</strong> — set by your coach after an assessment.</p>" +
        '<div class="modal__actions">' +
          '<button class="btn btn--primary btn--block" type="submit">Save changes</button>' +
          '<button class="btn btn--ghost btn--block" type="button" data-close>Cancel</button>' +
        "</div>" +
      "</form>",
      {
        bind: function (card) {
          card.querySelector("#editChildForm").addEventListener("submit", function (e) {
            e.preventDefault();
            var name = val("ecName"), ageRaw = val("ecAge"), age = parseAge(ageRaw);
            setFieldError("ecName", "ecError", "");
            setFieldError("ecAge", null, "");
            if (!name) { setFieldError("ecName", "ecError", "Please enter your child’s name."); byId("ecName").focus(); return; }
            // an age the studio already holds (e.g. 3, set by staff) can stay as it is
            var ageMsg = ageRaw === String(ch.age) ? "" : ageProblem(ageRaw);
            if (ageMsg) { setFieldError("ecAge", "ecError", ageMsg); byId("ecAge").focus(); return; }
            var res = db.updateChild(id, { name: name, age: age === null ? "" : age }, { by: "parent:" + fid });
            if (!res.ok) { setFieldError("ecName", "ecError", res.error); return; }
            closeModal();
            toast("ok", res.child.name + "’s details have been saved.");
          });
        },
        // keep what the parent typed; only bail out if the child disappeared
        refresh: function () {
          var c = db.child(id);
          if (!c || c.active === false) closeModal();
        }
      }
    );
  }

  function openRemoveChild(id) {
    var ch = db.child(id);
    if (!ch || ch.familyId !== fid || ch.active === false) return;
    var first = childFirst(ch);
    var err = "";   // refusal from the store on confirm

    // What stops the removal right now — checked on open, on every data change
    // and again on confirm. The store has the final say (upcoming classes);
    // the last-child rule is the portal's own. Credits stay in the family balance.
    function blocker() {
      if (db.children(fid).length <= 1) {
        return { kind: "last", msg: "Your account needs at least one child — add another before removing " + first + "." };
      }
      if (db.upcomingBookings({ childId: id }).length) {
        return { kind: "studio", msg: ch.name + " still has upcoming classes — please contact the studio to cancel them first." };
      }
      return null;
    }

    function build() {
      var b = blocker() || (err ? { kind: "studio", msg: err } : null);
      return modalHead("Remove " + ch.name + "?",
          esc(first) + " will no longer appear when you book. Past classes and coach feedback stay in your history, " +
          "and your family credits stay as they are.") +
        (b ? alertHTML("warn", esc(b.msg), true) : "") +
        '<div class="modal__actions">' +
          (!b ? '<button class="btn btn--danger btn--block" type="button" id="ptRemoveConfirm">Remove ' + esc(first) + "</button>"
            : b.kind === "studio" ? '<button class="btn btn--primary btn--block" type="button" data-action="cancel-help">Contact the studio</button>'
            : "") +
          '<button class="btn btn--ghost btn--block" type="button" data-close>' + (b ? "Close" : "Keep " + esc(first)) + "</button>" +
        "</div>";
    }
    function bind(card) {
      var btn = card.querySelector("#ptRemoveConfirm");
      if (!btn) return;
      btn.addEventListener("click", function () {
        // [PORT-6] never leave the account without a child
        if (db.children(fid).length <= 1) { setModal(build(), bind); return; }
        var res = db.removeChild(id, { by: "parent:" + fid });
        if (res.ok) {
          closeModal();
          toast("ok", ch.name + " has been removed from your account.");
        } else {
          err = res.error;
          setModal(build(), bind);
        }
      });
    }
    openModal(build(), {
      bind: bind,
      refresh: function () {
        var c = db.child(id);
        if (!c || c.active === false) { closeModal(); return; }
        setModal(build(), bind);
      }
    });
  }

  /* ============================================================
     MODAL
     opts: { bind(card) after each paint, refresh() on data change,
             onDocClick(e) / onEscape() for dropdowns inside the dialog }
     ============================================================ */
  var modal = { open: false, refresh: null, returnFocus: null, onDocClick: null, onEscape: null };

  function modalHead(title, subHtml) {
    return '<button class="modal__close" type="button" data-close aria-label="Close">×</button>' +
      '<h2 class="modal__title" id="modalTitle">' + esc(title) + "</h2>" +
      (subHtml ? '<p class="modal__sub">' + subHtml + "</p>" : "");
  }

  function setModal(html, bind) {
    var card = byId("modalContent");
    card.innerHTML = html;
    if (bind) bind(card);
  }

  function openModal(html, opts) {
    opts = opts || {};
    var root = byId("modal");
    if (!root) return;
    if (!modal.open) modal.returnFocus = document.activeElement;
    modal.open = true;
    modal.refresh = opts.refresh || null;
    modal.onDocClick = opts.onDocClick || null;
    modal.onEscape = opts.onEscape || null;
    setModal(html, opts.bind);
    root.classList.add("is-open");
    document.body.style.overflow = "hidden";
    var card = byId("modalContent");
    var focusable = card.querySelector("input:not([disabled]), .modal__actions button:not([disabled])") ||
      card.querySelector(".modal__close");
    if (focusable) { try { focusable.focus(); } catch (e) {} }
  }

  function closeModal() {
    var root = byId("modal");
    if (!root || !modal.open) return;
    root.classList.remove("is-open");
    document.body.style.overflow = "";
    modal.open = false;
    modal.refresh = null;
    modal.onDocClick = null;
    modal.onEscape = null;
    var f = modal.returnFocus;
    var sel = focusSelector(f);
    modal.returnFocus = null;
    if (pendingRender) renderView(true);
    // the opener may have been re-rendered while the dialog was open — find its twin
    if (f && !document.contains(f) && sel) f = document.querySelector(sel);
    if (f && f !== document.body && document.contains(f) && !f.disabled) {
      try { f.focus({ preventScroll: true }); } catch (e) {}
    }
  }

  function focusSelector(el) {
    if (!el || !el.getAttribute) return null;
    if (el.id) return "#" + el.id;
    var action = el.getAttribute("data-action");
    if (!action) return null;
    var arg = el.getAttribute("data-arg");
    return '[data-action="' + action + '"]' + (arg ? '[data-arg="' + String(arg).replace(/["\\]/g, "\\$&") + '"]' : "");
  }

  // PayNow mock — the credits go into the family balance.
  function openPayNow(packageId) {
    function current() {
      return db.packagesFor(fid).filter(function (x) { return x.id === packageId; })[0] || null;
    }
    function build(p) {
      var amount = HC.formatPrice(p.price);
      return modalHead("Complete payment",
          "<strong>" + esc(p.name) + "</strong> · " + esc(p.tierLabel || tierLabel(p.tier)) + " rate — " +
          dia(p.credits) + " credit" + (p.credits === 1 ? "" : "s") + " added to your family balance on payment.") +
        '<div class="paynow">' +
          '<div class="paynow__brand">Pay<b>Now</b></div>' +
          '<div class="paynow__amount">' + esc(amount) + "</div>" +
          '<div class="paynow__credits">' + dia(p.credits) + " credit" + (p.credits === 1 ? "" : "s") + " · family balance</div>" +
          paynowQR() +
          '<p class="paynow__cap">Scan with your bank app to pay</p>' +
        "</div>" +
        '<div class="modal__actions">' +
          '<button class="btn btn--primary btn--block" type="button" id="payConfirm">I’ve paid · ' + esc(amount) + "</button>" +
          '<button class="btn btn--ghost btn--block" type="button" data-close>Cancel</button>' +
        "</div>" +
        '<p class="muted" style="text-align:center;margin-top:.9rem;">Demo only — no real payment is taken.</p>';
    }
    var p0 = current();
    if (!p0) { toast("warn", "That package isn’t available any more — please choose again."); return; }
    openModal(build(p0), {
      bind: function (card) {
        card.querySelector("#payConfirm").addEventListener("click", function () {
          var res = db.purchase(fid, packageId, { by: "parent:" + fid });
          if (!res.ok) { toast("warn", res.error); return; }
          closeModal();
          toast("ok", "Payment received — " + creditsText(p0.credits) + " added to your family balance.");
        });
      }
    });
  }

  // a faux but convincing PayNow QR drawn inline (deterministic pattern)
  function paynowQR() {
    var n = 21, cell = 8, pad = 11, size = n * cell + pad * 2;
    var rects = "";
    function inFinder(r, c, br, bc) {
      return r >= br && r < br + 7 && c >= bc && c < bc + 7;
    }
    function finderDark(r, c, br, bc) {
      var rr = r - br, cc = c - bc;
      if (rr === 0 || rr === 6 || cc === 0 || cc === 6) return true;  // outer ring
      return rr >= 2 && rr <= 4 && cc >= 2 && cc <= 4;                 // inner block
    }
    function dark(r, c) {
      if (inFinder(r, c, 0, 0)) return finderDark(r, c, 0, 0);
      if (inFinder(r, c, 0, n - 7)) return finderDark(r, c, 0, n - 7);
      if (inFinder(r, c, n - 7, 0)) return finderDark(r, c, n - 7, 0);
      var h = (r * 73856093) ^ (c * 19349663);                         // deterministic field
      return ((h >>> 0) % 100) < 48;
    }
    for (var r = 0; r < n; r++) {
      for (var c = 0; c < n; c++) {
        if (dark(r, c)) {
          rects += '<rect x="' + (pad + c * cell) + '" y="' + (pad + r * cell) + '" width="' + cell + '" height="' + cell + '" rx="1.5"/>';
        }
      }
    }
    return '<svg class="paynow__qr" viewBox="0 0 ' + size + " " + size + '" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="PayNow QR code (mock)">' +
        '<rect width="' + size + '" height="' + size + '" rx="14" fill="#fff"/>' +
        '<g fill="#232825">' + rects + "</g>" +
        // little PayNow logo chip in the centre
        '<rect x="' + (size / 2 - 22) + '" y="' + (size / 2 - 22) + '" width="44" height="44" rx="9" fill="#fff" stroke="#fff" stroke-width="6"/>' +
        '<rect x="' + (size / 2 - 19) + '" y="' + (size / 2 - 19) + '" width="38" height="38" rx="8" fill="#7b1fa2"/>' +
        '<text x="' + (size / 2) + '" y="' + (size / 2 + 4) + '" text-anchor="middle" font-family="Inter,sans-serif" font-size="11" font-weight="700" fill="#fff">PN</text>' +
      "</svg>";
  }

  // No online cancellation — parents contact the studio.
  function openCancelNotice(bookingId) {
    var b = bookingId ? db.booking(bookingId) : null;
    var o = b ? occFor(b) : null;
    var what = b && o ? childFirst(db.child(b.childId)) + "’s " + o.name + " class on " + whenText(o) : "";
    var msg = what
      ? "Hi Huacheng Elite, I’d like to cancel/reschedule " + what + "."
      : "Hi Huacheng Elite, I’d like some help with a booking.";
    var wa = "https://wa.me/" + HC.brand.whatsapp + "?text=" + encodeURIComponent(msg);
    var tel = "tel:" + HC.brand.phoneDisplay.replace(/[^\d+]/g, "");

    openModal(
      modalHead(b ? "Need to cancel?" : "Contact the studio",
        (what ? "<strong>" + esc(what) + "</strong><br>" : "") +
        "Cancellations aren’t done online — our team will help you reschedule or cancel directly, and sort out any credit.") +
      '<div class="cancel-contact">' +
        '<a class="cancel-row" href="' + esc(wa) + '" target="_blank" rel="noopener">' +
          '<span class="cancel-row__ic wa">' + icon("whatsapp") + "</span>" +
          '<span><span class="cancel-row__k">WhatsApp</span><br><span class="cancel-row__v">' + esc(HC.brand.phoneDisplay) + "</span></span>" +
          '<span class="cancel-row__go">Chat →</span>' +
        "</a>" +
        '<a class="cancel-row" href="' + esc(tel) + '">' +
          '<span class="cancel-row__ic ph">' + icon("phone") + "</span>" +
          '<span><span class="cancel-row__k">Call us</span><br><span class="cancel-row__v">' + esc(HC.brand.phoneDisplay) + "</span></span>" +
          '<span class="cancel-row__go">Call →</span>' +
        "</a>" +
      "</div>" +
      '<div class="modal__actions">' +
        '<button class="btn btn--ghost btn--block" type="button" data-close>Close</button>' +
      "</div>"
    );
  }

  function openConfirmReset() {
    openModal(
      modalHead("Reset the demo?",
        "This re-seeds <strong>all</strong> the demo data on this device — including the staff console’s classes, leave, " +
        "attendance, notes and credit records — and logs you out. Nothing real is affected.") +
      '<div class="modal__actions">' +
        '<button class="btn btn--danger btn--block" type="button" id="resetConfirm">Yes, reset everything</button>' +
        '<button class="btn btn--ghost btn--block" type="button" data-close>Keep my session</button>' +
      "</div>",
      {
        bind: function (card) {
          card.querySelector("#resetConfirm").addEventListener("click", function () { App.reset(); });
        }
      }
    );
  }

  /* ============================================================
     TOAST
     ============================================================ */
  function toast(kind, msg) {
    var wrap = byId("toastWrap");
    if (!wrap) return;
    var glyph = kind === "ok" ? "✓" : kind === "warn" ? "!" : "i";
    var t = document.createElement("div");
    t.className = "toast toast--" + kind;
    t.setAttribute("role", kind === "warn" ? "alert" : "status");
    t.innerHTML = '<span class="toast__ic" aria-hidden="true">' + glyph + "</span><span>" + esc(msg) + "</span>";
    wrap.appendChild(t);
    setTimeout(function () {
      t.classList.add("is-out");
      setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 320);
    }, kind === "warn" ? 5200 : 3400);
  }

  /* ============================================================
     ICONS (inline, stroke)
     ============================================================ */
  var ICONS = {
    dashboard: '<path d="M3 12l9-8 9 8M5 10v9h5v-6h4v6h5v-9"/>',
    calendar: '<rect x="3" y="4.5" width="18" height="16" rx="2.5"/><path d="M3 9h18M8 2.5v4M16 2.5v4"/>',
    ticket: '<path d="M4 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-2a2 2 0 0 0 0-4V7z"/><path d="M15 5v14" stroke-dasharray="2 2"/>',
    wallet: '<path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H18a2 2 0 0 1 2 2v0H5.5"/><path d="M3 7.5V18a2 2 0 0 0 2 2h14a1 1 0 0 0 1-1v-3M3 7.5V12"/><circle cx="17" cy="13" r="1.3" fill="currentColor" stroke="none"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 20c0-3.3 3.6-6 8-6s8 2.7 8 6"/>',
    check: '<path d="M4 12l5 5L20 6"/>',
    alert: '<path d="M12 3.5 2.5 20h19L12 3.5z"/><path d="M12 10v4.5M12 17.2v.3"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.8v.3"/>',
    bell: '<path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15L6 16z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>',
    spark: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18"/>',
    "chev-left": '<path d="M15 5l-7 7 7 7"/>',
    "chev-right": '<path d="M9 5l7 7-7 7"/>',
    "chev-down": '<path d="M5 9l7 7 7-7"/>',
    phone: '<path d="M5 3h3l2 5-2 1.5a12 12 0 0 0 5.5 5.5L18 18l5 2v3a2 2 0 0 1-2 2A18 18 0 0 1 3 7a2 2 0 0 1 2-2z" transform="scale(.9) translate(1 0)"/>',
    whatsapp: '<path d="M16 5c6.1 0 11 4.9 11 11s-4.9 11-11 11c-2 0-3.9-.5-5.6-1.5L5 27l1.6-5.2A10.9 10.9 0 0 1 5 16C5 9.9 9.9 5 16 5z" transform="scale(.75)" fill="currentColor" stroke="none"/><path d="M21 17.6c-.3-.2-1.7-.9-2-1s-.5-.1-.7.2-.8.9-.9 1.1-.3.2-.6.1c-.3-.2-1.2-.5-2.3-1.4-.9-.8-1.4-1.7-1.6-2s0-.4.1-.6l.5-.5c.1-.2.2-.3.3-.5s0-.4 0-.6c-.1-.2-.7-1.6-.9-2.2s-.5-.5-.7-.5h-.6c-.2 0-.5.1-.8.4-.3.3-1 1-1 2.4s1 2.8 1.2 3 2 3.1 4.9 4.3c.7.3 1.2.5 1.6.6.7.2 1.3.2 1.8.1.5-.1 1.7-.7 1.9-1.4s.2-1.2.2-1.4z" transform="scale(.75)" fill="currentColor" stroke="none"/>'
  };

  function icon(name) {
    return '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">' + (ICONS[name] || "") + "</svg>";
  }

  /* ============================================================
     BOOT
     ============================================================ */
  function boot() {
    var page = document.body.getAttribute("data-page");
    if (page === "login") initLogin();
    else if (page === "portal") initPortal();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
