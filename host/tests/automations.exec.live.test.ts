// P-L6_24: an Automation that is run actually runs. On a booted daemon, through the gateway with real tokens: a records.create step makes its record, a wait step parks the Run and the clock
// resumes it, and a Run the last server left queued is driven to its end by the next one (the recovery at boot).
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-exec-"));
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

/** An Automation that runs by hand with these steps; returns its id. */
async function automation(d: Daemon, name: string, nodes: unknown[], token = OWNER): Promise<string> {
  const made = await ok(d, "/v1/automations/create", { idempotencyKey: `exec-${name}`, name }, token);
  const id = String((made["automation"] as { id?: string } | undefined)?.id ?? made["automationId"]);
  assert.match(id, /^aut_/, `automation.create: ${JSON.stringify(made)}`);
  await ok(d, "/v1/automations/update", { automationId: id, definition: { triggers: [{ key: "manual" }], nodes } }, token);
  return id;
}
const runOf = async (d: Daemon, id: string, key: string, token = OWNER): Promise<string> => String((await ok(d, "/v1/automations/run", { automationId: id, idempotencyKey: key }, token))["runId"]);
const statusOf = async (d: Daemon, runId: string): Promise<string> => String(((await ok(d, "/v1/runs/get", { runId }))["run"] as { status?: string } | undefined)?.status);
const hasNote = async (d: Daemon, title: string): Promise<boolean> =>
  ((await ok(d, "/v1/records/query", { type: "note_board" }))["rows"] as { fields: { title?: string } }[]).some((r) => r.fields.title === title);
const mk = (id: string, title: string) => ({ id, key: "records.create", input: { type: "note_board", fields: { title } } });

test("a manual Automation with a records.create step runs and the record exists", async () => {
  const d = await boot(seededDir());
  try {
    const id = await automation(d, "make-note", [mk("note", "Made by an automation")]);
    const runId = await runOf(d, id, "run-1");
    assert.equal(await until("the run to succeed", 15_000, async () => { const s = await statusOf(d, runId); return s === "succeeded" ? s : s === "failed" ? assert.fail(`the run failed: ${JSON.stringify(await ok(d, "/v1/runs/get", { runId }))}`) : undefined; }), "succeeded");
    assert.equal(await hasNote(d, "Made by an automation"), true, "the record the step made is there");
  } finally { await d.stop(); }
});

test("a wait step parks the Run, the clock resumes it, and the steps after it run", async () => {
  const d = await boot(seededDir());
  try {
    const id = await automation(d, "wait-note", [{ id: "pause", key: "wait", input: { forDuration: "2s" } }, mk("after", "Made after the wait")]);
    const runId = await runOf(d, id, "run-wait");
    await until("the run to wait", 10_000, async () => ((await statusOf(d, runId)) === "waiting" ? true : undefined));
    assert.equal(await hasNote(d, "Made after the wait"), false, "nothing after the wait has run yet");
    await until("the run to succeed", 20_000, async () => ((await statusOf(d, runId)) === "succeeded" ? true : undefined));
    assert.equal(await hasNote(d, "Made after the wait"), true);
  } finally { await d.stop(); }
});

test("a Run the last server left queued is driven to its end when the next one starts", async () => {
  const dir = seededDir();
  // the first server has no hooks, so nothing drives: the Run is made and left queued, as if the server had stopped right after it started
  let d = await boot(dir, { hooks: [] });
  let runId = "";
  try {
    const id = await automation(d, "recover-note", [mk("note", "Made after a restart")]);
    runId = await runOf(d, id, "run-recover");
    assert.equal(await statusOf(d, runId), "queued", "the first server only recorded the Run");
  } finally { await d.stop(); }
  d = await boot(dir);
  try {
    await until("the recovered run to succeed", 20_000, async () => ((await statusOf(d, runId)) === "succeeded" ? true : undefined));
    assert.equal(await hasNote(d, "Made after a restart"), true);
    assert.equal(((await ok(d, "/v1/runs/steps", { runId }))["steps"] as unknown[]).length >= 1, true, "the step log shows what ran");
  } finally { await d.stop(); }
});

/** Noah's Run parks on a wait; `lose` takes his place in the Space away; the Run must fail by name when the wait ends, and the step after it must never run. */
async function lostAccessMidRun(name: string, lose: (d: Daemon) => Promise<void>, why: RegExp): Promise<void> {
  const d = await boot(seededDir());
  try {
    const title = `Made by ${name}`;
    const id = await automation(d, `${name}-note`, [{ id: "pause", key: "wait", input: { forDuration: "2s" } }, mk("after", title)], NOAH);
    const runId = await runOf(d, id, `run-${name}`, NOAH);
    await until("the run to wait", 10_000, async () => ((await statusOf(d, runId)) === "waiting" ? true : undefined));
    await lose(d);
    const run = await until("the run to fail", 20_000, async () => {
      const r = (await ok(d, "/v1/runs/get", { runId }))["run"] as { status?: string; errorCode?: string; error?: { code?: string; details?: { reason?: string } } };
      return r.status === "failed" ? r : r.status === "succeeded" ? assert.fail("the run went on as a person who was no longer let in") : undefined;
    });
    const code = String(run.errorCode ?? run.error?.code);
    assert.match(code, /^(auth\.unauthenticated|permission\.(suspended|revoked|no_grant))$/, `the failure carries a catalogued code, got ${code}`);
    assert.match(JSON.stringify(run), why, `the failure names why: ${JSON.stringify(run)}`);
    assert.equal(await hasNote(d, title), false, "the step after the wait never ran");
  } finally { await d.stop(); }
}

test("a step is authorized when it runs: a person suspended while their Run waits has the Run fail by name", () =>
  lostAccessMidRun("suspended", async (d) => { await ok(d, "/v1/members/suspend", { personId: "usr_noah", reason: "test" }); }, /suspended/));

test("a step is authorized when it runs: a person removed while their Run waits has the Run fail by name", () =>
  lostAccessMidRun("removed", async (d) => {
    const preview = await ok(d, "/v1/members/remove_preview", { personId: "usr_noah" });
    const items = preview["items"] as { kind: string; defaultAction: string; options: string[] }[];
    // keep what Noah owns with Olivia, so the Run is not stopped by the wizard: it must fail on its own step
    const plan = items.map((i) => (i.options.includes("reassign") ? { kind: i.kind, action: "reassign", to: "usr_olivia" } : { kind: i.kind, action: i.defaultAction }));
    await ok(d, "/v1/members/remove", { personId: "usr_noah", plan, reason: "test" });
  }, /no longer a member/));
