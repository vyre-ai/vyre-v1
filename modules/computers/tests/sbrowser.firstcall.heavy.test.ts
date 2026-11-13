// @heavy docker
// An agent's first page load and its screenshot of a heavy page, on a real Docker host and the real Space browser (13 Nov 2026, owner on rc.26: the agent's first page load "failed with
// internal.unexpected, which is retryable; the retry went through", and its screenshot "failed with validation.too_large"). The browser service starts on the first call (container, browserd, Chrome),
// so the first call must wait for it within its budget instead of failing; and a heavy page's picture must come back usable.
//
// Runs only with VYRE_HEAVY_DOCKER=1; without it every test is skipped with its reason. With VYRE_SPACE_BROWSER_IMAGE set to an image that is already built, the build is skipped.
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createDockerApi, unixSocketHttp } from "../../../sandbox/src/docker.ts";
import { createDockerSpaceBrowser } from "../sbrowser/docker.ts";
import { bindSpaceBrowser } from "../sbrowser/port.ts";
import { resetAgentInfo } from "../sbrowser/agentinfo.ts";
import { encodePng, SHOT_LIMIT_BYTES } from "../png-fit.ts";
import { DANA, harness } from "../fixtures/harness.ts";
import { tool as cap } from "./tools.fixture.ts";

const ON = process.env["VYRE_HEAVY_DOCKER"] === "1";
const skip: string | false = ON ? false : "needs VYRE_HEAVY_DOCKER=1 (the 20 s shard never builds or starts the Space browser)";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const PREBUILT = process.env["VYRE_SPACE_BROWSER_IMAGE"];
const IMAGE = PREBUILT ?? "vyre/space-browser:heavy-firstcall";
const suffix = `${process.pid}${Math.random().toString(36).slice(2, 6)}`;
const NAME = `vyre-sbrowser-fc${suffix}`;
const http = unixSocketHttp();
const api = createDockerApi(http);

function host(cmd: string, args: string[], timeoutMs: number): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    execFile(cmd, args, { cwd: ROOT, timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ code: err ? ((err as unknown as { code?: number }).code ?? 1) : 0, out: `${stdout}\n${stderr}` });
    });
  });
}

// ---- a heavy page, served from this process on the Docker bridge ---------------------------------------------------------------------------------

/** A picture that does not compress, so the page's own screenshot is large. */
function noisePng(seed: number): Buffer {
  const [w, h] = [600, 400];
  const data = new Uint8Array(w * h * 4);
  let a = seed;
  for (let i = 0; i < data.length; i += 4) { a = (Math.imul(a, 1664525) + 1013904223) >>> 0; data[i] = (a >>> 24) & 255; data[i + 1] = (a >>> 16) & 255; data[i + 2] = (a >>> 8) & 255; data[i + 3] = 255; }
  return Buffer.from(encodePng({ width: w, height: h, data }));
}
let site: Server;
let sitePort = 0;
let GATEWAY = "172.17.0.1";
function serve(req: IncomingMessage, res: ServerResponse): void {
  const url = new URL(req.url ?? "/", "http://x");
  if (url.pathname === "/noise.png") { res.writeHead(200, { "content-type": "image/png" }); res.end(noisePng(Number(url.searchParams.get("i") ?? 1) * 7919)); return; }
  if (url.pathname === "/heavy") {
    const imgs = Array.from({ length: 6 }, (_, i) => `<img src="/noise.png?i=${i + 1}" width=600 height=400 style="display:block;float:left">`).join("");
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(`<!doctype html><meta charset=utf-8><title>Heavy</title><body style="margin:0">${imgs}</body>`);
    return;
  }
  res.writeHead(404).end("no");
}
const listen = (s: Server): Promise<number> => new Promise((resolve) => s.listen(0, "0.0.0.0", () => resolve((s.address() as { port: number }).port)));
const siteUrl = (p: string): string => `http://${GATEWAY}:${sitePort}${p}`;

before(async () => {
  if (!ON) return;
  assert.equal(await api.ping(), true, "the Docker daemon answers");
  const gw = await host("docker", ["network", "inspect", "bridge", "--format", "{{(index .IPAM.Config 0).Gateway}}"], 20_000);
  if (gw.code === 0 && /^\d+\.\d+\.\d+\.\d+/.test(gw.out.trim())) GATEWAY = gw.out.trim().split("\n")[0]!;
  if (!PREBUILT) {
    // The runners have no buildx: Vyre for Chrome goes into a copy of the build context, which is images/ (the two folders side by side), with the bridge module as a real file.
    const ext = process.env["VYRE_CHROME_EXT_DIR"] ?? path.join(ROOT, "apps/chrome");
    const ctxDir = fs.mkdtempSync(path.join(os.tmpdir(), `sbrowser-ctx-${suffix}-`));
    fs.cpSync(path.join(ROOT, "images/agent-computer"), path.join(ctxDir, "agent-computer"), { recursive: true });
    fs.cpSync(path.join(ROOT, "images/space-browser"), path.join(ctxDir, "space-browser"), { recursive: true });
    const vendor = path.join(ctxDir, "space-browser/browserd/vendor/chrome-bridge.ts");
    fs.rmSync(vendor, { force: true });
    fs.copyFileSync(path.join(ROOT, "lib/chrome-bridge.ts"), vendor);
    fs.cpSync(ext, path.join(ctxDir, "agent-computer/vyre-chrome"), { recursive: true, filter: (s) => !/\/(tests|node_modules)(\/|$)/.test(s) });
    const built = await host("docker", ["build", "-f", path.join(ctxDir, "space-browser/Dockerfile"), "-t", IMAGE, ctxDir], 1_200_000);
    fs.rmSync(ctxDir, { recursive: true, force: true });
    assert.equal(built.code, 0, `building ${IMAGE} failed: ${built.out.slice(-1500)}`);
  }
  site = createServer(serve);
  sitePort = await listen(site);
});

after(async () => {
  if (!ON) return;
  await api.containerStop(NAME, 5).catch(() => undefined);
  await api.containerRemove(NAME).catch(() => undefined);
  await http({ method: "DELETE", path: `/volumes/${NAME}-data`, query: { force: "true" } }).catch(() => undefined);
  await http({ method: "DELETE", path: `/networks/${NAME}net` }).catch(() => undefined);
  site?.close();
  bindSpaceBrowser(null);
  resetAgentInfo();
});

const stored: number[] = [];
/** The agent's tool context: Files refuses a direct write over its limit, as the real one does. */
const agent = () => harness({
  principal: { kind: "agent", id: "agt_dex" }, actingFor: DANA,
  respond: { "files.create": (i: Record<string, unknown>) => {
    const bytes = Buffer.from(String((i["content"] as { base64: string }).base64), "base64").length;
    if (bytes > SHOT_LIMIT_BYTES) throw Object.assign(new Error("This file is over the size limit for a direct write."), { code: "validation.too_large" });
    stored.push(bytes);
    return { file: { fileId: `fil_shot${stored.length}` } };
  } },
}).ctx;

test("@heavy space browser: the agent's very first calls, together, on a browser that has never started, wait for it and succeed", { skip, timeout: 300_000 }, async () => {
  const sb = createDockerSpaceBrowser({ api, http, name: NAME, image: IMAGE, user: { uid: 10001, gid: 10001 }, startTimeoutMs: 90_000 });
  bindSpaceBrowser(sb);
  assert.equal(await api.containerRunning(NAME), false, "no container yet: this is a cold browser");
  const t0 = Date.now();
  // a model asks for several things at once: all of them reach a browser that is still starting
  const calls = await Promise.allSettled([
    cap["computers.chrome.open"]!(agent(), { url: siteUrl("/heavy") }),
    cap["computers.chrome.tabs"]!(agent(), { action: "list" }),
    cap["computers.chrome.state"]!(agent(), {}),
  ]);
  const said = calls.map((c) => (c.status === "fulfilled" ? "ok" : `${(c.reason as { code?: string }).code ?? "?"}: ${(c.reason as Error).message}`));
  assert.deepEqual(said, ["ok", "ok", "ok"], `every first call succeeded (${Date.now() - t0} ms)`);
  assert.equal((calls[0] as PromiseFulfilledResult<{ title: string }>).value.title, "Heavy");
});

test("@heavy space browser: the agent's screenshot of a heavy page is stored under the limit and says the size it got", { skip, timeout: 300_000 }, async () => {
  const raw = await bindSpaceBrowserOf().tool({ profileId: "agt_dex", tool: "chrome_screenshot", args: {}, timeoutMs: 60_000 });
  const rawBytes = Buffer.from(String((raw as { png: string }).png), "base64").length;
  assert.ok(rawBytes > SHOT_LIMIT_BYTES, `the page is heavy: Chrome's picture is ${rawBytes} bytes, over the ${SHOT_LIMIT_BYTES} limit`);
  const shot = await cap["computers.chrome.screenshot"]!(agent(), {});
  assert.ok(shot.fileId, "a file came back");
  assert.ok(stored[stored.length - 1]! <= SHOT_LIMIT_BYTES, `stored ${stored[stored.length - 1]} bytes`);
  assert.match(shot.note ?? "", /scaled to \d+ x \d+/, shot.note);
  assert.ok(shot.width > 100 && shot.width < 1280, `the size it got: ${shot.width} x ${shot.height}`);
});

/** The bound Space browser (the first test made it). */
function bindSpaceBrowserOf() {
  return createDockerSpaceBrowser({ api, http, name: NAME, image: IMAGE, user: { uid: 10001, gid: 10001 }, startTimeoutMs: 90_000 });
}
