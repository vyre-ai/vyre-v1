// The Vyre for Chrome panel's faces (lane l-artifacts): the panel's own face() code and stylesheets, on a page laid out like the panel's rows (messages, the agent chip, recent chats), with the library faces,
// in paper and graphite at 1440 and 390. Run on the build box: node scripts/shots/chrome-faces-shoot.mjs [out-dir]
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { createRequire } from "node:module";
const REPO = process.cwd();
const root = path.join(REPO, "apps/chrome/src");
const out = process.argv[2] || "/root/wt/tmp-l-artifacts/chrome-faces";
fs.mkdirSync(out, { recursive: true });
const types = { ".js": "text/javascript", ".css": "text/css", ".html": "text/html" };
const srv = http.createServer((req, res) => {
  const p = new URL(req.url, "http://x").pathname;
  if (p === "/page.html") { res.writeHead(200, { "content-type": "text/html" }); res.end(PAGE); return; }
  const f = path.join(root, p);
  if (!f.startsWith(root) || !fs.existsSync(f)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { "content-type": types[path.extname(f)] ?? "text/plain" }); res.end(fs.readFileSync(f));
});
await new Promise((r) => srv.listen(0, r));
const origin = `http://127.0.0.1:${srv.address().port}`;
const PAGE = `<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/ui/tokens.css"><link rel="stylesheet" href="/panel/panel.css"><body><div id="app" style="max-width:420px;margin:24px auto;padding:0 12px;display:flex;flex-direction:column;gap:14px"></div>
<script type="module">
import { face } from "/ui/icons.js";
import { h } from "/ui/dom.js";
const A = [["Intake","av1:friends:3:1"],["Docs","av1:faces:10:4"],["Billing","av1:blobs:2:2"],["Research","av1:glass:5:0"],["Scout","av1:emoji:🦊:3"],["Old agent","intake"]];
const app = document.getElementById("app");
app.append(h("div", { css: { font: "600 13px system-ui", color: "var(--ink-3)" } }, "Who answers (the agent chip)"));
app.append(h("div", { css: { display: "flex", gap: "8px", flexWrap: "wrap" } }, ...A.map(([n, f]) => h("button.mp", {}, face({ name: n, face: f }, 18), h("span.ell", null, n)))));
app.append(h("div", { css: { font: "600 13px system-ui", color: "var(--ink-3)" } }, "Messages"));
for (const [n, f] of A.slice(0, 3)) app.append(h("div.msg", {}, face({ name: n, face: f }, 24), h("div", { css: { font: "13px system-ui" } }, h("b", null, n), h("div", null, "I found the three firms and drafted the comparison."))));
app.append(h("div", { css: { font: "600 13px system-ui", color: "var(--ink-3)" } }, "Recent chats, 20, 32 and 96 px"));
app.append(h("div", { css: { display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" } }, ...A.flatMap(([n, f]) => [20, 32].map((z) => face({ name: n, face: f }, z))), face({ name: "Docs", face: A[1][1] }, 96)));
document.title = "ready";
</script>`;
const { chromium } = createRequire(path.join(REPO, "package.json"))("playwright-core");
const browser = await chromium.launch({ args: ["--no-sandbox"] });
for (const [skin, scheme] of [["paper", "light"], ["graphite", "dark"]]) for (const [size, vp] of [["wide", { width: 1440, height: 900 }], ["phone", { width: 390, height: 844 }]]) {
  const ctx = await browser.newContext({ viewport: vp, colorScheme: scheme });
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(String(e)));
  await page.goto(`${origin}/page.html`);
  await page.waitForFunction(() => document.title === "ready", null, { timeout: 8000 }).catch(() => errs.push("page not ready"));
  await page.screenshot({ path: path.join(out, `chrome-faces-${skin}-${size}.png`) });
  console.log("shot", skin, size, errs.join(" | ").slice(0, 300));
  await ctx.close();
}
await browser.close(); srv.close();
process.exit(0);
