// A Space that moves between Vyre's relay and an address of its own on the same name, seen from a browser that used it before the move (rc.41). The real app (the production export) and a
// real Space server are behind one address; in front of them stands what answers at that name: the relay (its real page script, relay/client/shell/boot.js, and the real worker it serves a
// returning app, relay/worker/phone.js RETIRING_APP_WORKER; the worker that carries requests is a stand-in that marks what it carries), or the Space server itself (the real route that retires
// the relay's worker, host/src/routes/relay-worker.ts). What a person sees:
//   1 on the relay, opened from the Space link: the Space's sign-in
//   2 the Space moves to its own address: the next load ends on the sign-in, served directly, with no relay worker and never a "cannot reach" line
//   3 the Space moves to the relay, in a browser that has no key for it: the relay's page takes the Space link in a box; a link for another Space is said to be that; with the right link
//     the sign-in opens through the relay
// Needs a Chromium (CHROME_BIN) and a web export (VYRE_APP_DIST); VYRE_REQUIRE_CHROME=1 makes a missing one a failure.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import type net from "node:net";
import { bootFreshSpace, edge } from "../apps/app/tests/real-app-harness.test.ts";
import { browserOrSkip } from "./support/mail-browser.ts";
import { createRelayWorkerRoute } from "../host/src/routes/relay-worker.ts";
import { RETIRING_APP_WORKER } from "../relay/worker/phone.js";
import { SHOTS, shoot } from "./getting-in-kit.test.ts";

/** The relay's worker, reduced to what matters here: it is in charge of the page and carries every request but the relay's own files, marked so the address in front can tell. A page it can no longer carry comes from whatever answers at the address (the real worker does the same: relay/client/shell/sw.js asleep). */
const CARRYING_WORKER = `
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", (e) => {
  const u = new URL(e.request.url);
  if (u.origin !== location.origin || u.pathname.startsWith("/__vyre/")) return;
  e.respondWith((async () => {
    const headers = new Headers(e.request.headers);
    headers.set("x-via-relay", "1");
    const body = e.request.method === "GET" || e.request.method === "HEAD" ? undefined : await e.request.arrayBuffer();
    const r = await fetch(u.pathname + u.search, { method: e.request.method, headers, body, cache: "no-store" });
    if (r.status === 503 && e.request.mode === "navigate") return fetch(e.request.url, { cache: "no-store" });
    return r;
  })());
});`;
// secret-scan: fake
const SPACE_KEY = "k".repeat(43);

test("a Space that moves between the relay and its own address is found where it is, from a browser that used it before", async (t) => {
  const env = await browserOrSkip();
  if (typeof env === "string") {
    t.skip(env);
    return;
  }
  const space = await bootFreshSpace(undefined, true);
  const web = await edge(env.dist, space.url);
  const inner = new URL(web.origin);
  let mode: "relay" | "own" = "relay";
  const retire = createRelayWorkerRoute();
  const shellFile = (name: string): string =>
    fs.readFileSync(new URL(`../relay/client/shell/${name}`, import.meta.url), "utf8");
  const carried: string[] = [];
  const front = http.createServer((req, res) => {
    const p = (req.url ?? "/").split("?")[0]!;
    const via = req.headers["x-via-relay"] === "1";
    const pass = (): void => {
      const up = http.request(
        { host: inner.hostname, port: inner.port, path: req.url, method: req.method, headers: req.headers },
        (r) => {
          res.writeHead(r.statusCode ?? 502, r.headers);
          r.pipe(res);
        },
      );
      up.on("error", () => {
        res.writeHead(502);
        res.end();
      });
      req.pipe(up);
    };
    const send = (status: number, type: string, body: string, more: Record<string, string> = {}): void => {
      res.writeHead(status, { "content-type": type, "cache-control": "no-store", ...more });
      res.end(body);
    };
    if (mode === "own") {
      // the name is the Space server's: its own answer for the relay's worker address, and a channel through the relay that no longer reaches it
      if (retire.handle(req, res)) return;
      if (via && p.startsWith("/v1/")) {
        carried.push(p);
        send(503, "application/json", JSON.stringify({ error: "Fresh Co is asleep" }));
        return;
      }
      pass();
      return;
    }
    if (p === "/__vyre/sw.js") return send(200, "text/javascript", CARRYING_WORKER, { "service-worker-allowed": "/" });
    if (p === "/__vyre/info.json")
      return send(
        200,
        "application/json",
        JSON.stringify({
          name: "northwind",
          label: "Fresh Co",
          route: "r1",
          relay: "wss://relay.vyre.run",
          online: true,
        }),
      );
    if (p === "/__vyre/boot.js" || p === "/__vyre/pins.js") return send(200, "text/javascript", shellFile(p.slice(8)));
    if (p === "/sw.js") return send(200, "text/javascript", RETIRING_APP_WORKER, { "service-worker-allowed": "/" });
    if (via) return pass();
    if (req.method === "GET" && (req.headers.accept ?? "").includes("text/html"))
      return send(
        200,
        "text/html; charset=utf-8",
        `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Fresh Co</title><style>html{color-scheme:light dark}body{margin:0;min-height:100vh;display:grid;place-items:center;font:16px/1.5 system-ui,sans-serif;background:Canvas;color:CanvasText}main{max-width:26rem;padding:2rem 1.25rem;text-align:center}h1{font-size:1.25rem;margin:0 0 .5rem}p{margin:.25rem 0;opacity:.75}</style><body><main id="m"><h1>Fresh Co</h1><p id="s">Opening</p></main><script type="module" src="/__vyre/boot.js"></script></body></html>`,
      );
    send(404, "text/plain", "");
  });
  await new Promise<void>((r) => front.listen(0, "127.0.0.1", r));
  const origin = `http://127.0.0.1:${(front.address() as net.AddressInfo).port}`;
  const browser = await env.chromium.launch({ executablePath: env.exe, args: ["--no-sandbox"] });
  const worker = (page: import("playwright-core").Page): Promise<string> =>
    page.evaluate(() => {
      const c = navigator.serviceWorker.controller;
      return c ? new URL(c.scriptURL).pathname : "";
    });
  try {
    await t.test(
      "1 on the relay, opened from the Space link: the Space's sign-in, carried by the relay's worker",
      async (t1) => {
        const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
        const page = await ctx.newPage();
        await page.goto(`${origin}/#box=${SPACE_KEY}`);
        await page.getByTestId("si-user").waitFor({ timeout: 30_000 });
        assert.equal(await worker(page), "/__vyre/sw.js");
        // the Space's name arrives with its sign-in options: the screen is up first (the route table ships in the app), so wait for the name rather than read the title at once
        await page
          .getByTestId("step-sign-in")
          .getByText(/Sign in to Fresh Co/)
          .waitFor({ timeout: 15_000 });

        // a test inside this one runs on this one's own context: on the outer one it would queue behind this test, which is waiting for it (the walk ran into its 120 s cap)
        await t1.test(
          "2 the Space moves to its own address: the next load ends on the sign-in, direct, with no relay worker",
          async () => {
            mode = "own";
            const seen: string[] = [];
            page.on("framenavigated", () => {
              void page
                .getByText(/cannot reach this Space|is not answering/)
                .count()
                .then((n) => {
                  if (n > 0) seen.push("a dead-end line showed");
                })
                .catch(() => undefined);
            });
            const t0 = Date.now();
            await page.reload();
            await page.waitForFunction(
              async () =>
                !/\/__vyre\/sw\.js$/.test(navigator.serviceWorker.controller?.scriptURL ?? "") &&
                !(await navigator.serviceWorker.getRegistrations()).some((r) =>
                  /\/__vyre\/sw\.js$/.test((r.active ?? r.waiting ?? r.installing)?.scriptURL ?? ""),
                ) &&
                !!document.querySelector('[data-testid="si-user"]'),
              null,
              { timeout: 30_000 },
            );
            console.log(`getting-in: moved to its own address, sign-in ready ${Date.now() - t0} ms after the load`);
            assert.equal(await page.getByTestId("step-not-answering").count(), 0);
            assert.deepEqual(seen, [], "the person never saw a line saying the Space could not be reached");
            // the stale app worker retires itself and moves the page once: let that finish before the second visit, or the reload below is cut off by it (net::ERR_ABORTED)
            await page.waitForFunction(
              async () => (await navigator.serviceWorker.getRegistrations()).length === 0,
              null,
              {
                timeout: 20_000,
              },
            );
            const before = carried.length;
            await page.reload();
            await page.getByTestId("si-user").waitFor({ timeout: 30_000 });
            assert.equal(carried.length, before, "nothing goes through the relay's worker any more");
            await shoot(page, "30-moved-to-own-address");
          },
        );
        await ctx.close();
      },
    );

    await t.test(
      "3 the Space moves to the relay, in a browser with no key for it: the relay's page takes the Space link",
      async () => {
        mode = "own";
        const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
        const page = await ctx.newPage();
        await page.goto(`${origin}/`);
        await page.getByTestId("si-user").waitFor({ timeout: 30_000 });
        // the app's own worker is in charge of this browser's pages, as it is for anyone who used the Space at its own address
        await page.waitForFunction(
          async () => (await navigator.serviceWorker.getRegistrations()).some((r) => !!r.active),
          null,
          { timeout: 30_000 },
        );
        mode = "relay";
        await page.reload();
        // the relay's first-time page is what the person sees; the app's old worker may still be in charge of the page (the browser asks for its replacement on its own schedule, up to a day), and the page
        // removes it when the Space link is used, so the walk waits for what a person waits for: the box
        await page.locator("#k").waitFor({ timeout: 15_000 });
        assert.equal(await page.locator("#s").innerText(), "Open this Space from its link");
        await page.setViewportSize({ width: 1440, height: 900 });
        await page.emulateMedia({ colorScheme: "dark" });
        fs.mkdirSync(SHOTS, { recursive: true });
        await page.screenshot({ path: `${SHOTS}/31-relay-first-time-desktop-dark.png` });
        await page.setViewportSize({ width: 390, height: 844 });
        await page.emulateMedia({ colorScheme: "light" });
        await page.screenshot({ path: `${SHOTS}/31-relay-first-time-phone-light.png` });
        await page.setViewportSize({ width: 1440, height: 900 });
        await page.locator("#k").fill(`https://lakeside.vyre.run/#box=${SPACE_KEY}`);
        await page.getByRole("button", { name: "Continue" }).click();
        assert.equal(await page.locator("#s").innerText(), "That link is for a different Space.");
        await page.locator("#k").fill(`${origin}/chat`);
        await page.getByRole("button", { name: "Continue" }).click();
        assert.match(await page.locator("#s").innerText(), /has no key for this Space/);
        await page.locator("#k").fill(`${origin}/#box=${SPACE_KEY}`);
        await page.getByRole("button", { name: "Continue" }).click();
        await page.getByTestId("si-user").waitFor({ timeout: 30_000 });
        assert.equal(await worker(page), "/__vyre/sw.js", "the Space is reached through the relay now");
        // the Space's name arrives with its sign-in options: the screen is up first (the route table ships in the app), so wait for the name rather than read the title at once
        await page
          .getByTestId("step-sign-in")
          .getByText(/Sign in to Fresh Co/)
          .waitFor({ timeout: 15_000 });
        await shoot(page, "32-moved-to-relay");
        await ctx.close();
      },
    );
  } finally {
    await browser.close();
    front.close();
    web.close();
    await space.stop();
  }
});
