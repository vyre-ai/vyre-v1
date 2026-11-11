// @heavy docker
// The Space browser on a real Docker host (owner decision 6 Nov; DESIGN-agent-workspaces.md): the image builds from images/space-browser, the Docker adapter makes the one container and drives browserd through
// `docker exec ... ctl`, and a real headless Chromium runs one profile per agent. What this proves that the scripted tests cannot:
//   - agent A's profile and agent B's profile do not share cookies (a session cookie, and a persistent one that survives the browser stopping), though both visit the same site
//   - the live view: Chrome's screencast sends JPEG frames over the WebSocket, and while a person has the controls the agent's tools are paused and the person's click and keys reach the page
//   - a Vault login fills: a #Handle.field in chrome_fill is asked of the host's fill channel for that profile's agent, typed into the page, and never comes back in an answer; a profile with no channel
//     fills nothing; a handle the Vault refuses types nothing
//   - a file an agent downloads in its profile is saved into its profile folder inside the service, then moved into the agent's Files under Downloads and dropped from the service
//   - a profile's browser stops after idle and starts again from the same folder
//   - Vyre for Chrome in a profile is paired with the Space as that agent: it connects through its native messaging host, hears agent.optin, and the Vault answers through the bridge
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
import { takeDownloads } from "../sbrowser/downloads.ts";
import { asPerson, codeOf, harness } from "../fixtures/harness.ts";
import { tool as cap } from "./tools.fixture.ts";
import { computerSubnets } from "../impl.ts";
import { bindSpaceBrowser } from "../sbrowser/port.ts";
import { clientOnNetwork } from "../../../host/src/routes/site-host.ts";
import { FILL_PATH } from "../../../host/src/seams/computers.ts";
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
// a second service with Engine access and no runner, as on a server or a computer with Docker: it gets a network of its own
const NET_NAME = `${NAME}n`;
// a container of an earlier release: VYRE_SPACE_BROWSER_OLD_IMAGE is an image built from an earlier commit (CI builds it from the merge base); without it the same image is used and only the container's
// settings are of the earlier release (the default bridge, no network of its own), which is replaced the same way
const UPG_NAME = `${NAME}u`;
const OLD_IMAGE = process.env["VYRE_SPACE_BROWSER_OLD_IMAGE"] ?? IMAGE;
const sbNet = createDockerSpaceBrowser({ api, http, name: NET_NAME, image: IMAGE, user: { uid: 10001, gid: 10001 }, startTimeoutMs: 90_000 });
const tool = (profileId: string, name: string, args: Record<string, unknown> = {}, extra: { by?: "person"; fill?: { url: string; token: string }; space?: string } = {}) => sb.tool({ profileId, tool: name, args, timeoutMs: 30_000, ...extra });

function host(cmd: string, args: string[], timeoutMs: number): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    execFile(cmd, args, { cwd: ROOT, timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ code: err ? ((err as NodeJS.ErrnoException & { code?: number }).code as number | undefined) ?? 1 : 0, out: `${stdout}\n${stderr}` });
    });
  });
}

// ---- the sites the browsers visit, served from this test process on the Docker bridge ----------------------------------------------------------------

const logins: Array<{ user: string; password: string }> = [];
const slowHits = new Map<string, number>();
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
  } else if (url.pathname === "/download") {
    res.writeHead(200, { "content-type": "application/octet-stream", "content-disposition": `attachment; filename="${url.searchParams.get("name") ?? "file.bin"}"` });
    const bytes = Number(url.searchParams.get("bytes") ?? 0);
    res.end(bytes > 0 ? Buffer.alloc(bytes, 120) : `the contents of ${url.searchParams.get("name") ?? "file.bin"}`);
  } else if (url.pathname === "/slow") {
    const k = url.searchParams.get("k") ?? "";
    slowHits.set(k, (slowHits.get(k) ?? 0) + 1);
    setTimeout(() => page(res, `<p id=out>slow ${k}</p>`), 4000);
  } else if (url.pathname === "/files") {
    page(res, `<a id=small href="/download?name=invoice.txt">Invoice</a> <a id=big href="/download?name=archive.bin&bytes=${21 * 1024 * 1024}">Archive</a>`);
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
const invokes: Array<{ cap: string; input: Record<string, unknown>; who: { agentId: string; asker: string } }> = [];
const fills = createFillService({
  source: {
    lookup,
    async invoke(cap, input, who) {
      invokes.push({ cap, input, who });
      if (cap === "vault.items.match") return { items: [{ item: { itemId: "itm_login", name: "Login" }, usernameField: "username" }] };
      return { handle: "#Login_Site", fields: ["username", "password"] };
    },
  },
  log: (u) => { uses.push(`${u.agentId}:${u.handle}:${u.outcome}`); },
});

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
  // the bridge protocol module is a link in the repository and a copy in the build context (scripts/release stage-bridge does the same)
  const vendor = path.join(ctxDir, "space-browser/browserd/vendor/chrome-bridge.ts");
  fs.rmSync(vendor, { force: true });
  fs.copyFileSync(path.join(ROOT, "lib/chrome-bridge.ts"), vendor);
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
  for (const n of [NAME, NET_NAME, UPG_NAME]) {
    await api.containerStop(n, 5).catch(() => undefined);
    await api.containerRemove(n).catch(() => undefined);
    await http({ method: "DELETE", path: `/volumes/${n}-data`, query: { force: "true" } }).catch(() => undefined);
  }
  await http({ method: "DELETE", path: `/networks/${NET_NAME}net` }).catch(() => undefined);
  await http({ method: "DELETE", path: `/networks/${UPG_NAME}net` }).catch(() => undefined);
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
  assert.deepEqual([s.width, s.height], [1280, 800], "the stream says the page's real size, measured");
  assert.equal(String((await tool("agt_dex", "chrome_eval", { expression: "innerWidth + 'x' + innerHeight" }))["result"]), "1280x800", "the viewport is exactly 1280x800");
  const before = ((await tool("agt_dex", "chrome_tabs", { action: "list" }))["tabs"] as Array<{ tabId: string }>)[0]!.tabId;
  const added = (await tool("agt_dex", "chrome_tabs", { action: "new", url: siteUrl("/whoami") }))["tabs"] as Array<{ tabId: string; active: boolean }>;
  const extra = added.find((x) => x.active)!.tabId;
  assert.equal(String((await tool("agt_dex", "chrome_eval", { expression: "innerWidth + 'x' + innerHeight" }))["result"]), "1280x800", "a new tab too");
  const shotDims = await tool("agt_dex", "chrome_screenshot");
  assert.deepEqual([shotDims["width"], shotDims["height"]], [1280, 800]);
  void extra;
  await tool("agt_dex", "chrome_tabs", { action: "use", tabId: before });
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
  await assert.rejects(() => tool("agt_dex", "chrome_state"), (e) => e instanceof ToolError && e.code === "paused" && /A person has the controls/.test(e.message), "the agent's tools wait, and say why in plain words");
  await assert.rejects(() => tool("agt_dex", "chrome_open", { url: siteUrl("/whoami") }), (e) => e instanceof ToolError && e.code === "paused", "an agent that tries to act is refused, not let through under the person's hands");
  await assert.rejects(() => sb.takeover({ profileId: "agt_dex", personId: "usr_omar" }), (e) => e instanceof ToolError && e.code === "bad_input" && /Someone else has the controls/.test(e.message), "a second person is refused while it is held");
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
  assert.equal((await tool("agt_dex", "chrome_state"))["loading"], false, "the agent has its tools back at once");
  await sb.takeover({ profileId: "agt_dex", personId: "usr_omar" });   // free again: the second person may now have it, and the agent waits for them just the same
  await assert.rejects(() => tool("agt_dex", "chrome_state"), (e) => e instanceof ToolError && e.code === "paused");
  await sb.giveBack("agt_dex");
  assert.equal((await tool("agt_dex", "chrome_state"))["loading"], false, "and has them back at once again");
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

// What the extension's native host does, from inside the container: read the profile's bridge folder, call the bridge over loopback with the profile's token, and listen on the events stream.
const AS_EXTENSION = String.raw`
const fs = require("node:fs");
const dir = "/data/profiles/agt_pair/bridge";
const info = JSON.parse(fs.readFileSync(dir + "/vyred.json", "utf8"));
const token = fs.readFileSync(dir + "/admin.token", "utf8").trim();
const base = info.url;
const H = { authorization: "Bearer " + token, "content-type": "application/json" };
const rpc = (b) => fetch(base + "/chrome-bridge/v1/rpc", { method: "POST", headers: H, body: JSON.stringify(b) }).then((r) => r.json());
(async () => {
  const lines = [];
  const ac = new AbortController();
  const ev = await fetch(base + "/chrome-bridge/v1/events", { headers: H, signal: ac.signal });
  (async () => { const rd = ev.body.getReader(); const dec = new TextDecoder(); let buf = ""; try { for (;;) { const { value, done } = await rd.read(); if (done) break; buf += dec.decode(value); let i; while ((i = buf.indexOf("\n")) >= 0) { lines.push(JSON.parse(buf.slice(0, i))); buf = buf.slice(i + 1); } } } catch (e) {} })();
  const hello = await rpc({ id: "1", type: "bridge", op: "hello", input: {} });
  const match = await rpc({ id: "2", type: "invoke", capability: "vault.items.match", input: { url: "https://app.example.com" } });
  const use = await rpc({ id: "3", type: "invoke", capability: "vault.use", input: { item: "itm_login" } });
  const fill = await rpc({ id: "4", type: "invoke", capability: "vault.fill", input: { handle: "#Login_Site.password", target: { kind: "browser", ref: "ag1-test" } } });
  const bad = await rpc({ id: "5", type: "invoke", capability: "vault.share", input: {} });
  const nonsense = await rpc({ id: "6", type: "bridge", op: "agents.list", input: {} });
  const noToken = await fetch(base + "/chrome-bridge/v1/rpc", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  await new Promise((r) => setTimeout(r, 500));
  ac.abort();
  console.log(JSON.stringify({ hello, match, use, fill, bad, nonsense, noTokenStatus: noToken.status, lines }));
})();
`;

test("@heavy space browser: Vyre for Chrome in a profile is paired with the Space as that agent, and the Vault answers through the bridge", { skip, timeout: 300_000 }, async () => {
  const grant = await fills.issue({ computerId: "agt_pair", agentId: "agt_pair", asker: "usr_dana" });
  const fill = { url: `http://${GATEWAY}:${fillPort}/`, token: grant.fillToken };
  await tool("agt_pair", "chrome_open", { url: siteUrl("/login") }, { fill, space: "spc_sbtest" });
  // the real extension connects through its native messaging host, says hello, and hears that the Space opened this browser to its agent
  let row: { bridge?: { connected: number; hello: boolean; optin: boolean } } | undefined;
  for (let i = 0; i < 60; i++) {
    row = (await sb.profiles()).profiles.find((x) => x.profileId === "agt_pair");
    if (row?.bridge?.optin && row.bridge.connected >= 1) break;
    await sleep(1000);
  }
  assert.ok(row?.bridge?.optin && row.bridge.connected >= 1, `the extension connected through its native host and was told the Space opened it to its agent (${JSON.stringify(row?.bridge)})`);
  // what the extension's native host does, spoken by hand
  const r = await api.exec(NAME, { cmd: ["node", "-e", AS_EXTENSION], env: [] });
  assert.equal(r.exitCode, 0, r.stderr);
  const out = JSON.parse(r.stdout.trim().split("\n").at(-1)!) as { hello: { output: { active: string; signedIn: boolean } }; match: { output: { items: Array<{ item: { itemId: string } }> } }; use: { output: { handle: string } }; fill: { output: { filled: boolean } }; bad: { error: { code: string } }; nonsense: { error: { code: string } }; noTokenStatus: number; lines: Array<Record<string, unknown>> };
  assert.deepEqual([out.hello.output.active, out.hello.output.signedIn], ["spc_sbtest", true], "the profile's agent is signed in to its one Space");
  assert.equal(out.match.output.items[0]!.item.itemId, "itm_login", "which items fit a page, from the Vault");
  assert.equal(out.use.output.handle, "#Login_Site");
  assert.ok(invokes.every((x) => x.who.agentId === "agt_pair" && x.who.asker === "usr_dana"), "every Vault question was asked as this profile's agent for the person who asked");
  assert.deepEqual(invokes.map((x) => x.cap), ["vault.items.match", "vault.use"]);
  assert.equal(out.fill.output.filled, true);
  assert.deepEqual(out.lines.find((l) => l["type"] === "fill"), { type: "fill", ref: "ag1-test", value: PASSWORD }, "the value was pushed to the extension once, for the one ref");
  assert.deepEqual(out.lines[0], { type: "agent.optin", spaces: ["spc_sbtest"], mode: "computer" });
  assert.ok(uses.includes("agt_pair:#Login_Site.password:filled"), "the Vault logged the use under the agent");
  assert.equal(out.bad.error.code, "not_allowed", "the extension may not ask for anything else");
  assert.equal(out.nonsense.error.code, "not_available");
  assert.equal(out.noTokenStatus, 401, "the bridge answers only a profile's own token");
  grant.revoke();
});

test("@heavy space browser: a file an agent downloads lands in its Files under Downloads, as the agent, and is gone from the browser service", { skip, timeout: 300_000 }, async () => {
  await tool("agt_dler", "chrome_open", { url: siteUrl("/whoami") });
  // a navigation to an attachment downloads it without leaving the page
  await tool("agt_dler", "chrome_eval", { expression: `(() => { const a = document.createElement("a"); a.href = ${JSON.stringify(siteUrl("/download?name=quarterly%20report.txt"))}; a.download = ""; document.body.appendChild(a); a.click(); return true; })()` });
  let rows: Array<{ name: string; size: number }> = [];
  for (let i = 0; i < 40 && rows.length === 0; i++) { await sleep(500); rows = await sb.downloads("agt_dler"); }
  assert.deepEqual(rows.map((x) => x.name), ["quarterly report.txt"], "Chrome saved it in the profile's downloads folder without asking");
  const h = harness({ principal: { kind: "agent", id: "agt_dler" }, actingFor: "usr_dana", respond: { "files.folder.create": () => ({ folder: { folderId: "fld_downloads" } }) } });
  const saved = await takeDownloads(h.ctx, sb, "agt_dler", "agt_dler");
  assert.deepEqual(saved.map((x) => x.path), ["Downloads/quarterly report.txt"], "the agent is told where");
  const made = h.calls("files.create");
  assert.equal(made.length, 1);
  assert.equal(made[0]!.input["folderId"], "fld_downloads");
  assert.equal(Buffer.from((made[0]!.input["content"] as { base64: string }).base64, "base64").toString(), "the contents of quarterly report.txt");
  assert.deepEqual(await sb.downloads("agt_dler"), [], "the browser service dropped its copy");
  const ls = await api.exec(NAME, { cmd: ["ls", "/data/profiles/agt_dler/downloads"], env: [] });
  assert.equal(ls.stdout.trim(), "");
});

test("@heavy space browser: every profile starts on the Vyre start page, shows its agent's name and face and the sites it opened, and another profile's browser cannot read them", { skip, timeout: 300_000 }, async () => {
  const face = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="#d9c8f2"/><circle cx="32" cy="28" r="12" fill="#222"/></svg>';
  await tool("agt_home", "chrome_status");
  await sb.tool({ profileId: "agt_home", tool: "chrome_open", args: { url: siteUrl("/whoami") }, timeoutMs: 30_000, agent: { name: "Dana's Assistant", faceSvg: face } });
  const first = (await tool("agt_home", "chrome_tabs", { action: "list" }))["tabs"] as Array<{ url: string }>;
  assert.ok(first.length >= 1);
  // the first tab was the start page before the agent navigated; open it again to read it (the browser carries the profile's cookie)
  await tool("agt_home", "chrome_open", { url: "http://127.0.0.1:7004/start?skin=graphite" });
  assert.match(await text("agt_home"), /Dana's Assistant/);
  const html = String((await tool("agt_home", "chrome_eval", { expression: "document.documentElement.outerHTML" }))["result"]);
  assert.match(html, /data:image\/svg\+xml;base64,/, "the face is inline: nothing to fetch");
  assert.ok(html.includes(GATEWAY), "the site it opened is in the row of recent sites");
  assert.match(html, /#161617/, "Graphite");
  fs.mkdirSync("/root/sbshots", { recursive: true });
  const shot = await sb.screenshot("agt_home");
  fs.writeFileSync("/root/sbshots/start-graphite.png", shot.bytes);
  await tool("agt_home", "chrome_open", { url: "http://127.0.0.1:7004/start?skin=light" });
  fs.writeFileSync("/root/sbshots/start-light.png", (await sb.screenshot("agt_home")).bytes);
  // another profile's browser has its own cookie: it sees no name and no sites
  await tool("agt_peek", "chrome_open", { url: "http://127.0.0.1:7004/start" });
  const peek = await text("agt_peek");
  assert.ok(!peek.includes("Dana's Assistant") && !peek.includes(GATEWAY), peek);
  // and a curl with no cookie from inside the container sees nothing either
  const bare = await api.exec(NAME, { cmd: ["node", "-e", "fetch('http://127.0.0.1:7004/start').then(r=>r.text()).then(t=>console.log(/Dana/.test(t)?'LEAK':'ok'))"], env: [] });
  assert.equal(bare.stdout.trim(), "ok");
});

// Audit bug 1 (12 Nov): every profile's browser shares the container's loopback. Agent B's pages and tools try every way to reach agent A's browser: its DevTools on 127.0.0.1 (list, version, new,
// activate, close, the page WebSocket), a cross-site request a page can send without reading the answer, and A's files (its bridge token) through a file address. None may work.
test("@heavy space browser: agent B's browser cannot reach agent A's browser: no DevTools on loopback for list, new, close, activate or a WebSocket, and no file of A's profile", { skip, timeout: 300_000 }, async () => {
  await tool("agt_victim", "chrome_open", { url: siteUrl("/set?name=victim&keep=1") });
  const victimTab = ((await tool("agt_victim", "chrome_tabs", { action: "list" }))["tabs"] as Array<{ tabId: string }>)[0]!.tabId;
  const tabsOfA = async (): Promise<number> => ((await tool("agt_victim", "chrome_tabs", { action: "list" }))["tabs"] as unknown[]).length;
  const before = await tabsOfA();
  await tool("agt_snoop", "chrome_open", { url: siteUrl("/whoami") });
  const got: Record<string, string> = {};
  const evalB = async (expression: string): Promise<string> => String((await tool("agt_snoop", "chrome_eval", { expression }))["result"]);
  // the DevTools ports the browsers used (9300 and up), and Chrome's usual one
  for (const port of [9222, 9300, 9301, 9302, 9303, 9304, 9305, 9306, 9307, 9308]) {
    const base = `http://127.0.0.1:${port}`;
    // A keeps working (the idle stop here is 3 s); a tab of A's that B closed shows here
    await tool("agt_victim", "chrome_state").catch((e: unknown) => { got[`A lost its tab by ${port}`] = e instanceof Error ? e.message : "failed"; });
    // the agent opens the list as a page and reads it
    try {
      const o = await tool("agt_snoop", "chrome_open", { url: `${base}/json/list` });
      const body = await evalB("document.body ? document.body.innerText.slice(0, 400) : ''");
      if (/webSocketDebuggerUrl|devtoolsFrontendUrl/.test(body) || String(o["title"]).includes("json")) got[`open ${port}/json/list`] = body.slice(0, 120);
    } catch { /* refused: good */ }
    // a page on the site asks without reading the answer (no-cors): close and activate are plain GETs
    const blind = await evalB(`(async () => { const out = []; for (const p of ["/json/version", "/json/activate/${victimTab}", "/json/close/${victimTab}"]) { try { await fetch(${JSON.stringify(base)} + p, { mode: "no-cors" }); out.push(p + ":sent"); } catch (e) { out.push(p + ":blocked"); } } return out.join(","); })()`).catch(() => "");
    if (/sent/.test(blind)) got[`no-cors ${port}`] = blind;
    // the page WebSocket of A's tab
    const ws = await evalB(`new Promise((res) => { try { const w = new WebSocket("ws://127.0.0.1:${port}/devtools/page/${victimTab}"); w.onopen = () => { w.close(); res("open"); }; w.onerror = () => res("error"); setTimeout(() => res("timeout"), 3000); } catch (e) { res("threw"); } })`).catch(() => "");
    if (ws === "open") got[`ws ${port}`] = ws;
  }
  // a same-origin page on the DevTools port can PUT /json/new; nothing answers on any of them
  for (const port of [9222, 9300, 9301, 9302]) {
    try {
      await tool("agt_snoop", "chrome_open", { url: `http://127.0.0.1:${port}/json/version` });
      const made = await evalB(`fetch("/json/new?${siteUrl("/whoami")}", { method: "PUT" }).then((r) => String(r.status)).catch(() => "blocked")`);
      if (made === "200") got[`put new ${port}`] = made;
    } catch { /* nothing there */ }
  }
  // a file of A's profile: its bridge token, opened as a tab (the browser service, not only the module, refuses it)
  for (const url of ["file:///data/profiles/agt_victim/bridge/admin.token", "file:///data/profiles/"]) {
    try {
      await tool("agt_snoop", "chrome_tabs", { action: "new", url });
      const body = await evalB("document.body ? document.body.innerText.slice(0, 200) : ''");
      if (body !== "" && !/blocked|ERR_BLOCKED|not available/i.test(body)) got[`file ${url}`] = body.slice(0, 60);
    } catch { /* refused: good */ }
  }
  // and nothing listens for DevTools in the container at all
  const listening = await api.exec(NAME, { cmd: ["sh", "-c", "cat /proc/net/tcp /proc/net/tcp6 2>/dev/null"], env: [] });
  const ports = new Set(listening.stdout.split("\n").slice(1).map((l) => l.trim().split(/\s+/)).filter((c) => c[3] === "0A" && c[1]).map((c) => parseInt(c[1]!.split(":")[1]!, 16)));
  for (const p of ports) if (p === 9222 || (p >= 9300 && p < 9500)) got[`listening ${p}`] = "yes";
  const after = await tabsOfA().catch(() => -1);
  if (after !== before) got["A's tab count"] = `${before} -> ${after}`;
  assert.deepEqual(got, {}, `B reached A's browser: ${JSON.stringify(got)}`);
  assert.equal(await text("agt_victim"), "set victim", "A's page is untouched");
});

// Audit bug 4 (12 Nov): the comments say the Space browser reaches only the Vault channel of the daemon. A stand-in daemon in this process applies the daemon's own rule (daemon.ts: a request that arrives on
// a network in computerSubnets() reaches only POST FILL_PATH). A page in the browser asks it for other routes by every name it has for the host.
test("@heavy space browser: with Engine access the service is on a network of its own, and a page in it reaches only the daemon's Vault channel, by the host's address or by host.docker.internal", { skip, timeout: 300_000 }, async () => {
  const daemon = createServer((req, res) => {
    const onNet = clientOnNetwork(req.socket.localAddress, req.socket.remoteAddress, computerSubnets());
    const path = (req.url ?? "").split("?")[0];
    res.setHeader("access-control-allow-origin", "*");
    if (onNet && !(req.method === "POST" && path === FILL_PATH)) { res.writeHead(403, { "content-type": "text/plain" }); res.end("refused"); return; }
    res.writeHead(200, { "content-type": "text/plain" }); res.end(`open ${req.method} ${path}`);
  });
  const port = await listen(daemon);
  bindSpaceBrowser(sbNet);
  try {
    await sbNet.tool({ profileId: "agt_netty", tool: "chrome_status", args: {}, timeoutMs: 30_000 });
    const info = JSON.parse(new TextDecoder().decode((await http({ method: "GET", path: `/containers/${NET_NAME}/json` })).body)) as { HostConfig: { NetworkMode: string }; NetworkSettings: { Networks: Record<string, { Gateway: string }> } };
    const gw = Object.values(info.NetworkSettings.Networks)[0]!.Gateway;
    const t = (name: string, args: Record<string, unknown>) => sbNet.tool({ profileId: "agt_netty", tool: name, args, timeoutMs: 30_000 });
    const seen: Record<string, string> = {};
    for (const host of [gw, "host.docker.internal"]) {
      await t("chrome_open", { url: `http://${host}:${port}/v1/capabilities/files.list` }).catch(() => undefined);
      seen[`open ${host}`] = String((await t("chrome_eval", { expression: "document.body.innerText.slice(0, 60)" }))["result"]);
      seen[`get ${host}`] = String((await t("chrome_eval", { expression: `fetch("http://${host}:${port}/local/daemon/stop").then((r) => r.text(), () => "unreachable")` }))["result"]);
      seen[`fill ${host}`] = String((await t("chrome_eval", { expression: `fetch("http://${host}:${port}${FILL_PATH}", { method: "POST", body: "{}" }).then((r) => r.text(), () => "unreachable")` }))["result"]);
    }
    assert.deepEqual(seen, {
      [`open ${gw}`]: "refused", [`get ${gw}`]: "refused", [`fill ${gw}`]: `open POST ${FILL_PATH}`,
      "open host.docker.internal": "refused", "get host.docker.internal": "refused", "fill host.docker.internal": `open POST ${FILL_PATH}`,
    }, "only the Vault channel answers a page in the Space browser");
    assert.equal(info.HostConfig.NetworkMode, `${NET_NAME}net`, "its own network, not the default bridge");
    const net = JSON.parse(new TextDecoder().decode((await http({ method: "GET", path: `/networks/${NET_NAME}net` })).body)) as { IPAM: { Config: Array<{ Subnet: string }> } };
    assert.deepEqual(computerSubnets(), [net.IPAM.Config[0]!.Subnet], "the daemon knows the service's network");
  } finally { bindSpaceBrowser(null); daemon.close(); }
});

// Audit B4 (12 Nov): the hold was enforced only inside browserd, which keeps it in memory. Through the module's own path (the capabilities an agent calls), every chrome_* tool must wait while a person has the
// controls, also after the browser service restarts during the takeover; and giving back must always work.
test("@heavy space browser: through the module every chrome tool of the agent waits while a person holds its browser, also after the browser service restarts, and giving back works", { skip, timeout: 300_000 }, async () => {
  const AG = "agt_held";
  const h = harness({ principal: { kind: "agent", id: AG }, actingFor: "usr_dana" });
  const dana = asPerson(h, { kind: "person", id: "usr_dana" }, { respond: { "agents.share_class": () => ({ class: "personal", ownerId: "usr_dana", people: [] }) } });
  bindSpaceBrowser(sb);
  try {
    await cap["computers.chrome.open"]!(h.ctx, { url: siteUrl("/ticker") });
    await cap["computers.browser.take_over"]!(dana.ctx, { agentId: AG });
    const all: Array<[string, Record<string, unknown>]> = [
      ["computers.chrome.open", { url: siteUrl("/whoami") }], ["computers.chrome.state", {}], ["computers.chrome.snapshot", {}], ["computers.chrome.screenshot", {}], ["computers.chrome.console", {}],
      ["computers.chrome.net", {}], ["computers.chrome.inspect", { ref: "e1" }], ["computers.chrome.sources", {}], ["computers.chrome.act", { ref: "e1", action: "click" }], ["computers.chrome.click", { x: 150, y: 150 }],
      ["computers.chrome.type", { text: "x" }], ["computers.chrome.fill", { fields: [{ ref: "e1", value: "x" }] }], ["computers.chrome.wait", { until: "time", value: "10" }], ["computers.chrome.eval", { expression: "1" }],
      ["computers.chrome.api", { method: "GET", url: siteUrl("/whoami") }], ["computers.chrome.send", { heldId: "hld_x" }], ["computers.chrome.tabs", { action: "list" }], ["computers.chrome.plan", { goal: "x" }], ["computers.chrome.resume", {}],
    ];
    const through = async (when: string): Promise<string[]> => {
      const wrong: string[] = [];
      for (const [name, input] of all) {
        const r = await cap[name]!(h.ctx, input).then(() => "ran", (e: unknown) => (codeOf(e) === "provider.unavailable" && /A person has the controls/.test(JSON.stringify(e)) ? "waited" : `refused otherwise: ${JSON.stringify(e).slice(0, 120)}`));
        if (r !== "waited") wrong.push(`${when} ${name}: ${r}`);
      }
      const b = await cap["computers.chrome.batch"]!(h.ctx, { steps: [{ tool: "state", args: {} }] }) as { results: Array<{ ok: boolean; result?: { error?: string } }> };
      if (b.results[0]!.ok || !/A person has the controls/.test(String(b.results[0]!.result?.error))) wrong.push(`${when} batch: ${JSON.stringify(b.results[0])}`);
      return wrong;
    };
    const wrong = await through("held");
    assert.equal((await cap["computers.chrome.status"]!(h.ctx, {})).connected, true, "a look at the status runs while it is held");
    // the browser service restarts under the person's hands
    const r = await http({ method: "POST", path: `/containers/${NAME}/restart`, query: { t: "5" } });
    assert.equal(r.status, 204, "the service restarted");
    wrong.push(...(await through("after the restart")));
    assert.deepEqual(wrong, [], "every tool waited");
    assert.equal((await sb.profiles()).profiles.find((p) => p.profileId === AG)?.takeoverBy, "usr_dana", "the restarted service was told who has the controls");
    const back = await cap["computers.browser.give_back"]!(dana.ctx, { agentId: AG }) as { profile: { takeoverBy?: string } };
    assert.equal(back.profile.takeoverBy, undefined);
    assert.equal(typeof (await cap["computers.chrome.state"]!(h.ctx, {})).url, "string", "given back, the agent works at once");
  } finally { bindSpaceBrowser(null); }
});

// Audit B9 (12 Nov): a download often showed only on a later step (a file had to be quiet for a second), and one over 20 MB stayed in the service, tried at every step and never reported.
test("@heavy space browser: the click that downloads a file reports it in the same step, and a file over 20 MB is reported once in plain words and not tried again", { skip, timeout: 300_000 }, async () => {
  const AG = "agt_clicker";
  const h = harness({ principal: { kind: "agent", id: AG }, actingFor: "usr_dana", respond: { "files.folder.create": () => ({ folder: { folderId: "fld_dl_clicker" } }) } });
  bindSpaceBrowser(sb);
  try {
    await cap["computers.chrome.open"]!(h.ctx, { url: siteUrl("/files") });
    const tree = String((await cap["computers.chrome.snapshot"]!(h.ctx, {})).tree);
    const refOf = (label: string): string => /\[ref=(e\d+)\]/.exec(tree.split("\n").find((l) => l.includes(`"${label}"`)) ?? "")?.[1] ?? "";
    const small = await cap["computers.chrome.click"]!(h.ctx, { ref: refOf("Invoice") });
    assert.deepEqual((small.downloads ?? []).map((d: { path: string }) => d.path), ["Downloads/invoice.txt"], `the click that downloaded it says so (${JSON.stringify(small)})`);
    const big = await cap["computers.chrome.click"]!(h.ctx, { ref: refOf("Archive") });
    const note = (big.downloads ?? []).find((d: { name: string }) => d.name === "archive.bin") as { note?: string; fileId?: string } | undefined;
    assert.ok(note && /more than the 20 MB/.test(String(note.note)) && note.fileId === undefined, `a file too large to move is reported with a plain line (${JSON.stringify(big)})`);
    const later = await cap["computers.chrome.state"]!(h.ctx, {});
    assert.equal(later.downloads, undefined, "and is not reported or tried again");
    assert.deepEqual(await sb.downloads(AG), [], "nothing is left waiting in the list");
  } finally { bindSpaceBrowser(null); }
});

// Review finding 1 (12 Nov): chrome_open with newTab, or after the last tab was closed, threw "newTab is not a function" (a local boolean hid the helper in agentd/chrome.ts, shared with agent computers).
test("@heavy space browser: chrome_open opens a new tab when asked, and opens a page after the last tab was closed", { skip, timeout: 300_000 }, async () => {
  await tool("agt_newtab", "chrome_open", { url: siteUrl("/whoami?n=1") });
  const before = ((await tool("agt_newtab", "chrome_tabs", { action: "list" }))["tabs"] as unknown[]).length;
  const opened = await tool("agt_newtab", "chrome_open", { url: siteUrl("/whoami?n=2"), newTab: true });
  assert.match(String(opened["url"]), /n=2/);
  const tabs = (await tool("agt_newtab", "chrome_tabs", { action: "list" }))["tabs"] as Array<{ tabId: string; url: string }>;
  assert.equal(tabs.length, before + 1, "one more tab");
  for (const t of tabs) await tool("agt_newtab", "chrome_tabs", { action: "close", tabId: t.tabId });
  assert.equal(((await tool("agt_newtab", "chrome_tabs", { action: "list" }))["tabs"] as unknown[]).length, 0, "every tab closed");
  const again = await tool("agt_newtab", "chrome_open", { url: siteUrl("/whoami?n=3") });
  assert.match(String(again["url"]), /n=3/, "a page opens in a new tab when none is left");
});

// Review finding 4 (12 Nov): the adapter repeated a whole call when the error said "not answering", which ctl also prints for an error after the request was sent. A step in flight when browserd dies must come
// back as an error, never be sent again by itself. What a dying browserd really produces is printed by the test.
test("@heavy space browser: a step in flight when browserd dies is an error to the agent and is not sent again", { skip, timeout: 300_000 }, async () => {
  // a browserd told to stop (TERM: it closes the browsers and answers) and one that is killed outright (KILL: the socket and the exec just end)
  for (const sig of ["TERM", "KILL"]) {
    const key = `die${sig}`;
    await tool("agt_dying", "chrome_open", { url: siteUrl("/whoami") });
    const step = tool("agt_dying", "chrome_open", { url: siteUrl(`/slow?k=${key}`) }).then(() => "answered", (e: unknown) => `refused: ${e instanceof Error ? e.message : String(e)}`);
    for (let i = 0; i < 50 && !slowHits.get(key); i++) await sleep(100);
    assert.equal(slowHits.get(key), 1, "the step reached the site");
    // browserd is the container's program: the container stops with it (and this exec with it)
    await api.exec(NAME, { cmd: ["sh", "-c", `kill -${sig} $(pgrep -f 'node /opt/browserd/main.ts')`], env: [] }).catch(() => undefined);
    const got = await step;
    console.log(`a step when browserd died (${sig}): ${got}`);
    await sleep(6000);
    assert.equal(slowHits.get(key), 1, `the step was not sent again (${sig}: ${got})`);
    assert.match(got, /^refused: /, "the agent is told it did not finish");
  }
  // and the service comes back for the next call
  await tool("agt_dying", "chrome_open", { url: siteUrl("/whoami") });
});

// Review finding 2 (12 Nov): when the give back did not reach browserd, browserd kept its own takeover and refused the agent for good while the Space said nobody held it.
test("@heavy space browser: a give back that does not reach browserd is repaired by the agent's next call through the module", { skip, timeout: 300_000 }, async () => {
  const AG = "agt_missed";
  const h = harness({ principal: { kind: "agent", id: AG }, actingFor: "usr_dana" });
  const dana = asPerson(h, { kind: "person", id: "usr_dana" }, { respond: { "agents.share_class": () => ({ class: "personal", ownerId: "usr_dana", people: [] }) } });
  const realGiveBack = sb.giveBack.bind(sb);
  bindSpaceBrowser(sb);
  try {
    await cap["computers.chrome.open"]!(h.ctx, { url: siteUrl("/whoami") });
    await cap["computers.browser.take_over"]!(dana.ctx, { agentId: AG });
    sb.giveBack = async () => { throw new ToolError("unavailable", "browserd stopped while it worked on the request"); };
    await cap["computers.browser.give_back"]!(dana.ctx, { agentId: AG });
    sb.giveBack = realGiveBack;
    assert.equal((await sb.profiles()).profiles.find((p) => p.profileId === AG)?.takeoverBy, "usr_dana", "browserd missed it and still holds its own copy");
    const out = await cap["computers.chrome.state"]!(h.ctx, {});
    assert.equal(typeof out.url, "string", "the agent works: its call carried the hold as the Space has it");
    assert.equal((await sb.profiles()).profiles.find((p) => p.profileId === AG)?.takeoverBy, undefined, "and browserd let go");
  } finally { sb.giveBack = realGiveBack; bindSpaceBrowser(null); }
});

// Review finding 5 (12 Nov): an install that already ran the Space browser kept its old container (old browserd with DevTools ports, old policy, the default bridge) after an update.
test("@heavy space browser: a container of an earlier release is replaced by this release's, and the profiles keep their sign-ins", { skip, timeout: 600_000 }, async () => {
  const old = createDockerSpaceBrowser({ api, name: UPG_NAME, image: OLD_IMAGE, user: { uid: 10001, gid: 10001 }, startTimeoutMs: 90_000 });
  await old.tool({ profileId: "agt_kept", tool: "chrome_open", args: { url: siteUrl("/set?name=kept&keep=1") }, timeoutMs: 30_000 });
  await old.stop("agt_kept");   // the sign-in is written to the profile folder
  const before = JSON.parse(new TextDecoder().decode((await http({ method: "GET", path: `/containers/${UPG_NAME}/json` })).body)) as { Id: string; Image: string; HostConfig: { NetworkMode: string } };
  assert.equal(before.HostConfig.NetworkMode, "bridge", "the earlier release's container is on the default bridge");
  const lines: string[] = [];
  const now = createDockerSpaceBrowser({ api, http, name: UPG_NAME, image: IMAGE, user: { uid: 10001, gid: 10001 }, startTimeoutMs: 90_000, log: (m) => lines.push(m) });
  await now.tool({ profileId: "agt_kept", tool: "chrome_open", args: { url: siteUrl("/whoami") }, timeoutMs: 30_000 });
  const after = JSON.parse(new TextDecoder().decode((await http({ method: "GET", path: `/containers/${UPG_NAME}/json` })).body)) as { Id: string; Image: string; HostConfig: { NetworkMode: string } };
  assert.notEqual(after.Id, before.Id, `replaced (${JSON.stringify(lines)})`);
  assert.equal(after.HostConfig.NetworkMode, `${UPG_NAME}net`, "on its own network now");
  const img = JSON.parse(new TextDecoder().decode((await http({ method: "GET", path: `/images/${encodeURIComponent(IMAGE)}/json` })).body)) as { Id: string };
  assert.equal(after.Image, img.Id, "made from this release's image");
  assert.ok(lines.some((l) => /replacing the container of an earlier release/.test(l)), JSON.stringify(lines));
  const who = String((await now.tool({ profileId: "agt_kept", tool: "chrome_eval", args: { expression: "document.body.innerText" }, timeoutMs: 30_000 }))["result"]);
  assert.equal(who, "cookie:[sid=kept]", "the profile kept its sign-in across the replacement");
  const listening = await api.exec(UPG_NAME, { cmd: ["sh", "-c", "cat /proc/net/tcp /proc/net/tcp6 2>/dev/null"], env: [] });
  const open = listening.stdout.split("\n").slice(1).map((l) => l.trim().split(/\s+/)).filter((c) => c[3] === "0A" && c[1]).map((c) => parseInt(c[1]!.split(":")[1]!, 16)).filter((p) => p === 9222 || (p >= 9300 && p < 9500));
  assert.deepEqual(open, [], "and no DevTools port is open in it");
  // a second adapter of the same release leaves it alone
  const again = createDockerSpaceBrowser({ api, http, name: UPG_NAME, image: IMAGE, user: { uid: 10001, gid: 10001 }, startTimeoutMs: 90_000, log: (m) => lines.push(m) });
  await again.tool({ profileId: "agt_kept", tool: "chrome_state", args: {}, timeoutMs: 30_000 });
  const third = JSON.parse(new TextDecoder().decode((await http({ method: "GET", path: `/containers/${UPG_NAME}/json` })).body)) as { Id: string };
  assert.equal(third.Id, after.Id, "a container of this release is not replaced");
});

test("@heavy space browser: a profile's tabs come back after its browser stops after idle", { skip, timeout: 300_000 }, async () => {
  await tool("agt_tabby", "chrome_open", { url: siteUrl("/whoami?tab=one") });
  await tool("agt_tabby", "chrome_tabs", { action: "new", url: siteUrl("/whoami?tab=two") });
  let stopped = false;
  for (let i = 0; i < 40 && !stopped; i++) { await sleep(1000); stopped = (await sb.profiles()).profiles.find((x) => x.profileId === "agt_tabby")?.running === false; }
  assert.ok(stopped, "the browser stopped after idle");
  let urls: string[] = [];
  for (let i = 0; i < 20; i++) {
    urls = ((await tool("agt_tabby", "chrome_tabs", { action: "list" }))["tabs"] as Array<{ url: string }>).map((t) => t.url);
    if (urls.some((u) => u.includes("tab=one")) && urls.some((u) => u.includes("tab=two"))) break;
    await sleep(500);
  }
  assert.ok(urls.some((u) => u.includes("tab=one")) && urls.some((u) => u.includes("tab=two")), `both tabs are back (${JSON.stringify(urls)})`);
});

test("@heavy space browser: the sites a profile is signed in to are listed while its browser sleeps, and listing starts nothing", { skip, timeout: 300_000 }, async () => {
  await tool("agt_sleepy", "chrome_open", { url: siteUrl("/set?name=zed&keep=1") });
  assert.ok((await sb.sessions("agt_sleepy")).some((x) => x.site === GATEWAY), "live while it runs");
  let asleep = false;
  for (let i = 0; i < 40 && !asleep; i++) { await sleep(1000); asleep = (await sb.profiles()).profiles.find((x) => x.profileId === "agt_sleepy")?.running === false; }
  assert.ok(asleep, "the browser stopped after idle");
  const rows = await sb.sessions("agt_sleepy");
  assert.ok(rows.some((x) => x.site === GATEWAY), `listed from what was kept when it closed (${JSON.stringify(rows)})`);
  assert.equal((await sb.profiles()).profiles.find((x) => x.profileId === "agt_sleepy")?.running, false, "listing started nothing");
  assert.deepEqual(await sb.sessions("agt_never_seen"), [], "a profile that never ran has none, and starts nothing");
  assert.equal((await sb.profiles()).profiles.find((x) => x.profileId === "agt_never_seen")?.running ?? false, false);
});
