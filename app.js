/* ============================================================
   HUACHENG ELITE — Booking Portal mock engine
   ------------------------------------------------------------
   Loaded on BOTH login.html and portal.html, AFTER mock-data.js.
   No backend: session + state persist in localStorage.
   Keys:
     hc_session : "1" when logged in
     hc_state   : JSON { account, credits, bookings[], scheduleBooked{} }
   ============================================================ */
(function () {
  "use strict";

  var HC = window.HC;
  if (!HC) {
    console.warn("[HC] mock-data.js must load before app.js");
    return;
  }

  var SESSION_KEY = "hc_session";
  var STATE_KEY = "hc_state";

  /* ============================================================
     STATE / SESSION
     ============================================================ */
  var App = (HC.app = {});

  App.hasSession = function () {
    try { return localStorage.getItem(SESSION_KEY) === "1"; }
    catch (e) { return false; }
  };

  App.getState = function () {
    try {
      var raw = localStorage.getItem(STATE_KEY);
      if (!raw) return null;
      var s = JSON.parse(raw);
      // defensive defaults
      s.credits = typeof s.credits === "number" ? s.credits : 0;
      s.bookings = Array.isArray(s.bookings) ? s.bookings : [];
      s.scheduleBooked = s.scheduleBooked && typeof s.scheduleBooked === "object" ? s.scheduleBooked : {};
      s.account = s.account || {};
      s.account.child = s.account.child || {};
      return s;
    } catch (e) { return null; }
  };

  App.saveState = function (s) {
    try { localStorage.setItem(STATE_KEY, JSON.stringify(s)); }
    catch (e) { /* ignore quota / private mode */ }
  };

  App.login = function (account, credits) {
    var s = {
      account: {
        parentName: account.parentName || "",
        email: account.email || "",
        phone: account.phone || "",
        child: {
          name: (account.child && account.child.name) || "",
          age: (account.child && account.child.age) || ""
        }
      },
      credits: typeof credits === "number" ? credits : 0,
      bookings: [],
      scheduleBooked: {}
    };
    App.saveState(s);
    try { localStorage.setItem(SESSION_KEY, "1"); } catch (e) {}
    location.href = "portal.html";
  };

  App.logout = function () {
    // clear session AND state so a shared device doesn't leak the previous
    // parent/child details, bookings or credits after logout.
    try {
      localStorage.removeItem(SESSION_KEY);
      localStorage.removeItem(STATE_KEY);
    } catch (e) {}
    location.href = "login.html";
  };

  App.reset = function () {
    try {
      localStorage.removeItem(SESSION_KEY);
      localStorage.removeItem(STATE_KEY);
    } catch (e) {}
    location.href = "login.html";
  };

  /* effective booked count for a schedule entry (base + our local bookings) */
  App.effectiveBooked = function (entry, state) {
    var extra = (state && state.scheduleBooked && state.scheduleBooked[entry.id]) || 0;
    return entry.booked + extra;
  };

  App.spotsLeft = function (entry, state) {
    return Math.max(0, entry.capacity - App.effectiveBooked(entry, state));
  };

  App.isBooked = function (entryId, state) {
    return (state.bookings || []).some(function (b) { return b.entryId === entryId; });
  };

  /* ============================================================
     LOGIN PAGE
     ============================================================ */
  function initLogin() {
    // already logged in? jump straight to the portal
    if (App.hasSession() && App.getState()) {
      location.href = "portal.html";
      return;
    }

    var tabLogin = document.getElementById("tabLogin");
    var tabSignup = document.getElementById("tabSignup");
    var panelLogin = document.getElementById("panelLogin");
    var panelSignup = document.getElementById("panelSignup");

    function selectTab(which) {
      var loginSel = which === "login";
      tabLogin.setAttribute("aria-selected", loginSel ? "true" : "false");
      tabSignup.setAttribute("aria-selected", loginSel ? "false" : "true");
      panelLogin.classList.toggle("is-active", loginSel);
      panelSignup.classList.toggle("is-active", !loginSel);
      var focusEl = (loginSel ? panelLogin : panelSignup).querySelector("input");
      if (focusEl) { try { focusEl.focus(); } catch (e) {} }
    }
    tabLogin.addEventListener("click", function () { selectTab("login"); });
    tabSignup.addEventListener("click", function () { selectTab("signup"); });

    // LOG IN — any value accepted
    document.getElementById("loginForm").addEventListener("submit", function (e) {
      e.preventDefault();
      var email = (document.getElementById("loginEmail").value || "").trim();
      // Reuse demo identity for the dashboard greeting, but key the account to the entered email.
      App.login({
        parentName: HC.demoAccount.parentName,
        email: email || HC.demoAccount.email,
        phone: HC.demoAccount.phone,
        child: { name: HC.demoAccount.child.name, age: HC.demoAccount.child.age }
      }, HC.demoAccount.startingCredits);
    });

    // forgot password — mocked note
    document.getElementById("forgotLink").addEventListener("click", function (e) {
      e.preventDefault();
      var hint = document.getElementById("forgotHint");
      hint.classList.add("is-shown");
    });

    // CREATE ACCOUNT
    var signupForm = document.getElementById("signupForm");
    signupForm.addEventListener("submit", function (e) {
      e.preventDefault();
      var fields = {
        parentName: document.getElementById("suParent"),
        email: document.getElementById("suEmail"),
        phone: document.getElementById("suPhone"),
        childName: document.getElementById("suChild"),
        childAge: document.getElementById("suAge"),
        password: document.getElementById("suPass")
      };
      var agree = document.getElementById("suAgree");
      var ok = true;

      Object.keys(fields).forEach(function (k) {
        var el = fields[k];
        var bad = !(el.value || "").trim();
        el.classList.toggle("invalid", bad);
        if (bad) ok = false;
      });

      var agreeErr = document.getElementById("agreeError");
      if (!agree.checked) {
        ok = false;
        agreeErr.textContent = "Please agree to the Terms & Conditions to continue.";
      } else {
        agreeErr.textContent = "";
      }

      if (!ok) return;

      App.login({
        parentName: fields.parentName.value.trim(),
        email: fields.email.value.trim(),
        phone: fields.phone.value.trim(),
        child: { name: fields.childName.value.trim(), age: fields.childAge.value.trim() }
      }, 1); // new accounts get 1 free trial credit
    });

    // clear invalid state on input
    signupForm.querySelectorAll("input").forEach(function (el) {
      el.addEventListener("input", function () { el.classList.remove("invalid"); });
    });
    document.getElementById("suAgree").addEventListener("change", function () {
      if (this.checked) document.getElementById("agreeError").textContent = "";
    });

    // DEMO ACCOUNT
    document.getElementById("demoBtn").addEventListener("click", function () {
      App.login({
        parentName: HC.demoAccount.parentName,
        email: HC.demoAccount.email,
        phone: HC.demoAccount.phone,
        child: { name: HC.demoAccount.child.name, age: HC.demoAccount.child.age }
      }, HC.demoAccount.startingCredits);
    });
  }

  /* ============================================================
     PORTAL PAGE
     ============================================================ */
  var state;       // live working copy

  function initPortal() {
    // guard: no session -> login
    if (!App.hasSession() || !App.getState()) {
      location.href = "login.html";
      return;
    }
    state = App.getState();

    // wire shell
    paintAppbar();
    wireNav();
    wireGlobalButtons();

    // initial route from hash (so refresh keeps the view), default dashboard
    var initial = (location.hash || "").replace("#", "");
    var valid = ["dashboard", "schedule", "bookings", "credits", "account"];
    showView(valid.indexOf(initial) >= 0 ? initial : "dashboard", true);
  }

  /* ---------- shell ---------- */
  function paintAppbar() {
    var pill = document.getElementById("creditsPill");
    if (pill) pill.innerHTML = creditPillHTML(state.credits);

    var name = document.getElementById("whoName");
    var sub = document.getElementById("whoSub");
    if (name) name.textContent = state.account.parentName || "Parent";
    if (sub) {
      var child = state.account.child || {};
      sub.textContent = child.name ? ("Parent of " + child.name) : (state.account.email || "");
    }
  }

  function creditPillHTML(n) {
    return '<span class="dia" aria-hidden="true">◆</span> ' + n + " credit" + (n === 1 ? "" : "s");
  }

  function bumpCredits() {
    var pill = document.getElementById("creditsPill");
    if (!pill) return;
    pill.innerHTML = creditPillHTML(state.credits);
    pill.classList.remove("bump");
    // force reflow so the animation can replay
    void pill.offsetWidth;
    pill.classList.add("bump");
  }

  function wireNav() {
    document.querySelectorAll("[data-view]").forEach(function (btn) {
      btn.addEventListener("click", function () { showView(btn.getAttribute("data-view")); });
    });
  }

  function wireGlobalButtons() {
    var logout = document.querySelectorAll("[data-action='logout']");
    logout.forEach(function (b) { b.addEventListener("click", App.logout); });

    var reset = document.querySelectorAll("[data-action='reset']");
    reset.forEach(function (b) {
      b.addEventListener("click", function () {
        openConfirmReset();
      });
    });

    // modal close handlers
    var modal = document.getElementById("modal");
    modal.querySelector(".modal__scrim").addEventListener("click", closeModal);
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") closeModal();
    });
  }

  function showView(view, skipHash) {
    document.querySelectorAll(".view").forEach(function (v) {
      v.classList.toggle("is-active", v.id === "view-" + view);
    });
    document.querySelectorAll(".navitem").forEach(function (n) {
      n.classList.toggle("is-active", n.getAttribute("data-view") === view);
    });

    if (!skipHash) {
      try { history.replaceState(null, "", "#" + view); } catch (e) { location.hash = view; }
    }

    // render the freshest content
    if (view === "dashboard") renderDashboard();
    else if (view === "schedule") renderSchedule();
    else if (view === "bookings") renderBookings();
    else if (view === "credits") renderPackages();
    else if (view === "account") renderAccount();

    // move focus / scroll to top of content for keyboard users
    var content = document.querySelector(".content");
    if (content) content.scrollTop = 0;
    window.scrollTo({ top: 0, behavior: "auto" });
  }

  /* ---------- helpers for rendering ---------- */
  function esc(str) {
    return String(str == null ? "" : str)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function dia(n) { return '<span class="dia" aria-hidden="true">◆</span>' + n; }

  function upcomingBookings() {
    // bookings ordered by day then time
    return (state.bookings || []).slice().sort(function (a, b) {
      if (a.day !== b.day) return a.day - b.day;
      return a.time.localeCompare(b.time);
    });
  }

  /* ---------- DASHBOARD ---------- */
  function renderDashboard() {
    var el = document.getElementById("view-dashboard");
    var child = state.account.child || {};
    var ups = upcomingBookings();

    var upcomingHTML;
    if (ups.length) {
      upcomingHTML = '<div class="upcoming">' + ups.slice(0, 3).map(upItemHTML).join("") + "</div>";
      if (ups.length > 3) {
        upcomingHTML += '<p class="muted" style="margin-top:.9rem;">+ ' + (ups.length - 3) +
          ' more in <a href="#bookings" data-view="bookings" style="color:var(--copper);font-weight:600;">My Bookings</a></p>';
      }
    } else {
      upcomingHTML =
        '<div class="empty">' +
          '<span class="empty__ic">' + icon("calendar") + '</span>' +
          '<p class="empty__t">No classes booked yet</p>' +
          '<p class="empty__d">Browse the weekly schedule and book ' + esc(child.name || "your child") +
          "'s first class — it only takes a tap.</p>" +
          '<button class="btn btn--primary" data-view="schedule">Browse the schedule <span class="btn__arrow" aria-hidden="true">→</span></button>' +
        "</div>";
    }

    el.innerHTML =
      '<div class="view__head">' +
        '<h1 class="view__title">Welcome back, ' + esc(state.account.parentName ? state.account.parentName.split(" ")[0] : "there") + ".</h1>" +
        '<p class="view__sub">Here’s ' + esc(child.name || "your child") + "’s training at a glance.</p>" +
      "</div>" +

      '<div class="balance-card">' +
        '<div class="balance-card__info">' +
          '<p class="balance-card__k">Credit balance</p>' +
          '<p class="balance-card__n">' + state.credits + '<span class="unit">credit' + (state.credits === 1 ? "" : "s") + "</span></p>" +
        "</div>" +
        '<div class="balance-card__actions">' +
          '<button class="btn btn--primary" data-view="credits">Buy credits</button>' +
        "</div>" +
      "</div>" +

      '<p class="section-label">Your upcoming classes</p>' +
      upcomingHTML +

      '<p class="section-label">Quick actions</p>' +
      '<div class="tiles">' +
        tileHTML("schedule", "calendar", "Book a class", "See this week’s timetable") +
        tileHTML("bookings", "ticket", "My bookings", "Review what’s booked") +
        tileHTML("credits", "wallet", "Buy credits", "Top up via PayNow") +
        tileHTML("account", "user", "My account", "Parent & child details") +
      "</div>";

    rebind(el);
  }

  function upItemHTML(b) {
    return '<div class="up-item">' +
        '<div class="up-item__date">' +
          '<div class="up-item__day">' + esc(HC.dayShort[b.day]) + "</div>" +
          '<div class="up-item__time">' + esc(HC.formatTime(b.time)) + "</div>" +
        "</div>" +
        '<div class="up-item__body">' +
          '<div class="up-item__name">' + esc(b.programmeName) + "</div>" +
          '<div class="up-item__meta">' + esc(b.coach) + " · " + esc(HC.dayNames[b.day]) + "</div>" +
        "</div>" +
        '<div class="up-item__cost">' + dia(b.cost) + "</div>" +
      "</div>";
  }

  function tileHTML(view, ic, title, desc) {
    return '<button class="tile" data-view="' + view + '">' +
        '<span class="tile__ic">' + icon(ic) + "</span>" +
        '<span class="tile__t">' + title + "</span>" +
        '<span class="tile__d">' + desc + "</span>" +
      "</button>";
  }

  /* ---------- SCHEDULE ---------- */
  function renderSchedule() {
    var el = document.getElementById("view-schedule");

    var cols = HC.currentWeek().map(function (d) {
      var entries = HC.scheduleForDay(d.day);
      var events = entries.length
        ? entries.map(calEventHTML).join("")
        : '<p class="cal__none">No classes</p>';
      return (
        '<div class="cal__col' + (d.isToday ? " is-today" : "") + '">' +
          '<div class="cal__head">' +
            '<span class="cal__dow">' + d.short + "</span>" +
            '<span class="cal__date">' + d.date + " " + d.month + "</span>" +
          "</div>" +
          '<div class="cal__events">' + events + "</div>" +
        "</div>"
      );
    }).join("");

    el.innerHTML =
      '<div class="view__head">' +
        '<h1 class="view__title">Weekly schedule</h1>' +
        '<p class="view__sub">Tap an open class to book — credits are deducted instantly.</p>' +
      "</div>" +
      '<div class="cal cal--portal" aria-label="Weekly class schedule">' + cols + "</div>";

    el.querySelectorAll("[data-book]").forEach(function (btn) {
      btn.addEventListener("click", function () { book(btn.getAttribute("data-book")); });
    });
  }

  function calEventHTML(entry) {
    var prog = HC.getProgramme(entry.programmeId) || { name: entry.programmeId, level: "", credits: 1 };
    var left = App.spotsLeft(entry, state);
    var booked = App.isBooked(entry.id, state);
    var full = left <= 0;
    var stateCls = booked ? " is-booked" : full ? " is-full" : left <= 2 ? " is-low" : "";
    var spots = full ? "Full" : left + " left";

    var action;
    if (booked) {
      action = '<span class="cal__tag">' + icon("check") + " Booked</span>";
    } else if (full) {
      action = '<button class="cal__book" type="button" disabled>Full</button>';
    } else {
      action = '<button class="cal__book" type="button" data-book="' + entry.id + '" aria-label="Book ' +
        esc(prog.name) + " at " + esc(HC.formatTime(entry.time)) + '">Book ' + dia(prog.credits) + "</button>";
    }

    return (
      '<div class="cal__event cal__event--p' + stateCls + '" title="' +
        esc(prog.name + (prog.level ? " · " + prog.level : "") + " · " + entry.coach +
            (prog.duration ? " · " + prog.duration + " min" : "")) + '">' +
        '<span class="cal__time">' + esc(HC.formatTime(entry.time)) + "</span>" +
        '<span class="cal__prog">' + esc(prog.name) + "</span>" +
        '<span class="cal__erow">' +
          '<span class="cal__coach">' + esc(entry.coach) + "</span>" +
          '<span class="cal__spots">' + spots + "</span>" +
        "</span>" +
        action +
      "</div>"
    );
  }

  /* date label for a booking, using this week's real date for that weekday */
  function bookingDateLabel(entry) {
    var wk = HC.currentWeek()[entry.day];
    var datePart = wk ? (wk.short + " " + wk.date + " " + wk.month) : HC.dayNames[entry.day];
    return datePart + " · " + HC.formatTime(entry.time);
  }

  /* ---------- BOOK ---------- */
  function book(entryId) {
    var entry = HC.schedule.filter(function (s) { return s.id === entryId; })[0];
    if (!entry) return;
    var prog = HC.getProgramme(entry.programmeId) || { name: entry.programmeId, credits: 1 };

    if (App.isBooked(entryId, state)) {
      toast("info", "You’ve already booked this class.");
      return;
    }
    if (App.spotsLeft(entry, state) <= 0) {
      toast("warn", "Sorry, that class is full.");
      renderSchedule();
      return;
    }
    if (state.credits < prog.credits) {
      toast("warn", "Not enough credits — let’s top up.");
      setTimeout(function () { showView("credits"); }, 700);
      return;
    }

    // commit
    state.credits -= prog.credits;
    state.scheduleBooked[entryId] = (state.scheduleBooked[entryId] || 0) + 1;
    state.bookings.push({
      entryId: entryId,
      programmeName: prog.name,
      day: entry.day,
      time: entry.time,
      coach: entry.coach,
      dateLabel: bookingDateLabel(entry),
      cost: prog.credits
    });
    App.saveState(state);

    bumpCredits();
    renderSchedule();
    updateBookingsBadge();
    toast("ok", "Booked! " + prog.name + " on " + HC.dayShort[entry.day] + " " + HC.formatTime(entry.time) + ".");
  }

  function updateBookingsBadge() {
    var badge = document.getElementById("bookingsBadge");
    if (!badge) return;
    var n = (state.bookings || []).length;
    if (n) { badge.textContent = n; badge.style.display = ""; }
    else { badge.style.display = "none"; }
  }

  /* ---------- MY BOOKINGS ---------- */
  function renderBookings() {
    var el = document.getElementById("view-bookings");
    var ups = upcomingBookings();

    var body;
    if (ups.length) {
      body = '<div class="bookings">' + ups.map(bookingCardHTML).join("") + "</div>";
    } else {
      body =
        '<div class="empty">' +
          '<span class="empty__ic">' + icon("ticket") + "</span>" +
          '<p class="empty__t">No bookings yet</p>' +
          '<p class="empty__d">When you book a class it will appear here, with the day, time and coach.</p>' +
          '<button class="btn btn--primary" data-view="schedule">Browse the schedule <span class="btn__arrow" aria-hidden="true">→</span></button>' +
        "</div>";
    }

    el.innerHTML =
      '<div class="view__head">' +
        '<h1 class="view__title">My bookings</h1>' +
        '<p class="view__sub">Your booked classes' + (ups.length ? " — " + ups.length + " in total." : ".") + "</p>" +
      "</div>" + body;

    rebind(el);
    el.querySelectorAll("[data-cancel]").forEach(function (b) {
      b.addEventListener("click", openCancelNotice);
    });
    updateBookingsBadge();
  }

  function bookingCardHTML(b) {
    return '<div class="booking-card">' +
        '<div class="booking-card__main">' +
          '<div class="booking-card__date">' +
            '<div class="booking-card__day">' + esc(HC.dayShort[b.day]) + "</div>" +
            '<div class="booking-card__time">' + esc(HC.formatTime(b.time)) + "</div>" +
          "</div>" +
          "<div>" +
            '<div class="booking-card__name">' + esc(b.programmeName) + "</div>" +
            '<div class="booking-card__meta">' + esc(HC.dayNames[b.day]) + " · " + esc(b.coach) + "</div>" +
          "</div>" +
        "</div>" +
        '<div class="booking-card__cost">' + dia(b.cost) + " used</div>" +
        '<button class="btn btn--ghost btn--sm" data-cancel="' + esc(b.entryId) + '">Cancel</button>' +
      "</div>";
  }

  /* ---------- PACKAGES / BUY CREDITS ---------- */
  function renderPackages() {
    var el = document.getElementById("view-credits");
    var cards = HC.packages.map(packageCardHTML).join("");

    el.innerHTML =
      '<div class="view__head">' +
        '<h1 class="view__title">Buy credits</h1>' +
        '<p class="view__sub">One credit books one class. Top up below — checkout is a PayNow mock.</p>' +
      "</div>" +
      '<div class="balance-strip">' +
        '<span class="balance-strip__k">Current balance</span>' +
        '<span class="balance-strip__v">' + dia(state.credits) + " credit" + (state.credits === 1 ? "" : "s") + "</span>" +
      "</div>" +
      '<div class="packages">' + cards + "</div>";

    el.querySelectorAll("[data-buy]").forEach(function (b) {
      b.addEventListener("click", function () { purchase(b.getAttribute("data-buy")); });
    });
  }

  function packageCardHTML(p) {
    var featured = p.tag === "Popular" || p.tag === "Best value";
    return '<article class="pkg' + (featured ? " is-featured" : "") + '">' +
        (p.tag ? '<span class="pkg__badge">' + esc(p.tag) + "</span>" : "") +
        '<h3 class="pkg__name">' + esc(p.name) + "</h3>" +
        '<div class="pkg__credits"><span class="n">' + p.credits + '</span><span class="u">credit' + (p.credits === 1 ? "" : "s") + "</span></div>" +
        '<div class="pkg__price">' + (p.price === 0 ? '<span class="free">Free</span>' : esc(HC.formatPrice(p.price))) + "</div>" +
        '<p class="pkg__note">' + esc(p.note) + "</p>" +
        '<button class="btn ' + (featured ? "btn--primary" : "btn--ghost") + ' pkg__btn" data-buy="' + esc(p.id) + '">' +
          (p.price === 0 ? "Claim free credit" : "Buy") +
        "</button>" +
      "</article>";
  }

  function purchase(packageId) {
    var p = HC.packages.filter(function (x) { return x.id === packageId; })[0];
    if (!p) return;

    // Free trial: no payment step
    if (p.price === 0) {
      state.credits += p.credits;
      App.saveState(state);
      bumpCredits();
      renderPackages();
      toast("ok", "Free trial credit added — enjoy your first class!");
      return;
    }

    openPayNow(p);
  }

  /* ============================================================
     MODAL
     ============================================================ */
  function openModal(html) {
    var modal = document.getElementById("modal");
    document.getElementById("modalContent").innerHTML = html;
    modal.classList.add("is-open");
    document.body.style.overflow = "hidden";
    // wire close button(s)
    modal.querySelectorAll("[data-close]").forEach(function (b) {
      b.addEventListener("click", closeModal);
    });
    // focus first actionable element
    var focusable = modal.querySelector(".modal__close, button, a[href]");
    if (focusable) { try { focusable.focus(); } catch (e) {} }
  }

  function closeModal() {
    var modal = document.getElementById("modal");
    modal.classList.remove("is-open");
    document.body.style.overflow = "";
  }

  function openPayNow(p) {
    var amount = HC.formatPrice(p.price);
    openModal(
      '<button class="modal__close" data-close aria-label="Close">×</button>' +
      '<h2 class="modal__title">Complete payment</h2>' +
      '<p class="modal__sub">' + esc(p.name) + " package — " + dia(p.credits) + " credit" + (p.credits === 1 ? "" : "s") + " on payment.</p>" +
      '<div class="paynow">' +
        '<div class="paynow__brand">Pay<b>Now</b></div>' +
        '<div class="paynow__amount">' + esc(amount) + "</div>" +
        '<div class="paynow__credits">' + dia(p.credits) + " credit" + (p.credits === 1 ? "" : "s") + "</div>" +
        paynowQR() +
        '<p class="paynow__cap">Scan with your bank app to pay</p>' +
      "</div>" +
      '<div class="modal__actions">' +
        '<button class="btn btn--primary btn--block" id="payConfirm">I’ve paid · ' + esc(amount) + "</button>" +
        '<button class="btn btn--ghost btn--block" data-close>Cancel</button>' +
      "</div>" +
      '<p class="muted" style="text-align:center;margin-top:.9rem;">Demo only — no real payment is taken.</p>'
    );

    document.getElementById("payConfirm").addEventListener("click", function () {
      state.credits += p.credits;
      App.saveState(state);
      closeModal();
      bumpCredits();
      renderPackages();
      toast("ok", "Payment received — " + p.credits + " credit" + (p.credits === 1 ? "" : "s") + " added.");
    });
  }

  // a faux but convincing PayNow QR drawn inline (deterministic pattern)
  function paynowQR() {
    var n = 21, cell = 8, pad = 11, size = n * cell + pad * 2;
    var rects = "";
    function dark(r, c) {
      // finder patterns at 3 corners
      function inFinder(r, c, br, bc) {
        return r >= br && r < br + 7 && c >= bc && c < bc + 7;
      }
      function finderDark(r, c, br, bc) {
        var rr = r - br, cc = c - bc;
        if (rr === 0 || rr === 6 || cc === 0 || cc === 6) return true;       // outer ring
        if (rr >= 2 && rr <= 4 && cc >= 2 && cc <= 4) return true;            // inner block
        return false;
      }
      if (inFinder(r, c, 0, 0)) return finderDark(r, c, 0, 0);
      if (inFinder(r, c, 0, n - 7)) return finderDark(r, c, 0, n - 7);
      if (inFinder(r, c, n - 7, 0)) return finderDark(r, c, n - 7, 0);
      // deterministic pseudo-random field
      var h = (r * 73856093) ^ (c * 19349663);
      h = (h >>> 0) % 100;
      return h < 48;
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

  function openCancelNotice() {
    var wa = "https://wa.me/" + HC.brand.whatsapp +
      "?text=" + encodeURIComponent("Hi Huacheng Elite, I'd like to cancel/reschedule a booked class.");
    var tel = "tel:" + HC.brand.phoneDisplay.replace(/[^\d+]/g, "");

    openModal(
      '<button class="modal__close" data-close aria-label="Close">×</button>' +
      '<h2 class="modal__title">Need to cancel?</h2>' +
      '<p class="modal__sub">Cancellations aren’t done online — our team will help you reschedule or cancel directly, and sort out any credit.</p>' +
      '<div class="cancel-contact">' +
        '<a class="cancel-row" href="' + wa + '" target="_blank" rel="noopener">' +
          '<span class="cancel-row__ic wa">' + icon("whatsapp") + "</span>" +
          "<span><span class=\"cancel-row__k\">WhatsApp</span><br><span class=\"cancel-row__v\">" + esc(HC.brand.phoneDisplay) + "</span></span>" +
          '<span class="cancel-row__go">Chat →</span>' +
        "</a>" +
        '<a class="cancel-row" href="' + tel + '">' +
          '<span class="cancel-row__ic ph">' + icon("phone") + "</span>" +
          "<span><span class=\"cancel-row__k\">Call us</span><br><span class=\"cancel-row__v\">" + esc(HC.brand.phoneDisplay) + "</span></span>" +
          '<span class="cancel-row__go">Call →</span>' +
        "</a>" +
      "</div>" +
      '<div class="modal__actions">' +
        '<button class="btn btn--ghost btn--block" data-close>Close</button>' +
      "</div>"
    );
  }

  function openConfirmReset() {
    openModal(
      '<button class="modal__close" data-close aria-label="Close">×</button>' +
      '<h2 class="modal__title">Reset the demo?</h2>' +
      '<p class="modal__sub">This clears your mock account, credits and bookings, and returns you to the login screen. Nothing real is affected.</p>' +
      '<div class="modal__actions">' +
        '<button class="btn btn--danger btn--block" id="resetConfirm">Yes, reset everything</button>' +
        '<button class="btn btn--ghost btn--block" data-close>Keep my session</button>' +
      "</div>"
    );
    document.getElementById("resetConfirm").addEventListener("click", App.reset);
  }

  /* ---------- ACCOUNT ---------- */
  function renderAccount() {
    var el = document.getElementById("view-account");
    var a = state.account;
    var c = a.child || {};

    el.innerHTML =
      '<div class="view__head">' +
        '<h1 class="view__title">My account</h1>' +
        '<p class="view__sub">Update your details — changes are saved to this device.</p>' +
      "</div>" +

      '<form class="panel" id="accountForm">' +
        '<h2 class="panel__title">Parent details</h2>' +
        '<div class="field">' +
          '<label for="acParent">Parent’s name</label>' +
          '<input id="acParent" type="text" autocomplete="name" value="' + esc(a.parentName) + '" />' +
        "</div>" +
        '<div class="field-row">' +
          '<div class="field"><label for="acEmail">Email</label>' +
            '<input id="acEmail" type="email" autocomplete="email" value="' + esc(a.email) + '" /></div>' +
          '<div class="field"><label for="acPhone">Phone</label>' +
            '<input id="acPhone" type="tel" autocomplete="tel" value="' + esc(a.phone) + '" /></div>' +
        "</div>" +

        '<h2 class="panel__title" style="margin-top:1.6rem;">Child details</h2>' +
        '<div class="field-row">' +
          '<div class="field"><label for="acChild">Child’s name</label>' +
            '<input id="acChild" type="text" value="' + esc(c.name) + '" /></div>' +
          '<div class="field"><label for="acAge">Child’s age</label>' +
            '<input id="acAge" type="text" inputmode="numeric" value="' + esc(c.age) + '" /></div>' +
        "</div>" +
        '<button class="btn btn--primary" type="submit" style="margin-top:1.4rem;">Save changes</button>' +
      "</form>" +

      '<div class="panel">' +
        '<h2 class="panel__title">Help & info</h2>' +
        '<div class="panel__links">' +
          '<a href="terms.html" target="_blank" rel="noopener">Terms & Conditions ↗</a>' +
          '<a href="index.html">Back to main site ↗</a>' +
        "</div>" +
      "</div>" +

      '<div class="panel danger-zone">' +
        '<h2 class="panel__title">Demo controls</h2>' +
        '<p class="muted" style="margin-bottom:1.1rem;">This portal is a UX concept. Reset clears all mock data on this device.</p>' +
        '<div class="panel__links">' +
          '<button class="btn btn--danger btn--sm" data-action="reset">Reset demo</button>' +
          '<button class="btn btn--ghost btn--sm" data-action="logout">Log out</button>' +
        "</div>" +
      "</div>";

    // re-wire reset/logout inside this freshly-rendered view
    el.querySelectorAll("[data-action='reset']").forEach(function (b) {
      b.addEventListener("click", openConfirmReset);
    });
    el.querySelectorAll("[data-action='logout']").forEach(function (b) {
      b.addEventListener("click", App.logout);
    });

    document.getElementById("accountForm").addEventListener("submit", function (e) {
      e.preventDefault();
      state.account.parentName = document.getElementById("acParent").value.trim();
      state.account.email = document.getElementById("acEmail").value.trim();
      state.account.phone = document.getElementById("acPhone").value.trim();
      state.account.child.name = document.getElementById("acChild").value.trim();
      state.account.child.age = document.getElementById("acAge").value.trim();
      App.saveState(state);
      paintAppbar();
      toast("ok", "Your details have been saved.");
    });
  }

  /* ---------- rebind data-view buttons created via innerHTML ---------- */
  function rebind(scope) {
    (scope || document).querySelectorAll("[data-view]").forEach(function (btn) {
      // avoid double-binding the persistent sidebar items (they live outside views)
      if (btn.closest(".sidebar")) return;
      btn.addEventListener("click", function (e) {
        e.preventDefault();
        showView(btn.getAttribute("data-view"));
      });
    });
  }

  /* ============================================================
     TOAST
     ============================================================ */
  function toast(kind, msg) {
    var wrap = document.getElementById("toastWrap");
    if (!wrap) return;
    var glyph = kind === "ok" ? "✓" : kind === "warn" ? "!" : "i";
    var t = document.createElement("div");
    t.className = "toast toast--" + kind;
    t.setAttribute("role", "status");
    t.innerHTML = '<span class="toast__ic" aria-hidden="true">' + glyph + "</span><span>" + esc(msg) + "</span>";
    wrap.appendChild(t);
    setTimeout(function () {
      t.classList.add("is-out");
      setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 320);
    }, 3200);
  }

  /* ============================================================
     ICONS (inline, stroke)
     ============================================================ */
  function icon(name) {
    var paths = {
      dashboard: '<path d="M3 12l9-8 9 8M5 10v9h5v-6h4v6h5v-9"/>',
      calendar: '<rect x="3" y="4.5" width="18" height="16" rx="2.5"/><path d="M3 9h18M8 2.5v4M16 2.5v4"/>',
      ticket: '<path d="M4 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-2a2 2 0 0 0 0-4V7z"/><path d="M15 5v14" stroke-dasharray="2 2"/>',
      wallet: '<path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H18a2 2 0 0 1 2 2v0H5.5"/><path d="M3 7.5V18a2 2 0 0 0 2 2h14a1 1 0 0 0 1-1v-3M3 7.5V12"/><circle cx="17" cy="13" r="1.3" fill="currentColor" stroke="none"/>',
      user: '<circle cx="12" cy="8" r="4"/><path d="M4 20c0-3.3 3.6-6 8-6s8 2.7 8 6"/>',
      check: '<path d="M4 12l5 5L20 6"/>',
      phone: '<path d="M5 3h3l2 5-2 1.5a12 12 0 0 0 5.5 5.5L18 18l5 2v3a2 2 0 0 1-2 2A18 18 0 0 1 3 7a2 2 0 0 1 2-2z" transform="scale(.9) translate(1 0)"/>',
      whatsapp: '<path d="M16 5c6.1 0 11 4.9 11 11s-4.9 11-11 11c-2 0-3.9-.5-5.6-1.5L5 27l1.6-5.2A10.9 10.9 0 0 1 5 16C5 9.9 9.9 5 16 5z" transform="scale(.75)" fill="currentColor" stroke="none"/><path d="M21 17.6c-.3-.2-1.7-.9-2-1s-.5-.1-.7.2-.8.9-.9 1.1-.3.2-.6.1c-.3-.2-1.2-.5-2.3-1.4-.9-.8-1.4-1.7-1.6-2s0-.4.1-.6l.5-.5c.1-.2.2-.3.3-.5s0-.4 0-.6c-.1-.2-.7-1.6-.9-2.2s-.5-.5-.7-.5h-.6c-.2 0-.5.1-.8.4-.3.3-1 1-1 2.4s1 2.8 1.2 3 2 3.1 4.9 4.3c.7.3 1.2.5 1.6.6.7.2 1.3.2 1.8.1.5-.1 1.7-.7 1.9-1.4s.2-1.2.2-1.4z" transform="scale(.75)" fill="currentColor" stroke="none"/>'
    };
    var p = paths[name] || "";
    return '<svg viewBox="0 0 24 24" aria-hidden="true">' + p + "</svg>";
  }

  /* ============================================================
     BOOT
     ============================================================ */
  document.addEventListener("DOMContentLoaded", function () {
    var page = document.body.getAttribute("data-page");
    if (page === "login") initLogin();
    else if (page === "portal") {
      initPortal();
      // initial bookings badge
      if (state) updateBookingsBadge();
    }
  });
})();
