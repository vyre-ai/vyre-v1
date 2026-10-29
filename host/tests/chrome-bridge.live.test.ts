// P-L10_06b: the Chrome bridge answers on a real booted daemon. /chrome-bridge/v1/rpc and /chrome-bridge/v1/events are the two endpoints the native messaging host (apps/chrome/src/worker/native/host.js)
// talks to; before this they existed only in a fake daemon in the extension's tests. Here the daemon is the real one on the seeded Space, and the rest of the daemon's HTTP face still works beside them.
// The extension side of the same chain (host -> framed Chrome messages) is in apps/chrome/tests/ext-core.test.ts and ext-agent.real.test.ts.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { bootCore, CORE_SPACE } from "../../fixtures/seed/core/index.ts";
import { fakePlatform } from "../src/platform/index.ts";
import type { FetchFn } from "../src/platform/probes.ts";
import { loadConfig } from "../src/daemon/config.ts";
import { startDaemon } from "../src/daemon/daemon.ts";
import type { Daemon } from "../src/daemon/daemon.ts";
import { ChromeToolError } from "../src/bridge/chrome.ts";

const caddyFetch: FetchFn = () => Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, text: () => Promise.resolve('{"apps":{"http":{}}}') });

function seededDir(): string {
  const core = bootCore();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-chrome-bridge-"));
  core.store.db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE");
  fs.copyFileSync(core.file, path.join(dir, "events.db"));
  core.close();
  return dir;
}

async function boot(): Promise<Daemon> {
  const dir = seededDir();
  return startDaemon({
    config: loadConfig(["--role", "space,device", "--data-dir", dir, "--port", "0"], {}, "1.2.3"),
    platform: fakePlatform({
      os: "linux", hostname: "chrome-bridge", free: 80e9,
      commands: {
        [`findmnt -n -o SOURCE --target ${dir}`]: { stdout: "/dev/mapper/vyre\n" },
        "lsblk -s -n -o TYPE /dev/mapper/vyre": { stdout: "crypt\ndisk\n" },
        "docker info --format {{.ServerVersion}}": { stdout: "27.1.1\n" },
      },
    }),
    fetch: caddyFetch,
    intervals: { fast: 3_600_000, slow: 3_600_000, encryption: 3_600_000, commands: 3_600_000, hooks: 3_600_000 },
  });
}

/** A capability over HTTP as the Space's owner, with the daemon's own token (the person this computer belongs to; how the app does it), for setting up what the extension then uses. */
async function asOwner(d: Daemon, cap: string, input: object): Promise<{ status: number; body: any }> {   // eslint-disable-line @typescript-eslint/no-explicit-any
  const r = await fetch(`${d.url}/v1/${cap.replaceAll(".", "/")}`, { method: "POST", headers: { authorization: `Bearer ${d.token}`, "content-type": "application/json" }, body: JSON.stringify({ idempotencyKey: `cb-${cap}-${Math.random()}`, ...input }) });
  return { status: r.status, body: await r.json() };
}
/** The person unlocks their vault on this computer, as the app does after a password sign-in (POST /local/vault/key/unlock with the daemon's own token). */
async function unlock(d: Daemon): Promise<void> {
  const r = await fetch(`${d.url}/local/vault/key/unlock`, { method: "POST", headers: { authorization: `Bearer ${d.token}`, "content-type": "application/json" }, body: JSON.stringify({ key: Buffer.alloc(32, 7).toString("base64") }) });
  assert.equal(r.status, 204);
}
const out = async (r: Response): Promise<any> => (await r.json()) as any;   // eslint-disable-line @typescript-eslint/no-explicit-any

const rpc = (d: Daemon, body: unknown, token: string | null = d.token): Promise<Response> =>
  fetch(`${d.url}/chrome-bridge/v1/rpc`, { method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });

/** Open the events stream and collect its lines until `n` have arrived. */
function events(d: Daemon, token: string): { lines: unknown[]; status: Promise<number>; until(n: number): Promise<void>; close(): void } {
  const lines: unknown[] = [];
  let req!: http.ClientRequest;
  let resolveStatus!: (n: number) => void;
  const status = new Promise<number>((r) => { resolveStatus = r; });
  let wake: (() => void) | null = null;
  req = http.get(`${d.url}/chrome-bridge/v1/events`, { headers: { authorization: `Bearer ${token}` } }, (res) => {
    resolveStatus(res.statusCode ?? 0);
    let buf = "";
    res.setEncoding("utf8");
    res.on("data", (c: string) => {
      buf += c;
      let at: number;
      while ((at = buf.indexOf("\n")) >= 0) { const l = buf.slice(0, at).trim(); buf = buf.slice(at + 1); if (l) lines.push(JSON.parse(l)); }
      wake?.();
    });
    res.on("error", () => {});
  });
  req.on("error", () => {});
  return {
    lines, status,
    until: async (n) => { for (let i = 0; i < 300 && lines.length < n; i++) await new Promise<void>((r) => { wake = r; setTimeout(r, 20); }); },
    close: () => req.destroy(),
  };
}

test("chrome bridge: a booted daemon answers /chrome-bridge/v1/rpc and /events, refuses a wrong token, and keeps its own routes", async () => {
  const d = await boot();
  try {
    assert.ok(d.chromeBridge, "the daemon has a Chrome bridge");
    assert.equal((await fetch(`${d.url}/healthz`)).status, 200, "the daemon's own routes still answer");
    assert.equal((await fetch(`${d.url}/v1/nope/nothing`, { method: "POST", headers: { authorization: `Bearer ${d.token}` }, body: "{}" })).status, 404, "and the gateway still owns every other path");

    assert.equal((await rpc(d, { id: "r0", type: "bridge", op: "hello", input: {} }, null)).status, 401, "no token");
    assert.equal((await rpc(d, { id: "r0", type: "bridge", op: "hello", input: {} }, "wrong")).status, 401, "a wrong token");
    const sameLength = d.token.slice(0, -1) + (d.token.endsWith("a") ? "b" : "a");
    assert.equal(sameLength.length, d.token.length);
    assert.equal((await rpc(d, { id: "r0", type: "bridge", op: "hello", input: {} }, sameLength)).status, 401, "a wrong token of the same length");
    assert.equal((await fetch(`${d.url}/chrome-bridge/v1/events`)).status, 401, "the events stream needs the token too");

    const ok = await rpc(d, { id: "r1", type: "bridge", op: "agent.event", input: { event: "driving", agent: "agt_scout", tabId: "t1" } });
    assert.equal(ok.status, 200);
    assert.deepEqual(await ok.json(), { id: "r1", ok: true, output: {} });
    // Before this change the bridge answered hello (and every invoke) with not_available; it now answers for the Space this daemon hosts, as the person who owns it.
    const hello = await out(await rpc(d, { id: "r2", type: "bridge", op: "hello", input: {} }));
    assert.equal(hello.ok, true, JSON.stringify(hello));
    assert.equal(hello.output.version, "1.2.3");
    assert.deepEqual(hello.output.spaces.map((x: { id: string }) => x.id), [CORE_SPACE]);
    assert.equal(hello.output.active, CORE_SPACE);
    assert.equal(hello.output.locked, true, "the vault is locked until the person unlocks it on this computer");
    assert.match(hello.output.spaces[0].webUrl, /^http:\/\/127\.0\.0\.1:\d+$/);
    const noAsk = await out(await rpc(d, { id: "r2b", type: "bridge", op: "ask.page", input: {} }));
    assert.equal(noAsk.error.code, "not_available", "Ask about this page is not connected yet and says so");
    const nope = await out(await rpc(d, { id: "r2c", type: "invoke", capability: "access.share", input: {} }));
    assert.equal(nope.error.code, "not_allowed", "the extension may call its nine vault capabilities and nothing else");
    const asAgent = await out(await rpc(d, { id: "r2d", type: "invoke", capability: "vault.items.match", agent: "agt_scout", input: { url: "https://x.example" } }));
    assert.equal(asAgent.error.code, "not_allowed", "an agent never gets the person's vault through the extension door");
    const elsewhere = await out(await rpc(d, { id: "r2e", type: "invoke", capability: "vault.items.match", space: "spc_elsewhere", input: { url: "https://x.example" } }));
    assert.equal(elsewhere.error.code, "not_available");
    assert.equal((await out(await rpc(d, { id: "r2f", type: "bridge", op: "space.select", input: { id: "spc_elsewhere" } }))).ok, false);
    assert.equal((await out(await rpc(d, { id: "r2g", type: "bridge", op: "space.select", input: { id: CORE_SPACE } }))).output.active, CORE_SPACE);
    assert.equal((await rpc(d, "nonsense")).status, 200);
    const bad = await fetch(`${d.url}/chrome-bridge/v1/rpc`, { method: "POST", headers: { authorization: `Bearer ${d.token}` }, body: "{not json" });
    assert.equal(bad.status, 400);
  } finally { await d.stop(); }
});

test("chrome bridge: an agent tool call reaches a connected extension on the events stream and its result, or its failure with the extension's code, comes back through rpc", async () => {
  const d = await boot();
  const stream = events(d, d.token);
  try {
    assert.equal(await stream.status, 200);
    d.chromeBridge.optIn(["spc_core"], "computer");
    await stream.until(1);
    assert.deepEqual(stream.lines[0], { type: "agent.optin", spaces: ["spc_core"], mode: "computer" });

    const call = d.chromeBridge.callTool({ tool: "chrome_status", agent: { id: "agt_scout", name: "Scout" }, space: "spc_core" });
    await stream.until(2);
    const cmd = stream.lines[1] as { type: string; id: string; tool: string; agent: { id: string }; space: string };
    assert.equal(cmd.type, "agent.call");
    assert.equal(cmd.tool, "chrome_status");
    assert.deepEqual([cmd.agent.id, cmd.space], ["agt_scout", "spc_core"]);
    const back = await rpc(d, { id: "r3", type: "bridge", op: "agent.result", input: { callId: cmd.id, ok: true, output: { tabs: 1 } } });
    assert.equal(back.status, 200);
    assert.deepEqual(await call, { tabs: 1 });

    const second = d.chromeBridge.callTool({ tool: "chrome_act", agent: { id: "agt_scout", name: "Scout" }, space: "spc_core" });
    await stream.until(3);
    // the rejection is awaited from the moment the call is made, so it never settles unobserved
    const refused = assert.rejects(second, (e: unknown) => e instanceof ChromeToolError && e.code === "paused");
    await rpc(d, { id: "r5", type: "bridge", op: "agent.result", input: { callId: (stream.lines[2] as { id: string }).id, ok: false, error: { code: "paused", message: "The person stopped the agent." } } });
    await refused;
  } finally {
    stream.close();
    await d.stop();
  }
});

const SECRET = "Tr0ub4dor&3-fixture";
const invoke = async (d: Daemon, capability: string, input: object): Promise<any> => out(await rpc(d, { id: `i${Math.random()}`, type: "invoke", capability, input }));   // eslint-disable-line @typescript-eslint/no-explicit-any

test("chrome bridge: the extension finds a login, has the vault filler push it into a page ref, checks and saves a login, all as the person and under their own grants", async () => {
  const d = await boot();
  const stream = events(d, d.token);
  try {
    assert.equal(await stream.status, 200);
    const folder = await asOwner(d, "vault.folders.create", { name: "Team logins", scope: "shared" });
    assert.equal(folder.status, 200, JSON.stringify(folder.body));
    const put = await asOwner(d, "vault.item.put", { folderId: folder.body.data.folder.id, name: "Acme portal", kind: "login", fields: [{ key: "url", value: "https://portal.acme.test" }, { key: "username", value: "dana@acme.test" }, { key: "password", value: SECRET, secret: true }] });
    assert.equal(put.status, 200, JSON.stringify(put.body));

    // the popup: logins for this page, by name, never a value
    const match = await invoke(d, "vault.items.match", { url: "https://portal.acme.test" });
    assert.equal(match.ok, true, JSON.stringify(match));
    assert.deepEqual(match.output.items.map((x: { item: { name: string } }) => x.item.name), ["Acme portal"]);
    assert.ok(!JSON.stringify(match).includes(SECRET) && !JSON.stringify(match).includes("dana@acme.test"));
    assert.deepEqual((await invoke(d, "vault.items.match", { url: "https://elsewhere.test" })).output.items, []);
    const itemId = match.output.items[0].item.id as string;

    // the fill: use gives a handle, fill asks the vault filler to put the field into a ref the extension minted; the value arrives on the events stream and in no reply
    const used = await invoke(d, "vault.use", { item: itemId, purpose: "fill portal.acme.test" });
    assert.equal(used.ok, true, JSON.stringify(used));
    assert.ok(used.output.fields.includes("password") && used.output.fields.includes("username"));
    const filled = await invoke(d, "vault.fill", { handle: `${used.output.handle}.password`, target: { kind: "browser", ref: "w1-0a1b2c" } });
    assert.equal(filled.ok, true, JSON.stringify(filled));
    assert.equal(filled.output.filled, true);
    assert.ok(!JSON.stringify(filled).includes(SECRET), "the reply to the extension carries no value");
    await stream.until(1);
    assert.deepEqual(stream.lines[0], { type: "fill", ref: "w1-0a1b2c", value: SECRET }, "the filler pushed the value for that ref, once");

    // login check: nothing is revealed, only known, changed or new
    const check = async (username: string, password: string): Promise<any> => out(await rpcFor(d, { op: "login.check", input: { origin: "https://portal.acme.test", username, password, kind: "signin" } }));   // eslint-disable-line @typescript-eslint/no-explicit-any
    assert.deepEqual((await check("dana@acme.test", SECRET)).output, { state: "known", name: "Acme portal", itemId });
    assert.deepEqual((await check("dana@acme.test", "a-newer-password")).output, { state: "changed", name: "Acme portal", itemId });
    assert.deepEqual((await check("someone.else@acme.test", "whatever")).output, { state: "new" });
    assert.equal(stream.lines.length, 1, "a check compares inside the daemon: nothing was pushed to the page");

    // nobody on the stream: the filler cannot deliver, and says so instead of claiming it filled
    stream.close();
    for (let i = 0; i < 100 && d.chromeBridge.connected > 0; i++) await new Promise((r) => setTimeout(r, 20));
    const lost = await invoke(d, "vault.fill", { handle: `${used.output.handle}.password`, target: { kind: "browser", ref: "w2-ffffff" } });
    assert.equal(lost.ok, false);
    assert.equal(lost.error.code, "provider.unavailable");

    // saving: the person's own Mine folder needs their vault key on this computer
    const locked = await invoke(d, "vault.folders.list", { scope: "mine" });
    assert.equal((await out(await rpc(d, { id: "h1", type: "bridge", op: "hello", input: {} }))).output.locked, true);
    await unlock(d);
    assert.equal((await out(await rpc(d, { id: "h2", type: "bridge", op: "hello", input: {} }))).output.locked, false, "unlocking in the app unlocks the extension's view");
    const mine = await asOwner(d, "vault.folders.create", { name: "My logins", scope: "mine" });
    assert.equal(mine.status, 200, JSON.stringify(mine.body));
    const folders = await invoke(d, "vault.folders.list", { scope: "mine" });
    assert.equal(locked.ok, true, "listing folders never needed the key");
    const home = folders.output.folders.find((f: { yourLevel: string }) => f.yourLevel === "manage" || f.yourLevel === "edit");
    assert.ok(home, JSON.stringify(folders));
    const saved = await invoke(d, "vault.item.put", { folderId: home.id, name: "Bank", kind: "login", fields: [{ key: "url", value: "https://bank.example" }, { key: "username", value: "pat" }, { key: "password", value: SECRET + "-bank", secret: true }] });
    assert.equal(saved.ok, true, JSON.stringify(saved));
    assert.deepEqual((await invoke(d, "vault.items.match", { url: "https://bank.example" })).output.items.map((x: { item: { name: string } }) => x.item.name), ["Bank"]);
    assert.equal((await out(await rpcFor(d, { op: "login.check", input: { origin: "https://bank.example", username: "pat", password: SECRET + "-bank", kind: "signin" } }))).output.state, "known", "a Mine item opens with the person's key");
    const updated = await invoke(d, "vault.item.update", { itemId: saved.output.item.id, fieldsSet: [{ key: "password", value: "rotated", secret: true }] });
    assert.equal(updated.ok, true, JSON.stringify(updated));
    assert.equal((await out(await rpcFor(d, { op: "login.check", input: { origin: "https://bank.example", username: "pat", password: "rotated", kind: "signin" } }))).output.state, "known");

    // the person locks their vault: their Mine items answer "locked", in the words the popup knows
    assert.equal((await fetch(`${d.url}/local/vault/key/lock`, { method: "POST", headers: { authorization: `Bearer ${d.token}` } })).status, 204);
    const afterLock = await out(await rpcFor(d, { op: "login.check", input: { origin: "https://bank.example", username: "pat", password: "rotated", kind: "signin" } }));
    assert.equal(afterLock.ok, true);
    assert.equal(afterLock.output.state, "new", "a locked Mine item cannot be compared, so it is not claimed as known");

    // no value ever reached a log
    d.sink.flush();
    const logs = JSON.stringify(d.sink.db.prepare("SELECT msg,attrs FROM logs").all());
    assert.ok(!logs.includes(SECRET) && !logs.includes("rotated"));
  } finally {
    stream.close();
    await d.stop();
  }
});

/** A request to the bridge as the native host sends it. */
function rpcFor(d: Daemon, o: { op: string; input: object }): Promise<Response> {
  return rpc(d, { id: `b${Math.random()}`, type: "bridge", op: o.op, input: o.input });
}

test("chrome bridge: the person chooses which Space's agents may drive their Chrome, and a tool call needs that, a token, and an agent the person can see", async () => {
  const d = await boot();
  const stream = events(d, d.token);
  const local = (p: string, init: RequestInit & { token?: string | null } = {}): Promise<Response> =>
    fetch(`${d.url}${p}`, { ...init, headers: { ...(init.token === null ? {} : { authorization: `Bearer ${init.token ?? d.token}` }), "content-type": "application/json" } });
  try {
    assert.equal(await stream.status, 200);
    assert.equal((await local("/local/chrome/optin", { token: null })).status, 401, "no token");
    assert.equal((await local("/local/chrome/optin", { token: "wrong" })).status, 401);
    assert.deepEqual((await out(await local("/local/chrome/optin"))).data.spaces, [], "off until the person turns it on");
    const call = { tool: "chrome_status", agent: { id: "agt_scout", name: "Scout" } };
    const refused = await local("/local/chrome/tool", { method: "POST", body: JSON.stringify(call) });
    assert.equal(refused.status, 403);
    assert.match((await out(refused)).error.message, /not let this Space's agents/);
    assert.equal((await local("/local/chrome/tool", { method: "POST", body: "{}" })).status, 422, "a call that names no tool or agent is a bad input");

    // the choice: a Space this computer does not host is dropped; the extension is told at once
    const set = await out(await local("/local/chrome/optin", { method: "PUT", body: JSON.stringify({ spaces: [CORE_SPACE, "spc_other"] }) }));
    assert.deepEqual(set.data.spaces, [CORE_SPACE]);
    await stream.until(1);
    assert.deepEqual(stream.lines[0], { type: "agent.optin", spaces: [CORE_SPACE], mode: "personal" });
    assert.deepEqual((await out(await local("/local/chrome/optin"))).data.spaces, [CORE_SPACE]);

    // an agent the person cannot see is refused by authorize, as the person
    const stranger = await local("/local/chrome/tool", { method: "POST", body: JSON.stringify({ tool: "chrome_status", agent: { id: "agt_nobody", name: "Nobody" } }) });
    assert.ok(stranger.status === 403 || stranger.status === 502, `an unknown agent is refused (${stranger.status})`);
    assert.equal(stream.lines.length, 1, "nothing was sent to the browser for it");

    // the extension answers a tool call for an agent the person can see
    const made = await asOwner(d, "agents.create", { name: "Rhea", template: "blank" });
    assert.equal(made.status, 200, JSON.stringify(made.body));
    {
      const agentId = made.body.data.agent.agentId as string;
      const run = local("/local/chrome/tool", { method: "POST", body: JSON.stringify({ tool: "chrome_status", agent: { id: agentId, name: "Rhea" } }) });
      await stream.until(2);
      const cmd = stream.lines[1] as { type: string; id: string; tool: string; space: string; agent: { id: string } };
      assert.deepEqual([cmd.type, cmd.tool, cmd.space, cmd.agent.id], ["agent.call", "chrome_status", CORE_SPACE, agentId]);
      await rpc(d, { id: "t1", type: "bridge", op: "agent.result", input: { callId: cmd.id, ok: true, output: { connected: true } } });
      const done = await run;
      assert.equal(done.status, 200);
      assert.deepEqual((await out(done)).data, { connected: true });
    }
    // turning it off tells the extension, and a call is refused again
    assert.deepEqual((await out(await local("/local/chrome/optin", { method: "PUT", body: JSON.stringify({ spaces: [] }) }))).data.spaces, []);
    assert.equal((await local("/local/chrome/tool", { method: "POST", body: JSON.stringify(call) })).status, 403);
  } finally {
    stream.close();
    await d.stop();
  }
});
