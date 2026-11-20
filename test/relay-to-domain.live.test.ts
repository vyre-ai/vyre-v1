// A Space reached through the relay (<name>.vyre.run, whose phone shell registers a worker at /__vyre/sw.js, scope /) and then moved to its own domain on the same name. The browser that opened it
// through the relay keeps the old worker, which keeps carrying its requests to the relay. In a real Chromium: the origin is the relay (the stand-in worker registers and controls the page), then the
// origin becomes a direct Space server (the real route for /__vyre/sw.js, the real boot script of the app); the browser's next load must end with the page served directly and no relay worker.
// Needs a Chromium (CHROME_BIN); VYRE_REQUIRE_CHROME=1 makes a missing one a failure.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import { createRelayWorkerRoute } from "../host/src/routes/relay-worker.ts";
import { bootScript } from "../apps/app/src/startup/boot.ts";

/** What the relay's phone shell registers, reduced to what matters here: it controls the page and carries every request but its own files to "the relay" (marked with a header). */
const RELAY_WORKER = `
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", (e) => {
  const u = new URL(e.request.url);
  if (u.pathname.startsWith("/__vyre/")) return;
  e.respondWith(fetch(u.pathname + u.search, { headers: { "x-via-relay": "1" }, cache: "no-store" }));
});`;

test("a name that moved from the relay to its own server ends up served directly, with no relay worker left", async (t) => {
  const exe = process.env["CHROME_BIN"] || "";
  const pw = await import("playwright-core");
  const chromium = pw.chromium ?? (pw as unknown as { default: typeof pw }).default.chromium;
  const path = exe || chromium.executablePath();
  if (!fs.existsSync(path)) {
    if (process.env["VYRE_REQUIRE_CHROME"] === "1") assert.fail(`no Chromium at ${path}`);
    t.skip("no Chromium on this machine");
    return;
  }
  let mode: "relay" | "direct" = "relay";
  const seen: { url: string; viaRelay: boolean }[] = [];
  const direct = createRelayWorkerRoute();
  const page = `<!doctype html><meta charset="utf-8"><title>Space</title><body><p id="m">${"{{M}}"}</p><script>${bootScript()}</script><script>addEventListener("load",()=>setTimeout(()=>dispatchEvent(new Event("vyre:usable")),0))</script></body>`;
  const relayShell = `<!doctype html><meta charset="utf-8"><body><script>navigator.serviceWorker.register("/__vyre/sw.js",{scope:"/"}).then(()=>navigator.serviceWorker.ready).then(()=>{document.title="ready"})</script>`;
  const server = http.createServer((req, res) => {
    const p = (req.url ?? "/").split("?")[0]!;
    seen.push({ url: p, viaRelay: req.headers["x-via-relay"] === "1" });
    if (mode === "direct" && direct.handle(req, res)) return;
    if (mode === "relay" && p === "/__vyre/sw.js") {
      res.writeHead(200, {
        "content-type": "text/javascript",
        "service-worker-allowed": "/",
        "cache-control": "no-cache",
      });
      res.end(RELAY_WORKER);
      return;
    }
    if (mode === "relay" && p === "/__vyre/info.json") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ name: "northwind" }));
      return;
    }
    if (p === "/" || p === "/index.html") {
      res.writeHead(200, { "content-type": "text/html", "cache-control": "no-store" });
      res.end(mode === "relay" && !req.headers["x-via-relay"] ? relayShell : page.replace("{{M}}", mode));
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const browser = await chromium.launch({ executablePath: path, args: ["--no-sandbox"] });
  try {
    const ctx = await browser.newContext();
    const tab = await ctx.newPage();
    // the person opened the Space through the relay: the worker is registered and controls the page
    await tab.goto(`${origin}/`);
    await tab.waitForFunction(() => document.title === "ready", null, { timeout: 15000 });
    await tab.reload();
    await tab.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 15000 });
    assert.match(await tab.evaluate(() => navigator.serviceWorker.controller!.scriptURL), /\/__vyre\/sw\.js$/);

    // the name moves to the box: the same origin now answers as a direct Space server
    mode = "direct";
    seen.length = 0;
    await tab.goto(`${origin}/`);
    // the old worker may still carry this first load; the page's boot retires it and reloads once
    await tab.waitForFunction(
      async () => {
        const rs = await navigator.serviceWorker.getRegistrations();
        return rs.length === 0 && !navigator.serviceWorker.controller;
      },
      null,
      { timeout: 20000 },
    );
    await tab.reload();
    await tab.waitForLoadState("load");
    assert.equal(await tab.textContent("#m"), "direct");
    assert.equal(await tab.evaluate(() => !!navigator.serviceWorker.controller), false, "no worker controls the page");
    seen.length = 0;
    await tab.reload();
    await tab.waitForLoadState("load");
    assert.deepEqual(
      seen.filter((s) => s.viaRelay),
      [],
      "nothing reaches the server through the relay's worker any more",
    );
    // a second browser start (a new tab on the same profile) is direct too
    const second = await ctx.newPage();
    seen.length = 0;
    await second.goto(`${origin}/`);
    assert.equal(await second.evaluate(() => !!navigator.serviceWorker.controller), false);
    assert.equal(
      seen.some((s) => s.viaRelay),
      false,
    );
  } finally {
    await browser.close();
    server.close();
  }
});
