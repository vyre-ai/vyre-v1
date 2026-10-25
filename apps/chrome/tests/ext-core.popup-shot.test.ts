// The popup and the save card in a real Chrome (headless), both skins: the logins for a site, the right-click menu, the no-app state and
// the save-a-login card. Clicks, right-clicks, hovers and keys are driven for real. Screenshots go to VYRE_SHOT_DIR (default: the temp
// directory) for the proof links. Skipped where no Chromium is installed (the desktop-less lanes); the screenshot job installs one.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = process.env["VYRE_SHOT_DIR"] ?? path.join(os.tmpdir(), "vyre-chrome-shots");

async function findChrome(): Promise<{ chromium: any; exe: string } | null> {
  let pw: any;
  try { pw = await import("playwright-core"); } catch { return null; }
  const chromium = pw.chromium ?? pw.default?.chromium;
  if (!chromium) return null;
  const candidates = [process.env["CHROME_BIN"], (() => { try { return chromium.executablePath(); } catch { return undefined; } })(), "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"];
  const exe = candidates.find((c) => c && fs.existsSync(c));
  return exe ? { chromium, exe } : null;
}

const found = await findChrome();

function serve(): Promise<{ url: string; close: () => Promise<void> }> {
  const types: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png" };
  const server = http.createServer((req, res) => {
    const u = new URL(req.url ?? "/", "http://x");
    if (u.pathname === "/page.html") {
      res.writeHead(200, { "content-type": "text/html" });
      res.end(`<!doctype html><meta charset="utf-8"><title>Acme sign in</title><body style="font:16px system-ui;margin:40px"><h1>Acme Portal</h1><form id="f" onsubmit="return false"><p><input id="u" type="email" name="email" autocomplete="username" placeholder="Email"></p><p><input id="p" type="password" name="password" placeholder="Password"></p><button type="submit">Sign in</button></form>`);
      return;
    }
    const rel = u.pathname.startsWith("/content/") ? path.join("src/content", u.pathname.slice(9)) : path.join("src/popup", u.pathname === "/" ? "popup.html" : u.pathname.slice(1));
    const file = path.resolve(ROOT, rel);
    if (!file.startsWith(ROOT) || !fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": types[path.extname(file)] ?? "application/octet-stream" });
    res.end(fs.readFileSync(file));
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ url: `http://127.0.0.1:${(server.address() as { port: number }).port}`, close: () => new Promise((r) => server.close(() => r())) })));
}

const stubScript = (state: unknown) => `
  window.__sent = [];
  window.__state = ${JSON.stringify(state)};
  window.chrome = { runtime: { id: "ext", sendMessage(msg, cb) {
    window.__sent.push(msg);
    let r = { data: {} };
    if (msg.type === "popup.state") r = { data: window.__state };
    else if (msg.type === "popup.agents") r = { data: { agents: [{ id: "agt_intake", name: "Intake" }, { id: "agt_scout", name: "Scout" }], suggested: { id: "agt_intake", name: "Intake" } } };
    else if (msg.type === "popup.fill") r = { data: { filled: ["username", "password"], signedIn: !!msg.signIn } };
    if (cb) setTimeout(() => cb(r), 0);
  } } };
  window.close = () => { window.__closed = true; };
`;

const online = {
  page: { host: "login.acme.test", origin: "https://login.acme.test", secure: true },
  spaces: [{ id: "a", name: "Acme Law", webUrl: "https://acme.vyre.run" }, { id: "p", name: "Personal", webUrl: "http://localhost:8420" }],
  active: "a", status: "online", blocked: null, error: null,
  rows: [
    { id: "v1", name: "Acme Portal", kind: "login", fieldKeys: ["username", "password", "totp"], hasUsername: true, usernameField: "username" },
    { id: "v2", name: "Acme Billing", kind: "login", fieldKeys: ["username", "password"], hasUsername: true, usernameField: "username" },
    { id: "v3", name: "Acme Authenticator", kind: "totp", fieldKeys: ["totp"], hasUsername: false, usernameField: "" },
  ],
};
const noApp = { ...online, status: "no_host", rows: [], error: { code: "no_host", message: "Vyre is not installed on this computer. Open your Space in the web app instead." } };

test("the popup and the save card in a real Chrome, paper and graphite", { skip: !found && "no Chromium on this machine" }, async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const srv = await serve();
  const browser = await found!.chromium.launch({ executablePath: found!.exe, args: ["--no-sandbox", "--disable-gpu"] });
  try {
    for (const skin of ["paper", "graphite"]) {
      const ctx = await browser.newContext({ viewport: { width: 320, height: 380 }, deviceScaleFactor: 2, colorScheme: skin === "paper" ? "light" : "dark" });
      const page = await ctx.newPage();
      await page.addInitScript(stubScript(online));
      await page.goto(`${srv.url}/popup.html?skin=${skin}`);
      await page.waitForSelector("#logins .row");

      // the list: names only, the first row selected and focused
      const names = await page.$$eval("#logins .row .name", (els: Element[]) => els.map((e) => e.textContent));
      assert.deepEqual(names, ["Acme Portal", "Acme Billing", "Acme Authenticator"]);
      assert.equal(await page.textContent("#space-name"), "Acme Law");
      assert.equal(await page.textContent("#site"), "login.acme.test");
      assert.equal(await page.getAttribute("#logins .row:nth-child(1)", "aria-selected"), "true");
      await page.screenshot({ path: path.join(OUT, `popup-logins-${skin}.png`), fullPage: true });

      // hover moves the quiet highlight; arrows move it; wrap at the end
      await page.hover("#logins .row:nth-child(2)");
      assert.equal(await page.getAttribute("#logins .row:nth-child(2)", "aria-selected"), "true");
      await page.keyboard.press("ArrowDown");
      await page.keyboard.press("ArrowDown");
      assert.equal(await page.getAttribute("#logins .row:nth-child(1)", "aria-selected"), "true", "wraps to the first row");

      // right-click: Fill, Fill and Sign In, Fill Code, Open in Vault, Never Fill on This Site
      await page.click("#logins .row:nth-child(1)", { button: "right" });
      await page.waitForSelector("#menu:not([hidden]) button");
      const items = await page.$$eval("#menu button span", (els: Element[]) => els.map((e) => e.textContent));
      assert.deepEqual(items, ["Fill", "Fill and Sign In", "Fill Code", "Open in Vault", "Never Fill on This Site"]);
      await page.screenshot({ path: path.join(OUT, `popup-menu-${skin}.png`), fullPage: true });
      await page.keyboard.press("Escape");
      assert.equal(await page.evaluate(() => (document.getElementById("menu") as HTMLElement).hidden), true, "Escape closes the menu, not the popup");
      assert.equal(await page.evaluate(() => (window as any).__closed ?? false), false);

      // Enter fills: the row reads Filled, then the popup closes
      await page.keyboard.press("Enter");
      await page.waitForFunction(() => (document.querySelector("#logins .row .trail") as HTMLElement).textContent === "Filled");
      const sent = await page.evaluate(() => (window as any).__sent.filter((m: any) => m.type === "popup.fill"));
      assert.deepEqual(sent, [{ type: "popup.fill", itemId: "v1", kind: "login", signIn: false, usernameField: "username" }]);
      await page.waitForFunction(() => (window as any).__closed === true);

      // slash jumps to Ask
      await page.evaluate(() => { (window as any).__closed = false; (document.activeElement as HTMLElement)?.blur(); });
      await page.keyboard.press("/");
      assert.equal(await page.evaluate(() => document.activeElement?.id), "q");
      await ctx.close();

      // no app: words, a way forward, nothing to fill
      const c2 = await browser.newContext({ viewport: { width: 320, height: 300 }, deviceScaleFactor: 2, colorScheme: skin === "paper" ? "light" : "dark" });
      const p2 = await c2.newPage();
      await p2.addInitScript(stubScript(noApp));
      await p2.goto(`${srv.url}/popup.html?skin=${skin}`);
      await p2.waitForSelector("#note:not([hidden])");
      assert.match(await p2.textContent("#note") ?? "", /not installed/);
      assert.equal(await p2.textContent("#note button"), "Open the web app");
      assert.equal(await p2.$("#web"), null, "one link, not two");
      await p2.screenshot({ path: path.join(OUT, `popup-no-app-${skin}.png`), fullPage: true });
      await c2.close();

      // the save card on a page, drawn by the real content scripts
      const c3 = await browser.newContext({ viewport: { width: 520, height: 420 }, deviceScaleFactor: 2, colorScheme: skin === "paper" ? "light" : "dark" });
      const p3 = await c3.newPage();
      await p3.addInitScript(`window.__sent = []; window.chrome = { runtime: { sendMessage(m) { window.__sent.push(m); } } };`);
      await p3.goto(`${srv.url}/page.html`);
      for (const f of ["finder", "autofill", "capture", "prompt"]) await p3.addScriptTag({ url: `${srv.url}/content/${f}.js` });
      await p3.fill("#u", "dana@acme.test");
      await p3.fill("#p", "Tr0ub4dor&3-sentinel");
      await p3.click("button[type=submit]");
      await p3.waitForFunction(() => (window as any).__sent.length > 0);
      const submitted = await p3.evaluate(() => (window as any).__sent[0]);
      assert.deepEqual(submitted, { type: "vyre.submit", username: "dana@acme.test", password: "Tr0ub4dor&3-sentinel", kind: "signin" });
      await p3.evaluate(() => (window as any).__vyreExt.prompt.show({ host: "login.acme.test", username: "dana@acme.test", password: "Tr0ub4dor&3-sentinel", mode: "save", name: "Acme Portal", agent: { id: "agt_intake", name: "Intake" } }));
      await p3.screenshot({ path: path.join(OUT, `save-card-${skin}.png`), fullPage: true });
      // the page cannot reach into the closed shadow root
      assert.equal(await p3.evaluate(() => document.documentElement.innerHTML.includes("Save this login")), false, "the card's text is not in the page's own DOM");
      assert.equal(await p3.evaluate(() => [...document.querySelectorAll("*")].some((e) => (e as any).shadowRoot)), false, "closed root: not reachable from the page");
      await c3.close();
    }
  } finally {
    await browser.close();
    await srv.close();
  }
});

// Final run on the last commit of P-L10_05: this file reports its own ok line.
