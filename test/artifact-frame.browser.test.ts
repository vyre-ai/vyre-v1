// The artifact viewer's frame in a real browser engine: the app's page frames the artifact host's /x/<code>?embed=1, the code is traded for the host's cookie inside the frame, and the artifact loads.
// Chromium and WebKit (the Mac app's engine) both run it against a booted daemon whose artifact host is a.localhost:<port>. Topology: a front server on one port is the Space's address (it serves the
// framing page itself and passes everything else to the daemon with the Host header kept), so the app is http://127.0.0.1:<port> and the artifact host is a.localhost:<port>, cross-site to it.
// VYRE_REQUIRE_BROWSERS names the engines a CI job must have ("webkit", "chromium", a comma list, or "1"); a required engine that is missing is a failure, never a skip.
// If WebKit refuses the cookie in the frame (its third-party cookie rules), this test fails on the macOS runner: the signal to open the artifact in a top-level webview instead.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import { createRequire } from "node:module";
import { boot, seededDir } from "./memory-live-kit.ts";
import { ok, standIn } from "./member-key-kit.ts";
import { loadConfig } from "../host/src/daemon/config.ts";

const need = createRequire(import.meta.url);
const WANT = (process.env["VYRE_REQUIRE_BROWSERS"] ?? "").split(",").map((x) => x.trim()).filter(Boolean);
const required = (engine: string): boolean => WANT.includes("1") || WANT.includes(engine);
let pw: typeof import("playwright-core") | null = null;
try { pw = need("playwright-core"); } catch { /* skipped below */ }

for (const engine of ["chromium", "webkit"] as const) {
  test(`${engine}: the app frames the artifact host; the one-time code becomes the host's cookie inside the frame and the page loads`, { timeout: 180_000, skip: !required(engine) && pw === null ? "playwright-core is not installed" : false }, async (t) => {
    assert.ok(pw !== null, "playwright-core is installed");
    let browser;
    try { browser = await pw![engine].launch(); } catch (e) { if (required(engine)) throw e; t.skip(`${engine} is not installed`); return; }
    const dir = seededDir();
    let target = 0;
    let frameHtml = "";
    const front = http.createServer((q, r) => {
      if (q.url === "/__frame") { r.writeHead(200, { "content-type": "text/html" }); r.end(frameHtml); return; }
      const up = http.request({ host: "127.0.0.1", port: target, method: q.method, path: q.url, headers: q.headers }, (res) => { r.writeHead(res.statusCode ?? 502, res.headers); res.pipe(r); });
      up.on("error", () => { r.writeHead(502); r.end(); });
      q.pipe(up);
    });
    await new Promise<void>((resolve) => front.listen(0, "127.0.0.1", resolve));
    const port = (front.address() as { port: number }).port;
    const d = await boot(dir, standIn, undefined, { config: loadConfig(["--data-dir", dir, "--port", "0", "--address", `http://127.0.0.1:${port}`], {}, "1.2.3") } as never);
    target = d.port;
    try {
      const made = await ok(d, d.token, "sites.artifact_publish", { title: "Frame test", html: "<!doctype html><title>frame</title><p id=hi>framed page</p>", idempotencyKey: "fr-1" });
      const open = await ok(d, d.token, "sites.artifact_open", { artifactId: made.artifactId as string, idempotencyKey: "fr-open" });
      assert.equal(open.url.replace(/[0-9a-f]{48}$/, "CODE"), `http://a.localhost:${port}/x/CODE`);
      frameHtml = `<!doctype html><body style="margin:0"><iframe id="v" title="viewer" sandbox="allow-scripts allow-forms allow-popups allow-downloads" src="${open.url}?embed=1" style="width:600px;height:300px;border:0"></iframe>`;
      const page = await browser.newPage();
      const net: string[] = [];
      page.on("requestfailed", (r) => net.push(`${r.url()} ${r.failure()?.errorText}`));
      await page.goto(`http://127.0.0.1:${port}/__frame`);
      const frame = await page.waitForSelector("#v").then((h) => h.contentFrame());
      assert.ok(frame, "the viewer frame exists");
      await frame!.waitForSelector("#hi", { timeout: 15_000 }).catch(async (e: Error) => { throw new Error(`${e.message}; frame url ${frame!.url()}; failed ${net.join(" | ")}; cookies ${JSON.stringify(await page.context().cookies())}`); });
      assert.equal(await frame!.textContent("#hi"), "framed page", "the artifact loaded in the frame");
    } finally { await browser.close(); front.close(); await d.stop(); fs.rmSync(dir, { recursive: true, force: true }); }
  });
}
