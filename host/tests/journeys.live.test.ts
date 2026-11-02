// Journeys on a booted daemon, through the gateway: what a fake schema and fake tasks cannot show.
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

function seededDir(): string {
  const core = bootCore();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-journeys-"));
  core.store.db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE");
  fs.copyFileSync(core.file, path.join(dir, "events.db"));
  core.close();
  return dir;
}

const boot = (dir: string, extra: Partial<DaemonOptions> = {}): Promise<Daemon> => startDaemon({
  config: loadConfig(["--data-dir", dir, "--port", "0"], {}, "1.2.3"),
  platform: fakePlatform({
    os: "linux", hostname: "journeys-live", free: 80e9,
    commands: {
      [`findmnt -n -o SOURCE --target ${dir}`]: { stdout: "/dev/mapper/vyre\n" },
      "lsblk -s -n -o TYPE /dev/mapper/vyre": { stdout: "crypt\ndisk\n" },
      "docker info --format {{.ServerVersion}}": { stdout: "27.1.1\n" },
    },
  }),
  fetch: caddyFetch,
  session: (h) => {
    const t = /^Bearer (.+)$/.exec(String(h["authorization"] ?? ""))?.[1];
    return t === OWNER ? { space: "spc_core", principal: { kind: "person", id: "usr_olivia" }, device: "journeys-live" } : null;
  },
  intervals: { fast: 3_600_000, slow: 3_600_000, encryption: 3_600_000, commands: 3_600_000, hooks: 200, tick: 200 },
  ...extra,
});

const call = async (d: Daemon, p: string, body: unknown, token = OWNER): Promise<{ status: number; data: Record<string, unknown>; text: string }> => {
  const r = await fetch(`${d.url}${p}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify(body), signal: AbortSignal.timeout(8_000) });
  const text = await r.text();
  return { status: r.status, data: ((JSON.parse(text) as { data?: Record<string, unknown> }).data ?? {}), text };
};
const ok = async (d: Daemon, p: string, body: unknown, token = OWNER): Promise<Record<string, unknown>> => {
  const r = await call(d, p, body, token);
  assert.equal(r.status, 200, `${p}: ${r.text}`);
  return r.data;
};
async function until<T>(what: string, ms: number, look: () => Promise<T | undefined>): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await look();
    if (v !== undefined) return v;
    assert.ok(Date.now() < end, `gave up waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 150));
  }
}


const stage = (key: string, order: number, extra: Record<string, unknown> = {}) => ({ key, title: key, order, exit: { requireTasks: false }, tasks: [], automations: [], ...extra });
const journey = async (d: Daemon, name: string, stages: unknown[]): Promise<{ id: string; recordType: string; version: number }> =>
  (await ok(d, "/v1/journeys/create", { name, subjectType: "company", stages, idempotencyKey: `j-${name}-${Math.random()}` }))["journey"] as { id: string; recordType: string; version: number };
const subject = async (d: Daemon, name: string): Promise<string> => String(((await ok(d, "/v1/records/create", { type: "company", fields: { name }, idempotencyKey: `s-${name}-${Math.random()}` }))["record"] as { id: string }).id);

const started = async (d: Daemon, journeyId: string, name: string): Promise<string> => String((await ok(d, "/v1/journeys/start", { journeyId, subjectRecordId: await subject(d, name), idempotencyKey: `start-${name}` }))["recordId"]);
const stageOf = async (d: Daemon, type: string, recordId: string): Promise<unknown> => (((await ok(d, "/v1/records/get", { type, recordId }))["record"]) as { fields: Record<string, unknown> }).fields["stage"];

test("a stage added to the design can be entered: the record type learns it", async () => {
  const d = await boot(seededDir());
  try {
    const j = await journey(d, "Onboarding", [stage("start", 0), stage("done", 1, { final: true })]);
    const out = await ok(d, "/v1/journeys/design", { journeyId: j.id, stages: [stage("start", 0), stage("review", 1), stage("done", 2, { final: true })], idempotencyKey: "design-1" });
    assert.equal((out["journey"] as { version: number }).version, 2);
    const recordId = await started(d, j.id, "Acme");
    await ok(d, "/v1/journeys/move_stage", { journeyId: j.id, recordId, toStage: "review", reason: "Ready for review", idempotencyKey: "move-1" });
    assert.equal(await stageOf(d, j.recordType, recordId), "review");
    const schema = (await ok(d, "/v1/schema/types/get", { type: j.recordType }))["type"] as { fields: Array<{ key: string; options?: { stages?: Array<{ key: string }> } }> };
    assert.deepEqual(schema.fields.find((f) => f.key === "stage")?.options?.stages?.map((x) => x.key), ["start", "review", "done"]);
  } finally { await d.stop(); }
});

test("a Journey can be made again under the name of one that was deleted", async () => {
  const d = await boot(seededDir());
  try {
    const stages = [stage("start", 0), stage("done", 1, { final: true })];
    const j = await journey(d, "Renewals", stages);
    await ok(d, "/v1/journeys/delete", { journeyId: j.id, idempotencyKey: "del-1" });
    const again = await journey(d, "Renewals", stages);
    assert.notEqual(again.recordType, j.recordType, "the old record type keeps its records");
  } finally { await d.stop(); }
});

test("finishing a task that is not one of the stage's own does not move the record: a time limit alert is not the work", async () => {
  const d = await boot(seededDir());
  try {
    const j = await journey(d, "Intake", [stage("start", 0), stage("next", 1), stage("done", 2, { final: true })]);
    const recordId = await started(d, j.id, "Beta");
    const made = (await ok(d, "/v1/tasks/create", { kind: "unblock", title: "This has been in start for over 24 hours", assigned: { kind: "person", id: "usr_olivia" }, recordId, source: { kind: "journey", id: recordId }, idempotencyKey: "alert-1" }))["task"] as { id: string };
    await ok(d, "/v1/tasks/transition", { taskId: made.id, to: "done", idempotencyKey: "alert-done" }).catch(async () => ok(d, "/v1/tasks/transition", { taskId: made.id, to: "canceled", idempotencyKey: "alert-cancel" }));
    await new Promise((r) => setTimeout(r, 1500));
    assert.equal(await stageOf(d, j.recordType, recordId), "start");
  } finally { await d.stop(); }
});

test("a stage taken out of the design stays valid for the records still on the version that has it", async () => {
  const d = await boot(seededDir());
  try {
    const three = [stage("start", 0), stage("old", 1), stage("done", 2, { final: true })];
    const j = await journey(d, "Legacy", three);
    const recordId = await started(d, j.id, "Gamma");
    await ok(d, "/v1/journeys/design", { journeyId: j.id, stages: [stage("start", 0), stage("new", 1), stage("done", 2, { final: true })], idempotencyKey: "design-2" });
    await ok(d, "/v1/journeys/move_stage", { journeyId: j.id, recordId, toStage: "old", reason: "Still on the first version", idempotencyKey: "move-old" });
    assert.equal(await stageOf(d, j.recordType, recordId), "old");
  } finally { await d.stop(); }
});

