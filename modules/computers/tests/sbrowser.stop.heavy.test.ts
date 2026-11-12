// @heavy docker
// Lead, 12 Nov: a stop never loses a sign-in made before the stop began. With 20 and then 30 browsers open, each given a cookie in the last 2 s, the container is stopped the way an update replaces it
// (the adapter's stop, 10 s) and the way `vyre-server stop` does (docker stop -t 10); the time it took and how many cookies came back are printed as METRIC lines, and every one must come back.
// (Setup shared with the scale test:) The Space browser at scale (owner, 12 Nov: "It needs to work on more than 30 workspaces too pretty smoothly without doing anything extra"), on a real Docker host with real Chromium, through the module's own
// path (the chrome_* capabilities, the host's memory budget, the make-room rule). 30 agent profiles on one host whose budget holds 12 browsers at once: 12 browse at the same moment, then waves of new ones, so
// the least recently used quiet browsers are closed to make room; every step must answer, none may fail for lack of room while a quiet browser exists, and a closed profile reopens with its sign-in.
// Then 20 open and idle for a minute: what browserd, the browsers and the module cost when nothing happens. The numbers are printed as METRIC lines for the owner.
// Runs only with VYRE_HEAVY_DOCKER=1; it builds the image unless VYRE_SPACE_BROWSER_IMAGE names one that is there.
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import type { Server } from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createDockerApi, unixSocketHttp } from "../../../sandbox/src/docker.ts";
import { createDockerSpaceBrowser } from "../sbrowser/docker.ts";
import { bindSpaceBrowser } from "../sbrowser/port.ts";

const ON = process.env["VYRE_HEAVY_DOCKER"] === "1";
const skip: string | false = ON ? false : "needs VYRE_HEAVY_DOCKER=1 (real Docker and Chromium)";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const IMAGE = process.env["VYRE_SPACE_BROWSER_IMAGE"] ?? "vyre/space-browser:scale";
const NAME = `vyre-sbrowser-st${process.pid}${Math.random().toString(36).slice(2, 6)}`;
const http = unixSocketHttp();
const api = createDockerApi(http);
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const BUDGET = 12;
const MB = 1024 * 1024;

function host(cmd: string, args: string[], timeoutMs: number): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => { execFile(cmd, args, { cwd: ROOT, timeout: timeoutMs, maxBuffer: 64 * MB }, (err, stdout, stderr) => resolve({ code: err ? 1 : 0, out: `${stdout}\n${stderr}` })); });
}
const json = async (p: string): Promise<Record<string, unknown>> => JSON.parse(new TextDecoder().decode((await http({ method: "GET", path: p })).body)) as Record<string, unknown>;

let site: Server;
let base = "";
before(async () => {
  if (!ON) return;
  if (!(await api.imageExists(IMAGE))) {
    const ctxDir = fs.mkdtempSync(path.join(os.tmpdir(), "sbrowser-scale-"));
    fs.cpSync(path.join(ROOT, "images/agent-computer"), path.join(ctxDir, "agent-computer"), { recursive: true });
    fs.cpSync(path.join(ROOT, "images/space-browser"), path.join(ctxDir, "space-browser"), { recursive: true });
    const vendor = path.join(ctxDir, "space-browser/browserd/vendor/chrome-bridge.ts");
    fs.rmSync(vendor, { force: true }); fs.copyFileSync(path.join(ROOT, "lib/chrome-bridge.ts"), vendor);
    fs.cpSync(process.env["VYRE_CHROME_EXT_DIR"] ?? path.join(ROOT, "apps/chrome"), path.join(ctxDir, "agent-computer/vyre-chrome"), { recursive: true, filter: (s) => !/\/(tests|node_modules)(\/|$)/.test(s) });
    const built = await host("docker", ["build", "-f", path.join(ctxDir, "space-browser/Dockerfile"), "-t", IMAGE, ctxDir], 1_200_000);
    fs.rmSync(ctxDir, { recursive: true, force: true });
    assert.equal(built.code, 0, built.out.slice(-1500));
  }
  // the service's own network, made beforehand with a subnet outside Docker's shared pools (the adapter finds it)
  for (let i = 0; i < 20; i++) {
    const third = Math.floor(Math.random() * 250) + 1;
    const r = await http({ method: "POST", path: "/networks/create", json: { Name: `${NAME}net`, Driver: "bridge", CheckDuplicate: true, Labels: { "vyre.sbrowser": "1" }, IPAM: { Config: [{ Subnet: `10.216.${third}.0/24`, Gateway: `10.216.${third}.1` }] } } });
    if (r.status === 201 || r.status === 409) { base = `http://10.216.${third}.1`; break; }
  }
  assert.ok(base, "the test network was made");
  site = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    const headers: Record<string, string | string[]> = { "content-type": "text/html; charset=utf-8" };
    if (url.pathname === "/set") headers["set-cookie"] = [`sid=${url.searchParams.get("name") ?? ""}; Path=/; Max-Age=3600`];
    res.writeHead(200, headers);
    res.end(`<!doctype html><title>site</title><p id=out>${url.pathname === "/set" ? `set ${url.searchParams.get("name") ?? ""}` : `cookie:[${req.headers.cookie ?? ""}]`}</p>`);
  });
  await new Promise<void>((r) => site.listen(0, "0.0.0.0", () => r()));
  base = `${base}:${(site.address() as { port: number }).port}`;
});

after(async () => {
  if (!ON || process.env["VYRE_SCALE_KEEP"] === "1") return;
  bindSpaceBrowser(null);
  await api.containerStop(NAME, 5).catch(() => undefined);
  await api.containerRemove(NAME).catch(() => undefined);
  await http({ method: "DELETE", path: `/volumes/${NAME}-data`, query: { force: "true" } }).catch(() => undefined);
  await http({ method: "DELETE", path: `/networks/${NAME}net` }).catch(() => undefined);
  site?.close();
});


const tool = async (sb: ReturnType<typeof createDockerSpaceBrowser>, profileId: string, name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> =>
  (await sb.tool({ profileId, tool: name, args, timeoutMs: 120_000 })) as Record<string, unknown>;

for (const n of [20, 30]) {
  for (const how of ["update", "vyre-server stop"] as const) {
    test(`@heavy ${n} browsers open, each signed in within the last 2 s: a stop the way ${how === "update" ? "an update replaces the container" : "vyre-server stop does"} keeps every sign-in`, { skip, timeout: 1_200_000 }, async () => {
      const sb = createDockerSpaceBrowser({ api, http, name: NAME, image: IMAGE, user: { uid: 10001, gid: 10001 }, startTimeoutMs: 120_000, idleMinutes: 60, log: () => undefined });
      const tag = `${n}${how === "update" ? "u" : "s"}`;
      const ids = Array.from({ length: n }, (_, i) => `agt_${tag}${String(i).padStart(2, "0")}`);
      // every browser open first, then all signed in at once, then the stop at once
      for (let k = 0; k < ids.length; k += 6) await Promise.all(ids.slice(k, k + 6).map((id) => tool(sb, id, "chrome_open", { url: `${base}/whoami` })));
      assert.equal((await sb.profiles()).profiles.filter((p) => p.running).length, n, "all open");
      const t0 = Date.now();
      await Promise.all(ids.map((id) => tool(sb, id, "chrome_open", { url: `${base}/set?name=${id}` })));
      const signedIn = Date.now() - t0;
      const s0 = performance.now();
      if (how === "update") await api.containerStop(NAME, 10);
      else assert.equal((await host("docker", ["stop", "-t", "10", NAME], 60_000)).code, 0);
      const stopMs = Math.round(performance.now() - s0);
      const logs = await host("docker", ["logs", "--tail", "50", NAME], 30_000);
      const closed = /every browser closed in (\d+) ms/.exec(logs.out)?.[1];
      const hard = /still closing after/.test(logs.out);
      // back up, and every profile asked what it holds
      let kept = 0;
      const lost: string[] = [];
      for (let k = 0; k < ids.length; k += 6) {
        await Promise.all(ids.slice(k, k + 6).map(async (id) => {
          await tool(sb, id, "chrome_open", { url: `${base}/whoami` });
          const text = String((await tool(sb, id, "chrome_eval", { expression: "document.body.innerText" }))["result"]);
          if (text === `cookie:[sid=${id}]`) kept += 1; else lost.push(`${id}: ${text}`);
        }));
        for (const id of ids.slice(k, k + 6)) await sb.stop(id).catch(() => undefined);
      }
      console.log(`METRIC sbrowser-stop ${n} open, ${how}: stop took ${stopMs} ms (browserd closed every browser in ${closed ?? "?"} ms${hard ? ", HIT THE 8 s HARD EXIT" : ""}); cookies set in the last ${signedIn} ms before it: ${kept} of ${n} came back`);
      assert.equal(hard, false, "the stop never ran out of time");
      assert.deepEqual(lost, [], "every sign-in made before the stop came back");
    });
  }
}
