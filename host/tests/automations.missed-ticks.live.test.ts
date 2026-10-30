// Missed schedule ticks on the booted host. After the cursor is armed, 73 hourly fires are late.
// skip starts none, run once starts the latest only, and backfill over its cap starts none and pauses that schedule only.
// The host timer is stopped so a moved clock cannot fire the job twice.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { bootCore } from "../../fixtures/seed/core/index.ts";
import { fakePlatform } from "../src/platform/index.ts";
import type { FetchFn } from "../src/platform/probes.ts";
import { loadConfig } from "../src/daemon/config.ts";
import { startDaemon } from "../src/daemon/daemon.ts";
import type { Daemon, DaemonOptions } from "../src/daemon/daemon.ts";

const caddyFetch: FetchFn = () => Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, text: () => Promise.resolve('{"apps":{"http":{}}}') });
const OWNER = "tok-usr_olivia";
const SCHEDULE_JOB = "hook.automations.schedule_tick";
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const CAP = 10;
const MISSED = 73;

let clock = 0;

function seededDir(): string {
  const core = bootCore();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-miss-"));
  core.store.db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE");
  fs.copyFileSync(core.file, path.join(dir, "events.db"));
  core.close();
  return dir;
}

const boot = (dir: string, extra: Partial<DaemonOptions> = {}): Promise<Daemon> => startDaemon({
  config: loadConfig(["--data-dir", dir, "--port", "0"], {}, "1.2.3"),
  platform: fakePlatform({
    os: "linux", hostname: "miss-live", free: 80e9,
    commands: {
      [`findmnt -n -o SOURCE --target ${dir}`]: { stdout: "/dev/mapper/vyre\n" },
      "lsblk -s -n -o TYPE /dev/mapper/vyre": { stdout: "crypt\ndisk\n" },
      "docker info --format {{.ServerVersion}}": { stdout: "27.1.1\n" },
    },
  }),
  fetch: caddyFetch,
  session: (h) => {
    const t = /^Bearer (.+)$/.exec(String(h["authorization"] ?? ""))?.[1];
    return t === OWNER ? { space: "spc_core", principal: { kind: "person", id: "usr_olivia" }, device: "miss-live" } : null;
  },
  now: () => clock,
  intervals: { fast: 3_600_000, slow: 3_600_000, encryption: 3_600_000, commands: 3_600_000, hooks: 3_600_000, tick: 3_600_000 },
  ...extra,
});

const call = async (d: Daemon, p: string, body: unknown): Promise<{ status: number; data: Record<string, unknown>; text: string }> => {
  const r = await fetch(`${d.url}${p}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${OWNER}` }, body: JSON.stringify(body), signal: AbortSignal.timeout(8_000) });
  const text = await r.text();
  return { status: r.status, data: ((JSON.parse(text) as { data?: Record<string, unknown> }).data ?? {}), text };
};
const ok = async (d: Daemon, p: string, body: unknown): Promise<Record<string, unknown>> => {
  const r = await call(d, p, body);
  assert.equal(r.status, 200, `${p}: ${r.text}`);
  return r.data;
};

async function onlyScheduleJob(d: Daemon): Promise<void> {
  assert.ok(d.hooks!.periodic.some((p) => p.name === "automations.schedule_tick"));
  await d.scheduler.stop();
  for (const job of d.scheduler.status()) if (job.name !== SCHEDULE_JOB) d.scheduler.remove(job.name);
  assert.deepEqual(d.scheduler.status().map((job) => job.name), [SCHEDULE_JOB]);
}

async function automation(d: Daemon, name: string, config: Record<string, unknown>): Promise<string> {
  const made = await ok(d, "/v1/automations/create", {
    idempotencyKey: `miss-${name}`,
    name,
    definition: {
      triggers: [{ key: "schedule", config }],
      nodes: [{ id: "note", key: "records.create", input: { type: "note_board", fields: { title: name } } }],
    },
  });
  const id = String((made["automation"] as { id?: string } | undefined)?.id ?? made["automationId"]);
  assert.match(id, /^aut_/);
  const on = await ok(d, "/v1/automations/set_enabled", { automationId: id, enabled: true });
  assert.equal((on["automation"] as { status?: string }).status, "on");
  return id;
}

async function runCount(d: Daemon, automationId: string): Promise<number> {
  const listed = await ok(d, "/v1/runs/list", { scope: "subject", subject: { type: "automation", id: automationId }, limit: 100 });
  return (listed["runs"] as unknown[]).length;
}

async function statusOf(d: Daemon, automationId: string): Promise<{ status: string; pausedReason?: string }> {
  const got = await ok(d, "/v1/automations/get", { automationId });
  const row = got["automation"] as { status?: string; pausedReason?: string };
  return { status: String(row.status), ...(row.pausedReason ? { pausedReason: row.pausedReason } : {}) };
}

/** UTC instants of `0 * * * *` strictly after `cursor` and at or before `now`. */
function hourlyFires(cursor: number, now: number): number[] {
  const out: number[] = [];
  for (let t = Math.floor(cursor / HOUR) * HOUR + HOUR; t <= now; t += HOUR) out.push(t);
  return out;
}

test("73 missed ticks follow skip, run once, and the backfill cap", async () => {
  clock = Date.now();
  const d = await boot(seededDir());
  try {
    await onlyScheduleJob(d);
    const hourly = { cron: "0 * * * *", timezone: "UTC" };
    const skipId = await automation(d, "miss-skip", { ...hourly, missed: "skip" });
    const onceId = await automation(d, "miss-once", { ...hourly, missed: "run_once" });
    const fillId = await automation(d, "miss-fill", {
      ...hourly,
      missed: "backfill_each_tick",
      lookbackMs: 30 * DAY,
      cap: CAP,
      spacingMs: 0,
      overlap: "queue",
    });

    clock += MINUTE;
    await d.scheduler.tick();
    assert.equal(await runCount(d, skipId), 0);
    assert.equal(await runCount(d, onceId), 0);
    assert.equal(await runCount(d, fillId), 0);

    const armedAt = clock;
    const first = Math.floor(armedAt / HOUR) * HOUR + HOUR;
    const last = first + (MISSED - 1) * HOUR;
    clock = last + 2 * MINUTE;
    const fires = hourlyFires(armedAt, clock);
    assert.equal(fires.length, MISSED, "the downtime covers 73 hourly fires");
    assert.ok(clock - fires[fires.length - 1]! > MINUTE, "every one of those fires is late");
    assert.ok(clock < last + HOUR, "the next hour has not fired");

    await d.scheduler.tick();
    assert.equal(await runCount(d, skipId), 0, "skip does not start the 73 missed ticks");
    assert.equal(await runCount(d, onceId), 1, "run once starts one Run for the whole gap, not 73");
    assert.equal(await runCount(d, fillId), 0, "backfill over the cap starts none of the 73");
    assert.deepEqual(await statusOf(d, skipId), { status: "on" });
    assert.deepEqual(await statusOf(d, onceId), { status: "on" });
    const paused = await statusOf(d, fillId);
    assert.equal(paused.status, "paused");
    assert.equal(paused.pausedReason, "Schedule backlog is over its cap");

    const needs = await ok(d, "/v1/tasks/needs_you", { limit: 50 });
    const asks = (needs["items"] as { task?: { source?: { id?: string }; summary?: string; why?: string } }[])
      .filter((item) => item.task?.source?.id === `automation-schedule:${fillId}`);
    assert.equal(asks.length, 1, "one Needs you request for the capped schedule");
    assert.match(String(asks[0]?.task?.summary), new RegExp(`${MISSED} missed runs`));
    assert.match(String(asks[0]?.task?.why), new RegExp(`backlog of ${MISSED}`));
    assert.match(String(asks[0]?.task?.why), new RegExp(`cap of ${CAP}`));

    await d.hooks!.runPeriodic("automations.schedule_tick");
    assert.equal(await runCount(d, skipId), 0);
    assert.equal(await runCount(d, onceId), 1, "the same missed gap does not start a second Run");
    assert.equal(await runCount(d, fillId), 0, "a second tick still does not backfill past the cap");
    const again = (await ok(d, "/v1/tasks/needs_you", { limit: 50 }))["items"] as { task?: { source?: { id?: string } } }[];
    assert.equal(again.filter((item) => item.task?.source?.id === `automation-schedule:${fillId}`).length, 1, "the open request is not opened again");
  } finally { await d.stop(); }
});
