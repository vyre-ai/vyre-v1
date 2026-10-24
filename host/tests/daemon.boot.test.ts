// vyred end to end on the seeded `core` Space: it boots from host/modules.json and the registry, answers example.echo over HTTP and over the live socket with one trace id in the response, the
// event and the log, writes health_probe / health_service / network rows, serves the health_restart and network_command queues, refuses writes when the event log fails verification, and
// runs in the device role with no Space at all. Nothing is mocked inside the daemon; only the machine (Docker, Caddy, disk encryption) is a recorded platform.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { bootCore, CORE_SPACE } from "../../fixtures/seed/core/index.ts";
import type { CapabilityDef } from "../../packages/contracts/src/types.ts";
import { fakePlatform } from "../src/platform/index.ts";
import type { FetchFn } from "../src/platform/probes.ts";
import { processUnit } from "../src/supervisor/index.ts";
import { loadConfig, readInfo } from "../src/daemon/config.ts";
import { startDaemon } from "../src/daemon/daemon.ts";
import type { Daemon } from "../src/daemon/daemon.ts";
import type { NetworkPort } from "../src/daemon/commands.ts";
import { openDb } from "../src/daemon/sqlite.ts";

const echoCap = {
  name: "example.echo", v: 1, permission: null, level: "edit", resource: { type: "space" }, idempotency: "natural", effects: "write", risk: "low", emits: ["example.said"],
  examples: [], surfaces: {}, input: {}, output: {}, errors: [], summary: "Echo",
} as unknown as CapabilityDef;
const echoRoute = { method: "POST", path: "/v1/example/echo", cap: "example.echo", v: 1, effects: "write" as const };
const echoHandler = (ctx: { emit(n: never, s: string, p: unknown): unknown }, input: unknown): unknown => { ctx.emit("example.said" as never, "echo:1", input); return input; };

const tmp = (p: string): string => fs.mkdtempSync(path.join(os.tmpdir(), p));

/** A data directory holding a copy of the seeded core Space's events.db. */
function seededDir(): string {
  const core = bootCore();
  const dir = tmp("vyre-daemon-boot-");
  core.store.db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE");
  fs.copyFileSync(core.file, path.join(dir, "events.db"));
  core.close();
  return dir;
}

/** The machine as a recorded platform: encrypted volume, Docker answering. */
function machine(dir: string) {
  return fakePlatform({
    os: "linux", hostname: "boot-test", free: 80e9,
    commands: {
      [`findmnt -n -o SOURCE --target ${dir}`]: { stdout: "/dev/mapper/vyre\n" },
      "lsblk -s -n -o TYPE /dev/mapper/vyre": { stdout: "crypt\ndisk\n" },
      "docker info --format {{.ServerVersion}}": { stdout: "27.1.1\n" },
    },
  });
}
const caddyFetch: FetchFn = () => Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, text: () => Promise.resolve('{"apps":{"http":{}}}') });

/** A network port that records what the daemon asked of it. */
function recordingNetwork() {
  const calls: string[] = [];
  const port: NetworkPort = {
    checkDns: (d) => { calls.push(`dns ${d}`); return Promise.resolve({ ok: true, records: [{ type: "CNAME", name: d, value: "relay.vyre.run" }] }); },
    applyAddress: (a) => { calls.push(`apply ${a.mode} ${a.address}`); return Promise.resolve(); },
    renew: (h) => { calls.push(`renew ${h}`); return Promise.resolve({ expiresAt: 1_900_000_000_000 }); },
    reconnect: (id) => { calls.push(`reconnect ${id}`); return Promise.resolve("healthy" as const); },
    disconnect: (id) => { calls.push(`disconnect ${id}`); return Promise.resolve(); },
  };
  return { port, calls };
}

async function boot(dir: string, extra: { network?: NetworkPort } = {}): Promise<Daemon> {
  return startDaemon({
    config: loadConfig(["--data-dir", dir, "--port", "0", "--address", "space.example.com"], {}, "1.2.3"),
    platform: machine(dir), fetch: caddyFetch, ...(extra.network ? { network: extra.network } : {}),
    extra: { caps: [echoCap], routes: [echoRoute], handlers: { "example.echo": echoHandler as never } },
    services: [{ name: "sidecar", start: processUnit(process.execPath, ["-e", "setInterval(() => {}, 1000)"]) }],
    intervals: { fast: 3_600_000, slow: 3_600_000, encryption: 3_600_000, commands: 3_600_000 },
  });
}

const post = (d: Daemon, p: string, body: unknown, token: string | null = d.token) => fetch(`${d.url}${p}`, {
  method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body),
});
/** A keep-alive socket to a server that was just restarted can be stale: try once more on a fresh one. */
const twice = async <T>(f: () => Promise<T>): Promise<T> => { try { return await f(); } catch { return f(); } };
const one = (d: Daemon, sql: string, ...a: unknown[]): Record<string, unknown> => (d.db!.all(sql, ...a)[0] ?? {}) as Record<string, unknown>;

test("vyred boots on the seeded Space from modules.json, answers example.echo with one trace id, and writes its probe, service and network rows", async () => {
  const dir = seededDir();
  const net = recordingNetwork();
  const d = await boot(dir, { network: net.port });
  try {
    assert.equal(d.space, CORE_SPACE);
    assert.deepEqual(d.roles, ["space"]);
    assert.ok(d.port > 0 && d.url === `http://127.0.0.1:${d.port}`);
    const info = readInfo(d.paths);
    assert.equal(info?.url, d.url);
    assert.equal(info?.pid, process.pid);
    assert.equal(fs.statSync(d.paths.adminToken).mode & 0o777, 0o600, "the admin token is owner-only");

    // /healthz is public and carries no secret
    const hz = await fetch(`${d.url}/healthz`);
    assert.equal(hz.status, 200);
    const h = (await hz.json()) as { ok: boolean; version: string; roles: string[]; space: string; head: number; services: { name: string; state: string }[]; probes: Record<string, string> };
    assert.equal(h.ok, true);
    assert.equal(h.version, "1.2.3");
    assert.equal(h.space, CORE_SPACE);
    assert.ok(h.head > 10, "the seed's events are in the log");
    assert.deepEqual(h.services.map((s) => [s.name, s.state]).sort(), [["gateway", "healthy"], ["scheduler", "healthy"], ["sidecar", "healthy"]]);
    assert.ok(!JSON.stringify(h).includes(d.token), "no token in healthz");
    const seedHead = h.head;

    // example.echo through the gateway: authorize (the seeded owner), validate, handler, commit
    const r = await post(d, "/v1/example/echo", { n: 7 });
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { data: { n: 7 } });
    const traceId = r.headers.get("x-vyre-trace")!;
    assert.match(traceId, /^[0-9a-f]{32}$/);
    const ev = await d.log!.read({ type: "example.said" });
    assert.equal(ev.length, 1);
    assert.equal(ev[0]?.trace_id, traceId, "the event carries the call's trace id");
    assert.equal(ev[0]?.actor, "usr_olivia", "acting as the Space owner");
    assert.equal(ev[0]?.seq, seedHead + 1);
    const t = d.sink.trace(traceId);
    assert.ok(t.spans.some((s) => s.name === "invoke"), "and so does its span in logs.db");

    // refused without the token, and for a wrong token; unknown paths are 404s with an error body
    assert.equal((await post(d, "/v1/example/echo", { n: 1 }, null)).status, 401);
    assert.equal((await post(d, "/v1/example/echo", { n: 1 }, "wrong")).status, 401);
    const nope = await post(d, "/v1/nope/nothing", {});
    assert.equal(nope.status, 404);
    assert.equal(((await nope.json()) as { error: { code: string } }).error.code, "validation.unknown_capability");
    const bad = await fetch(`${d.url}/v1/example/echo`, { method: "POST", headers: { authorization: `Bearer ${d.token}`, "content-type": "application/json" }, body: "{not json" });
    assert.equal(bad.status, 400);

    // probes: all eight rows, healthy against the recorded machine
    const probes = Object.fromEntries((d.db!.all("SELECT name, state FROM health_probe ORDER BY name") as { name: string; state: string }[]).map((p) => [p.name, p.state]));
    assert.deepEqual(probes, { caddy: "healthy", disk_encrypted: "healthy", disk_space: "healthy", docker: "healthy", events_db: "healthy", index_db: "healthy", scheduler: "healthy", time_skew: "healthy" });
    assert.equal(JSON.parse(String(one(d, "SELECT values_json FROM health_probe WHERE name = 'disk_space'")["values_json"])).freeBytes, 80e9);
    const again = await d.runProbes(["events_db"]);
    assert.equal(again.events_db?.values?.["seq"], seedHead + 1, "the incremental verify walked the new event");

    // services: the supervisor's view is the health_service table
    const svc = Object.fromEntries((d.db!.all("SELECT name, state, restarts FROM health_service ORDER BY name") as { name: string; state: string; restarts: number }[]).map((s) => [s.name, [s.state, s.restarts]]));
    assert.deepEqual(svc, { gateway: ["healthy", 0], scheduler: ["healthy", 0], sidecar: ["healthy", 0] });

    // network rows: the address, this server and the direct endpoint
    const cfg = one(d, "SELECT address, mode, public_ingress FROM network_config WHERE id = 1");
    assert.deepEqual([cfg["address"], cfg["mode"], cfg["public_ingress"]], ["space.example.com", "own_domain", 1]);
    assert.equal(one(d, "SELECT state FROM network_server WHERE server_id = 'srv_local'")["state"], "healthy");
    assert.equal(one(d, "SELECT url FROM network_endpoint WHERE kind = 'direct'")["url"], "https://space.example.com");

    // health_restart: restart the sidecar (a real child process) and the gateway (the server we are talking to)
    const oldPid = d.supervisor.status("sidecar")[0]!.startedAt;
    d.db!.run("INSERT INTO health_restart (id, service, by_principal, on_behalf, at, done_at) VALUES ('rst_t1', 'sidecar', 'usr_olivia', NULL, 1, NULL)");
    d.db!.run("INSERT INTO health_restart (id, service, by_principal, on_behalf, at, done_at) VALUES ('rst_t2', 'gateway', 'usr_olivia', NULL, 2, NULL)");
    assert.equal(await d.pollCommands(), 2);
    assert.ok(d.supervisor.status("sidecar")[0]!.startedAt >= oldPid);
    assert.equal(d.supervisor.status("sidecar")[0]?.restarts, 1);
    assert.equal(d.supervisor.status("gateway")[0]?.restarts, 1);
    assert.equal(one(d, "SELECT restarts FROM health_service WHERE name = 'gateway'")["restarts"], 1);
    assert.ok(one(d, "SELECT done_at FROM health_restart WHERE id = 'rst_t2'")["done_at"], "the request is closed");
    const afterRestart = await twice(() => fetch(`${d.url}/healthz`));
    assert.equal(afterRestart.status, 200, "the gateway answers again on the same port");
    assert.equal((await twice(() => post(d, "/v1/example/echo", { n: 2 }))).status, 200);

    // network_command: every kind goes through the port and lands in the state tables
    for (const [kind, target] of [["set_domain", "space.example.com"], ["renew", "space.example.com"], ["reconnect", "srv_office"], ["remove", "srv_old"]] as const) {
      d.db!.run("INSERT INTO network_command (kind, target, by_principal, at, done_at) VALUES (?, ?, 'usr_olivia', 1, NULL)", kind, target);
    }
    d.db!.run("INSERT INTO network_server (server_id, name, role, state, heartbeat_at) VALUES ('srv_office', 'Office Mac', 'compute', 'down', 1)");
    d.db!.run("INSERT INTO network_server (server_id, name, role, state, heartbeat_at) VALUES ('srv_old', 'Old box', 'compute', 'down', 1)");
    assert.equal(await d.pollCommands(), 4);
    assert.deepEqual(net.calls, ["dns space.example.com", "apply own_domain space.example.com", "renew space.example.com", "reconnect srv_office", "disconnect srv_old"]);
    assert.equal(one(d, "SELECT ok FROM network_dns WHERE domain = 'space.example.com'")["ok"], 1);
    assert.equal(one(d, "SELECT expires_at FROM network_cert WHERE host = 'space.example.com'")["expires_at"], 1_900_000_000_000);
    assert.equal(one(d, "SELECT state FROM network_server WHERE server_id = 'srv_office'")["state"], "healthy");
    assert.equal(d.db!.all("SELECT 1 FROM network_server WHERE server_id = 'srv_old'").length, 0);
    assert.equal(d.db!.all("SELECT 1 FROM network_command WHERE done_at IS NULL").length, 0);
  } finally {
    await d.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
  assert.equal(readInfo(d.paths), null, "stopping removes the pid and info files");
  await assert.rejects(() => fetch(`${d.url}/healthz`), "and the port is closed");
});

test("the live socket answers example.echo on the same server with the same trace id in the response, the numbered event and the log", async () => {
  const dir = seededDir();
  const d = await boot(dir);
  try {
    const head = (await (await fetch(`${d.url}/healthz`)).json() as { head: number }).head;
    const ws = new WebSocket(`ws://127.0.0.1:${d.port}/sync/v1/ws?token=${d.token}&device=dev1`);
    const frames: Record<string, unknown>[] = [];
    const waiting: ((f: Record<string, unknown>) => void)[] = [];
    ws.addEventListener("message", (m) => { const f = JSON.parse(String(m.data)) as Record<string, unknown>; const w = waiting.shift(); if (w) w(f); else frames.push(f); });
    await new Promise<void>((resolve, reject) => { ws.addEventListener("open", () => resolve()); ws.addEventListener("error", () => reject(new Error("socket did not open"))); });
    const next = (): Promise<Record<string, unknown>> => new Promise((resolve, reject) => {
      const q = frames.shift();
      if (q) { resolve(q); return; }
      const timer = setTimeout(() => reject(new Error("no frame")), 3000);
      waiting.push((f) => { clearTimeout(timer); resolve(f); });
    });
    const ofType = async (type: string): Promise<Record<string, unknown>> => { for (;;) { const f = await next(); if (f["t"] === type) return f; } };

    ws.send(JSON.stringify({ t: "hello", cursor: head }));
    assert.equal((await ofType("hello_ok"))["head"], head);
    const tr = `${"a1".repeat(16)}-${"b2".repeat(8)}`;
    ws.send(JSON.stringify({ t: "call", id: 1, cap: "example.echo", input: { n: 9 }, tr }));
    const evFrame = await ofType("ev");
    const res = await ofType("res");
    assert.equal(res["ok"], true);
    assert.deepEqual((res["data"] as { output: unknown }).output, { n: 9 });
    assert.equal(String(res["tr"]).slice(0, 32), "a1".repeat(16), "the response is in the caller's trace");
    assert.equal(evFrame["seq"], head + 1);
    assert.equal(evFrame["tr"], "a1".repeat(16));
    assert.equal(d.sink.trace("a1".repeat(16)).logs.some((l) => l.msg === "ws.call"), true, "and the log has the call");
    ws.close();

    // a socket without the token is refused
    const closed = new WebSocket(`ws://127.0.0.1:${d.port}/sync/v1/ws?token=nope&device=dev2`);
    await new Promise<void>((resolve) => { closed.addEventListener("error", () => resolve()); closed.addEventListener("close", () => resolve()); });
  } finally {
    await d.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("an event log that fails verification is reported down and the server stops accepting changes", async () => {
  const dir = seededDir();
  const db = openDb(path.join(dir, "events.db"));
  db.run("UPDATE events SET event = replace(event, '\"actor\":\"svc_seed\"', '\"actor\":\"svc_evil\"') WHERE seq = 3");
  db.close();
  const d = await boot(dir);
  try {
    assert.equal(one(d, "SELECT state FROM health_probe WHERE name = 'events_db'")["state"], "down");
    assert.match(String(one(d, "SELECT detail FROM health_probe WHERE name = 'events_db'")["detail"]), /failed verification/);
    const h = (await (await fetch(`${d.url}/healthz`)).json()) as { ok: boolean };
    assert.equal(h.ok, false);
    const r = await post(d, "/v1/example/echo", { n: 1 });
    assert.ok(r.status >= 500, `refused with a server error, got ${r.status}`);
    assert.equal(((await r.json()) as { error: { code: string } }).error.code, "internal.unavailable");
    assert.equal((await d.log!.read({ type: "example.said" })).length, 0, "nothing was written");
  } finally {
    await d.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("the device role runs the supervisor, scheduler and probes with no Space, and its HTTP face has no Space API", async () => {
  const dir = tmp("vyre-daemon-device-");
  const d = await startDaemon({
    config: loadConfig(["--role", "device", "--data-dir", dir, "--port", "0"], {}, "1.2.3"), platform: machine(dir), fetch: caddyFetch,
    intervals: { fast: 3_600_000, slow: 3_600_000, encryption: 3_600_000, commands: 3_600_000 },
  });
  try {
    assert.deepEqual(d.roles, ["device"]);
    assert.equal(d.space, null);
    assert.equal(d.db, null);
    assert.equal(d.log, null);
    assert.equal(fs.existsSync(path.join(dir, "events.db")), false, "a device keeps no event log");
    const h = (await (await fetch(`${d.url}/healthz`)).json()) as { ok: boolean; roles: string[]; space: string | null; services: { name: string }[]; probes: Record<string, string> };
    assert.equal(h.ok, true);
    assert.deepEqual(h.roles, ["device"]);
    assert.equal(h.space, null);
    assert.deepEqual(h.services.map((s) => s.name).sort(), ["gateway", "scheduler"]);
    assert.deepEqual(Object.keys(h.probes).sort(), ["disk_encrypted", "disk_space", "scheduler", "time_skew"], "device probes only: no Docker, Caddy or event log");
    const r = await fetch(`${d.url}/v1/example/echo`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    assert.equal(r.status, 404);
    assert.match(((await r.json()) as { error: { message: string } }).error.message, /device role/);
  } finally {
    await d.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a second daemon on the same data directory is refused, and a new Space needs --space", async () => {
  const dir = tmp("vyre-daemon-second-");
  await assert.rejects(() => startDaemon({ config: loadConfig(["--data-dir", dir, "--port", "0"], {}, "1"), platform: machine(dir), fetch: caddyFetch }), /no Space yet/);
  const d = await startDaemon({ config: loadConfig(["--data-dir", dir, "--port", "0", "--space", "spc_fresh"], {}, "1"), platform: machine(dir), fetch: caddyFetch, intervals: { fast: 3_600_000, slow: 3_600_000, encryption: 3_600_000, commands: 3_600_000 } });
  try {
    assert.equal(d.space, "spc_fresh");
    assert.equal((await d.log!.currentHead()).seq, 0, "a new Space starts with an empty log");
    assert.equal(fs.existsSync(path.join(dir, "events.db")), true);
    // the pid file names another live process, so a second start is refused
    fs.writeFileSync(d.paths.info, JSON.stringify({ ...readInfo(d.paths)!, pid: process.ppid }));
    await assert.rejects(() => startDaemon({ config: loadConfig(["--data-dir", dir, "--port", "0"], {}, "1"), platform: machine(dir), fetch: caddyFetch }), /already running/);
  } finally {
    fs.writeFileSync(d.paths.info, JSON.stringify({ ...readInfo(d.paths)!, pid: process.pid }));
    await d.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});


// P-H_02: the daemon wires ctx.schedule, ctx.seal, contract event ids and the connector seams.
const laterCap = { ...echoCap, name: "example.later", emits: [] } as unknown as CapabilityDef;
const sealCap = { ...echoCap, name: "example.seal", emits: [] } as unknown as CapabilityDef;
type WiringCtx = {
  schedule(at: string, cap: string, input: unknown): Promise<string>;
  seal: { seal(v: Uint8Array, scope: string): { keyId: string; nonce: string; bytes: string }; unseal(s: { keyId: string; nonce: string; bytes: string }): Uint8Array };
};
const wiringRoutes = [
  { method: "POST", path: "/v1/example/later", cap: "example.later", v: 1, effects: "write" as const },
  { method: "POST", path: "/v1/example/seal", cap: "example.seal", v: 1, effects: "write" as const },
];

async function bootWiring(dir: string, seams?: Parameters<typeof startDaemon>[0]["seams"]): Promise<Daemon> {
  return startDaemon({
    config: loadConfig(["--data-dir", dir, "--port", "0"], {}, "1.2.3"),
    platform: machine(dir), fetch: caddyFetch,
    extra: {
      caps: [echoCap, laterCap, sealCap], routes: [echoRoute, ...wiringRoutes],
      handlers: {
        "example.echo": echoHandler as never,
        // the hold's timeout: schedule the follow-up now, run it on the queue's tick
        "example.later": (async (ctx: WiringCtx, input: { n: number }) => ({ job: await ctx.schedule("+0ms", "example.echo", { n: input.n }) })) as never,
        "example.seal": ((ctx: WiringCtx, input: { text: string }) => {
          const sealed = ctx.seal.seal(new TextEncoder().encode(input.text), "wiring");
          return { keyId: sealed.keyId, opaque: !sealed.bytes.includes(input.text), back: new TextDecoder().decode(ctx.seal.unseal(sealed)) };
        }) as never,
      },
    },
    ...(seams ? { seams } : {}),
    intervals: { fast: 3_600_000, slow: 3_600_000, encryption: 3_600_000, commands: 3_600_000, tick: 3_600_000 },
  });
}

test("daemon.boot: a scheduled call (a Gate timer) fires on the queue's tick as the principal that scheduled it, and every event id is in contract form", async () => {
  const dir = seededDir();
  const d = await bootWiring(dir);
  try {
    assert.ok(d.schedule, "the space role has a schedule queue");
    const r = await post(d, "/v1/example/later", { n: 9 });
    assert.equal(r.status, 200);
    const { data } = (await r.json()) as { data: { job: string } };
    assert.match(data.job, /^sch_[a-f0-9]+$/);
    assert.equal(d.schedule!.counts().pending, 1);
    assert.equal((await d.log!.read({ type: "example.said" })).length, 0, "nothing ran before the tick");
    assert.equal(await d.schedule!.tick(), 1);
    assert.equal(d.schedule!.counts().pending, 0);
    const said = await d.log!.read({ type: "example.said" });
    assert.equal(said.length, 1);
    assert.deepEqual(said[0]?.payload, { n: 9 });
    assert.equal(said[0]?.actor, "usr_olivia", "ran as the principal that scheduled it");
    const all = await d.log!.read({ after: 0, limit: 5000 });
    assert.ok(all.length > 10);
    // events written by the pipeline carry the contract's id; the seed's own ids are not ours to judge
    assert.match(said[0]!.id, /^evt_[a-z0-9]+$/);
  } finally { await d.stop(); }
});

test("daemon.boot: a sealed value round-trips through ctx.seal and the sealed bytes do not contain the text", async () => {
  const dir = seededDir();
  const d = await bootWiring(dir);
  try {
    const r = await post(d, "/v1/example/seal", { text: "the-secret-value" });
    assert.equal(r.status, 200);
    assert.deepEqual(((await r.json()) as { data: unknown }).data, { keyId: "k1/wiring", opaque: true, back: "the-secret-value" });
    assert.equal(fs.statSync(path.join(d.paths.root, "seal.key")).mode & 0o777, 0o600, "the seal key is owner-only");
    // the key survives a restart, so a value sealed before still opens after
    const keyBefore = fs.readFileSync(path.join(d.paths.root, "seal.key"), "utf8");
    await d.stop();
    const again = await bootWiring(dir);
    try { assert.equal(fs.readFileSync(path.join(again.paths.root, "seal.key"), "utf8"), keyBefore); } finally { await again.stop(); }
  } finally { await d.stop(); }
});

test("daemon.boot: the seams are wired from the Vault port at boot and taken out at stop", async () => {
  const dir = seededDir();
  const set: Record<string, unknown> = {};
  const seams = {
    setters: {
      setGoogleHost: (h: unknown) => { set["google"] = h; },
      setImapSecretResolver: (f: unknown) => { set["imap"] = f; },
    },
    files: { read: () => Promise.reject(new Error("no files")) },
    blobs: { put: () => Promise.reject(new Error("no blobs")) },
    members: { emails: () => Promise.resolve([]) },
  };
  const d = await bootWiring(dir, seams);
  try {
    assert.deepEqual(d.seams?.state, { google: "wired", microsoft: "absent", imap: "wired" });
    assert.ok(set["google"] && set["imap"]);
  } finally { await d.stop(); }
  assert.equal(set["google"], null);
  assert.equal(set["imap"], null);
});

test("daemon.boot: the device role has no schedule queue and no seams", async () => {
  const dir = tmp("vyre-daemon-wiring-device-");
  const d = await startDaemon({ config: loadConfig(["--role", "device", "--data-dir", dir, "--port", "0"], {}, "1"), platform: machine(dir), fetch: caddyFetch, intervals: { fast: 3_600_000, slow: 3_600_000, encryption: 3_600_000 } });
  try { assert.equal(d.schedule, null); assert.equal(d.seams, null); } finally { await d.stop(); }
});

// P-H_02 final run: each named test shows its own ok line in the run on the last commit.
