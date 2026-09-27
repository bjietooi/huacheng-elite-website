/* ============================================================
   HUACHENG ELITE — Coach & Admin console · reports (admin only)
   ------------------------------------------------------------
   A dashboard of "credits not yet utilised" — what the studio still
   owes in lessons — built on HC.db.creditReport(), one row per
   FAMILY (credits are one shared pool any of the children can use):
     available  = in the family's pool, not booked
     reserved   = already booked for a class that hasn't started
     unutilised = available + reserved (negative balances count as 0;
                  credits booked on a negative balance aren't counted)
   The per-student list lives in Students; tiles and links here go
   there with a credit filter (data-go="students").

   Charts are hand-drawn HTML (no library). Each is a role="img"
   with a summary label, a Chart/Table toggle as its text twin,
   and a hover tooltip that only repeats what the table shows.
   Chart colours are validated (see reports.css).
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

  var THRESHOLDS = [14, 21, 30, 60];
  var TOP_N = 12;

  // date-range presets — each returns { from, to } ending today
  var PRESETS = [
    { id: "month", label: "This month", from: function (t) { return t.slice(0, 8) + "01"; } },
    { id: "30",    label: "Last 30 days", from: function (t) { return db.addDays(t, -29); } },
    { id: "90",    label: "Last 3 months", from: function (t) { return db.addDays(t, -89); } },
    { id: "year",  label: "This year", from: function (t) { return t.slice(0, 4) + "-01-01"; } }
  ];

  /* ---------- view state (survives re-renders) ---------- */
  // the date range lives in the URL (?from=&to=) so a refresh keeps it
  var ui = {
    dormant: 21,
    view: { top: "chart", idle: "chart", type: "chart" }
  };

  // tooltip payloads for the current render, keyed by data-tip
  var tips = {};

  /* ============================================================
     HELPERS
     ============================================================ */
  function money2(n) {
    return "S$" + Number(n || 0).toLocaleString("en-SG", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function defaultRate() {
    var j = db.tierPacks && db.tierPacks.junior;
    return j && j[10] ? j[10] / 10 : 42.5;
  }

  /* ---------- date range ---------- */
  var ISO = /^\d{4}-\d{2}-\d{2}$/;

  // params → a valid { from, to, preset } (to never past today, from never past to)
  function range(params) {
    var today = db.todayISO();
    var to = ISO.test(params.to || "") && params.to <= today ? params.to : today;
    var from = ISO.test(params.from || "") && params.from <= to ? params.from : null;
    if (!from) from = PRESETS[0].from(to);
    var preset = null;
    if (to === today) {
      PRESETS.forEach(function (p) { if (!preset && p.from(today) === from) preset = p.id; });
    }
    return { from: from, to: to, preset: preset };
  }

  // "27 Sep 2026"
  function dayYear(iso) { return fmt.date(iso, "day") + " " + iso.slice(0, 4); }

  // "1–27 Sep 2026" · "29 Aug – 27 Sep 2026" · "27 Sep 2026"
  function rangeLabel(from, to) {
    if (from === to) return dayYear(to);
    var a = fmt.date(from, "day"), b = fmt.date(to, "day");           // "1 Sep"
    var year = to.slice(0, 4);
    if (from.slice(0, 4) !== year) return dayYear(from) + " – " + dayYear(to);
    if (from.slice(5, 7) === to.slice(5, 7)) return a.split(" ")[0] + "–" + b + " " + year;
    return a + " – " + b + " " + year;
  }

  function firstName(name) { return String(name || "").trim().split(/\s+/)[0] || ""; }

  // "Ethan & Chloe" · "Ethan, Chloe & Max"
  function kidNames(kids) {
    var n = (kids || []).map(function (c) { return firstName(c.name); });
    if (!n.length) return "";
    return n.length === 1 ? n[0] : n.slice(0, -1).join(", ") + " & " + n[n.length - 1];
  }

  function kidsLine(kids) {
    var n = kidNames(kids);
    return n ? (kids.length === 1 ? "Child: " : "Shared by ") + n : "No children added";
  }

  function statuses(r) {
    var out = [];
    if (r.available < 0) out.push({ label: "Negative balance", kind: "blocked", title: "Owes " + Admin.plural(-r.available, "credit") });
    if (r.dormant) out.push({ label: "Dormant", kind: "warn", title: "Holds credits, nothing booked, no class in over " + ui.dormant + " days" });
    if (r.trialOnly) out.push({ label: "Trial only", kind: "info", title: "Only the free trial credit — no paid purchases yet" });
    return out;
  }

  // largest holders first, then by name
  function byUnutilised(a, b) {
    return b.unutilised - a.unutilised || a.family.parentName.localeCompare(b.family.parentName);
  }

  // link to the Students list with a credit filter (the list lives there, not here)
  function studentsLink(label, credit, cls, extra) {
    return '<button class="btn btn--quiet btn--xs ' + (cls || "rep-kpi-link") + '" type="button" data-go="students"' +
      (credit ? " data-params='" + esc(JSON.stringify(credit === "dormant" && ui.dormant !== 21
        ? { credit: credit, days: String(ui.dormant) } : { credit: credit })) + "'" : "") +
      (extra || "") + ">" + label + "</button>";
  }

  // opens the family, keeping the first child in view (core handles data-open-family)
  function openAttrs(r) {
    return ' data-open-family="' + esc(r.family.id) + '"' + (r.children[0] ? ' data-child="' + esc(r.children[0].id) + '"' : "");
  }

  function familyButton(r) {
    var inner = h.avatar(r.family.parentName, "sm") +
      '<span class="person__text"><span class="person__name">' + esc(r.family.parentName) + "</span>" +
      '<span class="person__sub">' + esc(kidsLine(r.children)) + "</span></span>";
    return Admin.openFamily
      ? '<button class="person" type="button"' + openAttrs(r) + ">" + inner + "</button>"
      : '<div class="person">' + inner + "</div>";
  }

  function viewToggle(chart, label) {
    var cur = ui.view[chart];
    return '<div class="seg rep-toggle" role="group" aria-label="' + esc(label) + '">' +
      ["chart", "table"].map(function (v) {
        return '<button type="button" id="repView-' + chart + "-" + v + '" data-rep-view="' + chart + ":" + v +
          '" aria-pressed="' + (cur === v) + '">' + (v === "chart" ? "Chart" : "Table") + "</button>";
      }).join("") +
    "</div>";
  }

  /* ============================================================
     HEAD + KPIs
     ============================================================ */
  function rangeHtml(rep, rng) {
    var today = db.todayISO();
    var presets = PRESETS.map(function (p) {
      return '<button type="button" id="repRange-' + p.id + '" data-rep-range="' + p.id + '" aria-pressed="' +
        (rng.preset === p.id) + '">' + esc(p.label) + "</button>";
    }).join("");
    return '<section class="rep-range" aria-labelledby="repRangeTitle">' +
        '<div class="rep-range__top">' +
          '<h2 class="rep-range__t" id="repRangeTitle">' + Admin.icon("calendar") + "Period</h2>" +
          '<div class="seg rep-range__seg" role="group" aria-label="Date range presets">' + presets + "</div>" +
          '<div class="rep-range__dates">' +
            '<label class="rep-range__f" for="repFrom"><span>From</span>' +
              '<input class="input" type="date" id="repFrom" value="' + esc(rng.from) + '" max="' + esc(rng.to) + '" />' +
            "</label>" +
            '<label class="rep-range__f" for="repTo"><span>To</span>' +
              '<input class="input" type="date" id="repTo" value="' + esc(rng.to) + '" min="' + esc(rng.from) + '" max="' + esc(today) + '" />' +
            "</label>" +
            (rng.preset === "month" && rng.to === today ? "" :
              '<button class="btn btn--quiet btn--sm" type="button" id="repRangeReset">Reset</button>') +
          "</div>" +
        "</div>" +
        '<p class="rep-range__d" id="repRangeLabel">Showing <strong>' + esc(rangeLabel(rng.from, rng.to)) + "</strong>" +
          " · balances as at " + esc(dayYear(rng.to)) +
          (rng.to === today ? "" : " (not today)") + "</p>" +
      "</section>";
  }

  function headHtml(rep) {
    var thresh = '<label class="rep-thresh" for="repDormant" title="A family is dormant when it holds available credits, has nothing booked and none of its children has attended a class for longer than this.">' +
        '<span class="rep-thresh__k">Dormant after</span>' +
        '<select class="input" id="repDormant">' +
          h.options(THRESHOLDS.map(function (d) { return { value: d, label: d + " days" }; }), ui.dormant) +
        "</select>" +
      "</label>";
    return h.pageHead({
      eyebrow: "As at " + fmt.date(rep.to, "long"),
      title: "Credits report",
      sub: "What families are still owed in lessons, and what moved in the period you pick.",
      actions: thresh +
        '<button class="btn btn--ghost" type="button" id="repPrint">Print</button>' +
        '<button class="btn btn--primary" type="button" id="repExport">' + Admin.icon("download") + "Export CSV</button>"
    });
  }

  function stat(k, v, unit, d, cls) {
    return '<div class="stat' + (cls ? " " + cls : "") + '">' +
      '<p class="stat__k">' + esc(k) + "</p>" +
      '<p class="stat__v">' + v + (unit ? " <small>" + esc(unit) + "</small>" : "") + "</p>" +
      '<p class="stat__d">' + d + "</p></div>";
  }

  function kpisHtml(rep) {
    var t = rep.totals;
    var pct = t.families ? Math.round((t.familiesWithCredits / t.families) * 100) : 0;
    var dormantD = t.dormantFamilies
      ? "<span>" + esc(Admin.plural(t.dormantCredits, "credit")) + " idle · no class in " + ui.dormant + "+ days</span>" +
        studentsLink("Show", "dormant", "rep-kpi-link", ' id="repDormantLink"')
      : "No one idle for " + ui.dormant + "+ days";
    var out = '<section class="stats rep-kpis" aria-label="Summary as at ' + esc(fmt.date(rep.to, "long")) + '">' +
        stat("Total unutilised", t.unutilised, t.unutilised === 1 ? "credit" : "credits",
          "≈ " + esc(fmt.money(t.estValue)) + " est. value · as at " + esc(fmt.date(rep.to, "day")), "stat--ink") +
        stat("Available", t.available, t.available === 1 ? "credit" : "credits", "In family pools, not booked") +
        stat("Reserved", t.reserved, t.reserved === 1 ? "credit" : "credits", "Booked for classes not yet held") +
        stat("Families holding credits", t.familiesWithCredits, "of " + t.families,
          "<span>" + pct + "% of families</span>" + studentsLink("Show", "holding", "rep-kpi-link", ' id="repHoldingLink"')) +
        stat("Dormant", t.dormantFamilies, t.dormantFamilies === 1 ? "family" : "families", dormantD,
          t.dormantFamilies > 0 ? "stat--alert" : "") +
      "</section>" +
      '<p class="rep-defs">' +
        "Credits are one shared pool per family — any of the children can use them — so every figure here is per family. " +
        "<strong>Available</strong> credits sit in a family’s pool, unbooked. " +
        "<strong>Reserved</strong> credits are booked for classes that haven’t happened yet. " +
        "<strong>Unutilised</strong> = available + reserved. " +
        "Value = unutilised credits × that family’s average paid price per credit (" +
        esc(money2(defaultRate())) + ", the Junior 10-pack rate, where nothing has been paid yet). " +
        "Every credit has a <strong>type</strong> — Junior, Elite, Competitive or a coach’s private sessions — and only books that kind of class. " +
        "Balances are as at <strong>" + esc(fmt.date(rep.to, "long")) + "</strong>; what was bought, used and earned is inside the period above." +
      "</p>";
    if (t.negativeFamilies) {
      out += h.notice("warn",
        "<p><strong>" + esc(Admin.plural(t.negativeFamilies, "family", "families")) + "</strong> " +
        (t.negativeFamilies === 1 ? "has" : "have") + " a negative balance (owes credits). Negative balances count as zero in these totals" +
        (t.unpaid ? ", and the " + esc(Admin.plural(t.unpaid, "credit")) + " booked on them " + (t.unpaid === 1 ? "isn’t" : "aren’t") +
          " counted until the family tops up" : "") + ". " +
        studentsLink("Show in Students", "negative", "rep-neg-link", ' id="repNegativeLink"') + "</p>");
    }
    return out;
  }

  /* ============================================================
     CHART A — top families, stacked available + reserved
     ============================================================ */
  function topChartHtml(rep) {
    var holding = rep.rows.filter(function (r) { return r.unutilised > 0; }).sort(byUnutilised);
    var top = holding.slice(0, TOP_N);
    var rest = holding.slice(TOP_N).reduce(function (s, r) { return s + r.unutilised; }, 0);
    var restNote = holding.length > top.length
      ? '<p class="rep-note">The other ' + esc(Admin.plural(holding.length - top.length, "family", "families")) +
        " hold " + esc(Admin.plural(rest, "credit")) + " between them. " +
        studentsLink("See them in Students", "holding", "rep-inline-link") + "</p>"
      : "";
    var body;

    if (!top.length) {
      body = h.empty("chart", "No unutilised credits", "Every credit families were given has been used.");
    } else if (ui.view.top === "table") {
      body = '<div class="tbl-wrap"><table class="tbl rep-mini">' +
        '<caption class="sr-only">Top ' + top.length + " families by unutilised credits</caption>" +
        '<thead><tr><th scope="col">Family</th><th scope="col" class="num">Available</th>' +
        '<th scope="col" class="num">Reserved</th><th scope="col" class="num">Unutilised</th></tr></thead><tbody>' +
        top.map(function (r) {
          return "<tr><td>" + familyButton(r) + "</td>" +
            '<td class="num">' + Math.max(0, r.available) + '</td><td class="num">' + r.reserved + "</td>" +
            '<td class="num"><strong>' + r.unutilised + "</strong></td></tr>";
        }).join("") +
        "</tbody></table></div>";
    } else {
      var max = top[0].unutilised;
      var summary = "Stacked bar chart of the top " + top.length + " families by unutilised credits, split into available and reserved. " +
        top.slice(0, 3).map(function (r) {
          return r.family.parentName + " " + r.unutilised + " (" + Math.max(0, r.available) + " available, " + r.reserved + " reserved)";
        }).join("; ") + (top.length > 3 ? "; and " + (top.length - 3) + " more. Switch to Table for every figure." : ".");
      var link = !!Admin.openFamily;
      body = '<div class="legend rep-legend" aria-hidden="true">' +
          '<span><i class="rep-key rep-key--avail"></i>Available</span>' +
          '<span><i class="rep-key rep-key--res"></i>Reserved (booked)</span>' +
        "</div>" +
        '<div class="rep-hbars" role="img" aria-label="' + esc(summary) + '">' +
        top.map(function (r, i) {
          var avail = Math.max(0, r.available);
          var key = "top" + i;
          tips[key] = {
            title: r.family.parentName,
            sub: kidsLine(r.children),
            rows: [
              { value: String(r.unutilised), label: "unutilised", strong: true },
              { value: String(avail), label: "available", key: "avail" },
              { value: String(r.reserved), label: "reserved", key: "res" },
              { value: "≈ " + fmt.money(r.estValue), label: "est. value" }
            ]
          };
          return '<div class="rep-hbar' + (link ? " is-link" : "") + '" data-tip="' + key + '"' +
              (link ? openAttrs(r) : "") + ' style="--i:' + i + '">' +
              '<span class="rep-hbar__label"><span class="rep-hbar__name">' + esc(r.family.parentName) + "</span>" +
                '<span class="rep-hbar__sub">' + esc(kidNames(r.children)) + "</span></span>" +
              '<span class="rep-hbar__track">' +
                '<span class="rep-hbar__bar" style="--p:' + (r.unutilised / max).toFixed(4) + '">' +
                  (avail ? '<span class="rep-hbar__seg rep-hbar__seg--avail" style="flex:' + avail + ' 1 0"></span>' : "") +
                  (r.reserved ? '<span class="rep-hbar__seg rep-hbar__seg--res" style="flex:' + r.reserved + ' 1 0"></span>' : "") +
                "</span>" +
                '<span class="rep-hbar__val">' + r.unutilised + "</span>" +
              "</span>" +
            "</div>";
        }).join("") +
        "</div>";
    }

    return '<section class="card rep-chart rep-chart--top" aria-labelledby="repTopTitle">' +
        '<div class="card__head">' +
          '<div><h2 class="card__title" id="repTopTitle">Who holds the most</h2>' +
          '<p class="card__sub">' + (holding.length > TOP_N ? "Top " + TOP_N + " families" : "Families") +
            " by unutilised credits · click one to open the family</p></div>" +
          (top.length ? viewToggle("top", "Show top families as") : "") +
        "</div>" +
        '<div class="card__body">' + body + restNote + "</div>" +
      "</section>";
  }

  /* ============================================================
     CHART B — idle credits by days since last class (ordinal)
     ============================================================ */
  function idleChartHtml(rep) {
    var aging = rep.aging;
    var total = aging.reduce(function (s, a) { return s + a.credits; }, 0);
    var body;

    if (ui.view.idle === "table") {
      body = '<div class="tbl-wrap"><table class="tbl rep-mini">' +
        '<caption class="sr-only">Available credits by days since the family’s last class</caption>' +
        '<thead><tr><th scope="col">Since last class</th><th scope="col" class="num">Credits</th><th scope="col" class="num">Families</th></tr></thead><tbody>' +
        aging.map(function (a) {
          return "<tr><td>" + esc(a.label) + '</td><td class="num">' + a.credits + '</td><td class="num">' + a.families + "</td></tr>";
        }).join("") +
        "</tbody></table></div>";
    } else {
      var max = Math.max.apply(null, aging.map(function (a) { return a.credits; }).concat([1]));
      var summary = "Column chart of available credits by days since the family’s last class: " +
        aging.map(function (a) {
          return a.label + ", " + Admin.plural(a.credits, "credit") + " (" + Admin.plural(a.families, "family", "families") + ")";
        }).join("; ") + ".";
      body = '<div class="rep-cols" role="img" aria-label="' + esc(summary) + '">' +
        aging.map(function (a, i) {
          var key = "idle" + i;
          var share = total ? Math.round((a.credits / total) * 100) : 0;
          tips[key] = {
            title: a.label + " since last class",
            rows: [
              { value: String(a.credits), label: a.credits === 1 ? "credit" : "credits", strong: true, key: "age" + (i + 1) },
              { value: String(a.families), label: a.families === 1 ? "family" : "families" },
              { value: share + "%", label: "of available credits" }
            ]
          };
          return '<div class="rep-col" data-tip="' + key + '" style="--i:' + i + '">' +
              '<span class="rep-col__plot">' +
                '<span class="rep-col__val">' + a.credits + "</span>" +
                '<span class="rep-col__bar rep-col__bar--' + (i + 1) + '" style="--p:' + (a.credits / max).toFixed(4) + '"></span>' +
              "</span>" +
              '<span class="rep-col__label">' + esc(a.label) + "</span>" +
              '<span class="rep-col__sub">' + esc(Admin.plural(a.families, "family", "families")) + "</span>" +
            "</div>";
        }).join("") +
        "</div>";
    }

    return '<section class="card rep-chart rep-chart--idle" aria-labelledby="repIdleTitle">' +
        '<div class="card__head">' +
          '<div><h2 class="card__title" id="repIdleTitle">Idle credits</h2>' +
          '<p class="card__sub">Available credits by days since the family’s last class</p></div>' +
          viewToggle("idle", "Show idle credits as") +
        "</div>" +
        '<div class="card__body">' + body +
          '<p class="rep-note">A family’s last class is the most recent one any of its children attended; families who haven’t attended yet count from the day their account opened.</p>' +
        "</div>" +
      "</section>";
  }

  /* ============================================================
     CREDITS BY TYPE — what is held, and what moved in the period
     One series per panel, so every bar wears the same colour and
     is direct-labelled with its credit type.
     ============================================================ */
  function typeChartHtml(rep) {
    var held = (rep.totals.byType || []).slice();
    var m = rep.movement;
    var moved = db.creditTypes().map(function (ty) {
      var x = (m.byType && m.byType[ty.id]) || { in: 0, out: 0, revenue: 0 };
      return { type: ty, bought: x.in, used: x.out, revenue: x.revenue || 0 };
    }).filter(function (x) { return x.bought || x.used; })
      .sort(function (a, b) { return (b.bought + b.used) - (a.bought + a.used); });
    var total = held.reduce(function (n, x) { return n + x.credits; }, 0);
    var maxMove = moved.reduce(function (n, x) { return Math.max(n, x.bought, x.used); }, 1);
    var body;

    if (ui.view.type === "table") {
      body = '<div class="tbl-wrap"><table class="tbl rep-mini">' +
          '<caption class="sr-only">Unutilised credits, and credits bought and used in the period, by credit type</caption>' +
          '<thead><tr><th scope="col">Credit type</th><th scope="col" class="num">Held</th>' +
          '<th scope="col" class="num">Bought</th><th scope="col" class="num">Used</th><th scope="col" class="num">Revenue</th></tr></thead><tbody>' +
          db.creditTypes().map(function (ty) {
            var heldN = 0;
            held.forEach(function (x) { if (x.type.id === ty.id) heldN = x.credits; });
            var mv = null;
            moved.forEach(function (x) { if (x.type.id === ty.id) mv = x; });
            if (!heldN && !mv) return "";
            return "<tr><td>" + h.creditChip(ty.id) + '</td><td class="num">' + heldN +
              '</td><td class="num">' + (mv ? mv.bought : 0) + '</td><td class="num">' + (mv ? mv.used : 0) +
              '</td><td class="num">' + esc(fmt.money(mv ? mv.revenue : 0)) + "</td></tr>";
          }).join("") +
        "</tbody></table></div>";
    } else if (!held.length && !moved.length) {
      body = h.empty("chart", "No credits to show", "Nothing has been bought or used in this period.");
    } else {
      var maxHeld = held.length ? held[0].credits : 1;
      var heldSummary = "Bar chart of unutilised credits by credit type: " +
        (held.length ? held.map(function (x) { return x.type.name + ", " + Admin.plural(x.credits, "credit"); }).join("; ") : "none") + ".";
      var heldBars = held.length
        ? '<div class="rep-tbars" role="img" aria-label="' + esc(heldSummary) + '">' +
          held.map(function (x, i) {
            var key = "type" + i;
            tips[key] = {
              title: x.type.name,
              sub: "Unutilised credits",
              rows: [
                { value: String(x.credits), label: "credits held", strong: true, key: "avail" },
                { value: total ? Math.round((x.credits / total) * 100) + "%" : "0%", label: "of all credits" }
              ]
            };
            return '<div class="rep-tbar" data-tip="' + key + '" style="--i:' + i + '">' +
                '<span class="rep-tbar__label">' + h.creditChip(x.type.id) + "</span>" +
                '<span class="rep-hbar__track">' +
                  '<span class="rep-hbar__bar rep-tbar__bar" style="--p:' + (x.credits / maxHeld).toFixed(4) + '"></span>' +
                  '<span class="rep-hbar__val">' + x.credits + "</span>" +
                "</span>" +
              "</div>";
          }).join("") + "</div>"
        : '<p class="rep-note">No unutilised credits.</p>';

      var moveSummary = "Bought against used in this period, by credit type: " +
        (moved.length ? moved.map(function (x) {
          return x.type.name + ", " + x.bought + " bought, " + x.used + " used";
        }).join("; ") : "nothing moved") + ".";
      var moveBars = moved.length
        ? '<div class="legend rep-legend" aria-hidden="true">' +
            '<span><i class="rep-key rep-key--avail"></i>Bought</span>' +
            '<span><i class="rep-key rep-key--res"></i>Used</span>' +
          "</div>" +
          '<div class="rep-tbars rep-tbars--pair" role="img" aria-label="' + esc(moveSummary) + '">' +
          moved.map(function (x, i) {
            var key = "move" + i;
            tips[key] = {
              title: x.type.name,
              sub: "In this period",
              rows: [
                { value: String(x.bought), label: "bought", key: "avail" },
                { value: String(x.used), label: "used", key: "res" },
                { value: fmt.money(x.revenue), label: "revenue" }
              ]
            };
            return '<div class="rep-tbar rep-tbar--pair" data-tip="' + key + '" style="--i:' + i + '">' +
                '<span class="rep-tbar__label">' + h.creditChip(x.type.id) + "</span>" +
                '<span class="rep-tbar__pair">' +
                  '<span class="rep-hbar__track"><span class="rep-hbar__bar rep-tbar__bar rep-tbar__bar--in" style="--p:' +
                    (x.bought / maxMove).toFixed(4) + '"></span><span class="rep-hbar__val">' + x.bought + "</span></span>" +
                  '<span class="rep-hbar__track"><span class="rep-hbar__bar rep-tbar__bar rep-tbar__bar--out" style="--p:' +
                    (x.used / maxMove).toFixed(4) + '"></span><span class="rep-hbar__val">' + x.used + "</span></span>" +
                "</span>" +
              "</div>";
          }).join("") + "</div>"
        : '<p class="rep-note">Nothing was bought or used in this period.</p>';

      body = '<div class="rep-typegrid">' +
          '<div class="rep-typecol"><h3 class="rep-subhead">Unutilised credits held</h3>' + heldBars + "</div>" +
          '<div class="rep-typecol"><h3 class="rep-subhead">Bought vs used in this period</h3>' + moveBars + "</div>" +
        "</div>";
    }

    return '<section class="card rep-chart rep-chart--type" aria-labelledby="repTypeTitle">' +
        '<div class="card__head">' +
          '<div><h2 class="card__title" id="repTypeTitle">Credits by type</h2>' +
          '<p class="card__sub">A credit only books its own kind of class</p></div>' +
          viewToggle("type", "Show credits by type as") +
        "</div>" +
        '<div class="card__body">' + body + "</div>" +
      "</section>";
  }

  /* ============================================================
     IN THIS PERIOD — credit movement + activity
     ============================================================ */
  function monthHtml(rep) {
    var m = rep.movement;
    var act = rep.activity || { classes: 0, booked: 0, present: 0, late: 0, absent: 0, unmarked: 0 };
    var ins = [
      ["Purchased", m.purchased],
      ["Free trial", m.trial],
      ["Refunded (cancellations)", m.refunded],
      ["Added by staff", m.manualAdded]
    ];
    var outs = [
      ["Used for bookings", m.used],
      ["Deducted by staff", m.manualDeducted]
    ];
    var inSum = ins.reduce(function (s, x) { return s + x[1]; }, 0);
    var outSum = outs.reduce(function (s, x) { return s + x[1]; }, 0);
    var net = m.net != null ? m.net : inSum - outSum;
    function list(items, sign) {
      return '<dl class="rep-flow__list">' + items.map(function (x) {
        return "<div><dt>" + esc(x[0]) + "</dt>" +
          (x[1] ? "<dd>" + sign + x[1] + "</dd>" : '<dd class="is-zero">0</dd>') + "</div>";
      }).join("") + "</dl>";
    }
    var attendance = [
      ["Present", act.present], ["Late", act.late], ["Absent", act.absent], ["Not marked", act.unmarked]
    ];
    return '<section class="card rep-month" aria-labelledby="repMonthTitle">' +
        '<div class="card__head">' +
          '<div><h2 class="card__title" id="repMonthTitle">In this period</h2>' +
          '<p class="card__sub">' + esc(rangeLabel(m.from, m.to)) + " · credits in and out</p></div>" +
        "</div>" +
        '<div class="card__body">' +
          '<div class="rep-flow">' +
            '<div class="rep-flow__col rep-flow__col--in"><p class="rep-flow__h"><span>Credits in</span><span>+' + inSum + "</span></p>" + list(ins, "+") + "</div>" +
            '<div class="rep-flow__col rep-flow__col--out"><p class="rep-flow__h"><span>Credits out</span><span>' + (outSum ? "−" + outSum : "0") + "</span></p>" + list(outs, "−") + "</div>" +
          "</div>" +
          '<div class="rep-flow__foot">' +
            "<div><span>Net change</span><strong>" + esc(fmt.signed(net) || "0") + "</strong>" +
              '<em>' + (net > 0 ? "More credits sold than used" : net < 0 ? "More credits used than sold" : "Balanced") + "</em></div>" +
            "<div><span>Revenue</span><strong>" + esc(fmt.money(m.revenue)) + "</strong><em>PayNow + paid at studio</em></div>" +
          "</div>" +
          '<div class="rep-activity">' +
            '<p class="rep-subhead">Classes in this period</p>' +
            '<p class="rep-activity__lead"><strong>' + act.classes + "</strong> " +
              (act.classes === 1 ? "class" : "classes") + " · <strong>" + act.booked + "</strong> " +
              (act.booked === 1 ? "booking" : "bookings") + "</p>" +
            '<dl class="rep-activity__list">' + attendance.map(function (x) {
              return "<div><dt>" + esc(x[0]) + "</dt><dd" + (x[1] ? "" : ' class="is-zero"') + ">" + x[1] + "</dd></div>";
            }).join("") + "</dl>" +
          "</div>" +
        "</div>" +
      "</section>";
  }

  /* ============================================================
     HANDOFF — the per-student list lives in Students
     ============================================================ */
  function handoffHtml(rep) {
    var t = rep.totals;
    return '<section class="rep-handoff" aria-labelledby="repHandoffTitle">' +
        '<span class="rep-handoff__ic">' + Admin.icon("users") + "</span>" +
        '<div class="rep-handoff__text">' +
          '<h2 class="rep-handoff__t" id="repHandoffTitle">Looking for a particular student?</h2>' +
          '<p class="rep-handoff__d">Students lists all ' + esc(Admin.plural(t.students, "student")) +
            " with their family’s credits, last class and status — search, filter and adjust from there.</p>" +
        "</div>" +
        '<button class="btn btn--ink" type="button" id="repStudentsLink" data-go="students">See all students' +
          Admin.icon("chevron-right") + "</button>" +
      "</section>";
  }

  /* ============================================================
     CSV EXPORT — one row per family
     ============================================================ */
  // Spreadsheet formula-injection guard for free text. A phone number
  // ("+65 8888 8888": a plus, then digit groups split by single spaces)
  // can't carry a formula, so it's exported as written.
  function csvCell(v, text) {
    var s = v == null ? "" : String(v);
    if (text && /^[=+\-@\t\r]/.test(s) && !/^\+\d+( \d+)+$/.test(s)) s = "'" + s;
    return /[",\r\n]/.test(s) || /^\s|\s$/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  // "Junior 8; Elite 4" — every wallet the family holds
  function walletText(r) {
    return (r.wallets || []).filter(function (w) { return w.credits; }).map(function (w) {
      return (w.type.short || w.type.name) + " " + w.credits;
    }).join("; ");
  }

  function buildCsv(rows) {
    var head = ["Family", "Children", "Email", "Phone", "Available", "By credit type", "Reserved", "Unutilised",
      "Est. value (S$)", "Avg price per credit (S$)", "Bought in period", "Used in period", "Refunded in period",
      "Added by staff", "Taken by staff", "Revenue in period (S$)", "Classes attended in period",
      "Last class", "Idle days", "Status"];
    var lines = [head.map(function (x) { return csvCell(x); }).join(",")];
    rows.forEach(function (r) {
      var f = r.family || {};
      lines.push([
        csvCell(f.parentName, true),
        csvCell(r.children.map(function (c) { return c.name; }).join("; "), true),
        csvCell(f.email, true),
        csvCell(f.phone, true),
        csvCell(r.available),
        csvCell(walletText(r), true),
        csvCell(r.reserved),
        csvCell(r.unutilised),
        csvCell(r.estValue.toFixed(2)),
        csvCell(r.unitPrice.toFixed(2)),
        csvCell(r.bought),
        csvCell(r.spent),
        csvCell(r.refunded),
        csvCell(r.addedByStaff),
        csvCell(r.takenByStaff),
        csvCell(Number(r.revenue || 0).toFixed(2)),
        csvCell(r.attended),
        csvCell(r.lastClass || ""),
        csvCell(r.idleDays),
        csvCell(statuses(r).map(function (x) { return x.label; }).join("; "))
      ].join(","));
    });
    return lines.join("\r\n") + "\r\n";
  }

  function exportCsv(rng) {
    var rep = db.creditReport({ from: rng.from, to: rng.to, dormantDays: ui.dormant });
    var rows = rep.rows.slice().sort(byUnutilised);
    var U = window.URL || window.webkitURL;
    if (typeof window.Blob === "undefined" || !U || typeof U.createObjectURL !== "function") {
      Admin.toast("warn", "This browser can’t save files. Try Chrome, Safari or Edge.");
      return;
    }
    if (!rows.length) {
      Admin.toast("warn", "No families to export yet.");
      return;
    }
    var name = "huacheng-credits-" + rep.from + "-to-" + rep.to + ".csv";
    // BOM so Excel reads UTF-8 names correctly
    var blob = new window.Blob(["﻿" + buildCsv(rows)], { type: "text/csv;charset=utf-8" });
    var url = U.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.hidden = true;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      if (a.parentNode) a.parentNode.removeChild(a);
      if (typeof U.revokeObjectURL === "function") U.revokeObjectURL(url);
    }, 1000);
    Admin.toast("ok", "Exported " + Admin.plural(rows.length, "family", "families") + " to " + name);
  }

  /* ============================================================
     TOOLTIP (one element on <body>; text only via textContent)
     ============================================================ */
  var tipBound = false;

  function tipEl() {
    var t = document.getElementById("repTip");
    if (!t) {
      t = document.createElement("div");
      t.id = "repTip";
      t.className = "rep-tip";
      t.setAttribute("aria-hidden", "true"); // repeats the table view, so screen readers skip it
      t.hidden = true;
      document.body.appendChild(t);
    }
    if (!tipBound) {
      tipBound = true;
      window.addEventListener("scroll", hideTip, { passive: true });
      window.addEventListener("hashchange", hideTip);
    }
    return t;
  }

  function hideTip() {
    var t = document.getElementById("repTip");
    if (t) t.hidden = true;
  }

  function showTip(key, x, y) {
    var d = tips[key];
    if (!d) { hideTip(); return; }
    var t = tipEl();
    if (t.getAttribute("data-key") !== key) {
      t.setAttribute("data-key", key);
      t.textContent = "";
      var title = document.createElement("p");
      title.className = "rep-tip__t";
      title.textContent = d.title;
      t.appendChild(title);
      if (d.sub) {
        var sub = document.createElement("p");
        sub.className = "rep-tip__s";
        sub.textContent = d.sub;
        t.appendChild(sub);
      }
      d.rows.forEach(function (r) {
        var row = document.createElement("p");
        row.className = "rep-tip__row" + (r.strong ? " is-strong" : "");
        var k = document.createElement("i");
        k.className = "rep-tip__key" + (r.key ? " rep-tip__key--" + r.key : "");
        row.appendChild(k);
        var v = document.createElement("b");
        v.textContent = r.value;
        row.appendChild(v);
        var l = document.createElement("span");
        l.textContent = r.label;
        row.appendChild(l);
        t.appendChild(row);
      });
    }
    t.hidden = false;
    var vw = window.innerWidth || document.documentElement.clientWidth;
    var vh = window.innerHeight || document.documentElement.clientHeight;
    var w = t.offsetWidth, ht = t.offsetHeight;
    var left = x + 14, top = y + 14;
    if (left + w > vw - 8) left = Math.max(8, x - w - 14);
    if (top + ht > vh - 8) top = Math.max(8, y - ht - 14);
    t.style.left = left + "px";
    t.style.top = top + "px";
  }

  /* ============================================================
     VIEW
     ============================================================ */
  function render(el, params) {
    hideTip();
    tips = {};
    var t = document.getElementById("repTip");
    if (t) t.removeAttribute("data-key");
    if (!Admin.can("reports")) {
      el.innerHTML = h.pageHead({ title: "Reports" }) +
        h.empty("chart", "Admins only", "Credit reports are available to the studio admin.");
      return;
    }
    var rng = range(params || {});
    var rep = db.creditReport({ from: rng.from, to: rng.to, dormantDays: ui.dormant });
    var intro = !el.querySelector(".rep");
    el.innerHTML = '<div class="rep' + (intro ? " rep--intro" : "") + '">' +
        headHtml(rep) +
        rangeHtml(rep, rng) +
        kpisHtml(rep) +
        '<div class="rep-grid">' +
          topChartHtml(rep) +
          '<div class="rep-side">' + idleChartHtml(rep) + monthHtml(rep) + "</div>" +
        "</div>" +
        typeChartHtml(rep) +
        handoffHtml(rep) +
      "</div>";
    bind(el.querySelector(".rep"), rng);
  }

  // Listeners live on the freshly rendered root, so re-renders never stack them.
  // Family links (data-open-family) and Students links (data-go) are handled by the core.
  function bind(root, rng) {
    root.querySelector("#repDormant").addEventListener("change", function (e) {
      ui.dormant = parseInt(e.target.value, 10) || 21;
      Admin.refresh();
    });

    // the range lives in the URL, so a refresh (or a shared link) keeps it
    function setRange(from, to) {
      hideTip();
      Admin.setParams({ from: from, to: to });
    }

    root.addEventListener("change", function (e) {
      var id = e.target.id;
      if (id !== "repFrom" && id !== "repTo") return;
      var today = db.todayISO();
      var from = root.querySelector("#repFrom").value || rng.from;
      var to = root.querySelector("#repTo").value || rng.to;
      if (!ISO.test(from)) from = rng.from;
      if (!ISO.test(to) || to > today) to = today;
      if (from > to) { if (id === "repFrom") to = from > today ? today : from; else from = to; }
      if (from > today) from = today;
      setRange(from, to);
    });

    root.addEventListener("click", function (e) {
      var t = e.target;
      if (t.closest("[data-open-family], [data-open-student], [data-go]")) { hideTip(); return; }
      if (t.closest("#repExport")) { exportCsv(rng); return; }
      var pre = t.closest("[data-rep-range]");
      if (pre) {
        var id = pre.getAttribute("data-rep-range");
        var today2 = db.todayISO();
        var p = null;
        PRESETS.forEach(function (x) { if (x.id === id) p = x; });
        if (p) setRange(p.from(today2), today2);
        return;
      }
      if (t.closest("#repRangeReset")) {
        var today3 = db.todayISO();
        setRange(PRESETS[0].from(today3), today3);
        return;
      }
      if (t.closest("#repPrint")) { if (typeof window.print === "function") window.print(); return; }
      var v = t.closest("[data-rep-view]");
      if (v) {
        var p = v.getAttribute("data-rep-view").split(":");
        ui.view[p[0]] = p[1];
        Admin.refresh();
      }
    });

    // hover layer: each bar / column is its own hit target
    root.addEventListener("pointermove", function (e) {
      if (e.pointerType === "touch") return;
      var mark = e.target.closest && e.target.closest("[data-tip]");
      if (mark && root.contains(mark)) showTip(mark.getAttribute("data-tip"), e.clientX, e.clientY);
      else hideTip();
    });
    root.addEventListener("pointerleave", hideTip);
  }

  Admin.registerView("reports", { render: render });
})();
