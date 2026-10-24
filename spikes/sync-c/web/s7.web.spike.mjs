// S5 web half: headless Chrome on a runner, encrypted sqlite3mc on OPFS opens 200k rows; reactive 10k list update under 16 ms.
// Run through the spike workflow (it installs playwright-core and downloads chromium headless shell on first use).
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
await import("./ensure-deps.mjs");
const HERE = path.dirname(fileURLToPath(import.meta.url));
const metric = (o) => console.log("METRIC " + JSON.stringify(o));
const TYPES = { ".mjs": "text/javascript", ".js": "text/javascript", ".wasm": "application/wasm", ".html": "text/html" };

test("web: encrypted sqlite3mc on OPFS opens 200k rows and updates a 10k list under 16 ms", { timeout: 280000 }, async () => {
  execSync("npx playwright-core install chromium-headless-shell", { cwd: HERE, stdio: "inherit" });
  const { chromium } = await import("playwright-core");
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, "http://x").pathname;
    const file = u === "/" ? path.join(HERE, "index.html") : u === "/worker.js" ? path.join(HERE, "worker.js") : u.startsWith("/sqlite/") ? path.join(HERE, "node_modules/sqlite-wasm-cipher", u.slice(8)) : null;
    if (!file || !file.startsWith(HERE) || !fs.existsSync(file)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { "content-type": TYPES[path.extname(file)] || "application/octet-stream", "cross-origin-opener-policy": "same-origin", "cross-origin-embedder-policy": "require-corp" });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const browser = await chromium.launch({ args: ["--no-sandbox"] });
  try {
    const page = await browser.newPage();
    page.on("console", (m) => console.log("browser:", m.text()));
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    const res = await page.evaluate(() => new Promise((resolve) => {
      const w = new Worker("/worker.js", { type: "module" });
      w.onmessage = (e) => resolve(e.data); w.onerror = (e) => resolve({ ok: false, error: "worker error " + e.message });
    }));
    console.log(JSON.stringify(res));
    assert.equal(res.ok, true, res.error);
    const o = res.out;
    metric({ name: "s5.web_opfs_cipher", ...o, budget_reactive_ms: 16, pass: o.reactive_p99_ms < 16 });
    assert.equal(o.count, 200000); assert.equal(o.query_rows, 200000);
    assert.match(o.no_key, /rejected/); assert.match(o.wrong_key, /rejected/); assert.equal(o.plaintext_in_opfs, false);
    assert.ok(o.reactive_p99_ms < 16, "reactive p99 " + o.reactive_p99_ms);
  } finally { await browser.close(); server.close(); }
});
