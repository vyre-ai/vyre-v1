// The public path end to end in a real browser, with a hostile page: Chromium, an HTTP front, the relay Worker (on the fake Workers runtime), the real relay box on its control socket, the daemon's public route and the real form page.
// The app and /p/ share an origin. What must hold: a page under /p/ has an opaque origin, reads none of the app's storage, sends no session to anything, and a Vyre form still submits.
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import { createRequire } from "node:module";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import worker, * as W from "../relay/worker/index.js";
import { createRuntime } from "../relay/worker/fake-cf.js";
import { forgetUnclaimed } from "../relay/worker/phone.js";
import { startRelayBox } from "../host/src/seams/relay.ts";
import { createPublicPathRoute } from "../host/src/routes/public-path.ts";
import { createFormsPageRoute } from "../host/src/routes/forms-page.ts";

const HOSTILE = `<!doctype html><title>page</title><script>
(async () => {
  const out = { origin: self.origin };
  const tryIt = async (k, f) => { try { out[k] = await f(); } catch (e) { out[k] = "blocked:" + e.name; } };
  await tryIt("ls", () => localStorage.getItem("vyre_secret"));
  await tryIt("cookie", () => document.cookie);
  await tryIt("idb", () => new Promise((ok, no) => { const r = indexedDB.open("vyre"); r.onerror = () => no(r.error); r.onsuccess = () => ok("open"); }));
  await tryIt("sw", async () => { await navigator.serviceWorker.register("/p/forms/hostile"); return "registered"; });
  await tryIt("info", async () => (await (await fetch("/__vyre/info.json", { credentials: "include" })).text()));
  await tryIt("api", async () => (await fetch("/v1/identity.whoami", { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: "{}" })).status);
  await tryIt("post", async () => (await fetch("/p/forms/hostile?op=submit", { method: "POST", credentials: "include", headers: { "content-type": "application/json", authorization: "Bearer stolen" }, body: "{}" })).status);
  await tryIt("escape", async () => (await fetch("/p/..%2f..%2fv1/identity.whoami", { credentials: "include" })).status);
  document.documentElement.dataset.out = JSON.stringify(out);
})();
</script>`;

test("a hostile page under /p/ reads nothing of the app and acts as nobody; a real form still submits", async (t) => {
  forgetUnclaimed();
  const rt = createRuntime({
    worker, Class: W.RouteRelay, classes: { TICKETS: W.PairTicket, CODES: W.CodeSlot, SIGNIN: W.SigninSlot, HOSTS: W.HostSlot },
    env: {
      NAMES_FETCH: async (u: string) => new Response(JSON.stringify({ data: { name: new URL(u).searchParams.get("name"), status: "ok" } }), { status: 200 }),
      DOH_FETCH: async () => new Response(JSON.stringify({ Status: 0 }), { status: 200 }),
      ASSETS: { fetch: async () => new Response("asset") },
    },
  } as never) as any;
  // the daemon's side: the public route, the real form page, and a log of every request that reached the gateway
  const reached: { url: string; cookie?: string | undefined; authorization?: string | undefined }[] = [];
  const submitted: unknown[] = [];
  const view = { slug: "quote", kind: "public", name: "Quote", captcha: false, fields: [{ field: "name", hidden: false, step: 0, title: "Your name", type: "text", required: true }] };
  const forms = createFormsPageRoute({
    read: async (slug) => (slug === "quote" ? view : null) as never,
    call: async (cap, input) => { submitted.push({ cap, input }); return { recordId: "rec_1" }; },
  } as never);
  const inner = { handle(req: http.IncomingMessage, res: http.ServerResponse): boolean {
    if (req.url === "/f/hostile") { res.writeHead(200, { "content-type": "text/html" }); res.end(HOSTILE); return true; }
    return forms.handle(req, res);
  } };
  const route = createPublicPathRoute({ forms: () => inner, origin: () => "https://harbor.vyre.run" });
  const gateway = http.createServer((req, res) => {
    reached.push({ url: req.url ?? "", cookie: req.headers.cookie, authorization: req.headers.authorization });
    if (!route.handle(req, res)) { res.writeHead(599); res.end("the app's own routes, which a visitor must never reach"); }
  });
  await new Promise<void>((r) => gateway.listen(0, "127.0.0.1", r));
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-p-"));
  const box = startRelayBox({ relayUrl: "http://relay.test", dataDir, localPort: () => (gateway.address() as AddressInfo).port, onState: () => {}, WebSocket: rt.WebSocket });
  await box.ready;
  assert.equal((await box.host.claim("harbor", "Harbor")).status, "claimed");
  // the browser's side: this address stands for https://harbor.vyre.run
  const front = http.createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string" && k !== "host" && k !== "connection") headers.set(k, v);
    const r = await worker.fetch(new Request(`https://harbor.vyre.run${req.url}`, { method: req.method ?? "GET", headers, ...(chunks.length ? { body: Buffer.concat(chunks) } : {}) }), rt.env);
    const out: Record<string, string> = {};
    r.headers.forEach((v: string, k: string) => { out[k] = v; });
    res.writeHead(r.status, out);
    res.end(Buffer.from(await r.arrayBuffer()));
  });
  await new Promise<void>((r) => front.listen(0, "127.0.0.1", r));
  const port = (front.address() as AddressInfo).port;
  const req = createRequire(path.join(process.cwd(), "package.json"));
  const { chromium } = req("playwright-core") as { chromium: { launch(o: unknown): Promise<any> } };
  const browser = await chromium.launch({ args: ["--no-sandbox", `--host-resolver-rules=MAP harbor.vyre.run 127.0.0.1:${port}`] });
  t.after(async () => { await browser.close(); box.stop(); front.closeAllConnections(); front.close(); gateway.closeAllConnections(); gateway.close(); fs.rmSync(dataDir, { recursive: true, force: true }); await rt.settle(); });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const app = "http://harbor.vyre.run";
  // the app: a signed-in person's storage and cookie on this origin
  await page.goto(`${app}/__vyre/info.json`);
  await page.evaluate(() => { localStorage.setItem("vyre_secret", "s3cret"); document.cookie = "vyre_session=live; path=/"; });
  // the hostile page, opened in the same browser
  await page.goto(`${app}/p/forms/hostile`);
  await page.waitForFunction(() => document.documentElement.dataset.out, undefined, { timeout: 15_000 });
  const out = JSON.parse(await page.evaluate(() => document.documentElement.dataset.out as string)) as Record<string, unknown>;
  process.stdout.write(`hostile page saw: ${JSON.stringify(out)}\n`);
  assert.equal(out.origin, "null", "an opaque origin");
  assert.match(String(out.ls), /^blocked:/);
  assert.match(String(out.cookie), /^blocked:/);
  assert.match(String(out.idb), /^blocked:/);
  assert.match(String(out.sw), /^blocked:/);
  assert.match(String(out.info), /^blocked:/, "the app's own files are cross-origin to it");
  assert.match(String(out.api), /^blocked:/, "and the app's API");
  assert.ok(!JSON.stringify(out).includes("s3cret") && !JSON.stringify(out).includes("live"));
  for (const r of reached) {
    assert.equal(r.cookie, undefined, `no cookie on ${r.url}`);
    assert.equal(r.authorization, undefined, `no authorization on ${r.url}`);
    assert.ok(r.url.startsWith("/p/"), `only the public path reached the gateway: ${r.url}`);
  }
  // back at the app, its storage is as it was
  await page.goto(`${app}/__vyre/info.json`);
  assert.equal(await page.evaluate(() => localStorage.getItem("vyre_secret")), "s3cret");
  // a real form: its page, in the same sandbox, posts to its own address and thanks the visitor
  await page.goto(`${app}/p/forms/quote`);
  await page.fill("input", "Ada");
  await page.click("button[type=submit]");
  await page.waitForFunction(() => { const t = document.getElementById("vf-thanks"); return t && !t.hidden; }, undefined, { timeout: 15_000 });
  assert.equal(submitted.length, 1);
  assert.deepEqual((submitted[0] as { cap: string }).cap, "forms.submit");
  assert.deepEqual((submitted[0] as { input: { answers: unknown } }).input.answers, { name: "Ada" });
});
