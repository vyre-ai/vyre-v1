// Moving runs onto a new version, live. A waiting run moves at its step boundary, finished steps are not repeated, and a finished run is refused.
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-cohort-"));
  core.store.db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE");
  fs.copyFileSync(core.file, path.join(dir, "events.db"));
  core.close();
  return dir;
}

const boot = (dir: string, extra: Partial<DaemonOptions> = {}): Promise<Daemon> => startDaemon({
  config: loadConfig(["--data-dir", dir, "--port", "0"], {}, "1.2.3"),
  platform: fakePlatform({
    os: "linux", hostname: "exec-live", free: 80e9,
    commands: {
      [`findmnt -n -o SOURCE --target ${dir}`]: { stdout: "/dev/mapper/vyre\n" },
      "lsblk -s -n -o TYPE /dev/mapper/vyre": { stdout: "crypt\ndisk\n" },
      "docker info --format {{.ServerVersion}}": { stdout: "27.1.1\n" },
    },
  }),
  fetch: caddyFetch,
  session: (h) => {
    const t = /^Bearer (.+)$/.exec(String(h["authorization"] ?? ""))?.[1];
    return t === OWNER ? { space: "spc_core", principal: { kind: "person", id: "usr_olivia" }, device: "exec-live" } : null;
  },
  intervals: { fast: 3_600_000, slow: 3_600_000, encryption: 3_600_000, commands: 3_600_000, hooks: 200, tick: 200 },
  ...extra,
});

interface Reply { status: number; data: Record<string, unknown>; text: string }

const call = async (d: Daemon, p: string, body: unknown): Promise<Reply> => {
  const r = await fetch(`${d.url}${p}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${OWNER}` }, body: JSON.stringify(body), signal: AbortSignal.timeout(8_000) });
  const text = await r.text();
  let json: Record<string, unknown> = {};
  try { json = JSON.parse(text) as Record<string, unknown>; } catch { /* the body is not JSON */ }
  return { status: r.status, data: (json["data"] as Record<string, unknown> | undefined) ?? {}, text };
};
const ok = async (d: Daemon, p: string, body: unknown): Promise<Record<string, unknown>> => {
  const r = await call(d, p, body);
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
const statusOf = async (d: Daemon, runId: string): Promise<string> => String(((await ok(d, "/v1/runs/get", { runId }))["run"] as { status?: string }).status);
const versionOf = async (d: Daemon, runId: string): Promise<number> => Number(((await ok(d, "/v1/runs/get", { runId }))["run"] as { definitionVersion?: number }).definitionVersion);
const note = (id: string, title: string) => ({ id, key: "records.create", input: { type: "note_board", fields: { title } } });
async function noteCount(d: Daemon, title: string): Promise<number> {
  const rows = (await ok(d, "/v1/records/query", { type: "note_board" }))["rows"] as { fields?: { title?: string } }[];
  return rows.filter((row) => row.fields?.title === title).length;
}

test("a waiting run moves to the new version at its step, then runs the new step once", async () => {
  const d = await boot(seededDir());
  try {
    const oldTitle = "Made by the first version";
    const newTitle = "Made by the second version";
    const made = await ok(d, "/v1/automations/create", {
      idempotencyKey: "cohort-live", name: "cohort-live",
      definition: { triggers: [{ key: "manual" }], nodes: [{ id: "pause", key: "wait", input: { forDuration: "6s" }, next: ["note"] }, note("note", oldTitle)] },
    });
    const id = String((made["automation"] as { id?: string }).id);
    const runId = String((await ok(d, "/v1/automations/run", { automationId: id, idempotencyKey: "cohort-run" }))["runId"]);
    await until("the run to wait", 10_000, async () => ((await statusOf(d, runId)) === "waiting" ? true : undefined));
    await ok(d, "/v1/automations/update", {
      automationId: id, expectedVersion: 1,
      definition: { triggers: [{ key: "manual" }], nodes: [{ id: "pause", key: "wait", input: { forDuration: "6s" }, next: ["note"] }, note("note", newTitle)] },
    });
    assert.equal(await versionOf(d, runId), 1, "publishing alone does not move it");
    const preview = await ok(d, "/v1/automations/migration_preview", { automationId: id, toVersion: 2 });
    const cohorts = preview["cohorts"] as { runIds: string[]; disposition: string; proposedStepId: string | null }[];
    assert.deepEqual(cohorts.map((c) => [c.disposition, c.proposedStepId, c.runIds]), [["safe", "pause", [runId]]]);
    assert.equal(await versionOf(d, runId), 1, "a preview does not move it");
    const moved = await ok(d, "/v1/automations/migrate_runs", { automationId: id, toVersion: 2, runIds: [runId] });
    assert.deepEqual(moved["moved"], [{ runId, fromVersion: 1, toVersion: 2, atStepId: "pause" }]);
    assert.deepEqual(moved["held"], []);
    assert.equal(await versionOf(d, runId), 2);
    await until("the run to succeed", 25_000, async () => ((await statusOf(d, runId)) === "succeeded" ? true : undefined));
    assert.equal(await noteCount(d, newTitle), 1, "the new version ran its step once");
    assert.equal(await noteCount(d, oldTitle), 0, "the old step never ran");
    const again = await call(d, "/v1/automations/migrate_runs", { automationId: id, toVersion: 2, runIds: [runId] });
    assert.notEqual(again.status, 200, "a finished run is not moved");
    assert.match(again.text, /safe cohort/);
  } finally { await d.stop(); }
});

test("a version that drops the run's step is refused and the run stays where it was", async () => {
  const d = await boot(seededDir());
  try {
    const made = await ok(d, "/v1/automations/create", {
      idempotencyKey: "cohort-gone", name: "cohort-gone",
      definition: { triggers: [{ key: "manual" }], nodes: [{ id: "pause", key: "wait", input: { forDuration: "5s" }, next: ["note"] }, note("note", "Made before the change")] },
    });
    const id = String((made["automation"] as { id?: string }).id);
    const runId = String((await ok(d, "/v1/automations/run", { automationId: id, idempotencyKey: "cohort-gone-run" }))["runId"]);
    await until("the run to wait", 10_000, async () => ((await statusOf(d, runId)) === "waiting" ? true : undefined));
    await ok(d, "/v1/automations/update", { automationId: id, expectedVersion: 1, definition: { triggers: [{ key: "manual" }], nodes: [note("only", "Made by the new shape")] } });
    const preview = await ok(d, "/v1/automations/migration_preview", { automationId: id, toVersion: 2 });
    assert.deepEqual((preview["cohorts"] as { disposition: string }[]).map((c) => c.disposition), ["ambiguous"]);
    const refused = await call(d, "/v1/automations/migrate_runs", { automationId: id, toVersion: 2, runIds: [runId] });
    assert.notEqual(refused.status, 200, refused.text);
    assert.equal(await versionOf(d, runId), 1);
  } finally { await d.stop(); }
});
