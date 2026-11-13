// @heavy docker
// Lane f-agentpc, 13 Nov 2026 (P7 section 10 items 3 and 4, owner: "uses only the sign-ins the asker may use", and his rule of 10 Nov: every sign-in survives an update). A real Chromium in the real Space
// browser service, one shared agent, three people: Maya who owns it, Ana and Ben. What proves the bound on a real browser:
//   - Ana signs in to a site through the agent's browser; in Ben's turn the same site is not signed in (a cookie jar of his own), and Ben's sign-in is not Ana's either
//   - the agent's owner keeps the agent's own profile: a sign-in made in it before this rule (what rc.26 did for every asker) is found again after the browser stops and starts, cookies intact; a person who is not
//     the owner is not signed in by it
//   - the same after the whole service container is made again (what an update does to it)
// VYRE_AGENTPC_PHASE=seed signs the owner in with the profile id rc.26 used (the agent's id) and stops there, leaving the container and its data volume (VYRE_AGENTPC_SB names them), so the rc.26 code can make
// the data and this tree find it; VYRE_AGENTPC_PHASE=verify only checks. Default: everything, in this tree.
// Runs only with VYRE_HEAVY_DOCKER=1; VYRE_SPACE_BROWSER_IMAGE names an image already built (otherwise it is built here).
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
import { harness } from "../fixtures/harness.ts";
import { tool as cap } from "./tools.fixture.ts";

const ON = process.env["VYRE_HEAVY_DOCKER"] === "1";
const skip: string | false = ON ? false : "needs VYRE_HEAVY_DOCKER=1 (the Space browser is a real container)";
const PHASE = process.env["VYRE_AGENTPC_PHASE"] ?? "all";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const PRESET = process.env["VYRE_SPACE_BROWSER_IMAGE"];
const suffix = `${process.pid}${Math.random().toString(36).slice(2, 6)}`;
const IMAGE = PRESET ?? `vyre/space-browser:agentpc-${suffix}`;
const NAME = process.env["VYRE_AGENTPC_SB"] ?? `vyre-sbrowser-ap${suffix}`;
const http = unixSocketHttp();
const api = createDockerApi(http);
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const mkSb = () =>
  createDockerSpaceBrowser({
    api,
    name: NAME,
    image: IMAGE,
    user: { uid: 10001, gid: 10001 },
    idleMinutes: 0.05,
    sweepSeconds: 2,
    startTimeoutMs: 90_000,
  });
let sb = mkSb();

const AG = "agt_01a1d4e073004405af63151b48dcb667";
const MAYA = "usr_maya";
const ANA = "usr_ana";
const BEN = "usr_ben";

function host(cmd: string, args: string[], timeoutMs: number): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    execFile(cmd, args, { cwd: ROOT, timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({
        code: err ? ((err as unknown as { code?: number }).code ?? 1) : 0,
        out: `${stdout}\n${stderr}`,
      });
    });
  });
}

// the site the browsers visit, served from this test process on the Docker bridge: a login that sets a cookie that lasts, and a page that says which cookie it was sent
let site: Server;
let GATEWAY = "172.17.0.1";
let sitePort = 0;
function serveSite(req: IncomingMessage, res: ServerResponse): void {
  const url = new URL(req.url ?? "/", "http://x");
  const page = (body: string, headers: Record<string, string | string[]> = {}): void => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", ...headers });
    res.end(`<!doctype html><meta charset=utf-8><title>site</title><body>${body}</body>`);
  };
  if (url.pathname === "/signin") {
    const who = url.searchParams.get("name") ?? "nobody";
    page(`<p id=out>signed in ${who}</p>`, { "set-cookie": [`sid=${who}; Path=/; Max-Age=3600`] });
  } else if (url.pathname === "/whoami") {
    page(`<p id=out>cookie:[${req.headers.cookie ?? ""}]</p>`);
  } else res.writeHead(404).end("no");
}
const siteUrl = (p: string): string => `http://${GATEWAY}:${sitePort}${p}`;
const listen = (s: Server): Promise<number> =>
  new Promise((resolve) => s.listen(0, "0.0.0.0", () => resolve((s.address() as { port: number }).port)));

/** A turn of the shared agent for `asker`: the agent acting for that person, through the module's own tool layer. */
function turn(asker: string | undefined) {
  resetAgentInfo();
  const h = harness({ principal: { kind: "agent", id: AG }, ...(asker === undefined ? {} : { actingFor: asker }) });
  h.respond["agents.get"] = () => ({
    agent: { agentId: AG, name: "Dex", folderId: "fld_dex", ownerId: MAYA, kind: "agent" },
  });
  return h.ctx;
}
const open = (asker: string | undefined, p: string) => cap["computers.chrome.open"]!(turn(asker), { url: siteUrl(p) });
const seen = async (asker: string | undefined): Promise<string> => {
  await open(asker, "/whoami");
  return String(
    (await cap["computers.chrome.eval"]!(turn(asker), { expression: "document.body.innerText" }))["result"],
  );
};

before(async () => {
  if (!ON) return;
  assert.equal(await api.ping(), true, "the Docker daemon answers");
  const gw = await host(
    "docker",
    ["network", "inspect", "bridge", "--format", "{{(index .IPAM.Config 0).Gateway}}"],
    20_000,
  );
  if (gw.code === 0 && /^\d+\.\d+\.\d+\.\d+/.test(gw.out.trim())) GATEWAY = gw.out.trim().split("\n")[0]!;
  if (PRESET === undefined) {
    const ext = process.env["VYRE_CHROME_EXT_DIR"] ?? path.join(ROOT, "apps/chrome");
    const ctxDir = fs.mkdtempSync(path.join(os.tmpdir(), `sbrowser-ctx-${suffix}-`));
    fs.cpSync(path.join(ROOT, "images/agent-computer"), path.join(ctxDir, "agent-computer"), { recursive: true });
    fs.cpSync(path.join(ROOT, "images/space-browser"), path.join(ctxDir, "space-browser"), { recursive: true });
    const vendor = path.join(ctxDir, "space-browser/browserd/vendor/chrome-bridge.ts");
    fs.rmSync(vendor, { force: true });
    fs.copyFileSync(path.join(ROOT, "lib/chrome-bridge.ts"), vendor);
    fs.cpSync(ext, path.join(ctxDir, "agent-computer/vyre-chrome"), {
      recursive: true,
      filter: (s) => !/\/(tests|node_modules)(\/|$)/.test(s),
    });
    const built = await host(
      "docker",
      ["build", "-f", path.join(ctxDir, "space-browser/Dockerfile"), "-t", IMAGE, ctxDir],
      1_200_000,
    );
    fs.rmSync(ctxDir, { recursive: true, force: true });
    assert.equal(built.code, 0, `building ${IMAGE} failed: ${built.out.slice(-1500)}`);
  }
  site = createServer(serveSite);
  sitePort = await listen(site);
  bindSpaceBrowser(sb);
});

after(async () => {
  if (!ON) return;
  bindSpaceBrowser(null);
  site?.close();
  // a seed phase leaves the container and its volume for the verify phase of the other code
  if (PHASE === "seed") return;
  await api.containerStop(NAME, 5).catch(() => undefined);
  await api.containerRemove(NAME).catch(() => undefined);
  await http({ method: "DELETE", path: `/volumes/${NAME}-data`, query: { force: "true" } }).catch(() => undefined);
  if (PRESET === undefined) await host("docker", ["rmi", "-f", IMAGE], 60_000);
});

test(
  "the owner is signed in as before the rule (the agent's own profile, as rc.26 made it); a person who is not the owner is not",
  {
    skip: skip || (PHASE === "verify" ? false : "needs the verify phase: the seed made the sign-in"),
    timeout: 600_000,
  },
  async () => {
    assert.match(await seen(MAYA), /sid=maya/, "the owner's sign-in is found again");
    assert.doesNotMatch(await seen(BEN), /sid=maya/, "Ben's turn is not signed in as the owner");
    // a browser that stopped, and one made again by an update, still has the owner's sign-in and still not Ben's
    await sb.stop(AG);
    assert.match(await seen(MAYA), /sid=maya/, "after the browser stopped and started");
    assert.doesNotMatch(await seen(BEN), /sid=maya/);
  },
);

test(
  "what Ana signs in to in the agent's browser is not there in Ben's turn, and each person's sign-in outlives the browser and the service",
  { skip: skip || (PHASE === "seed" || PHASE === "verify" ? "needs the whole run" : false), timeout: 600_000 },
  async () => {
    await open(MAYA, "/signin?name=maya");
    await open(ANA, "/signin?name=ana");
    assert.match(await seen(ANA), /sid=ana/, "Ana is signed in in her own turn");
    const ben = await seen(BEN);
    assert.doesNotMatch(ben, /sid=ana/, `Ben's turn does not browse as Ana: ${ben}`);
    assert.doesNotMatch(ben, /sid=maya/, `nor as the owner: ${ben}`);
    assert.match(await seen(MAYA), /sid=maya/, "the owner's own turn is the owner's");
    assert.doesNotMatch(await seen(MAYA), /sid=ana/);
    // Ben signs in to the same site: his is his, and Ana's is still Ana's
    await open(BEN, "/signin?name=ben");
    assert.match(await seen(BEN), /sid=ben/);
    assert.match(await seen(ANA), /sid=ana/);
    // the service made again (an update): everyone is still signed in as themselves
    await api.containerStop(NAME, 5);
    await api.containerRemove(NAME);
    sb = mkSb();
    bindSpaceBrowser(sb);
    assert.match(await seen(ANA), /sid=ana/, "Ana after the service was made again");
    assert.match(await seen(BEN), /sid=ben/, "Ben after the service was made again");
    assert.match(await seen(MAYA), /sid=maya/, "the owner after the service was made again");
    await sleep(10);
  },
);

test(
  "a seed phase: the owner signs in with the profile id rc.26 used and the service is left for the next code",
  { skip: skip || (PHASE === "seed" ? false : "only the seed phase"), timeout: 600_000 },
  async () => {
    await open(MAYA, "/signin?name=maya");
    assert.match(await seen(MAYA), /sid=maya/);
  },
);
