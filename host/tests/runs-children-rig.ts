// The booted daemon the child-Run tests share (runs.children.test.ts and runs.children.retry.test.ts): a seeded Space, the owner's calls, and the automations, notes and waits
// each test reads. Each test boots its own daemon from it.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fakePlatform } from "../src/platform/index.ts";
import type { FetchFn } from "../src/platform/probes.ts";
import { loadConfig } from "../src/daemon/config.ts";
import { startDaemon } from "../src/daemon/daemon.ts";
import type { Daemon, DaemonOptions } from "../src/daemon/daemon.ts";

const caddyFetch: FetchFn = () => Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, text: () => Promise.resolve('{"apps":{"http":{}}}') });
const OWNER = "tok-usr_olivia";

/** A data directory holding a copy of the seeded core Space. `bootCore` is fixtures/seed/core's (a test passes it: only a test file may import the fixtures). */
export function seededDir(bootCore: () => { store: { db: { exec(sql: string): void } }; file: string; close(): void }): string {
  const core = bootCore();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-children-"));
  core.store.db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE");
  fs.copyFileSync(core.file, path.join(dir, "events.db"));
  core.close();
  return dir;
}

export const bootDaemon = (dir: string, extra: Partial<DaemonOptions> = {}): Promise<Daemon> => startDaemon({
  config: loadConfig(["--data-dir", dir, "--port", "0"], {}, "1.2.3"),
  platform: fakePlatform({
    os: "linux", hostname: "children-live", free: 80e9,
    commands: {
      [`findmnt -n -o SOURCE --target ${dir}`]: { stdout: "/dev/mapper/vyre\n" },
      "lsblk -s -n -o TYPE /dev/mapper/vyre": { stdout: "crypt\ndisk\n" },
      "docker info --format {{.ServerVersion}}": { stdout: "27.1.1\n" },
    },
  }),
  fetch: caddyFetch,
  session: (h) => {
    const t = /^Bearer (.+)$/.exec(String(h["authorization"] ?? ""))?.[1];
    return t === OWNER ? { space: "spc_core", principal: { kind: "person", id: "usr_olivia" }, device: "children-live" } : null;
  },
  intervals: { fast: 3_600_000, slow: 3_600_000, encryption: 3_600_000, commands: 3_600_000, hooks: 200, tick: 200 },
  ...extra,
});

const call = async (d: Daemon, p: string, body: unknown, token = OWNER): Promise<{ status: number; data: Record<string, unknown>; text: string }> => {
  const r = await fetch(`${d.url}${p}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify(body), signal: AbortSignal.timeout(8_000) });
  const text = await r.text();
  return { status: r.status, data: ((JSON.parse(text) as { data?: Record<string, unknown> }).data ?? {}), text };
};
export const ok = async (d: Daemon, p: string, body: unknown, token = OWNER): Promise<Record<string, unknown>> => {
  const r = await call(d, p, body, token);
  assert.equal(r.status, 200, `${p}: ${r.text}`);
  return r.data;
};
export async function until<T>(what: string, ms: number, look: () => Promise<T | undefined>): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await look();
    if (v !== undefined) return v;
    assert.ok(Date.now() < end, `gave up waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 150));
  }
}

type Note = { fields: { title?: string } };
export const note = (id: string, title: string, next?: string[]) => ({ id, key: "records.create", input: { type: "note_board", fields: { title } }, ...(next ? { next } : {}) });
/** The catalogue requires `branches` on a parallel step's input. The host follows the labeled node branches. */
export const parallel = (id: string, waitFor: "all" | "any", lanes: { label: string; to: string }[], next: string[]) => ({
  id, key: "parallel", input: { waitFor, branches: lanes.map((l) => l.to) }, branches: lanes, next,
});

export async function automation(d: Daemon, name: string, definition: unknown): Promise<string> {
  const made = await ok(d, "/v1/automations/create", { idempotencyKey: `child-${name}`, name });
  const id = String((made["automation"] as { id?: string } | undefined)?.id ?? made["automationId"]);
  assert.match(id, /^aut_/, `automation.create: ${JSON.stringify(made)}`);
  await ok(d, "/v1/automations/update", { automationId: id, definition });
  return id;
}
export const runOf = async (d: Daemon, id: string, key: string): Promise<string> => String((await ok(d, "/v1/automations/run", { automationId: id, idempotencyKey: key }))["runId"]);
export const runRow = async (d: Daemon, runId: string): Promise<{ status?: string; summary?: string; parentRun?: string }> =>
  ((await ok(d, "/v1/runs/get", { runId }))["run"] ?? {}) as { status?: string; summary?: string; parentRun?: string };
export const statusOf = async (d: Daemon, runId: string): Promise<string> => String((await runRow(d, runId)).status);
export const notes = async (d: Daemon): Promise<Note[]> => ((await ok(d, "/v1/records/query", { type: "note_board" }))["rows"] as Note[]);
export const countOf = async (d: Daemon, title: string): Promise<number> => (await notes(d)).filter((r) => r.fields.title === title).length;

export async function succeed(d: Daemon, runId: string, ms: number): Promise<void> {
  await until("the run to succeed", ms, async () => {
    const run = await runRow(d, runId);
    if (run.status === "succeeded") return true;
    if (run.status === "failed" || run.status === "stopped") {
      const steps = await ok(d, "/v1/runs/steps", { runId });
      assert.fail(`the run ${run.status}: ${run.summary ?? ""} ${JSON.stringify(steps)}`);
    }
    return undefined;
  });
}
