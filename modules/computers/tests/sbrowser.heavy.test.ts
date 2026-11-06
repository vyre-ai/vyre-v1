// @heavy docker
// The Space browser on a real Docker host (owner decision 6 Nov; DESIGN-agent-workspaces.md): the image builds from images/space-browser, the Docker adapter makes the one container and drives browserd through
// `docker exec ... ctl`, and a real headless Chromium runs one profile per agent. What this proves that the scripted tests cannot:
//   - agent A's profile and agent B's profile do not share cookies (a session cookie, and a persistent one that survives the browser stopping), though both visit the same site
//   - the live view: Chrome's screencast sends JPEG frames over the WebSocket, and while a person has the controls the agent's tools are paused and the person's click and keys reach the page
//   - a Vault login fills: a #Handle.field in chrome_fill is asked of the host's fill channel for that profile's agent, typed into the page, and never comes back in an answer; a profile with no channel
//     fills nothing; a handle the Vault refuses types nothing
//   - a profile's browser stops after idle and starts again from the same folder
//
// Runs only with VYRE_HEAVY_DOCKER=1. Without it every test here is skipped with its reason; a skip is never a pass of the real thing. With it on, nothing is skipped: a missing Docker daemon or a failed image
// build fails the run.
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
import { ToolError } from "../handlers/tools/common.ts";
import { createFillService, fillHttp } from "../handlers/fill.ts";
import type { FillLookup } from "../handlers/fill.ts";

const ON = process.env["VYRE_HEAVY_DOCKER"] === "1";
const skip: string | false = ON ? false : "needs VYRE_HEAVY_DOCKER=1 (the 20 s shard never builds or starts the Space browser)";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const IMAGE = process.env["VYRE_SPACE_BROWSER_IMAGE"] ?? "vyre/space-browser:heavy";
const suffix = `${process.pid}${Math.random().toString(36).slice(2, 6)}`;
const NAME = `vyre-sbrowser-hv${suffix}`;
const http = unixSocketHttp();
const api = createDockerApi(http);
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const sb = createDockerSpaceBrowser({ api, name: NAME, image: IMAGE, user: { uid: 10001, gid: 10001 }, idleMinutes: 0.05, sweepSeconds: 2, startTimeoutMs: 90_000 });
const tool = (profileId: string, name: string, args: Record<string, unknown> = {}, extra: { by?: "person"; fill?: { url: string; token: string } } = {}) => sb.tool({ profileId, tool: name, args, timeoutMs: 30_000, ...extra });

function host(cmd: string, args: string[], timeoutMs: number): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    execFile(cmd, args, { cwd: ROOT, timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ code: err ? ((err as NodeJS.ErrnoException & { code?: number }).code as number | undefined) ?? 1 : 0, out: `${stdout}\n${stderr}` });
    });
  });
}

// ---- the sites the browsers visit, served from this test process on the Docker bridge ----------------------------------------------------------------

const logins: Array<{ user: string; password: string }> = [];
let site: Server;
let fillSite: Server;
let GATEWAY = "172.17.0.1";
let sitePort = 0;
let fillPort = 0;
let deny = false;
const PASSWORD = "Sw0rdfish-9931";

function page(res: ServerResponse, body: string, headers: Record<string, string | string[]> = {}): void {
  res.writeHead(200, { "content-type": "text/html; charset=utf-8", ...headers });
  res.end(`<!doctype html><meta charset=utf-8><title>site</title><body style="margin:0">${body}</body>`);
}
function serveSite(req: IncomingMessage, res: ServerResponse): void {
  const url = new URL(req.url ?? "/", "http://x");
  if (url.pathname === "/set") {
    const who = url.searchParams.get("name") ?? "nobody";
    const persistent = url.searchParams.get("keep") === "1" ? "; Max-Age=3600" : "";
    page(res, `<p id=out>set ${who}</p>`, { "set-cookie": [`sid=${who}; Path=/${persistent}`] });
  } else if (url.pathname === "/whoami") {
    page(res, `<p id=out>cookie:[${req.headers.cookie ?? ""}]</p>`);
  } else if (url.pathname === "/ticker") {
    page(res, `<button id=b style="position:fixed;left:100px;top:100px;width:200px;height:100px" onclick="window.clicks=(window.clicks||0)+1;document.getElementById('n').textContent=window.clicks">go</button>
      <input id=t style="position:fixed;left:400px;top:100px;width:300px;height:40px"><p id=n style="position:fixed;left:100px;top:300px">0</p><div id=c style="position:fixed;left:100px;top:400px;font-size:60px"></div>
      <script>let i=0;setInterval(()=>{document.getElementById('c').textContent='tick '+(++i)},50)</script>`);
  } else if (url.pathname === "/login" && req.method === "POST") {
    let body = "";
    req.on("data", (c: Buffer) => { body += c.toString("utf8"); });
    req.on("end", () => { const f = new URLSearchParams(body); logins.push({ user: f.get("user") ?? "", password: f.get("password") ?? "" }); page(res, `<p id=out>welcome ${f.get("user") ?? ""}</p>`); });
  } else if (url.pathname === "/login") {
    page(res, `<form method=post action=/login><label>User <input name=user></label><label>Password <input name=password type=password></label><button type=submit>Sign in</button></form>`);
  } else { res.writeHead(404).end("no"); }
}

const lookup = async (handle: string): Promise<FillLookup> => {
  if (deny) return { kind: "denied", reason: "no" };
  return handle === "#Login_Site.password" ? { kind: "value", itemId: "itm_login", value: PASSWORD } : { kind: "unknown" };
};
const uses: string[] = [];
const fills = createFillService({ source: { lookup }, log: (u) => { uses.push(`${u.agentId}:${u.handle}:${u.outcome}`); } });

const listen = (s: Server): Promise<number> => new Promise((resolve) => s.listen(0, "0.0.0.0", () => resolve((s.address() as { port: number }).port)));
const siteUrl = (p: string): string => `http://${GATEWAY}:${sitePort}${p}`;
const text = async (profileId: string): Promise<string> => String((await tool(profileId, "chrome_eval", { expression: "document.body.innerText" }))["result"]);

before(async () => {
  if (!ON) return;
  assert.equal(await api.ping(), true, "the Docker daemon answers");
  const gw = await host("docker", ["network", "inspect", "bridge", "--format", "{{(index .IPAM.Config 0).Gateway}}"], 20_000);
  if (gw.code === 0 && /^\d+\.\d+\.\d+\.\d+/.test(gw.out.trim())) GATEWAY = gw.out.trim().split("\n")[0]!;
  const ext = process.env["VYRE_CHROME_EXT_DIR"] ?? path.join(ROOT, "apps/chrome");
  assert.ok(fs.existsSync(path.join(ext, "manifest.json")), "Vyre for Chrome is there to bake in");
  // The runners have no buildx: the extension goes into a copy of the build context, which is images/ (the two folders side by side).
  const ctxDir = fs.mkdtempSync(path.join(os.tmpdir(), `sbrowser-ctx-${suffix}-`));
  fs.cpSync(path.join(ROOT, "images/agent-computer"), path.join(ctxDir, "agent-computer"), { recursive: true });
  fs.cpSync(path.join(ROOT, "images/space-browser"), path.join(ctxDir, "space-browser"), { recursive: true });
  fs.cpSync(ext, path.join(ctxDir, "agent-computer/vyre-chrome"), { recursive: true, filter: (s) => !/\/(tests|node_modules)(\/|$)/.test(s) });
  const built = await host("docker", ["build", "-f", path.join(ctxDir, "space-browser/Dockerfile"), "-t", IMAGE, ctxDir], 1_200_000);
  fs.rmSync(ctxDir, { recursive: true, force: true });
  assert.equal(built.code, 0, `building ${IMAGE} failed: ${built.out.slice(-1500)}`);
  site = createServer(serveSite);
  sitePort = await listen(site);
  const fh = fillHttp(fills);
  fillSite = createServer((req, res) => fh(req, res));
  fillPort = await listen(fillSite);
});

after(async () => {
  if (!ON) return;
  await api.containerStop(NAME, 5).catch(() => undefined);
  await api.containerRemove(NAME).catch(() => undefined);
  await http({ method: "DELETE", path: `/volumes/${NAME}-data`, query: { force: "true" } }).catch(() => undefined);
  site?.close(); fillSite?.close();
});

const ipOfContainer = async (): Promise<string> => {
  const r = await http({ method: "GET", path: `/containers/${NAME}/json` });
  const j = JSON.parse(new TextDecoder().decode(r.body)) as { NetworkSettings: { Networks: Record<string, { IPAddress: string }> } };
  return Object.values(j.NetworkSettings.Networks)[0]!.IPAddress;
};

test("@heavy space browser: one container for the Space host, inside the computer profile, and a browser per agent that answers the tools", { skip, timeout: 300_000 }, async () => {
  const opened = await tool("agt_dex", "chrome_open", { url: siteUrl("/whoami") });
  assert.equal(opened["title"], "site");
  const info = JSON.parse(new TextDecoder().decode((await http({ method: "GET", path: `/containers/${NAME}/json` })).body)) as { State: { Running: boolean }; HostConfig: { Privileged: boolean; CapDrop: string[]; SecurityOpt: string[]; Binds: string[] }; Config: { User: string } };
  assert.equal(info.State.Running, true);
  assert.equal(info.HostConfig.Privileged, false);
  assert.deepEqual(info.HostConfig.CapDrop, ["ALL"]);
  assert.ok(info.HostConfig.SecurityOpt.includes("no-new-privileges:true"));
  assert.equal(info.Config.User, "10001:10001");
  assert.deepEqual(info.HostConfig.Binds, [`${NAME}-data:/data:rw`]);
  const snap = await tool("agt_dex", "chrome_snapshot", { format: "text" });
  assert.match(String(snap["tree"]), /cookie:\[\]/);
  const shot = await tool("agt_dex", "chrome_screenshot");
  assert.ok(Number(shot["width"]) > 100 && String(shot["png"]).startsWith("iVBOR"), "a real PNG");
});

test("@heavy space browser: agent A and agent B visit the same site and their cookies do not cross, and a persistent login survives the browser stopping", { skip, timeout: 300_000 }, async () => {
  await tool("agt_alice", "chrome_open", { url: siteUrl("/set?name=alice&keep=1") });
  await tool("agt_bobby", "chrome_open", { url: siteUrl("/whoami") });
  assert.equal(await text("agt_bobby"), "cookie:[]", "B has no cookie from A's visit");
  await tool("agt_alice", "chrome_open", { url: siteUrl("/whoami") });
  assert.equal(await text("agt_alice"), "cookie:[sid=alice]", "A has its own");
  await tool("agt_bobby", "chrome_open", { url: siteUrl("/set?name=bobby") });
  await tool("agt_alice", "chrome_open", { url: siteUrl("/whoami") });
  assert.equal(await text("agt_alice"), "cookie:[sid=alice]", "B's login did not replace A's");
  await tool("agt_bobby", "chrome_open", { url: siteUrl("/whoami") });
  assert.equal(await text("agt_bobby"), "cookie:[sid=bobby]");
  // the folders on the volume are separate
  const ls = await api.exec(NAME, { cmd: ["ls", "/data/profiles"], env: [] });
  assert.ok(ls.stdout.split("\n").includes("agt_alice") && ls.stdout.split("\n").includes("agt_bobby"), ls.stdout);
  // the idle stop (3 s of quiet, looked at every 2 s) closes the browser and keeps the folder; the next tool starts it again from the same profile
  let stopped = false;
  for (let i = 0; i < 40 && !stopped; i++) {
    await sleep(1000);
    const rows = (await sb.profiles()).profiles;
    stopped = rows.find((x) => x.profileId === "agt_alice")?.running === false;
  }
  assert.ok(stopped, "agt_alice's browser stopped after idle");
  await tool("agt_alice", "chrome_open", { url: siteUrl("/whoami") });
  assert.equal(await text("agt_alice"), "cookie:[sid=alice]", "the persistent login came back from the profile folder");
});

test("@heavy space browser: the live view sends screencast frames, and a person who takes over has the agent's tools paused and their click and keys reach the page", { skip, timeout: 300_000 }, async () => {
  await tool("agt_dex", "chrome_open", { url: siteUrl("/ticker") });
  const s = await sb.stream({ profileId: "agt_dex" });
  assert.ok(s.ws, "browserd gave a WebSocket address");
  const wsUrl = s.ws!.replace(/^ws:\/\/[^:/]+/, `ws://${await ipOfContainer()}`);
  const base = wsUrl.replace(/^ws/, "http").replace(/\/ws\?t=.*/, "");
  assert.equal((await fetch(`${base}/stream?t=nope`)).status, 401, "a view without a ticket is refused");
  assert.equal((await fetch(`${base}/stream`)).status, 401);
  const refusedWs = new WebSocket(`${wsUrl.replace(/t=.*/, "t=nope")}`);
  assert.ok(await new Promise<boolean>((resolve) => { refusedWs.addEventListener("open", () => resolve(false)); refusedWs.addEventListener("error", () => resolve(true)); refusedWs.addEventListener("close", () => resolve(true)); }), "a WebSocket with a wrong ticket does not open");
  const ws = new WebSocket(wsUrl);
  ws.binaryType = "arraybuffer";
  const frames: Uint8Array[] = [];
  const msgs: Array<{ t: string; seq?: number; reason?: string }> = [];
  ws.addEventListener("message", (ev: MessageEvent) => {
    if (typeof ev.data === "string") msgs.push(JSON.parse(ev.data)); else frames.push(new Uint8Array(ev.data as ArrayBuffer));
  });
  await new Promise<void>((resolve, reject) => { ws.addEventListener("open", () => resolve()); ws.addEventListener("error", () => reject(new Error("the view did not open"))); });
  for (let i = 0; i < 50 && frames.length < 5; i++) await sleep(100);
  assert.ok(frames.length >= 5, `screencast frames arrived (${frames.length})`);
  assert.ok(frames.every((f) => f[0] === 0xff && f[1] === 0xd8), "each frame is a JPEG");
  const ask = async (m: Record<string, unknown>): Promise<{ t: string; reason?: string }> => {
    const seq = Math.floor(Math.random() * 1e9);
    ws.send(JSON.stringify({ ...m, seq }));
    for (let i = 0; i < 100; i++) { const got = msgs.find((x) => x.seq === seq); if (got) return got; await sleep(50); }
    throw new Error(`no answer to ${String(m["t"])}`);
  };
  assert.equal((await ask({ t: "move", x: 150, y: 150 })).t, "refused", "no input before a person takes over");
  await sb.takeover({ profileId: "agt_dex", personId: "usr_dana" });
  await assert.rejects(() => tool("agt_dex", "chrome_state"), (e) => e instanceof ToolError && e.code === "paused", "the agent's tools wait");
  assert.equal((await ask({ t: "move", x: 150, y: 150 })).t, "ack");
  assert.equal((await ask({ t: "down", n: 1 })).t, "ack");
  assert.equal((await ask({ t: "up", n: 1 })).t, "ack");
  assert.equal(String((await tool("agt_dex", "chrome_eval", { expression: "String(window.clicks||0)" }, { by: "person" }))["result"]), "1", "the person's click reached the button");
  assert.equal((await ask({ t: "move", x: 500, y: 120 })).t, "ack");
  await ask({ t: "down", n: 1 }); await ask({ t: "up", n: 1 });
  assert.equal((await ask({ t: "type", text: "hello" })).t, "ack");
  assert.equal((await ask({ t: "key", name: "Return", down: true })).t, "ack");
  assert.equal(String((await tool("agt_dex", "chrome_eval", { expression: "document.getElementById('t').value" }, { by: "person" }))["result"]), "hello", "typed text reached the field");
  await sb.giveBack("agt_dex");
  assert.equal((await tool("agt_dex", "chrome_state"))["loading"], false, "the agent has its tools back");
  ws.close();
});

test("@heavy space browser: a Vault login fills in the agent's profile, and never comes back in an answer", { skip, timeout: 300_000 }, async () => {
  const grant = await fills.issue({ computerId: "agt_dex", agentId: "agt_dex", asker: "usr_dana" });
  const fill = { url: `http://${GATEWAY}:${fillPort}/`, token: grant.fillToken };
  await tool("agt_dex", "chrome_open", { url: siteUrl("/login") });
  const snap = await tool("agt_dex", "chrome_snapshot");
  const tree = String(snap["tree"]);
  const ref = (label: RegExp): string => { const m = tree.split("\n").find((l) => label.test(l)); assert.ok(m, `${label} in ${tree}`); return /\[ref=(e\d+)\]/.exec(m!)![1]!; };
  const userRef = ref(/textbox "User/); const passRef = ref(/textbox "Password/); const submit = ref(/button "Sign in"/);
  const filled = await tool("agt_dex", "chrome_fill", { fields: [{ ref: userRef, value: "dex" }, { ref: passRef, value: "#Login_Site.password" }] }, { fill });
  assert.equal(filled["filled"], 2);
  const { used, ...visible } = filled;
  assert.ok(!JSON.stringify(visible).includes(PASSWORD), "the value is not in the answer");
  assert.deepEqual(used, [{ handle: "#Login_Site.password", itemId: "itm_login", value: PASSWORD }], "browserd reports what it used so the host can scrub every later answer (the module does, and drops `used`)");
  await tool("agt_dex", "chrome_act", { ref: submit, action: "click" });
  for (let i = 0; i < 40 && logins.length === 0; i++) await sleep(100);
  assert.deepEqual(logins.at(-1), { user: "dex", password: PASSWORD }, "the page received the Vault value");
  assert.ok(uses.includes("agt_dex:#Login_Site.password:filled"), "the Vault logged the use under the agent");
  assert.ok(!(await text("agt_dex")).includes(PASSWORD));

  // another profile has no channel: nothing is typed, and no browser starts for the refusal
  await assert.rejects(() => tool("agt_other", "chrome_fill", { fields: [{ ref: "e1", value: "#Login_Site.password" }] }), (e) => e instanceof ToolError && e.code === "unavailable" && /no channel to the Vault/.test(e.message));
  assert.ok(!(await sb.profiles()).profiles.some((x) => x.profileId === "agt_other" && x.running), "a refused handle started no browser");
  // a handle the Vault refuses types nothing
  deny = true;
  try {
    await assert.rejects(() => tool("agt_dex", "chrome_fill", { fields: [{ ref: passRef, value: "#Login_Site.password" }] }, { fill }), (e) => e instanceof ToolError && e.code === "bad_input" && /may not use/.test(e.message));
  } finally { deny = false; }
  assert.ok(uses.includes("agt_dex:#Login_Site.password:refused"));
  grant.revoke();
});
