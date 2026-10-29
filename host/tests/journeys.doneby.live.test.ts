// A Journey task done by an Automation, on a booted host: entering the stage runs the Automation, its Run succeeding does the task, and the finished task moves the record on.
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-jtask-"));
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

interface Reply { status: number; data: Record<string, unknown>; text: string }

const call = async (d: Daemon, p: string, body: unknown, token = OWNER): Promise<Reply> => {
  const r = await fetch(`${d.url}${p}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify(body), signal: AbortSignal.timeout(8_000) });
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

test("a task done by an Automation is done when the Automation's Run succeeds, and the record moves on", async () => {
  const d = await boot(seededDir());
  try {
    const made = await ok(d, "/v1/automations/create", {
      idempotencyKey: "jt-auto", name: "jt-sorter",
      definition: { triggers: [{ key: "journey_stage_entered" }], nodes: [{ id: "note", key: "records.create", input: { type: "note_board", fields: { title: "Sorted by the Automation" } } }] },
    });
    const autoId = String((made["automation"] as { id?: string }).id);
    await ok(d, "/v1/automations/set_enabled", { automationId: autoId, enabled: true });
    const stages = [
      { key: "intake", title: "Intake", order: 1, exit: { requireTasks: true }, tasks: [{ key: "sort", title: "Sort the mail", assigned: { kind: "person", id: "usr_olivia" }, required: true, doneByAutomation: autoId }], automations: [] },
      { key: "done", title: "Done", order: 2, exit: { requireTasks: false }, tasks: [], automations: [], final: true },
    ];
    const j = await ok(d, "/v1/journeys/create", { idempotencyKey: "jt-jrn", name: "Mail sorting", subjectType: "contact", stages });
    const journeyId = String((j["journey"] as { journeyId?: string; id?: string }).journeyId ?? (j["journey"] as { id?: string }).id);
    const contact = await ok(d, "/v1/records/create", { type: "contact", fields: { name: "Subject One" }, idempotencyKey: "jt-contact" });
    const subjectRecordId = String((contact["record"] as { id?: string }).id);
    const started = await ok(d, "/v1/journeys/start", { idempotencyKey: "jt-start", journeyId, subjectRecordId });
    const recordId = String(started["recordId"]);
    const stageOf = async (): Promise<string> => String(((await ok(d, "/v1/records/get", { type: "journey_mail_sorting", recordId }))["record"] as { fields?: { stage?: string } }).fields?.stage);
    await until("the Automation's note", 20_000, async () => {
      const rows = (await ok(d, "/v1/records/query", { type: "note_board" }))["rows"] as { fields?: { title?: string } }[];
      return rows.some((r) => r.fields?.title === "Sorted by the Automation") ? true : undefined;
    });
    const tasks = (await ok(d, "/v1/journeys/tasks", { recordId }))["tasks"] as { taskKey: string; state: string }[];
    assert.ok(tasks.some((t) => t.taskKey === "sort"), JSON.stringify(tasks));
    await until("the task to be done", 20_000, async () => {
      const now = (await ok(d, "/v1/journeys/tasks", { recordId }))["tasks"] as { taskKey: string; state: string }[];
      return now.find((t) => t.taskKey === "sort")?.state === "done" ? true : undefined;
    });
    await until("the record to move on", 20_000, async () => ((await stageOf()) === "done" ? true : undefined));
  } finally { await d.stop(); }
});
