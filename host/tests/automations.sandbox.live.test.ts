// A sandbox test run reads for real and does not perform writes or outward sends.
// runs.steps has no output body, so the stored step log in modules.db shows the live read and the catalogue samples.
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
const HOUR = 3_600_000;
const WRITE_SAMPLE = { recordId: "rec_a1b2c3" };
const SEND_SAMPLE = { messageId: "msg_a1b2c3" };
const READ_SAMPLE = { count: 1, rows: [{}] };

function seededDir(): string {
  const core = bootCore();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-sandbox-"));
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
    const who = t === OWNER ? "usr_olivia" : null;
    return who === null ? null : { space: "spc_core", principal: { kind: "person", id: who }, device: "exec-live" };
  },
  intervals: { fast: HOUR, slow: HOUR, encryption: HOUR, commands: HOUR, hooks: 200, tick: HOUR, sweep: HOUR },
  ...extra,
});

interface Reply { status: number; data: Record<string, unknown>; text: string }

const call = async (d: Daemon, p: string, body: unknown, token = OWNER): Promise<Reply> => {
  const r = await fetch(`${d.url}${p}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify(body), signal: AbortSignal.timeout(8_000) });
  const text = await r.text();
  let data: Record<string, unknown> = {};
  try { data = ((JSON.parse(text) as { data?: Record<string, unknown> }).data ?? {}); } catch { /* the body is not JSON */ }
  return { status: r.status, data, text };
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

async function noteCount(d: Daemon, title: string): Promise<number> {
  const rows = (await ok(d, "/v1/records/query", { type: "note_board" }))["rows"] as { fields?: { title?: string } }[];
  return rows.filter((row) => row.fields?.title === title).length;
}

interface StoredStep { step: string; state: string; output: unknown }
function storedSteps(d: Daemon, runId: string): StoredStep[] {
  const rows = d.db!.all("SELECT step, state, output_json FROM runs_steps WHERE run_id = ? ORDER BY ord, attempt", runId) as { step: string; state: string; output_json: string | null }[];
  return rows.map((row) => ({ step: row.step, state: row.state, output: row.output_json == null ? undefined : JSON.parse(row.output_json) as unknown }));
}

test("a sandbox test reads a note for real and does not create or send", async () => {
  const d = await boot(seededDir());
  try {
    const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    const seen = `Sandbox read ${stamp}`;
    const missed = `Sandbox write ${stamp}`;
    const outward = `Sandbox send ${stamp}`;
    await ok(d, "/v1/records/create", { idempotencyKey: `sandbox-read-${stamp}`, type: "note_board", fields: { title: seen } });
    assert.equal(await noteCount(d, seen), 1, "the read has a real note to find");
    const made = await ok(d, "/v1/automations/create", {
      idempotencyKey: `sandbox-${stamp}`, name: "sandbox-test",
      definition: {
        triggers: [{ key: "manual" }],
        nodes: [
          { id: "find", key: "records.find", input: { type: "note_board", filter: { field: "title", op: "eq", value: seen } }, next: ["note"] },
          { id: "note", key: "records.create", input: { type: "note_board", fields: { title: missed } }, next: ["say"] },
          { id: "say", key: "post_message", input: { channelId: "chn_general", text: outward } },
        ],
      },
    });
    const id = String((made["automation"] as { id?: string } | undefined)?.id ?? made["automationId"]);
    assert.match(id, /^aut_/);
    const runId = String((await ok(d, "/v1/automations/test", { automationId: id }))["runId"]);
    await until("the test run to succeed", 12_000, async () => {
      const body = await ok(d, "/v1/runs/get", { runId });
      const run = body["run"] as { status?: string; kind?: string } | undefined;
      if (run?.status === "failed" || run?.status === "stopped") assert.fail(`the run ${run.status}: ${JSON.stringify(body)}`);
      return run?.status === "succeeded" ? run : undefined;
    });
    const run = (await ok(d, "/v1/runs/get", { runId }))["run"] as { kind?: string };
    assert.equal(run.kind, "automation_test");
    const listed = (await ok(d, "/v1/runs/steps", { runId }))["steps"] as { step: string; state: string }[];
    assert.deepEqual(listed.map((row) => `${row.step}:${row.state}`), ["find:succeeded", "note:succeeded", "say:succeeded"]);
    const stored = storedSteps(d, runId);
    const find = stored.find((row) => row.step === "find");
    assert.ok(find, "the read step is in the step log");
    assert.notDeepEqual(find.output, READ_SAMPLE, "the read was not replaced by the catalogue sample");
    assert.match(JSON.stringify(find.output), new RegExp(stamp), "the read returned the live note");
    const note = stored.find((row) => row.step === "note");
    assert.deepEqual(note?.output, WRITE_SAMPLE);
    const say = stored.find((row) => row.step === "say");
    assert.deepEqual(say?.output, SEND_SAMPLE);
    assert.equal(await noteCount(d, missed), 0, "the write did not create the note");
    const fetched = await call(d, "/v1/records/get", { type: "note_board", recordId: WRITE_SAMPLE.recordId });
    assert.equal(fetched.text.includes(missed), false, "the catalogue record id is not the note the step would have written");
  } finally { await d.stop(); }
});
