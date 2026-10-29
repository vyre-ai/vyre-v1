// A retryable failure takes the next attempt and a new attempt key. A step that already finished is not run again.
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-retry-"));
  core.store.db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE");
  fs.copyFileSync(core.file, path.join(dir, "events.db"));
  core.close();
  return dir;
}

const boot = (dir: string, extra: Partial<DaemonOptions> = {}): Promise<Daemon> => startDaemon({
  config: loadConfig(["--data-dir", dir, "--port", "0"], {}, "1.2.3"),
  platform: fakePlatform({
    os: "linux", hostname: "retry-live", free: 80e9,
    commands: {
      [`findmnt -n -o SOURCE --target ${dir}`]: { stdout: "/dev/mapper/vyre\n" },
      "lsblk -s -n -o TYPE /dev/mapper/vyre": { stdout: "crypt\ndisk\n" },
      "docker info --format {{.ServerVersion}}": { stdout: "27.1.1\n" },
    },
  }),
  fetch: caddyFetch,
  session: (h) => {
    const t = /^Bearer (.+)$/.exec(String(h["authorization"] ?? ""))?.[1];
    return t === OWNER ? { space: "spc_core", principal: { kind: "person", id: "usr_olivia" }, device: "retry-live" } : null;
  },
  intervals: { fast: 3_600_000, slow: 3_600_000, encryption: 3_600_000, commands: 3_600_000, hooks: 200, tick: 200 },
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
async function until<T>(what: string, ms: number, look: () => Promise<T | undefined>): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await look();
    if (v !== undefined) return v;
    assert.ok(Date.now() < end, `gave up waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 150));
  }
}

interface StepRow { step: string; attempt: number; state: string; inputRef?: string; error?: { code?: string } }

test("a retryable failure uses a new attempt and a new attempt key, and does not repeat a step that already finished", async () => {
  const d = await boot(seededDir());
  try {
    const title = "Finished first";
    const made = await ok(d, "/v1/automations/create", { idempotencyKey: "retry-conflict", name: "Retry a conflict" });
    const id = String((made["automation"] as { id?: string } | undefined)?.id ?? made["automationId"]);
    assert.match(id, /^aut_/);
    await ok(d, "/v1/automations/update", {
      automationId: id,
      definition: {
        triggers: [{ key: "manual" }],
        nodes: [
          { id: "made", key: "records.create", input: { type: "note_board", fields: { title } } },
          {
            id: "bump", key: "records.update",
            input: { type: "note_board", recordId: "{{ steps.made.out.recordId }}", baseVersion: 0, patch: { title: "bumped" } },
            onError: { mode: "retry", max: 1 },
          },
        ],
      },
    });
    const runId = String((await ok(d, "/v1/automations/run", { automationId: id, idempotencyKey: "retry-run-1" }))["runId"]);
    const status = await until("the run to fail after its retry", 20_000, async () => {
      const run = (await ok(d, "/v1/runs/get", { runId }))["run"] as { status?: string };
      if (run.status === "failed") return run.status;
      if (run.status === "succeeded" || run.status === "stopped") assert.fail(`the run ended ${run.status} before the retry could fail`);
      return undefined;
    });
    assert.equal(status, "failed");
    const steps = (await ok(d, "/v1/runs/steps", { runId }))["steps"] as StepRow[];
    const created = steps.filter((s) => s.step === "made");
    assert.deepEqual(created.map((s) => ({ attempt: s.attempt, state: s.state, inputRef: s.inputRef })), [
      { attempt: 1, state: "succeeded", inputRef: `in:${runId}:made:1` },
    ], `the finished step ran once: ${JSON.stringify(created)}`);
    const bumps = steps.filter((s) => s.step === "bump");
    assert.deepEqual(bumps.map((s) => s.attempt), [1, 2], `two attempts: ${JSON.stringify(bumps)}`);
    assert.deepEqual(bumps.map((s) => s.state), ["failed", "failed"]);
    assert.deepEqual(bumps.map((s) => s.inputRef), [`in:${runId}:bump:1`, `in:${runId}:bump:2`]);
    assert.notEqual(bumps[0]?.inputRef, bumps[1]?.inputRef);
    assert.ok(bumps.every((s) => s.error?.code === "validation.version_conflict"), JSON.stringify(bumps));
    const notes = ((await ok(d, "/v1/records/query", { type: "note_board" }))["rows"] as { fields: { title?: string } }[]).filter((r) => r.fields.title === title || r.fields.title === "bumped");
    assert.equal(notes.length, 1, `the finished create was not repeated: ${JSON.stringify(notes)}`);
    assert.equal(notes[0]?.fields.title, title, "the conflicting update did not land");
  } finally { await d.stop(); }
});
