/* Screenshots of real pages in headless Chrome (dev tool, not a test).
     node shots.js [width] [only,names]
   Writes PNGs to tests/shots/ (git-ignored). Chrome is found at the usual macOS path. */
const http = require("http"), fs = require("fs"), path = require("path"), { spawn } = require("child_process");
const ROOT = path.resolve(__dirname, "..");
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// staff=<id> / parent=<familyId> in the query seeds the session before the page boots
function serve() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      const u = new URL(req.url, "http://x");
      const file = path.join(ROOT, decodeURIComponent(u.pathname));
      if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end("404"); }
      let body = fs.readFileSync(file);
      const staff = u.searchParams.get("staff"), parent = u.searchParams.get("parent");
      if ((staff || parent) && path.extname(file) === ".html") {
        const seed = staff
          ? `localStorage.clear();localStorage.setItem("hc_staff",${JSON.stringify(staff)});localStorage.setItem("hc_guide_${staff}","1");`
          : `localStorage.setItem("hc_parent",${JSON.stringify(parent)});`;
        body = body.toString().replace("<head>", "<head><script>" + seed + "</script>");
      }
      res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-store" });
      res.end(body);
    });
    srv.listen(0, "127.0.0.1", () => resolve({ srv, port: srv.address().port }));
  });
}

async function chrome(W, H) {
  const dir = fs.mkdtempSync(path.join(require("os").tmpdir(), "hc-shots-"));
  const proc = spawn(CHROME, ["--headless=new", "--user-data-dir=" + dir, "--remote-debugging-port=0", "--disable-gpu",
    "--hide-scrollbars", "--no-first-run", "--no-default-browser-check", "--window-size=" + W + "," + H, "about:blank"], { stdio: "ignore" });
  let port;
  for (let i = 0; i < 150 && !port; i++) { await sleep(100); try { port = fs.readFileSync(path.join(dir, "DevToolsActivePort"), "utf8").split("\n")[0]; } catch (e) {} }
  const page = (await (await fetch("http://127.0.0.1:" + port + "/json/list")).json()).find((t) => t.type === "page");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener("open", r));
  let id = 0; const pending = {};
  ws.addEventListener("message", (m) => { const d = JSON.parse(m.data); if (d.id && pending[d.id]) { pending[d.id](d); delete pending[d.id]; } });
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending[i] = r; ws.send(JSON.stringify({ id: i, method, params })); });
  await send("Emulation.setDeviceMetricsOverride", { width: +W, height: +H, deviceScaleFactor: 1, mobile: +W < 768 });
  await send("Page.enable"); await send("Runtime.enable");
  return {
    async go(url) { await send("Page.navigate", { url }); await sleep(1300); },
    async ev(expr) {
      const r = await send("Runtime.evaluate", { expression: "(function(){" + expr + "})()", returnByValue: true, awaitPromise: true });
      return r.result && r.result.result && r.result.result.value;
    },
    async shot(file) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const s = await send("Page.captureScreenshot", { format: "png" });
      fs.writeFileSync(file, Buffer.from(s.result.data, "base64"));
    },
    close() { ws.close(); proc.kill(); setTimeout(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {} }, 200); },
  };
}

// the demo family's id moves with the seed, so look it up rather than hard-coding it
function demoFamilyId() {
  const vm = require("vm");
  const store = {};
  const localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } };
  const window = { addEventListener() {}, localStorage };
  const ctx = vm.createContext({ window, localStorage, console, Date, Math, JSON });
  vm.runInContext(fs.readFileSync(path.join(ROOT, "mock-data.js"), "utf8"), ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, "hc-store.js"), "utf8"), ctx);
  const f = window.HC.db.familyByEmail("demo@huachengelite.com");
  return f ? f.id : "";
}

const SHOTS = [
  ["admin-packages", "admin", "admin/app.html#packages"],
  ["admin-credits", "admin", "admin/app.html#credits"],
  ["admin-reports", "admin", "admin/app.html#reports"],
  ["admin-students", "admin", "admin/app.html#students"],
  ["admin-add-student", "admin", "admin/app.html#students", "document.querySelector('#page .page__actions .btn--primary').click()"],
  ["admin-leave", "admin", "admin/app.html#leave"],
  ["admin-leave-form", "admin", "admin/app.html#leave", "document.querySelector('#page .page__actions .btn--primary').click()"],
  ["coach-classes", "coach-a", "admin/app.html#schedule"],
  ["portal-credits", null, "portal.html#credits"],
  ["portal-schedule", null, "portal.html#schedule"],
];

(async () => {
  const W = +process.argv[2] || 1440, H = W < 700 ? 900 : 1000;
  const only = process.argv[3] ? process.argv[3].split(",") : null;
  const { srv, port } = await serve();
  const b = await chrome(W, H);
  for (const [name, staff, page, js] of SHOTS) {
    if (only && !only.includes(name)) continue;
    const parent = staff ? "" : "&parent=" + (process.env.FAMILY || demoFamilyId());
    const url = "http://127.0.0.1:" + port + "/" + page.replace("#", (page.includes("?") ? "&" : "?") + "staff=" + (staff || "") + parent + "#");
    await b.go(url);
    if (js) { await b.ev(js + "; return 1"); await sleep(700); }
    const info = await b.ev("return {overflow: document.documentElement.scrollWidth > innerWidth + 1, title: (document.querySelector('.page__title')||document.querySelector('.view__title')||{}).textContent}");
    console.log(W, name, JSON.stringify(info));
    await b.shot(path.join(__dirname, "shots", W + "-" + name + ".png"));
  }
  b.close(); srv.close(); process.exit(0);
})();
