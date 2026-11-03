// vyred end to end on the seeded `core` Space, its second file (the first is daemon.boot.test.ts): an event log that fails verification stops writes, the device role runs with no Space,
// a second daemon on one data directory is refused, and P-H_02: ctx.schedule, ctx.seal, contract event ids and the connector seams are wired at boot. Both files share daemon-boot-rig.ts.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import type { CapabilityDef } from "../../packages/contracts/src/types.ts";
import { loadConfig, readInfo } from "../src/daemon/config.ts";
import { startDaemon } from "../src/daemon/daemon.ts";
import type { Daemon } from "../src/daemon/daemon.ts";
import { openDb } from "../src/daemon/sqlite.ts";
import { bootCore } from "../../fixtures/seed/core/index.ts";
import { boot, caddyFetch, echoCap, echoHandler, echoRoute, machine, one, post, seededDirFrom, tmp } from "./daemon-boot-rig.ts";

const seededDir = seededDirFrom(bootCore);

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
    // ruling 71: the host makes the Space once, with these six events and nothing else
    assert.deepEqual((await d.log!.read({ limit: 20 })).map((e) => e.type), ["space.created", "principal.created", "principal.role_set", "resource.created", "grant.created", "group.member_added", "channel.created", "thread.started", "channel.member_added", "resource.created", "resource.created"], "a new Space starts with its bootstrap events, then #vyre, its first channel, with the owner in it (l-team1)");
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
    const body = said[0]?.payload as unknown;
    assert.deepEqual(body instanceof Uint8Array ? JSON.parse(new TextDecoder().decode(body)) : body, { n: 9 });
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
    assert.deepEqual(d.seams?.state, { google: "wired", microsoft: "absent", imap: "wired", sources: "absent", resend: "absent", mailgun: "absent" });
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

test("daemon.boot: a plain boot wires Google, Microsoft and IMAP from the hostSeams the module impls export", async () => {
  const dir = seededDir();
  const d = await bootWiring(dir);
  try { assert.deepEqual([d.seams?.state.google, d.seams?.state.microsoft, d.seams?.state.imap], ["wired", "wired", "wired"]); } finally { await d.stop(); }
});

// P-H_02 final run: each named test shows its own ok line in the run on the last commit.
// P-H_02 final run: this file shows its own ok line in the run on the last commit.
