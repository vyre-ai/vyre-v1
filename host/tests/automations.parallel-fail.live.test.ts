// One parallel lane fails. waitFor all fails the parent and names that lane. waitFor any keeps waiting while another lane is still open, then finishes on the lane that succeeded. The failed lane stays visible. This is not the any-join that only races a fast note against a slow one.
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-pfail-"));
  core.store.db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE");
  fs.copyFileSync(core.file, path.join(dir, "events.db"));
  core.close();
  return dir;
}

const boot = (dir: string, extra: Partial<DaemonOptions> = {}): Promise<Daemon> => startDaemon({
  config: loadConfig(["--data-dir", dir, "--port", "0"], {}, "1.2.3"),
  platform: fakePlatform({
    os: "linux", hostname: "pfail-live", free: 80e9,
    commands: {
      [`findmnt -n -o SOURCE --target ${dir}`]: { stdout: "/dev/mapper/vyre\n" },
      "lsblk -s -n -o TYPE /dev/mapper/vyre": { stdout: "crypt\ndisk\n" },
      "docker info --format {{.ServerVersion}}": { stdout: "27.1.1\n" },
    },
  }),
  fetch: caddyFetch,
  session: (h) => {
    const t = /^Bearer (.+)$/.exec(String(h["authorization"] ?? ""))?.[1];
    return t === OWNER ? { space: "spc_core", principal: { kind: "person", id: "usr_olivia" }, device: "pfail-live" } : null;
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

type Note = { fields: { title?: string } };
type RunRow = { id?: string; status?: string; summary?: string; parentRun?: string };
type StepRow = { step: string; state: string; error?: { code?: string; message?: string } };
const note = (id: string, title: string, next?: string[]) => ({ id, key: "records.create", input: { type: "note_board", fields: { title } }, ...(next ? { next } : {}) });
const stopFailed = (id: string, message: string) => ({ id, key: "stop", input: { outcome: "failed", message }, next: ["join"] });
const parallel = (waitFor: "all" | "any", lanes: { label: string; to: string }[]) => ({
  id: "par", key: "parallel", input: { waitFor, branches: lanes.map((l) => l.to) }, branches: lanes, next: ["join"],
});

async function automation(d: Daemon, name: string, nodes: unknown[]): Promise<string> {
  const made = await ok(d, "/v1/automations/create", { idempotencyKey: `pfail-${name}`, name });
  const id = String((made["automation"] as { id?: string } | undefined)?.id ?? made["automationId"]);
  assert.match(id, /^aut_/);
  await ok(d, "/v1/automations/update", { automationId: id, definition: { triggers: [{ key: "manual" }], start: ["par"], nodes } });
  return id;
}
const runOf = async (d: Daemon, id: string, key: string): Promise<string> => String((await ok(d, "/v1/automations/run", { automationId: id, idempotencyKey: key }))["runId"]);
const runRow = async (d: Daemon, runId: string): Promise<RunRow> => ((await ok(d, "/v1/runs/get", { runId }))["run"] ?? {}) as RunRow;
const countOf = async (d: Daemon, title: string): Promise<number> =>
  ((await ok(d, "/v1/records/query", { type: "note_board" }))["rows"] as Note[]).filter((r) => r.fields.title === title).length;
const stepsOf = async (d: Daemon, runId: string): Promise<StepRow[]> => (await ok(d, "/v1/runs/steps", { runId }))["steps"] as StepRow[];

async function failedChild(d: Daemon, automationId: string, parentId: string): Promise<RunRow> {
  const listed = (await ok(d, "/v1/runs/list", { scope: "subject", subject: { type: "automation", id: automationId }, statuses: ["failed"], limit: 20 }))["runs"] as RunRow[];
  const child = listed.find((r) => r.parentRun === parentId && r.id);
  assert.ok(child?.id, `the failing lane is not in the run list: ${JSON.stringify(listed)}`);
  return child;
}

test("waitFor all fails the parent when one lane fails, names that lane, and does not join", async () => {
  const d = await boot(seededDir());
  try {
    const id = await automation(d, "all", [
      parallel("all", [{ label: "Good", to: "good" }, { label: "Bad", to: "bad" }]),
      note("good", "All kept", ["join"]),
      stopFailed("bad", "The bad lane stopped."),
      note("join", "All joined"),
    ]);
    const runId = await runOf(d, id, "run-all");
    const run = await until("the parent to fail", 15_000, async () => {
      const row = await runRow(d, runId);
      if (row.status === "failed") return row;
      if (row.status === "succeeded") assert.fail(`all joined after a lane failed: ${row.summary ?? ""}`);
      return undefined;
    });
    assert.match(String(run.summary), /The lane Bad/);
    assert.doesNotMatch(String(run.summary), /The bad lane stopped/, "the parent no longer carries the child reason");
    const par = (await stepsOf(d, runId)).find((s) => s.step === "par" && s.state === "failed");
    assert.ok(par, "the parallel step failed");
    assert.equal(par.error?.code, "run.branch_failed");
    assert.match(String(par.error?.message), /The lane Bad/);
    const child = await failedChild(d, id, runId);
    assert.equal(child.status, "failed");
    assert.match(String(child.summary), /The bad lane stopped/);
    const childSteps = await stepsOf(d, String(child.id));
    assert.equal(childSteps.some((s) => s.step === "bad" && s.state === "failed" && s.error?.code === "run.stopped"), true, JSON.stringify(childSteps));
    assert.equal(await countOf(d, "All kept"), 1);
    assert.equal(await countOf(d, "All joined"), 0);
  } finally { await d.stop(); }
});

test("waitFor any waits while a lane is still open, then succeeds on the lane that finished, and the failed lane stays visible", async () => {
  const d = await boot(seededDir());
  try {
    const id = await automation(d, "any", [
      parallel("any", [{ label: "Good", to: "pause" }, { label: "Bad", to: "bad" }]),
      { id: "pause", key: "wait", input: { forDuration: "2s" }, next: ["good"] },
      note("good", "Any winner", ["join"]),
      stopFailed("bad", "The bad lane stopped."),
      note("join", "Any joined"),
    ]);
    const runId = await runOf(d, id, "run-any");
    await until("the parent to wait for the open lane", 10_000, async () => {
      const row = await runRow(d, runId);
      if (row.status === "failed" || row.status === "stopped") assert.fail(`any ended the parent while a lane was still open: ${row.status} ${row.summary ?? ""}`);
      return row.status === "waiting" ? true : undefined;
    });
    const early = await failedChild(d, id, runId);
    assert.match(String(early.summary), /The bad lane stopped/);
    assert.equal(await countOf(d, "Any winner"), 0);
    assert.equal(await countOf(d, "Any joined"), 0);
    await until("the parent to succeed on the finished lane", 15_000, async () => {
      const row = await runRow(d, runId);
      if (row.status === "succeeded") return true;
      if (row.status === "failed" || row.status === "stopped") assert.fail(`any failed the parent after a lane finished: ${row.summary ?? ""}`);
      return undefined;
    });
    const child = await failedChild(d, id, runId);
    assert.equal(child.id, early.id, "the failed lane is the same run");
    assert.equal(child.status, "failed");
    const childSteps = await stepsOf(d, String(child.id));
    assert.equal(childSteps.some((s) => s.step === "bad" && s.state === "failed" && s.error?.code === "run.stopped"), true, JSON.stringify(childSteps));
    assert.equal(await countOf(d, "Any winner"), 1);
    assert.equal(await countOf(d, "Any joined"), 1);
  } finally { await d.stop(); }
});
