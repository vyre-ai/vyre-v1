// Agent control against a real Chrome (V1-SPEC 3.12): the same chrome_* tools as ext-agent.test.ts, but the page is a real page, the protocol is Chrome's own (a DevTools session
// stands in for chrome.debugger), and the frame, bar and named cursor are drawn by the real overlay code and photographed. Screenshots go to VYRE_SHOT_DIR (default: the temp
// directory) for the proof links. Skipped where no Chromium is installed (the desktop-less lanes); the screenshot job installs one.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { createAgentControl } from "../src/agent/index.js";
import { createDecoder, encode } from "../src/worker/framing.js";
import { runHost } from "../src/worker/native/host.js";
import { HOST_NAME } from "../src/worker/protocol.js";
import { createChromeBridge } from "../../../lib/chrome-bridge.ts";

const OUT = process.env["VYRE_SHOT_DIR"] ?? path.join(os.tmpdir(), "vyre-chrome-agent-shots");
const SECRET = "hunter2-Pa55";

async function findChrome() {
  let pw: any;
  try { pw = await import("playwright-core"); } catch { return null; }
  const chromium = pw.chromium ?? pw.default?.chromium;
  if (!chromium) return null;
  const candidates = [process.env["CHROME_BIN"], (() => { try { return chromium.executablePath(); } catch { return undefined; } })(), "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"];
  const exe = candidates.find((c) => c && fs.existsSync(c));
  return exe ? { chromium, exe } : null;
}
const found = await findChrome();

const STYLE = `<style>body{font:16px system-ui,sans-serif;margin:0;background:#f6f5f2;color:#1c1b1a}main{max-width:560px;margin:56px auto;padding:0 28px}h1{font-size:28px;margin:0 0 20px}
form,label,p{display:block;margin:0 0 14px}input,select{font:inherit;padding:7px 9px;margin-left:8px;border:1px solid #b9b6af;border-radius:6px;background:#fff;color:inherit}
button{font:inherit;padding:8px 16px;border-radius:8px;border:0;background:#2f5d50;color:#fff;margin-right:8px}a{color:#2f5d50}
@media (prefers-color-scheme:dark){body{background:#17171a;color:#eceae6}input,select{background:#232327;border-color:#44444a}button{background:#7fb5a3;color:#101012}a{color:#7fb5a3}}</style>`;

function pageHtml(path: string) {
  if (path === "/pricing") return `<!doctype html><meta charset="utf-8"><title>Acme pricing</title>${STYLE}<main><h1>Plans and pricing</h1><p>Free and Pro.</p><p><a href="/">Back</a></p></main>`;
  if (path === "/dashboard") return `<!doctype html><meta charset="utf-8"><title>Acme dashboard</title>${STYLE}<main><h1>Signed in</h1></main>`;
  return `<!doctype html><meta charset="utf-8"><title>Acme Portal</title>${STYLE}<main><h1>Acme Portal</h1>
<form id="login" method="post" action="/login"><label>Email <input name="email" type="email"></label><label>Password <input name="password" type="password"></label><button type="submit">Sign in</button></form>
<p><a href="/pricing">Pricing</a></p>
<label><input type="checkbox" id="remember"> Remember me</label>
<label>Plan <select id="plan"><option>Free</option><option>Pro</option></select></label>
<form id="contact" method="post" action="/contact"><label>Message <input name="message"></label><button type="submit">Send message</button></form>
<button id="pay" type="button" onclick="fetch('/pay',{method:'POST'})">Pay now</button></main>`;
}

function serve() {
  const counts = { contacts: 0, pays: 0, logins: 0 };
  const server = http.createServer((req, res) => {
    const u = new URL(req.url ?? "/", "http://x");
    if (u.pathname === "/api/items") { res.writeHead(200, { "content-type": "application/json", "set-cookie": "sid=abc123; Path=/" }); res.end(JSON.stringify({ items: [{ id: 1 }], api_key: "sk_live_999", name: "Acme" })); return; }
    if (u.pathname === "/api/echo") { const chunks: Buffer[] = []; req.on("data", (c) => chunks.push(c)); req.on("end", () => { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ got: JSON.parse(Buffer.concat(chunks).toString() || "{}"), token: "t0k" })); }); return; }
    if (u.pathname === "/pay") { counts.pays++; res.writeHead(204); res.end(); return; }
    if (u.pathname === "/contact" && req.method === "POST") { counts.contacts++; req.resume(); res.writeHead(200, { "content-type": "text/html" }); res.end(pageHtml("/dashboard")); return; }
    if (u.pathname === "/login" && req.method === "POST") { counts.logins++; req.resume(); res.writeHead(200, { "content-type": "text/html" }); res.end(pageHtml("/dashboard")); return; }
    res.writeHead(200, { "content-type": "text/html" });
    res.end(pageHtml(u.pathname));
  });
  return new Promise<{ url: string; counts: typeof counts; close: () => Promise<void> }>((resolve) => server.listen(0, "127.0.0.1", () => resolve({ url: `http://127.0.0.1:${(server.address() as { port: number }).port}`, counts, close: () => new Promise<void>((r) => server.close(() => r())) })));
}

const EVENTS = ["Page.frameStartedLoading", "Page.loadEventFired", "Network.requestWillBeSent", "Network.responseReceived", "Network.loadingFinished", "Network.loadingFailed", "Runtime.consoleAPICalled", "Runtime.exceptionThrown"];

/** A browser the extension code believes is Chrome with the debugger permission: one real tab, a DevTools session standing in for chrome.debugger, scripting run in the page. */
async function rig(browser: any, colorScheme: "light" | "dark", opts: { idleMs?: number } = {}) {
  const context = await browser.newContext({ viewport: { width: 1100, height: 720 }, deviceScaleFactor: 2, colorScheme });
  const regs = new Map<number, { page: any; cdp: any; port: any }>();
  const listeners: any[] = [];
  const connectListeners: any[] = [];
  const sentEvents: any[] = [];
  const results: any[] = [];
  let nextId = 1;
  let fillCalls = 0;

  async function register(page: any) {
    const id = nextId++;
    const cdp = await context.newCDPSession(page);
    for (const ev of EVENTS) cdp.on(ev, (p: any) => { for (const l of listeners) l({ tabId: id }, ev, p); });
    regs.set(id, { page, cdp, port: null });
    return id;
  }
  await context.addInitScript(() => {
    (window as any).chrome = { runtime: { connect: () => ({ postMessage: (m: unknown) => { void (window as any).__vyreOverlay(JSON.stringify(m)); }, disconnect: () => {} }) } };
  });
  await context.exposeBinding("__vyreOverlay", (source: any, json: string) => {
    const entry = [...regs.entries()].find(([, r]) => r.page === source.page);
    if (!entry) return;
    const [tabId, r] = entry;
    if (!r.port) {
      const handlers: any[] = [];
      r.port = { name: "vyre.agent.overlay", sender: { id: "ext", tab: { id: tabId } }, onMessage: { addListener: (f: any) => handlers.push(f) }, handlers };
      for (const f of connectListeners) f(r.port);
    }
    for (const h of r.port.handlers) h(JSON.parse(json));
  });

  const page = await context.newPage();
  const tabId = await register(page);
  let active = tabId;

  const ext: any = {
    runtime: { id: "ext", onConnect: { addListener: (f: any) => connectListeners.push(f) } },
    storage: { local: { async get() { return {}; }, async set() {}, async remove() {} } },
    debugger: {
      attach: async () => {}, detach: async () => {},
      sendCommand: async ({ tabId: t }: any, method: string, params: any) => regs.get(t)!.cdp.send(method, params ?? {}),
      onEvent: { addListener: (f: any) => listeners.push(f) },
      onDetach: { addListener: () => {} },
    },
    action: { setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {}, setTitle: async () => {} },
    scripting: {
      executeScript: async ({ target, func, args }: any) => {
        const r = regs.get(target.tabId);
        if (!r) throw new Error("no tab");
        const result = await r.page.evaluate(`(${func.toString()})(...${JSON.stringify(args ?? [])})`);
        return [{ frameId: 0, result }];
      },
    },
    tabs: {
      get: async (id: number) => { const r = regs.get(id); if (!r) throw new Error("No tab with id: " + id); return { id, url: r.page.url(), title: await r.page.title(), status: "complete", active: id === active }; },
      query: async () => { const r = regs.get(active)!; return [{ id: active, url: r.page.url(), title: await r.page.title(), status: "complete", active: true }]; },
      create: async () => { const p = await context.newPage(); const id = await register(p); return { id, url: "about:blank" }; },
      remove: async (id: number) => { const r = regs.get(id); regs.delete(id); await r?.page.close(); },
      onRemoved: { addListener: () => {} },
    },
  };
  const transport = {
    online: true, connect() {}, close() {},
    tell(op: string, input: any) { if (op === "agent.event") sentEvents.push(input); else results.push({ op, ...input }); },
    async call(_type: string, name: string, input: any) {
      assert.equal(name, "vault.fill");
      fillCalls++;
      setTimeout(() => { void control.onIncoming({ type: "fill", ref: input.target.ref, value: SECRET }); }, 5);
      return { filled: true };
    },
  };
  const control = createAgentControl(ext, { transport: transport as any, activeSpace: async () => "spc_a", settleMs: 120, idleMs: opts.idleMs ?? 60_000 });
  await control.onIncoming({ type: "agent.optin", spaces: ["spc_a"], mode: "computer" });
  const agent = { id: "agt_intake", name: "Intake" };
  const call = (tool: string, input: any = {}) => control.run({ tool, input, agent, space: "spc_a" });
  const overlayState = () => page.evaluate(() => {
    const s = (globalThis as any)[Symbol.for("vyre.agent.overlay")];
    return s ? { shown: s.host.isConnected, text: s.text.textContent, goal: s.goal.textContent, paused: s.paused, stop: s.stop.style.display !== "none", cursor: s.cursor.style.display === "block" ? s.cursor.style.transform : null, chip: s.chip.textContent } : null;
  });
  return { context, page, ext, control, call, overlayState, sentEvents, results, fillCalls: () => fillCalls, tabId, cdp: () => regs.get(tabId)!.cdp, close: () => context.close() };
}

/** The ref of the control a tree line names, e.g. refOf(tree, 'button "Sign in"'). */
function refOf(tree: string, what: string) {
  const line = tree.split("\n").find((l) => l.includes(what));
  assert.ok(line, `${what} is in the tree:\n${tree}`);
  return /\[ref=(e\d+)\]/.exec(line!)![1]!;
}

// With VYRE_REQUIRE_CHROME=1 (the CI job that proves the real-Chrome path) a missing Chromium fails here instead of skipping the three tests below, so a green run means they ran.
const mustRun = process.env["VYRE_REQUIRE_CHROME"] === "1";
test("Chromium is available when this run must drive a real Chrome", { skip: !mustRun && "VYRE_REQUIRE_CHROME is not 1" }, () => {
  assert.ok(found, "VYRE_REQUIRE_CHROME=1 but no Chromium was found (set CHROME_BIN or install playwright's chromium)");
});

test("the chrome_* tools drive a real page: read, press, type, hold, send, mask", { skip: !found && !mustRun && "no Chromium on this machine" }, async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const srv = await serve();
  const browser = await found!.chromium.launch({ executablePath: found!.exe, args: ["--no-sandbox", "--disable-gpu"] });
  const r = await rig(browser, "light");
  try {
    await r.page.goto(`${srv.url}/`);
    const snap = await r.call("chrome_snapshot");
    assert.equal(snap.title, "Acme Portal");
    for (const line of ['textbox "Email"', 'textbox "Password"', 'button "Sign in"', 'link "Pricing"', 'checkbox "Remember me"', 'combobox "Plan"', 'textbox "Message"', 'button "Send message"', 'button "Pay now"']) assert.ok(snap.tree.includes(line), `${line} in:\n${snap.tree}`);
    assert.match(snap.tree, /heading "Acme Portal" \(h1\)/);
    assert.match(snap.tree, /link "Pricing" \[ref=e\d+\] -> http:\/\/127\.0\.0\.1:\d+\/pricing/);
    assert.match(snap.tree, /checkbox "Remember me" \[ref=e\d+\] \(unchecked\)/);
    assert.match(snap.tree, /combobox "Plan" \[ref=e\d+\] value="Free"/);
    assert.match(snap.tree, /button "Sign in" \[ref=e\d+\] \(submits a form\)/);

    // the frame is on the tab while the agent drives
    const o = await r.overlayState();
    assert.deepEqual([o!.shown, o!.text, o!.paused, o!.stop, o!.chip], [true, "Intake is using this tab", false, true, "Intake"]);

    // type, check, select: real events on real inputs
    const email = refOf(snap.tree, 'textbox "Email"');
    assert.equal((await r.call("chrome_type", { ref: email, text: "dana@acme.test" })).ok, true);
    assert.equal(await r.page.inputValue("#login input[name=email]"), "dana@acme.test");
    assert.equal((await r.call("chrome_act", { ref: refOf(snap.tree, 'checkbox "Remember me"'), action: "check" })).ok, true);
    assert.equal(await r.page.isChecked("#remember"), true);
    assert.equal((await r.call("chrome_act", { ref: refOf(snap.tree, 'combobox "Plan"'), action: "select", value: "Pro" })).ok, true);
    assert.equal(await r.page.inputValue("#plan"), "Pro");
    const cursor = (await r.overlayState())!.cursor;
    assert.ok(cursor && /translate\(/.test(cursor), "the named cursor moved to the control it pressed");

    // a literal password is refused; a Vault handle fills it and the value never reaches the agent
    const pw = refOf(snap.tree, 'textbox "Password"');
    await assert.rejects(r.call("chrome_type", { ref: pw, text: "my-password" }), (e: any) => e.code === "secret_field");
    const filled = await r.call("chrome_type", { ref: pw, text: "#Acme.password" });
    assert.equal(filled.ok, true);
    assert.equal(r.fillCalls(), 1);
    assert.equal(await r.page.inputValue("#login input[type=password]"), SECRET, "the page has the value");
    const after = await r.call("chrome_snapshot");
    assert.match(after.tree, /textbox "Password" \[ref=e\d+\]( \(focused\))? value=•+ \(12 characters\)/);
    assert.doesNotMatch(JSON.stringify([after, snap, r.sentEvents]), new RegExp(SECRET));
    const shot = await r.call("chrome_screenshot", { ref: pw });
    const box = await r.page.locator("#login input[type=password]").boundingBox();
    const scroll = await r.page.evaluate(() => [window.scrollX, window.scrollY]);
    const plain = await r.cdp().send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true, clip: { x: box.x + scroll[0], y: box.y + scroll[1], width: Math.round(box.width), height: Math.round(box.height), scale: 1 } });
    assert.ok(shot.image.startsWith("iVBOR"), "a PNG");
    assert.notEqual(shot.image, plain.data, "the secret field was blurred in the agent's screenshot");
    assert.equal(await r.page.evaluate(() => getComputedStyle(document.querySelector("#login input[type=password]")!).filter), "none", "and restored afterwards");
    const whole = await r.call("chrome_screenshot", { fullPage: true });
    assert.ok(whole.width >= 1100 && whole.height >= 400);

    // a send and a payment are held until chrome_send
    const send = refOf(after.tree, 'button "Send message"');
    const held = await r.call("chrome_act", { ref: send, action: "click" });
    assert.equal(held.ok, false);
    assert.match(held.heldId, /^hld_/);
    const pay = refOf(after.tree, 'button "Pay now"');
    const heldPay = await r.call("chrome_act", { ref: pay, action: "click" });
    assert.ok(heldPay.heldId);
    await new Promise((res) => setTimeout(res, 150));
    assert.deepEqual([srv.counts.contacts, srv.counts.pays], [0, 0], "nothing was sent");
    assert.deepEqual((await r.call("chrome_status")).held.sort(), [held.heldId, heldPay.heldId].sort());
    const sent = await r.call("chrome_send", { heldId: held.heldId });
    assert.equal(sent.sent, true);
    // chrome_send returns when the click is made; the form POST can still be in flight, so wait for it to arrive, then see that no second one follows
    for (let waited = 0; srv.counts.contacts < 1 && waited < 3000; waited += 50) await new Promise((res) => setTimeout(res, 50));
    assert.equal(srv.counts.contacts, 1, "sent exactly once");
    await new Promise((res) => setTimeout(res, 500));
    assert.equal(srv.counts.contacts, 1, "and no second send follows");
    await assert.rejects(r.call("chrome_send", { heldId: held.heldId }), (e: any) => e.code === "held_gone");
    assert.equal(srv.counts.contacts, 1);

    // a link navigates and the new page comes back with fresh refs
    await r.page.goto(`${srv.url}/`);
    const again = await r.call("chrome_snapshot");
    const nav = await r.call("chrome_act", { ref: refOf(again.tree, 'link "Pricing"'), action: "click" });
    assert.equal(nav.ok, true);
    assert.match(nav.snapshot, /link "Back"/);
    assert.ok(r.page.url().endsWith("/pricing"));
    assert.equal((await r.call("chrome_state")).title, "Acme pricing");
    assert.equal((await r.call("chrome_wait", { until: "text", value: "Plans and pricing" })).ok, true);
    assert.equal((await r.call("chrome_wait", { until: "selector", value: "main h1" })).ok, true);
    assert.equal((await r.call("chrome_wait", { until: "text", value: "never on this page", timeoutMs: 400 })).ok, false);

    // net, console, sources, api, eval: read from the page, masked
    await r.call("chrome_act", { ref: refOf((await r.call("chrome_snapshot")).tree, 'link "Back"'), action: "click" });
    await r.page.evaluate(() => { console.log("hello from the page"); return fetch("/api/items?token=abc&page=1").then((x) => x.text()); });
    await new Promise((res) => setTimeout(res, 200));
    const net = await r.call("chrome_net", { filter: "api/items", bodies: true });
    assert.ok(net.requests.length >= 1);
    assert.match(net.requests[0].url, /\/api\/items\?token=•+&page=1$/);
    assert.equal(net.requests[0].status, 200);
    assert.doesNotMatch(net.requests[0].body, /sk_live_999/);
    assert.match(net.requests[0].body, /"api_key":"•+"/);
    const con = await r.call("chrome_console");
    assert.ok(con.messages.some((m: any) => m.text === "hello from the page"));
    const src = await r.call("chrome_sources");
    assert.ok(src.endpoints.some((e: any) => e.url.endsWith("/api/items")));
    const api = await r.call("chrome_api", { method: "GET", url: "/api/items" });
    assert.equal(api.status, 200);
    assert.deepEqual(api.body, { items: [{ id: 1 }], api_key: "••••", name: "Acme" });
    const post = await r.call("chrome_api", { method: "POST", url: `${srv.url}/api/echo`, body: { hello: "world" } });
    assert.deepEqual(post.body, { got: { hello: "world" }, token: "••••" });
    await assert.rejects(r.call("chrome_api", { method: "GET", url: "https://example.com/" }), (e: any) => e.code === "cross_origin");
    assert.equal((await r.call("chrome_eval", { expression: "document.title" })).result, "Acme Portal");
    await assert.rejects(r.call("chrome_open", { url: `${srv.url}/` }), (e: any) => e.code === "not_public", "the box's own addresses are not for agents");

    // a batch stops where a hold stops it
    const b = await r.call("chrome_snapshot");
    const batch = await r.call("chrome_batch", { steps: [{ tool: "chrome_act", args: { ref: refOf(b.tree, 'checkbox "Remember me"'), action: "uncheck" } }, { tool: "chrome_act", args: { ref: refOf(b.tree, 'button "Sign in"'), action: "click" } }] });
    assert.equal(batch.results.length, 2, "Sign in is a benign submit: both steps ran");
    assert.equal(srv.counts.logins, 1);
  } finally { await r.close(); await browser.close(); await srv.close(); }
});

test("the frame, the bar and the named cursor, in a light and a dark page, then Stop, Esc and idle", { skip: !found && !mustRun && "no Chromium on this machine" }, async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const srv = await serve();
  const browser = await found!.chromium.launch({ executablePath: found!.exe, args: ["--no-sandbox", "--disable-gpu"] });
  try {
    for (const scheme of ["light", "dark"] as const) {
      const r = await rig(browser, scheme);
      try {
        await r.page.goto(`${srv.url}/`);
        assert.equal(await r.overlayState(), null, "no frame before an agent acts");
        await r.call("chrome_plan", { goal: "Sign in to the portal" });
        const snap = await r.call("chrome_snapshot");
        await r.call("chrome_type", { ref: refOf(snap.tree, 'textbox "Email"'), text: "dana@acme.test" });
        await r.call("chrome_act", { ref: refOf(snap.tree, 'button "Sign in"'), action: "hover" });
        const s = await r.overlayState();
        assert.deepEqual([s!.text, s!.goal, s!.stop], ["Intake is using this tab", "Sign in to the portal", true]);
        await r.page.screenshot({ path: path.join(OUT, `agent-frame-${scheme}.png`) });

        // Esc pauses with a dashed frame and no Stop button
        await r.page.keyboard.press("Escape");
        await new Promise((res) => setTimeout(res, 200));
        const p = await r.overlayState();
        assert.deepEqual([p!.paused, p!.text, p!.stop], [true, "Intake is paused", false]);
        await r.page.screenshot({ path: path.join(OUT, `agent-frame-paused-${scheme}.png`) });
        await assert.rejects(r.call("chrome_snapshot"), (e: any) => e.code === "paused");
        await r.call("chrome_resume");
        assert.equal(await r.overlayState(), null, "answered: the frame is gone");

        // Stop, from the bar itself
        await r.call("chrome_snapshot");
        await r.page.evaluate(() => (globalThis as any)[Symbol.for("vyre.agent.overlay")].stop.click());
        await new Promise((res) => setTimeout(res, 200));
        assert.equal(await r.overlayState(), null, "Stop gave the tab back");
        assert.ok(r.sentEvents.some((e: any) => e.event === "stopped" && e.by === "person" && e.agent === "agt_intake"), "and it was logged under the agent");
        await assert.rejects(r.call("chrome_snapshot"), (e: any) => e.code === "paused");
        assert.equal((await r.call("chrome_status")).paused, true);
      } finally { await r.close(); }
    }

    // idle: the frame goes by itself
    const idle = await rig(browser, "light", { idleMs: 400 });
    try {
      await idle.page.goto(`${srv.url}/`);
      await idle.call("chrome_snapshot");
      assert.ok(await idle.overlayState());
      await new Promise((res) => setTimeout(res, 900));
      assert.equal(await idle.overlayState(), null, "idle: the frame is gone");
      assert.ok(idle.sentEvents.some((e: any) => e.event === "driving" && e.on === false && e.why === "idle"));
      await idle.call("chrome_snapshot");
      assert.ok(await idle.overlayState(), "the next call brings it back");
    } finally { await idle.close(); }
  } finally { await browser.close(); await srv.close(); }
});

test("one chrome_* tool call goes from the daemon bridge through the native host and the extension's own transport into a real Chrome page, and the page's answer comes back", { skip: !found && !mustRun && "no Chromium on this machine" }, async () => {
  const srv = await serve();
  const browser = await found!.chromium.launch({ executablePath: found!.exe, args: ["--no-sandbox", "--disable-gpu"] });
  const r = await rig(browser, "light");
  // the daemon's bridge on loopback (the booted daemon serves the same one: host/tests/chrome-bridge.live.test.ts)
  const bridge = createChromeBridge({ token: "tok-real" });
  const daemon = http.createServer((req, res) => { if (!bridge.handle(req, res)) { res.writeHead(404); res.end(); } });
  await new Promise<void>((res) => daemon.listen(0, "127.0.0.1", () => res()));
  // the real native host between Chrome (framed stdio) and the daemon; the extension's transport talks to it through connectNative
  const stdin = new PassThrough();
  const decoder = createDecoder();
  const onMessage: ((m: unknown) => void)[] = [];
  const stdout = { write: (b: Buffer) => { for (const f of decoder.push(b)) for (const h of onMessage) h(f); return true; } };
  const hostDone = runHost({ stdin, stdout, daemon: { url: `http://127.0.0.1:${(daemon.address() as { port: number }).port}`, token: "tok-real" } });
  r.ext.runtime.connectNative = (name: string) => {
    assert.equal(name, HOST_NAME);
    return { postMessage: (m: unknown) => { stdin.write(encode(m)); }, disconnect: () => {}, onMessage: { addListener: (f: (m: unknown) => void) => onMessage.push(f) }, onDisconnect: { addListener: () => {} } };
  };
  const control = createAgentControl(r.ext, { activeSpace: async () => "spc_a", settleMs: 120 });
  const wait = async (f: () => boolean) => { for (let i = 0; i < 300 && !f(); i++) await new Promise((x) => setTimeout(x, 20)); assert.ok(f(), "condition reached"); };
  try {
    await r.page.goto(`${srv.url}/`);
    control.connect();
    await wait(() => bridge.connected === 1);
    bridge.optIn(["spc_a"], "computer");
    await wait(() => control.optedIn.includes("spc_a"));
    const snap = (await bridge.callTool({ tool: "chrome_snapshot", agent: { id: "agt_intake", name: "Intake" }, space: "spc_a" })) as { ok: boolean; title: string; tree: string };
    assert.equal(snap.title, "Acme Portal", "the real page's title came back through the whole chain");
    assert.match(snap.tree, /button "Sign in"/);
    await assert.rejects(bridge.callTool({ tool: "chrome_act", input: { ref: "e999", action: "click" }, agent: { id: "agt_intake", name: "Intake" }, space: "spc_a" }), (e: any) => e.code === "unknown_ref", "a failure comes back with the extension's own code");
    await assert.rejects(bridge.callTool({ tool: "chrome_snapshot", agent: { id: "agt_other", name: "Other" }, space: "spc_b" }), (e: any) => e.code === "wrong_space");
  } finally {
    stdin.end();
    await hostDone;
    bridge.failAll();
    bridge.closeStreams();
    await new Promise<void>((res) => daemon.close(() => res()));
    await r.close();
    await browser.close();
    await srv.close();
  }
});
