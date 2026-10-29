// One due schedule tick on the booted host starts one Run. Repeating that tick for the same fire does not start a second.
// The first tick only arms the cursor (earlier history is not a backlog). The host timer is stopped so a moved clock cannot fire the job twice.
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

let clock = 0;

function seededDir(): string {
  const core = bootCore();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-sched-"));
  core.store.db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE");
  fs.copyFileSync(core.file, path.join(dir, "events.db"));
  core.close();
  return dir;
}

const boot = (dir: string, extra: Partial<DaemonOptions> = {}): Promise<Daemon> => startDaemon({
  config: loadConfig(["--data-dir", dir, "--port", "0"], {}, "1.2.3"),
  platform: fakePlatform({
    os: "linux", hostname: "sched-live", free: 80e9,
    commands: {
      [`findmnt -n -o SOURCE --target ${dir}`]: { stdout: "/dev/mapper/vyre\n" },
      "lsblk -s -n -o TYPE /dev/mapper/vyre": { stdout: "crypt\ndisk\n" },
      "docker info --format {{.ServerVersion}}": { stdout: "27.1.1\n" },
    },
  }),
  fetch: caddyFetch,
  session: (h) => {
    const t = /^Bearer (.+)$/.exec(String(h["authorization"] ?? ""))?.[1];
    return t === OWNER ? { space: "spc_core", principal: { kind: "person", id: "usr_olivia" }, device: "sched-live" } : null;
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

/** Leave only the automation schedule job, and stop the interval so a jumped clock runs it once when the test says so. */
async function onlyScheduleJob(d: Daemon): Promise<void> {
  assert.ok(d.hooks!.periodic.some((p) => p.name === "automations.schedule_tick"), "the live automations module schedules automations.schedule_tick");
  await d.scheduler.stop();
  for (const job of d.scheduler.status()) if (job.name !== SCHEDULE_JOB) d.scheduler.remove(job.name);
  assert.deepEqual(d.scheduler.status().map((job) => job.name), [SCHEDULE_JOB]);
}

async function automation(d: Daemon, name: string): Promise<string> {
  const made = await ok(d, "/v1/automations/create", {
    idempotencyKey: `sched-${name}`,
    name,
    definition: {
      triggers: [{ key: "schedule", config: { cron: "* * * * *", timezone: "UTC", missed: "skip" } }],
      nodes: [{ id: "note", key: "records.create", input: { type: "note_board", fields: { title: name } } }],
    },
  });
  const id = String((made["automation"] as { id?: string } | undefined)?.id ?? made["automationId"]);
  assert.match(id, /^aut_/);
  const on = await ok(d, "/v1/automations/set_enabled", { automationId: id, enabled: true });
  assert.equal((on["automation"] as { status?: string }).status, "on");
  return id;
}

async function runIds(d: Daemon, automationId: string): Promise<string[]> {
  const listed = await ok(d, "/v1/runs/list", { scope: "subject", subject: { type: "automation", id: automationId }, limit: 20 });
  const runs = listed["runs"] as { id?: string }[];
  return runs.map((run) => String(run.id));
}

test("one scheduler tick starts one Run, and the same fire does not start a second", async () => {
  clock = Date.now();
  const d = await boot(seededDir());
  try {
    await onlyScheduleJob(d);
    const id = await automation(d, "one-fire");
    assert.deepEqual(await runIds(d, id), [], "turning a schedule on does not start a Run");

    clock += MINUTE;
    await d.scheduler.tick();
    assert.deepEqual(await runIds(d, id), [], "the first tick arms the cursor and starts nothing");

    const cursor = clock;
    const boundary = Math.floor(cursor / MINUTE) * MINUTE + MINUTE;
    clock = Math.max(cursor + MINUTE, boundary + 30_000);
    assert.equal(Math.floor(clock / MINUTE) - Math.floor(cursor / MINUTE), 1, "exactly one minute boundary is due");
    await d.scheduler.tick();
    const started = await runIds(d, id);
    assert.equal(started.length, 1, `one due tick starts one Run, got ${JSON.stringify(started)}`);

    await d.hooks!.runPeriodic("automations.schedule_tick");
    assert.deepEqual(await runIds(d, id), started, "a repeated tick for the same fire does not start a second Run");
  } finally { await d.stop(); }
});
