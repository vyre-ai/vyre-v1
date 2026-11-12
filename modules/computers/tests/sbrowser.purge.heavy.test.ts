// @heavy docker
// Fifth look, 12 Nov: two Spaces on one Docker engine share the Space browser's container and volume. `--uninstall --purge` of one install (the installer's own purge_browser, run here as it is in
// the installer) removes only that Space's agent profiles; the other Space's agent stays signed in. Purging the second, with nothing else left on the volume and no other install, removes the
// container, the volume and the network. Both installers carry the same function (scripts/install/purge-browser.test.ts holds them together).
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
const NAME = `vyre-sbrowser-pg${process.pid}${Math.random().toString(36).slice(2, 6)}`;
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
    const r = await http({ method: "POST", path: "/networks/create", json: { Name: `${NAME}net`, Driver: "bridge", CheckDuplicate: true, Labels: { "vyre.sbrowser": "1" }, IPAM: { Config: [{ Subnet: `10.217.${third}.0/24`, Gateway: `10.217.${third}.1` }] } } });
    if (r.status === 201 || r.status === 409) { base = `http://10.217.${third}.1`; break; }
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


const tool = async (sb: ReturnType<typeof createDockerSpaceBrowser>, profileId: string, space: string, name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> =>
  (await sb.tool({ profileId, tool: name, args, timeoutMs: 120_000, space })) as Record<string, unknown>;
const purge = (installer: "linux" | "macos", space: string): Promise<{ code: number; out: string }> =>
  host("sh", ["-c", `. "scripts/install/${installer}/install.sh"\npurge_browser ${space}`], 180_000);

test("@heavy two Spaces on one engine: purging one removes only its agents' sign-ins; the other's agent is still signed in; purging the last removes the container, volume and network", { skip, timeout: 900_000 }, async () => {
  const sb = createDockerSpaceBrowser({ api, http, name: NAME, image: IMAGE, user: { uid: 10001, gid: 10001 }, startTimeoutMs: 120_000, idleMinutes: 60, log: () => undefined });
  await tool(sb, "agt_ofa", "spc_aaa", "chrome_open", { url: `${base}/set?name=agt_ofa` });
  await tool(sb, "agt_ofb", "spc_bbb", "chrome_open", { url: `${base}/set?name=agt_ofb` });
  process.env["VYRE_SOURCE_ONLY"] = "1"; process.env["VYRE_TEST_MODE"] = "1"; process.env["VYRE_TEST_SBROWSER"] = NAME; process.env["VYRE_TEST_OTHER_INSTALLS"] = "0";
  const first = await purge("linux", "spc_aaa");
  assert.equal(first.code, 0, first.out);
  assert.match(first.out, /Removed this Space's 1 agent browser profiles\. The Space browser stays: it also holds 1 other profiles/);
  // the other Space's agent: still signed in (its browser may have been left running; ask it again either way)
  await tool(sb, "agt_ofb", "spc_bbb", "chrome_open", { url: `${base}/whoami` });
  assert.equal(String((await tool(sb, "agt_ofb", "spc_bbb", "chrome_eval", { expression: "document.body.innerText" }))["result"]), "cookie:[sid=agt_ofb]", "the other Space's agent is still signed in");
  // the purged Space's agent starts from nothing
  await tool(sb, "agt_ofa", "spc_aaa", "chrome_open", { url: `${base}/whoami` });
  assert.equal(String((await tool(sb, "agt_ofa", "spc_aaa", "chrome_eval", { expression: "document.body.innerText" }))["result"]), "cookie:[]", "this Space's sign-in is gone");
  await sb.forget("agt_ofa");
  // the last Space goes: nothing else on the volume, no other install: everything goes (the macOS installer's copy this time)
  const last = await purge("macos", "spc_bbb");
  assert.equal(last.code, 0, last.out);
  assert.equal((await http({ method: "GET", path: `/containers/${NAME}/json` })).status, 404, "the container is gone");
  assert.equal((await http({ method: "GET", path: `/volumes/${NAME}-data` })).status, 404, "and its volume");
  assert.equal((await http({ method: "GET", path: `/networks/${NAME}net` })).status, 404, "and its network");
  console.log("METRIC sbrowser-purge two Spaces: the first purge kept the other Space's sign-in; the last removed container, volume and network");
});
