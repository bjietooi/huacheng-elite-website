/* ============================================================
   HUACHENG ELITE — Coach & Admin console · core
   ------------------------------------------------------------
   Shell for admin/app.html: staff session, hash router, sidebar,
   drawer, modal, confirm, toast, icons and shared HTML helpers.

   Feature modules (loaded after this file) register views:

     Admin.registerView("schedule", {
       render: function (el, params) { ... }   // required
     });

   and may expose cross-module entry points on `Admin`
   (Admin.openClass, Admin.openStudent, ...). Views must be
   re-renderable at any time from module state: the core
   re-renders the current view (and the open drawer) whenever
   HC.db changes, restoring scroll and the focused input.
   ============================================================ */
(function () {
  "use strict";

  var HC = window.HC;
  var db = HC && HC.db;
  if (!db) { console.warn("[Admin] mock-data.js and hc-store.js must load first"); return; }

  var Admin = (window.Admin = window.Admin || {});
  Admin.db = db;

  /* ---------- navigation (order + labels live here) ---------- */
  // Coaches get a simpler console: their own class calendar is home.
  var NAV = [
    { id: "today",    label: "Today",    icon: "home",     adminOnly: true },
    { id: "schedule", label: "Schedule", icon: "calendar", coachLabel: "My classes" },
    { id: "leave",    label: "Leave",    icon: "leave" },
    { id: "students", label: "Students", icon: "users" },
    { id: "coaches",  label: "Coaches",  icon: "whistle",  adminOnly: true },
    { id: "credits",  label: "Credits",  icon: "wallet",   adminOnly: true },
    { id: "packages", label: "Packages", icon: "tag",      adminOnly: true },
    { id: "reports",  label: "Reports",  icon: "chart",    adminOnly: true }
  ];

  function navLabel(n) { return !Admin.isAdmin() && n.coachLabel ? n.coachLabel : n.label; }
  function homeView() { return Admin.isAdmin() ? "today" : "schedule"; }
  Admin.homeView = function () { return homeView(); };

  var views = {};
  var current = { view: null, params: {} };

  Admin.registerView = function (id, def) { views[id] = def; };

  /* ============================================================
     SESSION
     ============================================================ */
  Admin.staff = null;

  Admin.isAdmin = function () { return !!Admin.staff && Admin.staff.role === "admin"; };

  // can("manage", occ) · can("credits") · can("leave", "Coach A")
  Admin.can = function (action, target) { return db.can(Admin.staff, action, target); };

  Admin.by = function () { return Admin.staff ? Admin.staff.id : "system"; };

  Admin.logout = function () {
    db.session.clear("staff");
    location.href = "index.html";
  };

  Admin.switchTo = function (staffId) {
    db.session.set("staff", staffId);
    location.reload();
  };

  /* ============================================================
     HELPERS
     ============================================================ */
  var esc = (Admin.esc = function (str) {
    return String(str == null ? "" : str)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  });

  Admin.plural = function (n, one, many) {
    return n + " " + (n === 1 ? one : (many || one + "s"));
  };

  Admin.fmt = {
    date: function (iso, style) { return db.formatDate(iso, style); },
    time: function (t) { return HC.formatTime(t); },
    stamp: function (s) { return db.formatStamp(s); },
    money: function (n) {
      return "S$" + Number(n || 0).toLocaleString("en-SG", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
    },
    // "Junior ◆8" — a wallet, or just the type when credits are omitted
    creditChip: function (typeId, credits, extraKind) {
      var t = db.creditType(typeId);
      var kind = t && t.kind === "private" ? "sub" : typeId === "elite" ? "elite"
        : typeId === "competitive" ? "competitive" : "junior";
      return '<span class="chip chip--' + (extraKind || kind) + ' chip--credit" title="' +
        esc(t ? t.name : "Credits") + '">' + esc(t ? (t.short || t.name) : "Credits") +
        (credits == null ? "" : ' <b>' + credits + "</b>") + "</span>";
    },

    // every wallet a family holds: [{ type, credits }] from HC.db.balances()
    wallets: function (list, opts) {
      opts = opts || {};
      if (!list || !list.length) return '<span class="muted">No credits</span>';
      return '<span class="chips">' + list.map(function (w) {
        return Admin.h.creditChip(w.type.id, w.credits);
      }).join("") + "</span>";
    },

    creditTypeOptions: function (selected, opts) {
      opts = opts || {};
      var list = db.creditTypes().map(function (t) { return { value: t.id, label: t.name }; });
      if (opts.all) list.unshift({ value: "all", label: opts.allLabel || "All credit types" });
      return Admin.h.options(list, selected);
    },

    credits: function (n) { return Admin.plural(n, "credit"); },
    signed: function (n) { return (n > 0 ? "+" : n < 0 ? "−" : "") + Math.abs(n); },
    timeRange: function (occ) { return HC.formatTime(occ.time) + " – " + HC.formatTime(occ.endTime); }
  };

  function initials(name) {
    var parts = String(name || "?").trim().split(/\s+/);
    return ((parts[0] || "")[0] + ((parts.length > 1 ? parts[parts.length - 1] : "")[0] || "")).toUpperCase();
  }

  // deterministic tint per name, from the brand-adjacent set below
  var AVATAR_TINTS = ["#b0703e", "#3f7465", "#8f5527", "#5d6f8a", "#a33122", "#6b7a3f", "#7a5a8a", "#46605a"];
  function tintFor(name) {
    var h = 0;
    for (var i = 0; i < String(name).length; i++) h = (h * 31 + String(name).charCodeAt(i)) >>> 0;
    return AVATAR_TINTS[h % AVATAR_TINTS.length];
  }

  /* Small HTML builders shared by every module. */
  Admin.h = {
    // page header — actions is an HTML string (buttons)
    pageHead: function (o) {
      return '<header class="page__head">' +
          "<div>" +
            (o.eyebrow ? '<p class="page__eyebrow">' + esc(o.eyebrow) + "</p>" : "") +
            '<h1 class="page__title">' + esc(o.title) + "</h1>" +
            (o.sub ? '<p class="page__sub">' + o.sub + "</p>" : "") +
          "</div>" +
          (o.actions ? '<div class="page__actions">' + o.actions + "</div>" : "") +
        "</header>";
    },

    avatar: function (name, size) {
      return '<span class="avatar' + (size ? " avatar--" + size : "") + '" style="--tint:' + tintFor(name) +
        '" aria-hidden="true">' + esc(initials(name)) + "</span>";
    },

    // chip(label, kind) — kind: open|blocked|removed|oneoff|leave|sub|ok|warn|info|muted|junior|elite|competitive
    chip: function (label, kind, title) {
      return '<span class="chip' + (kind ? " chip--" + kind : "") + '"' +
        (title ? ' title="' + esc(title) + '"' : "") + ">" + esc(label) + "</span>";
    },

    levelChip: function (level) {
      return Admin.h.chip(level || "—", String(level || "").toLowerCase() || "muted");
    },

    // status chips for an occurrence (blocked / deleted / leave / one-off / cover / full)
    occChips: function (occ) {
      var out = [];
      if (occ.status === "removed") out.push(Admin.h.chip(occ.removedScope === "series" ? "Weekly class deleted" : "Deleted", "removed", occ.reason));
      else if (occ.status === "blocked") out.push(Admin.h.chip(occ.blockKind === "leave" ? "Coach on leave" : "Blocked", occ.blockKind === "leave" ? "leave" : "blocked", occ.reason));
      if (occ.oneOff) out.push(Admin.h.chip("One-off", "oneoff", occ.note));
      if (occ.substituted) out.push(Admin.h.chip("Cover: " + occ.coach, "sub", "Timetabled coach: " + occ.originalCoach));
      if (occ.status === "open" && occ.spotsLeft === 0) out.push(Admin.h.chip("Full", "warn"));
      return out.join("");
    },

    // Where a class is in its day: upcoming | now | passed (cancelled/blocked classes return their status)
    classState: function (occ) {
      if (occ.status === "removed") return { key: "removed", label: "Deleted" };
      if (occ.status === "blocked") return { key: "blocked", label: occ.blockKind === "leave" ? "Coach on leave" : "Blocked" };
      if (occ.ended) return { key: "passed", label: "Passed" };
      if (occ.started) return { key: "now", label: "Now" };
      return { key: "upcoming", label: "Upcoming" };
    },

    stateChip: function (occ) {
      var st = Admin.h.classState(occ);
      var kind = { upcoming: "info", now: "now", passed: "muted", removed: "removed", blocked: occ.blockKind === "leave" ? "leave" : "blocked" }[st.key];
      return '<span class="chip chip--' + kind + ' chip--state"' + (st.key === "now" ? ' aria-label="Happening now"' : "") + ">" +
        (st.key === "now" ? '<i class="pulse" aria-hidden="true"></i>' : "") + esc(st.label) + "</span>";
    },

    // Attendance progress for a class that has started: "" before start / when nobody is booked
    attendance: function (occ) {
      if (!occ.started || occ.status !== "open" && occ.status !== "blocked") return { key: "none", label: "" };
      if (!occ.booked) return { key: "empty", label: "No students" };
      if (!occ.unmarked) return { key: "done", label: "Attendance marked" };
      var marked = occ.booked - occ.unmarked;
      return { key: "todo", label: marked ? marked + " of " + occ.booked + " marked" : "Attendance not marked" };
    },

    attendanceBadge: function (occ) {
      var a = Admin.h.attendance(occ);
      if (a.key === "none" || a.key === "empty") return "";
      return '<span class="att-badge att-badge--' + a.key + '">' +
        Admin.icon(a.key === "done" ? "check" : "clock") + "<span>" + esc(a.label) + "</span></span>";
    },

    attendanceChip: function (status) {
      if (!status) return Admin.h.chip("Not marked", "muted");
      var map = { present: ["Present", "ok"], late: ["Late", "info"], absent: ["Absent", "warn"] };
      var m = map[status] || [status, "muted"];
      return Admin.h.chip(m[0], m[1]);
    },

    rating: function (v) {
      if (!v) return "";
      var scale = db.noteScale.find(function (s) { return s.v === v; });
      var dots = "";
      for (var i = 1; i <= 5; i++) dots += '<i class="' + (i <= v ? "on" : "") + '"></i>';
      return '<span class="rating" title="' + esc(scale ? scale.label : v + "/5") + '">' +
        '<span class="rating__dots" aria-hidden="true">' + dots + "</span>" +
        '<span class="rating__label">' + esc(scale ? scale.label : v + "/5") + "</span></span>";
    },

    credits: function (n) {
      return '<span class="cred' + (n < 0 ? " cred--neg" : n === 0 ? " cred--zero" : "") + '">' +
        '<span class="dia" aria-hidden="true">◆</span>' + n + "</span>";
    },

    empty: function (iconName, title, desc, actionHtml, size) {
      return '<div class="empty' + (size ? " empty--" + size : "") + '">' +
          '<span class="empty__ic">' + Admin.icon(iconName) + "</span>" +
          '<p class="empty__t">' + esc(title) + "</p>" +
          (desc ? '<p class="empty__d">' + desc + "</p>" : "") +
          (actionHtml || "") +
        "</div>";
    },

    notice: function (kind, html) {
      return '<div class="notice notice--' + kind + '">' + Admin.icon(kind === "ok" ? "check" : kind === "warn" ? "alert" : "info") +
        "<div>" + html + "</div></div>";
    },

    // weekNav(weekStartIso) → prev / label / next / this-week buttons (data-week="YYYY-MM-DD")
    weekNav: function (weekStartIso) {
      var ws = db.weekStart(weekStartIso);
      var we = db.addDays(ws, 6);
      var thisWeek = db.weekStart(db.todayISO());
      var label = db.formatDate(ws, "day") + " – " + db.formatDate(we, "day") + " " + we.slice(0, 4);
      var rel = db.daysBetween(thisWeek, ws) / 7;
      var relLabel = rel === 0 ? "This week" : rel === 1 ? "Next week" : rel === -1 ? "Last week" :
        (rel > 0 ? "In " + rel + " weeks" : Math.abs(rel) + " weeks ago");
      return '<div class="weeknav" role="group" aria-label="Choose week">' +
          '<button class="btn btn--icon btn--ghost" data-week="' + db.addDays(ws, -7) + '" aria-label="Previous week">' + Admin.icon("chevron-left") + "</button>" +
          '<div class="weeknav__label"><strong>' + esc(label) + "</strong><span>" + esc(relLabel) + "</span></div>" +
          '<button class="btn btn--icon btn--ghost" data-week="' + db.addDays(ws, 7) + '" aria-label="Next week">' + Admin.icon("chevron-right") + "</button>" +
          (rel !== 0 ? '<button class="btn btn--quiet btn--sm" data-week="' + thisWeek + '">Today</button>' : "") +
        "</div>";
    },

    // <select> options: [{value, label}] or strings
    options: function (list, selected) {
      return list.map(function (o) {
        var v = typeof o === "string" ? o : o.value, l = typeof o === "string" ? o : o.label;
        return '<option value="' + esc(v) + '"' + (String(v) === String(selected) ? " selected" : "") + ">" + esc(l) + "</option>";
      }).join("");
    },

    programmeOptions: function (selected) {
      return Admin.h.options(HC.programmes.map(function (p) { return { value: p.id, label: p.name }; }), selected);
    },

    // Coaches for pickers: active coaches (plus `selected` if it's an inactive one).
    // opts.withAll adds "All coaches"; opts.timetable also lists inactive coaches still on the timetable (filters).
    coachOptions: function (selected, withAll, opts) {
      opts = opts || {};
      var names = opts.timetable ? db.coachNames() : db.coaches().map(function (c) { return c.coach; });
      if (selected && selected !== "all" && names.indexOf(selected) < 0) names.push(selected);
      var list = names.map(function (c) {
        var st = db.staffForCoach(c);
        return { value: c, label: c + (st && st.active === false ? " (inactive)" : "") };
      });
      if (withAll) list.unshift({ value: "all", label: "All coaches" });
      return Admin.h.options(list, selected);
    },

    timeOptions: function (selected) {
      var out = [];
      for (var m = 10 * 60; m <= 21 * 60 + 30; m += 15) {
        var t = db.fromMinutes(m);
        out.push({ value: t, label: HC.formatTime(t) });
      }
      return Admin.h.options(out, selected);
    }
  };

  /* ============================================================
     ICONS (24px stroke)
     ============================================================ */
  var ICONS = {
    home: '<path d="M3 11l9-7 9 7"/><path d="M5 9.5V20h5v-6h4v6h5V9.5"/>',
    calendar: '<rect x="3" y="4.5" width="18" height="16" rx="2.5"/><path d="M3 9.5h18M8 2.5v4M16 2.5v4"/>',
    leave: '<rect x="3" y="4.5" width="18" height="16" rx="2.5"/><path d="M3 9.5h18M8 2.5v4M16 2.5v4M9 13.5l6 5M15 13.5l-6 5"/>',
    users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6"/><path d="M16 4.8a3.5 3.5 0 0 1 0 6.4M18 14.3c2.1.7 3.5 2.8 3.5 5.7"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 20c0-3.3 3.6-6 8-6s8 2.7 8 6"/>',
    wallet: '<path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H18a2 2 0 0 1 2 2H5.5"/><path d="M3 7.5V18a2 2 0 0 0 2 2h14a1 1 0 0 0 1-1v-3M3 7.5V12"/><path d="M21 10.5h-4a2 2 0 0 0 0 4h4z"/>',
    chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    minus: '<path d="M5 12h14"/>',
    x: '<path d="M6 6l12 12M18 6L6 18"/>',
    check: '<path d="M4 12.5l5 5L20 6.5"/>',
    "chevron-left": '<path d="M15 5l-7 7 7 7"/>',
    "chevron-right": '<path d="M9 5l7 7-7 7"/>',
    "chevron-down": '<path d="M5 9l7 7 7-7"/>',
    search: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/>',
    ban: '<circle cx="12" cy="12" r="8.5"/><path d="M6 6l12 12"/>',
    trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
    undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
    pin: '<path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.3"/>',
    note: '<path d="M5 4h10l4 4v12H5z"/><path d="M15 4v4h4M8.5 12h7M8.5 15.5h5"/>',
    star: '<path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/>',
    swap: '<path d="M7 4L3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7"/>',
    alert: '<path d="M12 3.5L2.5 20h19z"/><path d="M12 10v4.5M12 17.3v.2"/>',
    info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5M12 7.8v.2"/>',
    logout: '<path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l-5-5 5-5M5 12h11"/>',
    external: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
    refresh: '<path d="M20 12a8 8 0 1 1-2.3-5.6M20 4v4.5h-4.5"/>',
    download: '<path d="M12 4v11M7 10.5l5 5 5-5M4 20h16"/>',
    filter: '<path d="M4 5h16l-6 7.5V19l-4-2v-4.5z"/>',
    phone: '<path d="M6.5 3.5h3l1.5 4.5-2 1.3a11 11 0 0 0 5.7 5.7l1.3-2 4.5 1.5v3a2 2 0 0 1-2 2A16.5 16.5 0 0 1 4.5 5.5a2 2 0 0 1 2-2z"/>',
    mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3.5 6.5l8.5 6.5 8.5-6.5"/>',
    heart: '<path d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.3a4.3 4.3 0 0 1 7.5 2.5C19.5 15.4 12 20 12 20z"/>',
    menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
    more: '<circle cx="5.5" cy="12" r="1.3" fill="currentColor"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/><circle cx="18.5" cy="12" r="1.3" fill="currentColor"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>',
    list: '<path d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01"/>',
    tag: '<path d="M3 12.5V4.5a1 1 0 0 1 1-1h8l8.5 8.5a1.5 1.5 0 0 1 0 2.1l-6.4 6.4a1.5 1.5 0 0 1-2.1 0z"/><circle cx="7.5" cy="8" r="1.3" fill="currentColor" stroke="none"/>',
    whistle: '<circle cx="8.5" cy="14.5" r="5"/><path d="M11.5 10.5L20 6.5v4.5h-5.8M8.5 14.5h.01M4 5l2 2M8 3v2.5"/>'
  };

  Admin.icon = function (name, cls) {
    return '<svg class="ic' + (cls ? " " + cls : "") + '" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
      (ICONS[name] || "") + "</svg>";
  };

  /* ============================================================
     TOAST
     ============================================================ */
  Admin.toast = function (kind, msg) {
    var wrap = document.getElementById("toastWrap");
    if (!wrap) return;
    var t = document.createElement("div");
    t.className = "toast toast--" + (kind || "info");
    t.setAttribute("role", "status");
    t.innerHTML = '<span class="toast__ic">' + Admin.icon(kind === "ok" ? "check" : kind === "warn" ? "alert" : "info") +
      "</span><span>" + esc(msg) + "</span>";
    wrap.appendChild(t);
    setTimeout(function () {
      t.classList.add("is-out");
      setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 300);
    }, 3600);
  };

  // Show the store's result: toast its error, return ok
  Admin.check = function (res, okMsg) {
    if (!res || !res.ok) {
      Admin.toast("warn", (res && res.error) || "Something went wrong.");
      return false;
    }
    if (okMsg) Admin.toast("ok", okMsg);
    return true;
  };

  /* ============================================================
     DRAWER (right-hand panel) — one at a time
     Admin.openDrawer({ title, sub, render(bodyEl), foot?: html, onClose?, wide? })
     `render` is re-run on every data change while open.
     ============================================================ */
  var drawerState = null;
  var lastFocus = null;

  // Bumped whenever a drawer or modal opens, closes or swaps content. The
  // double-click guard in boot() compares it against the value when a click
  // sequence began: if the layers changed after the first click, whatever now
  // sits under the pointer (another row, the scrim, a new modal's button)
  // must not receive the second click.
  var layerStamp = 0;

  Admin.openDrawer = function (opts) {
    var d = document.getElementById("drawer");
    // Replacing an open panel does not run its onClose: modules set their own
    // state before calling openDrawer, and a shared onClose would wipe it.
    if (!drawerState) lastFocus = document.activeElement;
    layerStamp++;
    drawerState = opts;
    drawerSeq++;
    d.classList.toggle("drawer--wide", !!opts.wide);
    d.classList.add("is-open");
    d.setAttribute("aria-hidden", "false");
    document.body.classList.add("has-drawer");
    paintDrawer(true);
    var close = d.querySelector(".drawer__close");
    if (close) { try { close.focus({ preventScroll: true }); } catch (e) {} }
  };

  function paintDrawer(resetScroll) {
    if (!drawerState) return;
    var d = document.getElementById("drawer");
    var body = d.querySelector(".drawer__body");
    var scroll = resetScroll ? 0 : body.scrollTop;
    var head = typeof drawerState.head === "function" ? drawerState.head() : drawerState;
    d.querySelector(".drawer__title").textContent = head.title || "";
    var sub = d.querySelector(".drawer__sub");
    sub.innerHTML = head.sub || "";
    sub.style.display = head.sub ? "" : "none";
    withFocusKept(body, function () { drawerState.render(body); });
    body.scrollTop = scroll;
  }

  Admin.closeDrawer = function () {
    if (!drawerState) return;
    var d = document.getElementById("drawer");
    var onClose = drawerState.onClose;
    drawerState = null;
    layerStamp++;
    d.classList.remove("is-open");
    d.setAttribute("aria-hidden", "true");
    document.body.classList.remove("has-drawer");
    d.querySelector(".drawer__body").innerHTML = "";
    if (onClose) onClose();
    if (lastFocus && document.contains(lastFocus)) { try { lastFocus.focus({ preventScroll: true }); } catch (e) {} }
  };

  Admin.drawerOpen = function () { return !!drawerState; };

  /* ============================================================
     MODAL
     Admin.openModal({ title, sub, body: html, actions: html, onOpen(cardEl), size: "sm"|"md"|"lg" })
     Buttons with [data-close] close it. Returns the card element.
     On close, focus goes back to the control that opened it (or, if a
     re-render replaced that control, to one with the same id, the open
     drawer's close button, or the page).
     ============================================================ */
  var modalOnClose = null;
  var modalReturn = null;   // { el, id, inDrawer } — where focus goes when the modal closes

  Admin.openModal = function (opts) {
    var m = document.getElementById("modal");
    var card = document.getElementById("modalCard");
    if (!m.classList.contains("is-open")) {
      var a = document.activeElement;
      // Focus on <body> means a modal that just closed chained into this one:
      // keep that modal's return target instead of losing it.
      if (a && a !== document.body) {
        modalReturn = { el: a, id: a.id || "", inDrawer: !!(a.closest && a.closest("#drawer")) };
      }
    }
    layerStamp++;
    card.className = "modal__card" + (opts.size ? " modal__card--" + opts.size : "");
    card.innerHTML =
      '<button class="modal__close" type="button" data-close aria-label="Close">' + Admin.icon("x") + "</button>" +
      '<h2 class="modal__title" id="modalTitle">' + esc(opts.title || "") + "</h2>" +
      (opts.sub ? '<p class="modal__sub">' + opts.sub + "</p>" : "") +
      '<div class="modal__body">' + (opts.body || "") + "</div>" +
      (opts.actions ? '<div class="modal__actions">' + opts.actions + "</div>" : "");
    modalOnClose = opts.onClose || null;
    m.classList.add("is-open");
    m.setAttribute("aria-hidden", "false");
    card.querySelectorAll("[data-close]").forEach(function (b) {
      b.addEventListener("click", function (e) { e.preventDefault(); Admin.closeModal(); });
    });
    if (opts.onOpen) opts.onOpen(card);
    var first = card.querySelector("[autofocus], input:not([type=hidden]):not([disabled]), select, textarea, .modal__actions .btn");
    if (first) { try { first.focus(); } catch (e) {} }
    return card;
  };

  Admin.closeModal = function () {
    var m = document.getElementById("modal");
    if (!m.classList.contains("is-open")) return;
    m.classList.remove("is-open");
    m.setAttribute("aria-hidden", "true");
    document.getElementById("modalCard").innerHTML = "";
    layerStamp++;
    var cb = modalOnClose;
    modalOnClose = null;
    if (cb) cb();
    // After the data-change re-render (a rAF) so a replaced control is found by id.
    requestAnimationFrame(function () { setTimeout(returnModalFocus, 0); });
  };

  Admin.modalOpen = function () {
    return document.getElementById("modal").classList.contains("is-open");
  };

  function returnModalFocus() {
    if (Admin.modalOpen()) return;   // a follow-up modal took over; it returns focus when it closes
    var r = modalReturn;
    modalReturn = null;
    var a = document.activeElement;
    if (a && a !== document.body && document.contains(a)) return;   // a module already placed focus
    var drawerClose = drawerState ? document.querySelector("#drawer .drawer__close") : null;
    var targets = r ? [
      r.el && document.contains(r.el) ? r.el : null,
      r.id ? document.getElementById(r.id) : null,
      r.inDrawer ? drawerClose : null
    ] : [];
    targets.push(drawerClose, document.getElementById("page"));
    for (var i = 0; i < targets.length; i++) {
      var t = targets[i];
      if (!t) continue;
      try { t.focus({ preventScroll: true }); } catch (e) {}
      if (document.activeElement === t) return;
    }
  }

  // Admin.confirm({ title, body (html), confirmLabel, danger }) → Promise<boolean>
  Admin.confirm = function (o) {
    return new Promise(function (resolve) {
      var settled = false;
      function done(v) { if (!settled) { settled = true; resolve(v); } }
      Admin.openModal({
        title: o.title,
        sub: o.sub,
        body: o.body || "",
        size: "sm",
        actions:
          '<button class="btn btn--ghost" type="button" data-close>' + esc(o.cancelLabel || "Cancel") + "</button>" +
          '<button class="btn ' + (o.danger ? "btn--danger-solid" : "btn--primary") + '" type="button" id="confirmOk">' +
            esc(o.confirmLabel || "Confirm") + "</button>",
        onClose: function () { done(false); },
        onOpen: function (card) {
          card.querySelector("#confirmOk").addEventListener("click", function () {
            done(true);
            Admin.closeModal();
          });
        }
      });
    });
  };

  /* ============================================================
     QUICK GUIDE — shown once per staff login, reopenable from the menu
     ============================================================ */
  var GUIDE_COACH = [
    { icon: "calendar", title: "Your classes", text: "<strong>My classes</strong> is your week at a glance. Each class shows <strong>Upcoming</strong>, <strong>Now</strong> or <strong>Passed</strong>, and whether attendance is marked." },
    { icon: "check", title: "Take attendance", text: "Tap a class, then Present, Late or Absent for each student. <strong>Mark all present</strong> saves time." },
    { icon: "note", title: "Give remarks", text: "Add a rating and a few words on each student’s performance. Tick <strong>Share with parent</strong> if their parent should see it." },
    { icon: "ban", title: "Can’t make a class?", text: "Tap <strong>⋯</strong> on the class → <strong>Block class</strong>. Parents can’t book it; anyone booked is refunded and told." },
    { icon: "leave", title: "Whole day off", text: "Leave → <strong>Book leave</strong>. Every class you teach that day is blocked in one go." },
    { icon: "trash", title: "Delete one date", text: "<strong>⋯</strong> → <strong>Delete this date</strong> removes just that day. Other weeks stay as they are." },
    { icon: "users", title: "Add a student", text: "Open a class → <strong>Add student</strong> to put a child in yourself. It uses their family’s shared credits." }
  ];
  var GUIDE_ADMIN = [
    { icon: "home", title: "Start on Today", text: "The studio at a glance — today’s classes, attendance still to mark and anything that needs you." },
    { icon: "check", title: "Attendance", text: "Open any class to mark attendance. Remarks are written by the class’s coach; you can read them all." },
    { icon: "ban", title: "Block, delete or re-staff", text: "Schedule → <strong>⋯</strong> on a class: block it, delete one date (or end a weekly class), or give it to another coach." },
    { icon: "plus", title: "One-off classes", text: "Schedule → <strong>Add one-off class</strong>. It appears on that date only; the weekly timetable doesn’t change." },
    { icon: "whistle", title: "Coaches", text: "Add or edit coaches, decide who can log in, and hand weekly classes to another coach." },
    { icon: "wallet", title: "Credits", text: "A family’s credits are shared by its children, and each kind of credit books its own classes — Junior, Elite, Competitive or Private with one coach." },
    { icon: "tag", title: "Packages", text: "Set what parents can buy: name, which credits it gives, how many and the price. Old packages are taken off sale, never deleted." },
    { icon: "users", title: "Students", text: "Every student with their credits, attendance and status (dormant, low, negative) in one list." },
    { icon: "chart", title: "Reports", text: "Credits not yet used — available and already booked — with an estimated value and a CSV export." }
  ];

  function guideKey() { return "hc_guide_" + (Admin.staff ? Admin.staff.id : ""); }

  Admin.showGuide = function () {
    var steps = Admin.isAdmin() ? GUIDE_ADMIN : GUIDE_COACH;
    Admin.openModal({
      title: "Welcome, " + Admin.staff.name,
      sub: Admin.isAdmin()
        ? "You run the studio from here. Parents see your changes straight away."
        : "Here’s how the coach console works. Parents see your changes straight away.",
      size: "lg",
      body: '<ol class="guide">' + steps.map(function (st, i) {
        return '<li class="guide__step">' +
            '<span class="guide__ic">' + Admin.icon(st.icon) + '<span class="guide__n">' + (i + 1) + "</span></span>" +
            '<span class="guide__text"><strong class="guide__t">' + esc(st.title) + "</strong>" +
            '<span class="guide__d">' + st.text + "</span></span>" +
          "</li>";
      }).join("") + "</ol>" +
        '<p class="guide__foot">This is a demo — try anything. <strong>Reset demo data</strong> in your account menu (the button with your initials) puts everything back.</p>',
      actions: '<button class="btn btn--primary" type="button" data-close>Got it</button>'
    });
    try { localStorage.setItem(guideKey(), "1"); } catch (e) {}
  };

  function guideSeen() {
    try { return localStorage.getItem(guideKey()) === "1"; } catch (e) { return true; }
  }

  /* ============================================================
     ROUTER
     ============================================================ */
  function parseHash() {
    var h = (location.hash || "").replace(/^#/, "");
    var q = h.indexOf("?");
    var view = q >= 0 ? h.slice(0, q) : h;
    var params = {};
    if (q >= 0) {
      h.slice(q + 1).split("&").forEach(function (pair) {
        if (!pair) return;
        var kv = pair.split("=");
        params[decodeURIComponent(kv[0])] = decodeURIComponent(kv.slice(1).join("=") || "");
      });
    }
    return { view: view, params: params };
  }

  function hashFor(view, params) {
    var q = Object.keys(params || {}).filter(function (k) {
      return params[k] != null && params[k] !== "";
    }).map(function (k) {
      return encodeURIComponent(k) + "=" + encodeURIComponent(params[k]);
    }).join("&");
    return "#" + view + (q ? "?" + q : "");
  }

  function allowed(view) {
    var nav = NAV.find(function (n) { return n.id === view; });
    return !!nav && !!views[view] && (!nav.adminOnly || Admin.isAdmin());
  }

  Admin.navLabel = function (view) {
    var nav = NAV.find(function (n) { return n.id === view; });
    return nav ? navLabel(nav) : "";
  }

  // Admin.go(view, params) — navigate (pushes history)
  // Navigating away closes an open panel — unless the caller opens one right after Admin.go.
  var drawerSeq = 0;
  var goSeq = null;

  Admin.go = function (view, params) {
    goSeq = drawerSeq;
    if (!allowed(view)) view = homeView();
    var h = hashFor(view, params || {});
    if (location.hash === h) { goSeq = null; render(true); return; }
    location.hash = h;
  };

  // Admin.setParams(patch) — update the current view's params without a new history entry
  Admin.setParams = function (patch) {
    var p = Object.assign({}, current.params, patch || {});
    try { history.replaceState(null, "", hashFor(current.view, p)); } catch (e) {}
    current.params = p;
    render(false);
  };

  Admin.params = function () { return Object.assign({}, current.params); };
  Admin.currentView = function () { return current.view; };

  function render(resetScroll) {
    var r = parseHash();
    var view = allowed(r.view) ? r.view : homeView();
    if (view !== r.view) {
      try { history.replaceState(null, "", hashFor(view, {})); } catch (e) {}
      r.params = {};
    }
    var changed = view !== current.view;
    current = { view: view, params: r.params };

    document.querySelectorAll(".nav").forEach(function (n) {
      var on = n.getAttribute("data-nav") === view;
      n.classList.toggle("is-active", on);
      if (on) n.setAttribute("aria-current", "page"); else n.removeAttribute("aria-current");
    });

    var main = document.getElementById("page");
    var nav = NAV.find(function (n) { return n.id === view; });
    document.title = (nav ? navLabel(nav) : "Console") + " · Huacheng Elite Staff";
    var y = window.scrollY;
    main.setAttribute("data-view", view);
    withFocusKept(main, function () {
      try {
        views[view].render(main, current.params);
      } catch (e) {
        console.error(e);
        main.innerHTML = Admin.h.empty("alert", "This page hit a snag", esc(e.message));
      }
    });
    if (changed || resetScroll) window.scrollTo(0, 0);
    else window.scrollTo(0, y);
    if (changed) main.classList.remove("is-entering"), void main.offsetWidth, main.classList.add("is-entering");
    paintBadges();
  }

  Admin.refresh = function () {
    if (!current.view) return;
    render(false);
    if (drawerState) paintDrawer(false);
  };

  // Keep the focused field (by id) and its caret across a re-render.
  Admin.keepFocus = function (scope, fn) { withFocusKept(scope, fn); };

  function withFocusKept(scope, fn) {
    var a = document.activeElement;
    var id = a && scope.contains(a) && a.id ? a.id : null;
    var sel = null;
    if (id && typeof a.selectionStart === "number") {
      try { sel = [a.selectionStart, a.selectionEnd]; } catch (e) {}
    }
    fn();
    if (id) {
      var el = document.getElementById(id);
      if (el && scope.contains(el)) {
        try {
          el.focus({ preventScroll: true });
          if (sel && el.setSelectionRange) el.setSelectionRange(sel[0], sel[1]);
        } catch (e) {}
      }
    }
  }

  /* ============================================================
     SHELL
     ============================================================ */
  function paintShell() {
    var s = Admin.staff;
    var navHtml = NAV.filter(function (n) { return !n.adminOnly || Admin.isAdmin(); }).map(function (n) {
      return '<a class="nav" href="#' + n.id + '" data-nav="' + n.id + '">' + Admin.icon(n.icon) +
        '<span class="nav__label">' + esc(navLabel(n)) + '</span><span class="nav__badge" data-badge="' + n.id + '" hidden></span></a>';
    }).join("");
    document.getElementById("sideNav").innerHTML = navHtml;

    var others = db.staff({ canLogin: true }).filter(function (x) { return x.id !== s.id; });
    var roleLine = s.role === "admin" ? "Admin" : "Coach";
    document.getElementById("me").innerHTML =
      // title: the text is hidden in the icon-only sidebar (≤1100px)
      '<button class="me__btn" type="button" id="meBtn" aria-haspopup="true" aria-expanded="false" title="' +
          esc(s.name + " · " + roleLine + (s.title ? " · " + s.title : "")) + '">' +
        Admin.h.avatar(s.name) +
        '<span class="me__text"><span class="me__name">' + esc(s.name) + '</span>' +
          '<span class="me__role">' + esc(roleLine) + "</span></span>" +
        Admin.icon("chevron-down", "me__chev") +
      "</button>" +
      '<div class="me__menu" id="meMenu" role="menu" hidden>' +
        (others.length ? '<p class="me__menu-label">Switch demo user</p>' : "") +
        others.map(function (o) {
          return '<button class="me__item" type="button" role="menuitem" data-switch="' + esc(o.id) + '">' +
            Admin.h.avatar(o.name, "sm") + "<span>" + esc(o.name) +
            '<small>' + (o.role === "admin" ? "Admin" : "Coach") + "</small></span></button>";
        }).join("") +
        (others.length ? "<hr />" : "") +
        '<button class="me__item" type="button" role="menuitem" id="guideBtn">' + Admin.icon("info") + "<span>Quick guide</span></button>" +
        '<button class="me__item" type="button" role="menuitem" id="resetDemo">' + Admin.icon("refresh") + "<span>Reset demo data</span></button>" +
        '<button class="me__item" type="button" role="menuitem" id="logoutBtn">' + Admin.icon("logout") + "<span>Log out</span></button>" +
      "</div>";

    var btn = document.getElementById("meBtn");
    var menu = document.getElementById("meMenu");
    btn.addEventListener("click", function (e) { e.stopPropagation(); setMenu(menu.hidden); });
    menu.querySelectorAll("[data-switch]").forEach(function (b) {
      b.addEventListener("click", function () { Admin.switchTo(b.getAttribute("data-switch")); });
    });
    document.getElementById("logoutBtn").addEventListener("click", Admin.logout);
    document.getElementById("guideBtn").addEventListener("click", function () {
      setMenu(false);
      btn.focus();
      Admin.showGuide();
    });
    document.getElementById("resetDemo").addEventListener("click", function () {
      setMenu(false);
      btn.focus();
      Admin.confirm({
        title: "Reset demo data?",
        body: "<p>This restores the sample studio — coaches, families, bookings, credits, leave and notes — on this device.</p>",
        confirmLabel: "Reset everything",
        danger: true
      }).then(function (yes) {
        if (!yes) return;
        db.reset();
        Admin.closeDrawer();
        Admin.toast("ok", "Demo data restored.");
      });
    });
    if (!paintShell.bound) {
      paintShell.bound = true; // the shell can be repainted; bind document listeners once
      document.addEventListener("click", function (e) {
        var m = document.getElementById("meMenu");
        if (m && !m.hidden && !m.contains(e.target)) setMenu(false);
      });
      document.addEventListener("keydown", function (e) {
        var m = document.getElementById("meMenu");
        if (e.key === "Escape" && m && !m.hidden) { setMenu(false); document.getElementById("meBtn").focus(); }
      });
    }

    var roleTag = document.getElementById("roleTag");
    if (roleTag) roleTag.textContent = s.role === "admin" ? "Admin console" : "Coach console";
  }

  function setMenu(open) {
    var menu = document.getElementById("meMenu");
    var btn = document.getElementById("meBtn");
    if (!menu || !btn) return;
    menu.hidden = !open;
    btn.setAttribute("aria-expanded", open ? "true" : "false");
  }

  // sidebar counter: students still to mark (yesterday + today; own classes for coaches)
  function paintBadges() {
    var today = db.todayISO();
    var mine = Admin.isAdmin() ? {} : { coach: Admin.staff.coach };
    var unmarked = 0;
    [db.addDays(today, -1), today].forEach(function (d) {
      db.occurrencesForDate(d, mine).forEach(function (o) { unmarked += o.unmarked; });
    });
    setBadge(homeView(), unmarked || "", unmarked ? Admin.plural(unmarked, "student") + " still to mark" : "");
  }

  function setBadge(id, val, title) {
    document.querySelectorAll('[data-badge="' + id + '"]').forEach(function (b) {
      b.hidden = !val;
      b.textContent = val;
      if (title) b.title = title; else b.removeAttribute("title");
    });
  }

  /* ============================================================
     BOOT
     ============================================================ */
  function boot() {
    // a deactivated coach, or one whose login was switched off, is signed out
    var staff = db.currentStaff();
    if (!staff) {
      db.session.clear("staff");
      location.replace("index.html");
      return;
    }
    Admin.staff = staff;
    document.body.classList.add(staff.role === "admin" ? "is-admin" : "is-coach");
    paintShell();

    var drawer = document.getElementById("drawer");
    drawer.querySelector(".drawer__close").addEventListener("click", Admin.closeDrawer);
    document.getElementById("drawerScrim").addEventListener("click", Admin.closeDrawer);
    document.querySelector("#modal .modal__scrim").addEventListener("click", Admin.closeModal);

    // Double-click guard: when the first click opens, closes or swaps a modal or
    // drawer, the second click (detail > 1) would land on whatever is now under
    // the pointer — another family's row, the drawer scrim, a button in the new
    // modal. Swallow it so a double-click does the action once and nothing else.
    var clickStamp = -1;
    document.addEventListener("click", function (e) {
      if (e.detail > 1 && clickStamp !== layerStamp) {
        e.preventDefault();
        e.stopImmediatePropagation();
        return;
      }
      clickStamp = layerStamp;
    }, true);
    document.addEventListener("keydown", function (e) {
      if (e.key !== "Escape") return;
      if (Admin.modalOpen()) Admin.closeModal();
      else if (drawerState) Admin.closeDrawer();
    });

    // delegated: any [data-go="view"] (+ data-params='{"a":1}') navigates
    document.addEventListener("click", function (e) {
      var go = e.target.closest("[data-go]");
      if (go) {
        e.preventDefault();
        var p = {};
        try { p = JSON.parse(go.getAttribute("data-params") || "{}"); } catch (err) {}
        Admin.closeDrawer();
        Admin.go(go.getAttribute("data-go"), p);
        return;
      }
      var cls = e.target.closest("[data-open-class]");
      if (cls && Admin.openClass) { e.preventDefault(); Admin.openClass(cls.getAttribute("data-open-class")); return; }
      var stu = e.target.closest("[data-open-student]");
      if (stu && Admin.openStudent) { e.preventDefault(); Admin.openStudent(stu.getAttribute("data-open-student")); return; }
      var fam = e.target.closest("[data-open-family]");
      // data-child keeps the child the link was clicked from in view
      if (fam && Admin.openFamily) {
        e.preventDefault();
        Admin.openFamily(fam.getAttribute("data-open-family"), fam.getAttribute("data-child") || undefined);
      }
    });

    window.addEventListener("hashchange", function () {
      var seq = goSeq;
      goSeq = null;
      if (drawerState && (seq === null || seq === drawerSeq)) Admin.closeDrawer();
      render(true);
    });

    var pending = false;
    db.onChange(function (detail) {
      if (pending) return;
      pending = true;
      requestAnimationFrame(function () {
        pending = false;
        // the staff record may have been renamed, deactivated or reset elsewhere
        var me = db.currentStaff();
        if (!me || me.id !== Admin.staff.id) { Admin.logout(); return; }
        var renamed = me.name !== Admin.staff.name || me.coach !== Admin.staff.coach;
        Admin.staff = me;
        if (renamed) paintShell();
        if (detail && detail.type === "reset" && drawerState) Admin.closeDrawer();
        Admin.refresh();
      });
    });

    // re-evaluate "started / ended" as the clock moves
    setInterval(function () {
      if (!Admin.modalOpen() && !isTyping()) Admin.refresh();
    }, 60000);

    render(true);
    if (!guideSeen()) setTimeout(function () { if (!Admin.modalOpen()) Admin.showGuide(); }, 450);
  }

  function isTyping() {
    var a = document.activeElement;
    return !!a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName);
  }

  document.addEventListener("DOMContentLoaded", boot);
})();
