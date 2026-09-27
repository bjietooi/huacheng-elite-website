/* Loads a real page of the mock (console or parent portal) in jsdom.

     const { openConsole, openPortal, openPage } = require("./dom-harness.js");
     const c = await openConsole({ staff: "coach-a", hash: "#schedule" });
     c.$(sel) / c.$$(sel)     querySelector helpers
     c.click(selOrEl)         real click event
     c.input(sel, value)      set value + fire input/change
     c.submit(sel)            submit a form
     await c.go("#students")  navigate and settle
     await c.tick(ms)         let timers / rAF settle (default 30ms)
     c.text(sel?)             normalised textContent
     c.errors                 console.error / uncaught / jsdom errors
     c.HC, c.Admin, c.App     page globals
     c.storage                localStorage snapshot (pass back in via `storage`)
     c.close()

   Each page gets its own isolated localStorage, so suites never collide.
   `now` freezes the page clock: openConsole({ now: "2026-10-06T12:00" }).
*/
const fs = require("fs");
const path = require("path");
const { JSDOM, ResourceLoader, VirtualConsole } = require("jsdom");

const ROOT = path.resolve(__dirname, "..");
const ORIGIN = "http://hc.test";

class DiskLoader extends ResourceLoader {
  fetch(url) {
    const u = new URL(url);
    if (u.origin !== ORIGIN) return null; // skip fonts / CDN images
    const file = path.join(ROOT, decodeURIComponent(u.pathname));
    if (!fs.existsSync(file)) return Promise.reject(new Error("404 " + u.pathname));
    return Promise.resolve(fs.readFileSync(file));
  }
}

async function openPage(relPath, { hash = "", storage = {}, session = {}, now = null } = {}) {
  const html = fs.readFileSync(path.join(ROOT, relPath), "utf8");
  const errors = [];
  const vc = new VirtualConsole();
  vc.on("error", (...a) => errors.push(a.map(String).join(" ")));
  vc.on("jsdomError", (e) => {
    const msg = String((e && (e.stack || e.message)) || e);
    if (/Not implemented: (navigation|window\.scrollTo|HTMLCanvasElement)/.test(msg)) return;
    if (/Could not parse CSS stylesheet/.test(msg)) return;
    errors.push("jsdomError: " + msg);
  });
  vc.on("warn", () => {});
  const dom = new JSDOM(html, {
    url: ORIGIN + "/" + relPath + hash,
    runScripts: "dangerously",
    resources: new DiskLoader(),
    pretendToBeVisual: true,
    virtualConsole: vc,
    beforeParse(window) {
      for (const [k, v] of Object.entries(storage)) window.localStorage.setItem(k, v);
      for (const [k, v] of Object.entries(session)) window.localStorage.setItem(k, v);
      window.scrollTo = () => {};
      window.HTMLElement.prototype.scrollIntoView = function () {};
      if (!window.matchMedia) {
        window.matchMedia = (q) => ({ matches: false, media: q, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false });
      }
      if (now) freezeClock(window, now);
      window.addEventListener("error", (ev) => errors.push("uncaught: " + ((ev.error && ev.error.stack) || ev.message)));
      window.addEventListener("unhandledrejection", (ev) => errors.push("unhandledrejection: " + ev.reason));
    },
  });
  const w = dom.window;
  await new Promise((r) => (w.document.readyState === "complete" ? r() : w.addEventListener("load", r)));
  await tick(30);

  function tick(ms = 30) { return new Promise((r) => setTimeout(r, ms)); }
  const api = {
    dom, window: w, document: w.document, errors,
    get HC() { return w.HC; },
    get Admin() { return w.Admin; },
    get App() { return w.HC && w.HC.app; },
    $: (s) => w.document.querySelector(s),
    $$: (s) => Array.from(w.document.querySelectorAll(s)),
    tick,
    click(target) {
      const el = typeof target === "string" ? w.document.querySelector(target) : target;
      if (!el) throw new Error("click: no element for " + target);
      el.dispatchEvent(new w.MouseEvent("click", { bubbles: true, cancelable: true }));
      return el;
    },
    input(target, value) {
      const el = typeof target === "string" ? w.document.querySelector(target) : target;
      if (!el) throw new Error("input: no element for " + target);
      if (el.type === "checkbox" || el.type === "radio") el.checked = !!value; else el.value = value;
      el.dispatchEvent(new w.Event("input", { bubbles: true }));
      el.dispatchEvent(new w.Event("change", { bubbles: true }));
      return el;
    },
    submit(target) {
      const el = typeof target === "string" ? w.document.querySelector(target) : target;
      el.dispatchEvent(new w.Event("submit", { bubbles: true, cancelable: true }));
    },
    async go(hashValue) { w.location.hash = hashValue; await tick(40); },
    text(sel) {
      const el = sel ? w.document.querySelector(sel) : w.document.body;
      return el ? el.textContent.replace(/\s+/g, " ").trim() : "";
    },
    get storage() {
      const o = {};
      for (let i = 0; i < w.localStorage.length; i++) { const k = w.localStorage.key(i); o[k] = w.localStorage.getItem(k); }
      return o;
    },
    close() { w.close(); },
  };
  return api;
}

// Pins the page's clock to "YYYY-MM-DDTHH:MM" so "now / passed / upcoming" is stable.
function freezeClock(window, stamp) {
  const fixed = new Date(stamp.length <= 10 ? stamp + "T12:00" : stamp).getTime();
  const Real = window.Date;
  function Fake(...args) {
    if (!(this instanceof Fake)) return new Real(fixed).toString();
    return args.length ? new Real(...args) : new Real(fixed);
  }
  Fake.prototype = Real.prototype;
  Fake.now = () => fixed;
  Fake.parse = Real.parse;
  Fake.UTC = Real.UTC;
  window.Date = Fake;
}

const openConsole = ({ staff = "admin", hash = "#today", storage, now, guide = false } = {}) =>
  openPage("admin/app.html", {
    hash, storage, now,
    session: Object.assign({ hc_staff: staff }, guide ? {} : { ["hc_guide_" + staff]: "1" }),
  });

const openPortal = ({ family = null, hash = "", storage, now, page = "portal.html" } = {}) =>
  openPage(page, { hash, storage, now, session: family ? { hc_parent: family } : {} });

module.exports = { openPage, openConsole, openPortal, ROOT };
