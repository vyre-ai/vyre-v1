// P-H_06 (rulings 31 and 32): the host wires every setter a module exports through `hostSeams` by name, runs the consumers and periodic jobs the live modules export, and a booted daemon
// reports which modules still lack a driver. Pure wiring first, then hook collection, then a booted daemon on the seeded `core` Space (nothing mocked inside the daemon).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { bootCore } from "../../fixtures/seed/core/index.ts";
import type { CapabilityDef } from "../../packages/contracts/src/types.ts";
import type { Ctx } from "../../packages/contracts/src/ctx.ts";
import { fakePlatform } from "../src/platform/index.ts";
import type { FetchFn } from "../src/platform/probes.ts";
import { loadConfig } from "../src/daemon/config.ts";
import { startDaemon } from "../src/daemon/daemon.ts";
import type { Daemon } from "../src/daemon/daemon.ts";
import { collectHooks, MAX_TRIES, RUNS_ESCALATION_EVERY_MS, toHookEvent } from "../src/daemon/consumers.ts";
import type { HookEvent, ModuleHooks } from "../src/daemon/consumers.ts";
import { BUILTIN_DRIVERS, createPushPort, wireSeams } from "../src/seams/index.ts";
import type { SeamDeps, SeamSetters } from "../src/seams/index.ts";
import type { StoredEvent } from "../../kernel/src/log/index.ts";

const tmp = (p: string): string => fs.mkdtempSync(path.join(os.tmpdir(), p));
const deps = (extra: Partial<SeamDeps> = {}): SeamDeps => ({
  vault: { secret: () => Promise.reject(new Error("no vault")), signRs256: () => Promise.reject(new Error("no vault")) },
  files: { read: () => Promise.reject(new Error("no files")) },
  blobs: { put: () => Promise.reject(new Error("no blobs")) },
  members: { emails: () => Promise.resolve([]) },
  space: "spc_test",
  ...extra,
});

// ---------------------------------------------------------------- wireSeams

test("seams.generic: a setter is called with the driver registered under its name, and taken out again at unwire", () => {
  const got: Record<string, unknown> = {};
  const setters = { setGoogleHost: (h: unknown) => { got["google"] = h; }, setConfigureThing: (c: unknown) => { got["thing"] = c; } } as unknown as SeamSetters;
  const w = wireSeams(setters, deps({ drivers: { setConfigureThing: () => ({ answer: 42 }) } }));
  assert.deepEqual(w.wired.sort(), ["setConfigureThing", "setGoogleHost"]);
  assert.deepEqual(w.missing, []);
  assert.deepEqual(got["thing"], { answer: 42 });
  assert.ok(got["google"], "a built-in driver was built");
  assert.equal(w.state.google, "wired");
  assert.equal(w.state.imap, "absent");
  w.unwire();
  assert.equal(got["google"], null);
  assert.equal(got["thing"], null);
});

test("seams.generic: a setter nobody has a driver for is reported with the module that offered it, not ignored and not a boot failure", () => {
  const called: string[] = [];
  const setters = { setImapSecretResolver: () => { called.push("imap"); }, setMysteryPort: () => { called.push("mystery"); } } as unknown as SeamSetters;
  const w = wireSeams(setters, deps({ owners: new Map([["setMysteryPort", "mystery"], ["setImapSecretResolver", "mail"]]) }));
  assert.deepEqual(called, ["imap"], "the setter without a driver is never called");
  assert.deepEqual(w.wired, ["setImapSecretResolver"]);
  assert.equal(w.missing.length, 1);
  assert.equal(w.missing[0]!.setter, "setMysteryPort");
  assert.equal(w.missing[0]!.module, "mystery");
  assert.match(w.missing[0]!.reason, /no driver/i);
});

test("seams.generic: a driver that throws is reported as missing with its reason and the other seams still wire", () => {
  const got: unknown[] = [];
  const setters = { setBroken: () => { got.push("broken"); }, setFine: (v: unknown) => { got.push(v); } } as unknown as SeamSetters;
  const w = wireSeams(setters, deps({ drivers: { setBroken: () => { throw new Error("no key"); }, setFine: () => "fine" } }));
  assert.deepEqual(got, ["fine"]);
  assert.deepEqual(w.wired, ["setFine"]);
  assert.match(w.missing[0]!.reason, /no key/);
});

test("seams.generic: the built-in registry covers the connector and mail-driver seams, and a push port without a transport refuses to send", async () => {
  assert.deepEqual(Object.keys(BUILTIN_DRIVERS).sort(), ["setGithubHost", "setGoogleHost", "setImapSecretResolver", "setMailgunHost", "setMsHost", "setResendHost", "setSourcesSecretResolver", "setStripeHost", "setTwilioHost"]);
  const port = createPushPort();
  await assert.rejects(() => port.send({ device: "d", platform: "ios", token: "t", title: "x", deepLink: "vyre://x", tag: "t" }), /No push transport/);
  const sent: string[] = [];
  const live = createPushPort({ send: (m) => { sent.push(m.device); return Promise.resolve("ok"); }, spaceName: () => "Northwind" });
  assert.equal(await live.send({ device: "dev1", platform: "ios", token: "t", title: "x", deepLink: "vyre://x", tag: "t" }), "ok");
  assert.deepEqual(sent, ["dev1"]);
  assert.equal(await live.spaceName?.("spc_test"), "Northwind");
});

// ---------------------------------------------------------------- collectHooks

test("seams.generic: collectHooks reads ctx-style consumers and periodic jobs, ignores kernel projections, and maps the runs alerts by name", async () => {
  const ran: unknown[] = [];
  const h = collectHooks("notifications", {
    handlers: {},
    consumers: {
      "notifications.fanout": { on: ["task.requested"], run: (_c: unknown, e: HookEvent) => { ran.push(e.name); return []; } },
      "access.acl": { mode: "async", on: { "grant.created": () => {} }, version: 1 },   // a kernel projection: not ours
      "bad.shape": { on: "task.requested", run: () => {} },
    },
    periodic: { "notifications.digest": { everyMs: 5000, run: () => { ran.push("digest"); } }, "bad.period": { everyMs: 0, run: () => {} } },
  });
  assert.deepEqual(h.consumers.map((c) => c.name), ["notifications.fanout"]);
  assert.deepEqual(h.periodic.map((p) => p.name), ["notifications.digest"]);
  assert.deepEqual(h.consumers[0]!.on, ["task.requested"]);
  await h.consumers[0]!.run({} as Ctx, { name: "task.requested" } as HookEvent);
  await h.periodic[0]!.run({} as Ctx);
  assert.deepEqual(ran, ["task.requested", "digest"]);

  const calls: string[] = [];
  const r = collectHooks("runs", {
    onRunFailed: (_c: unknown, ev: { runId: string }) => { calls.push(`failed:${ev.runId}`); return Promise.resolve({ alerted: true }); },
    sweepEscalations: () => { calls.push("sweep"); return Promise.resolve([]); },
  });
  assert.deepEqual(r.consumers.map((c) => [c.name, c.on]), [["runs.alerts", ["run.failed"]]]);
  assert.deepEqual(r.periodic.map((p) => [p.name, p.everyMs]), [["runs.escalations", RUNS_ESCALATION_EVERY_MS]]);
  await r.consumers[0]!.run({} as Ctx, { name: "run.failed", payload: { runId: "run_1" } } as unknown as HookEvent);
  await r.periodic[0]!.run({} as Ctx);
  assert.deepEqual(calls, ["failed:run_1", "sweep"]);
});

test("seams.generic: toHookEvent decodes a JSON payload, names the subject, and leaves a sealed payload empty", () => {
  const base = { seq: 7, id: "evt_a", type: "task.assigned", entity: "task", entity_id: "tsk_1", actor: "usr_a", trace_id: "t".repeat(32), at: 5, enc: 0, depth: 0 };
  const open = toHookEvent({ ...base, payload: new TextEncoder().encode(JSON.stringify({ taskId: "tsk_1" })) } as unknown as StoredEvent);
  assert.deepEqual([open.name, open.subject, open.payload, open.seq], ["task.assigned", "task/tsk_1", { taskId: "tsk_1" }, 7]);
  const sealed = toHookEvent({ ...base, enc: 1, payload: new Uint8Array([1, 2, 3]) } as unknown as StoredEvent);
  assert.deepEqual(sealed.payload, {});
});

// ---------------------------------------------------------------- a booted daemon

const echoCap = {
  name: "example.echo", v: 1, permission: null, level: "edit", resource: { type: "space" }, idempotency: "natural", effects: "write", risk: "low", emits: ["example.said"],
  examples: [], surfaces: {}, input: {}, output: {}, errors: [], summary: "Echo",
} as unknown as CapabilityDef;
const echoRoute = { method: "POST", path: "/v1/example/echo", cap: "example.echo", v: 1, effects: "write" as const };
const echoHandler = (ctx: { emit(n: never, s: string, p: unknown): unknown }, input: unknown): unknown => { ctx.emit("example.said" as never, "echo:1", input); return input; };

function seededDir(): string {
  const core = bootCore();
  const dir = tmp("vyre-seams-generic-");
  core.store.db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE");
  fs.copyFileSync(core.file, path.join(dir, "events.db"));
  core.close();
  return dir;
}
function machine(dir: string) {
  return fakePlatform({
    os: "linux", hostname: "seams-test", free: 80e9,
    commands: {
      [`findmnt -n -o SOURCE --target ${dir}`]: { stdout: "/dev/mapper/vyre\n" },
      "lsblk -s -n -o TYPE /dev/mapper/vyre": { stdout: "crypt\ndisk\n" },
      "docker info --format {{.ServerVersion}}": { stdout: "27.1.1\n" },
    },
  });
}
const caddyFetch: FetchFn = () => Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, text: () => Promise.resolve('{"apps":{"http":{}}}') });

async function boot(dir: string, o: Partial<Parameters<typeof startDaemon>[0]> = {}): Promise<Daemon> {
  return startDaemon({
    config: loadConfig(["--data-dir", dir, "--port", "0"], {}, "1.2.3"),
    platform: machine(dir), fetch: caddyFetch,
    extra: { caps: [echoCap], routes: [echoRoute], handlers: { "example.echo": echoHandler as never } },
    intervals: { fast: 3_600_000, slow: 3_600_000, encryption: 3_600_000, commands: 3_600_000, hooks: 3_600_000 },
    ...o,
  });
}
const echo = (d: Daemon, body: unknown) => fetch(`${d.url}/v1/example/echo`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${d.token}` }, body: JSON.stringify(body) });
const probe = (d: Daemon, name: string): Record<string, unknown> => (d.db!.all("SELECT state, detail, values_json FROM health_probe WHERE name = ?", name)[0] ?? {}) as Record<string, unknown>;
/** Pump until the pass has nothing left, a few times over, so a consumer that retries has had its tries. */
const settle = async (d: Daemon, times = MAX_TRIES + 1): Promise<void> => { for (let i = 0; i < times; i++) await d.hooks!.pump(); };

test("seams.generic: a plain boot wires every setter the module impls export, the modules that need a driver have one, and health says so", async () => {
  const d = await boot(seededDir());
  try {
    assert.deepEqual(d.seams?.missing, [], "no module is left without its driver on a plain boot");
    for (const name of ["setGoogleHost", "setMsHost", "setImapSecretResolver", "setEventsHost", "setEventsDispatch"]) assert.ok(d.seams?.wired.includes(name), `${name} is wired`);
    assert.deepEqual(probe(d, "module_drivers"), {}, "health lists only what is missing, so a complete boot adds no row");
    assert.ok(d.hooks!.consumers.some((c) => c.name === "notifications.fanout"), "the live notifications module's fanout consumer is registered from its exports");
  } finally { await d.stop(); }
});

test("seams.generic: the notifications push port is wired by name, refuses to send without a transport, and uses the one the daemon is given", async () => {
  const held: { port: ReturnType<typeof createPushPort> | null } = { port: null };
  const sent: string[] = [];
  const d = await boot(seededDir(), {
    seams: { setters: { setPushPort: (p: unknown) => { held.port = p as ReturnType<typeof createPushPort> | null; } } as unknown as SeamSetters, push: { send: (m) => { sent.push(m.device); return Promise.resolve("ok"); }, computerIdleMs: () => Promise.resolve(undefined) } },
  });
  try {
    assert.deepEqual(d.seams?.wired, ["setPushPort"]);
    assert.ok(held.port, "the setter was called with a port");
    assert.equal(await held.port!.send({ device: "dev1", platform: "ios", token: "t", title: "x", deepLink: "vyre://x", tag: "t" }), "ok");
    assert.deepEqual(sent, ["dev1"]);
  } finally { await d.stop(); }
  assert.equal(held.port, null, "the port is taken back out at stop");
  const bare: { port: ReturnType<typeof createPushPort> | null } = { port: null };
  const d2 = await boot(seededDir(), { seams: { setters: { setPushPort: (p: unknown) => { bare.port = p as ReturnType<typeof createPushPort> | null; } } as unknown as SeamSetters } });
  try { await assert.rejects(() => bare.port!.send({ device: "d", platform: "ios", token: "t", title: "x", deepLink: "vyre://x", tag: "t" }), /No push transport/); } finally { await d2.stop(); }
});

test("seams.generic: a module that exports a setter the host has no driver for still boots, and the daemon lists it as missing in health and in the log", async () => {
  const d = await boot(seededDir(), { seams: { setters: { setMysteryPort: () => {}, setGoogleHost: () => {} } as unknown as SeamSetters } });
  try {
    assert.deepEqual(d.seams?.missing.map((m) => m.setter), ["setMysteryPort"]);
    const row = probe(d, "module_drivers");
    assert.equal(row["state"], "degraded");
    assert.match(String(row["detail"]), /setMysteryPort/);
    assert.deepEqual(JSON.parse(String(row["values_json"])), { missing: 1, wired: 1 });
  } finally { await d.stop(); }
});

test("seams.generic: a consumer runs once per matching event as the host service with a working ctx, what it emits commits, and a restart does not repeat it", async () => {
  const dir = seededDir();
  const seen: { n: unknown; from: unknown; space: string; principal: string; origin: string; rows: number }[] = [];
  const hooks = (): ModuleHooks[] => [{
    module: "notifications", periodic: [],
    consumers: [{
      name: "test.echo_back", module: "notifications", on: ["example.said"],
      async run(ctx, ev) {
        const rows = Number((ctx.db.all("SELECT COUNT(*) AS n FROM notifications_push")[0] as { n: number }).n);
        seen.push({ n: ev.payload["n"], from: ev.payload["from"], space: ctx.space, principal: ctx.principal.id, origin: ctx.origin, rows });
        if (ev.payload["from"] !== "hook") await ctx.call("example.echo" as never, { from: "hook", n: ev.payload["n"] });
      },
    }],
  }];
  const d = await boot(dir, { hooks: hooks() });
  let head = 0;
  try {
    assert.equal((await echo(d, { n: 1 })).status, 200);
    await settle(d);
    assert.equal(seen.length, 2, "the event, then the event the consumer itself made");
    assert.deepEqual(seen.map((s) => [s.n, s.from ?? null]), [[1, null], [1, "hook"]]);
    assert.equal(seen[0]!.space, d.space);
    assert.equal(seen[0]!.principal, "svc_host");
    assert.equal(seen[0]!.origin, "hook");
    assert.equal(seen[0]!.rows, 0, "ctx.db reads the module's own tables");
    const said = await d.log!.read({ type: "example.said" });
    assert.equal(said.length, 2);
    assert.equal(said[1]!.actor, "svc_host");
    assert.ok(said[1]!.depth > said[0]!.depth, "an event made by a consumer is deeper than the one that woke it");
    head = (await d.log!.currentHead()).seq;
    assert.equal(Number((d.db!.all("SELECT seq FROM host_hook_cursor WHERE name = ?", "test.echo_back")[0] as { seq: number }).seq), head);
  } finally { await d.stop(); }
  const again = await boot(dir, { hooks: hooks() });
  try {
    await settle(again);
    assert.equal(seen.length, 2, "nothing is delivered twice after a restart");
    assert.equal((await again.log!.currentHead()).seq, head);
  } finally { await again.stop(); }
});

test("seams.generic: a consumer first seen starts at the end of the log, so history is not replayed into it", async () => {
  const dir = seededDir();
  const first = await boot(dir);
  try { assert.equal((await echo(first, { n: 1 })).status, 200); } finally { await first.stop(); }
  const got: unknown[] = [];
  const d = await boot(dir, { hooks: [{ module: "notifications", periodic: [], consumers: [{ name: "test.late", module: "notifications", on: ["example.said"], run: (_c, ev) => { got.push(ev.payload["n"]); } }] }] });
  try {
    await settle(d);
    assert.deepEqual(got, [], "the event from before the consumer existed is not delivered");
    assert.equal((await echo(d, { n: 2 })).status, 200);
    await settle(d);
    assert.deepEqual(got, [2]);
  } finally { await d.stop(); }
});

test("seams.generic: a consumer that throws is tried again on the next pass and in order, and one that never succeeds is skipped after its tries so later events still flow", async () => {
  const attempts = new Map<unknown, number>();
  const done: unknown[] = [];
  const d = await boot(seededDir(), {
    hooks: [{
      module: "notifications", periodic: [],
      consumers: [{
        name: "test.flaky", module: "notifications", on: ["example.said"],
        run: (_c, ev) => {
          const n = ev.payload["n"];
          attempts.set(n, (attempts.get(n) ?? 0) + 1);
          if (n === 1 && attempts.get(n)! < 3) throw new Error("flaky");
          if (n === 2) throw new Error("poison");
          done.push(n);
        },
      }],
    }],
  });
  try {
    for (const n of [1, 2, 3]) assert.equal((await echo(d, { n })).status, 200);
    await settle(d, MAX_TRIES * 3);
    assert.deepEqual(done, [1, 3], "event 1 got through on its third try, event 2 was skipped, event 3 followed");
    assert.equal(attempts.get(1), 3);
    assert.equal(attempts.get(2), MAX_TRIES);
    assert.equal(attempts.get(3), 1);
  } finally { await d.stop(); }
});

test("seams.generic: a periodic job is put on the scheduler under its name and runs with a ctx for its module; the runs alerts are found by their exported names", async () => {
  const ran: string[] = [];
  const fake = collectHooks("runs", {
    onRunFailed: () => Promise.resolve({ alerted: false }),
    sweepEscalations: async (ctx: Ctx) => { ran.push(`${ctx.space}:${ctx.principal.id}:${typeof ctx.now()}:${ctx.db.all("SELECT COUNT(*) AS n FROM runs_alerts").length}`); return []; },
  });
  const d = await boot(seededDir(), { hooks: [fake] });
  try {
    const names = d.scheduler.status().map((j) => j.name);
    assert.ok(names.includes("hook.runs.escalations"), "the escalation sweep is scheduled");
    assert.ok(names.includes("hooks.pump"), "the pump backstop is scheduled");
    assert.deepEqual(d.hooks!.consumers.map((c) => c.name), ["runs.alerts"]);
    await d.hooks!.runPeriodic("runs.escalations");
    assert.deepEqual(ran, [`${d.space}:svc_host:number:1`]);
    await assert.rejects(() => d.hooks!.runPeriodic("no.such.job"), /no periodic job/);
  } finally { await d.stop(); }
});

// P-H_06: each named test shows its own ok line in the run on the last commit.
