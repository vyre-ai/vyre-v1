// Live HTTP proofs for the old acceptance names. A gap below is a case this seam cannot drive.
//
// "form opt-in updates the record, assigns and tags in parallel, then resumes the wait once"
//   The wait half is the graceful-stop test. Two lanes, a join, and a wait that does not block the other lane are host/tests/runs.children.test.ts.
//   Not proved: form_submit, records.update, or one mail.send.
// "an appointment tomorrow skips the seven-day and five-day messages and still updates the record"
//   Gap: calendar anchor offsets and an internal clock. No live route stands in.
// "rescheduling an appointment moves the unfinished milestone and does not repeat a sent message"
//   Gap: calendar_event.updated and that same internal clock.
// "a loop of three stakeholders resumes the waiting child on the same node after a new host"
//   Three item notes and the note after the loop are host/tests/runs.children.test.ts.
//   Child run ids, attempt numbers, and held later iterations are not on this seam.
//   A SIGKILL while a loop child is waiting is the killed-host file.
// "seventy-three missed ticks open one Needs You item, and latest N does not start them twice"
//   Gap: planSchedule, tick claims, and the Needs You task are not an HTTP tick.
// "a revoked Google account fails the step, Ask Vyre drops the token, and the same connection retries"
//   Gap: the Google step and the Ask Vyre scrub are module fixtures. Not invented here.
// "publishing version 13 leaves version 12 runs in place and previews safe and ambiguous groups"
//   Publishing a later version does not move a waiting run. migration_preview groups it as a safe cohort and the run stays on version 1.
//   The move itself, and the refusals, are host/tests/automations.cohort.live.test.ts.
// Personal ownership: Noah can run an automation he owns. Olivia is not refused on that id.
//   automations.get returns 200. Her space-owner grant on the ancestor covers it.
//   The module rule (not found unless owner, follower, or an explicit view allow) is not what this daemon returns.
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
const NOAH = "tok-usr_noah";

function seededDir(): string {
  const core = bootCore();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-accept-"));
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
    const who = t === OWNER ? "usr_olivia" : t === NOAH ? "usr_noah" : null;
    return who === null ? null : { space: "spc_core", principal: { kind: "person", id: who }, device: "exec-live" };
  },
  intervals: { fast: 3_600_000, slow: 3_600_000, encryption: 3_600_000, commands: 3_600_000, hooks: 200, tick: 200 },
  ...extra,
});

interface Reply { status: number; data: Record<string, unknown>; text: string; json: Record<string, unknown> }

const call = async (d: Daemon, p: string, body: unknown, token = OWNER): Promise<Reply> => {
  const r = await fetch(`${d.url}${p}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify(body), signal: AbortSignal.timeout(8_000) });
  const text = await r.text();
  let json: Record<string, unknown> = {};
  try { json = JSON.parse(text) as Record<string, unknown>; } catch { /* the body is not JSON */ }
  return { status: r.status, data: (json["data"] as Record<string, unknown> | undefined) ?? {}, text, json };
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

const idOf = (made: Record<string, unknown>): string => {
  const id = String((made["automation"] as { id?: string } | undefined)?.id ?? made["automationId"]);
  assert.match(id, /^aut_/, `automation.create: ${JSON.stringify(made)}`);
  return id;
};
async function automation(d: Daemon, name: string, nodes: unknown[], token = OWNER, start?: string[]): Promise<string> {
  const made = await ok(d, "/v1/automations/create", {
    idempotencyKey: `accept-${name}`, name,
    definition: { triggers: [{ key: "manual" }], nodes, ...(start ? { start } : {}) },
  }, token);
  return idOf(made);
}
const runOf = async (d: Daemon, id: string, key: string, token = OWNER): Promise<string> => String((await ok(d, "/v1/automations/run", { automationId: id, idempotencyKey: key }, token))["runId"]);
const note = (id: string, title: string, next?: string[]) => ({ id, key: "records.create", input: { type: "note_board", fields: { title } }, ...(next ? { next } : {}) });
async function noteCount(d: Daemon, title: string, token = OWNER): Promise<number> {
  const rows = (await ok(d, "/v1/records/query", { type: "note_board" }, token))["rows"] as { fields?: { title?: string } }[];
  return rows.filter((row) => row.fields?.title === title).length;
}
async function untilStatus(d: Daemon, runId: string, want: string, ms: number, token = OWNER): Promise<void> {
  await until(`the run to be ${want}`, ms, async () => {
    const body = await ok(d, "/v1/runs/get", { runId }, token);
    const status = String((body["run"] as { status?: string } | undefined)?.status ?? "");
    if (status === "failed" || status === "stopped") assert.fail(`the run ${status}: ${JSON.stringify(body)}`);
    return status === want ? true : undefined;
  });
}
async function versionOf(d: Daemon, runId: string): Promise<number> {
  const body = await ok(d, "/v1/runs/get", { runId });
  return Number((body["run"] as { definitionVersion?: number } | undefined)?.definitionVersion ?? 0);
}

test("a manual run that writes a note succeeds", async () => {
  const d = await boot(seededDir());
  try {
    const title = "Made by an automation";
    const id = await automation(d, "make-note", [note("note", title)]);
    const runId = await runOf(d, id, "run-1");
    await untilStatus(d, runId, "succeeded", 15_000);
    assert.equal(await noteCount(d, title), 1);
  } finally { await d.stop(); }
});

test("a wait parks, the daemon stops, and the next daemon writes the note once", async () => {
  const dir = seededDir();
  const title = "Made after a graceful stop";
  let d = await boot(dir);
  let runId = "";
  try {
    const id = await automation(d, "grace-note", [{ id: "pause", key: "wait", input: { forDuration: "2s" } }, note("after", title)]);
    runId = await runOf(d, id, "run-grace");
    await untilStatus(d, runId, "waiting", 10_000);
    assert.equal(await noteCount(d, title), 0, "nothing after the wait has run yet");
  } finally { await d.stop(); }
  d = await boot(dir);
  try {
    await untilStatus(d, runId, "succeeded", 20_000);
    assert.equal(await noteCount(d, title), 1);
    await ok(d, "/v1/runs/get", { runId });
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(await noteCount(d, title), 1);
  } finally { await d.stop(); }
});

test("the same idempotency key returns one run and writes the note once", async () => {
  const d = await boot(seededDir());
  try {
    const title = "Made once";
    const id = await automation(d, "once-note", [note("note", title)]);
    const body = { automationId: id, idempotencyKey: "same-run" };
    const first = String((await ok(d, "/v1/automations/run", body))["runId"]);
    const second = String((await ok(d, "/v1/automations/run", body))["runId"]);
    assert.equal(second, first);
    await untilStatus(d, first, "succeeded", 15_000);
    assert.equal(await noteCount(d, title), 1);
  } finally { await d.stop(); }
});

test("a draft may save an AI step, and turning it on is rejected as a preview", async () => {
  const d = await boot(seededDir());
  try {
    const made = await ok(d, "/v1/automations/create", { idempotencyKey: "accept-ai", name: "ai-draft" });
    const id = idOf(made);
    const saved = await ok(d, "/v1/automations/update", {
      automationId: id,
      definition: { triggers: [{ key: "manual" }], nodes: [{ id: "ask", key: "ai", input: { prompt: "Summarise" }, ai: { agentId: "agt_helper" } }] },
    });
    const nodes = (saved["automation"] as { definition?: { nodes?: { key?: string }[] } }).definition?.nodes ?? [];
    assert.equal(nodes[0]?.key, "ai", "a draft save of an AI step stands");
    const refused = await call(d, "/v1/automations/set_enabled", { automationId: id, enabled: true });
    assert.equal(refused.status, 422, refused.text);
    const error = refused.json["error"] as { code?: string; message?: string; details?: { reason?: string } } | undefined;
    assert.equal(error?.code, "validation.precondition_failed", refused.text);
    assert.equal(error?.details?.reason, "preview", refused.text);
    assert.match(error?.message ?? "", /preview/, refused.text);
    assert.notEqual((await ok(d, "/v1/automations/get", { automationId: id }) as { automation?: { status?: string } })["automation"]?.status, "on");
  } finally { await d.stop(); }
});

test("Noah can run a personal automation he owns", async () => {
  const d = await boot(seededDir());
  try {
    const title = "Noah's note";
    const made = await ok(d, "/v1/automations/create", { idempotencyKey: "accept-noah", name: "noah-note", definition: { triggers: [{ key: "manual" }], nodes: [note("note", title)] } }, NOAH);
    const id = idOf(made);
    const row = made["automation"] as { ownerId?: string; kind?: string };
    assert.equal(row.ownerId, "usr_noah");
    assert.equal(row.kind, "personal");
    const runId = await runOf(d, id, "noah-run", NOAH);
    await untilStatus(d, runId, "succeeded", 15_000, NOAH);
    assert.equal(await noteCount(d, title, NOAH), 1);
  } finally { await d.stop(); }
});

test("publishing a later version does not move a waiting run", async () => {
  const d = await boot(seededDir());
  try {
    const pinned = "Stays on the first version";
    const later = "Would belong to the later version";
    const nodes = (title: string) => [
      { id: "pause", key: "wait", input: { forDuration: "2s" }, next: ["note"] },
      note("note", title),
    ];
    const id = await automation(d, "pin-note", nodes(pinned));
    const runId = await runOf(d, id, "pin-run");
    await untilStatus(d, runId, "waiting", 10_000);
    const saved = await ok(d, "/v1/automations/update", {
      automationId: id, expectedVersion: 1,
      definition: { triggers: [{ key: "manual" }], nodes: nodes(later) },
    });
    assert.equal((saved["automation"] as { version?: number }).version, 2);
    assert.equal(await versionOf(d, runId), 1);
    const preview = await ok(d, "/v1/automations/migration_preview", { automationId: id, toVersion: 2 });
    assert.deepEqual((preview["cohorts"] as { disposition: string; runIds: string[] }[]).map((c) => [c.disposition, c.runIds]), [["safe", [runId]]]);
    assert.equal(await versionOf(d, runId), 1, "a preview does not move the run");
    await untilStatus(d, runId, "succeeded", 20_000);
    assert.equal(await versionOf(d, runId), 1);
    assert.equal(await noteCount(d, pinned), 1);
    assert.equal(await noteCount(d, later), 0);
  } finally { await d.stop(); }
});
