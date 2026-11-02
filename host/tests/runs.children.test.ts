// Parallel lanes and loop iterations are child Runs. On a booted daemon, through the gateway: notes the lanes and the loop write, a lane that loses an any-join, a wait that does not block the other lane, and a parent stop that keeps the note after a child's wait from being written.
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-children-"));
  core.store.db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE");
  fs.copyFileSync(core.file, path.join(dir, "events.db"));
  core.close();
  return dir;
}

const boot = (dir: string, extra: Partial<DaemonOptions> = {}): Promise<Daemon> => startDaemon({
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

type Note = { fields: { title?: string } };
const note = (id: string, title: string, next?: string[]) => ({ id, key: "records.create", input: { type: "note_board", fields: { title } }, ...(next ? { next } : {}) });
/** The catalogue requires `branches` on a parallel step's input. The host follows the labeled node branches. */
const parallel = (id: string, waitFor: "all" | "any", lanes: { label: string; to: string }[], next: string[]) => ({
  id, key: "parallel", input: { waitFor, branches: lanes.map((l) => l.to) }, branches: lanes, next,
});

async function automation(d: Daemon, name: string, definition: unknown): Promise<string> {
  const made = await ok(d, "/v1/automations/create", { idempotencyKey: `child-${name}`, name });
  const id = String((made["automation"] as { id?: string } | undefined)?.id ?? made["automationId"]);
  assert.match(id, /^aut_/, `automation.create: ${JSON.stringify(made)}`);
  await ok(d, "/v1/automations/update", { automationId: id, definition });
  return id;
}
const runOf = async (d: Daemon, id: string, key: string): Promise<string> => String((await ok(d, "/v1/automations/run", { automationId: id, idempotencyKey: key }))["runId"]);
const runRow = async (d: Daemon, runId: string): Promise<{ status?: string; summary?: string; parentRun?: string }> =>
  ((await ok(d, "/v1/runs/get", { runId }))["run"] ?? {}) as { status?: string; summary?: string; parentRun?: string };
const statusOf = async (d: Daemon, runId: string): Promise<string> => String((await runRow(d, runId)).status);
const notes = async (d: Daemon): Promise<Note[]> => ((await ok(d, "/v1/records/query", { type: "note_board" }))["rows"] as Note[]);
const countOf = async (d: Daemon, title: string): Promise<number> => (await notes(d)).filter((r) => r.fields.title === title).length;

async function succeed(d: Daemon, runId: string, ms: number): Promise<void> {
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

test("two parallel lanes write Left note and Right note, then Joined once exists exactly once", async () => {
  const d = await boot(seededDir());
  try {
    const id = await automation(d, "split", {
      triggers: [{ key: "manual" }],
      start: ["par"],
      nodes: [
        parallel("par", "all", [{ label: "Left", to: "a1" }, { label: "Right", to: "b1" }], ["join"]),
        note("a1", "Left note", ["join"]),
        note("b1", "Right note", ["join"]),
        note("join", "Joined once"),
      ],
    });
    const runId = await runOf(d, id, "run-split");
    await succeed(d, runId, 20_000);
    assert.equal(await countOf(d, "Left note"), 1);
    assert.equal(await countOf(d, "Right note"), 1);
    assert.equal(await countOf(d, "Joined once"), 1);
  } finally { await d.stop(); }
});

test("waitFor any writes the fast note and leaves the slow note absent when the parent succeeds", async () => {
  const d = await boot(seededDir());
  try {
    const id = await automation(d, "any", {
      triggers: [{ key: "manual" }],
      start: ["par"],
      nodes: [
        parallel("par", "any", [{ label: "Slow", to: "pause" }, { label: "Fast", to: "fast" }], ["join"]),
        { id: "pause", key: "wait", input: { forDuration: "30s" }, next: ["slow"] },
        note("slow", "Slow note", ["join"]),
        note("fast", "Fast note", ["join"]),
        note("join", "Joined any"),
      ],
    });
    const runId = await runOf(d, id, "run-any");
    await succeed(d, runId, 15_000);
    assert.equal(await countOf(d, "Fast note"), 1);
    assert.equal(await countOf(d, "Slow note"), 0);
    assert.equal(await countOf(d, "Joined any"), 1);
  } finally { await d.stop(); }
});

test("a loop of three items writes Ada, Bea and Cy, then one note after the loop", async () => {
  const d = await boot(seededDir());
  try {
    const id = await automation(d, "each", {
      triggers: [{ key: "manual" }],
      start: ["each"],
      nodes: [
        {
          id: "each", key: "loop",
          input: { items: [{ id: "a", name: "Ada" }, { id: "b", name: "Bea" }, { id: "c", name: "Cy" }], concurrency: 2 },
          branches: [{ label: "body", to: "make" }], next: ["after"],
        },
        note("make", "{{ item.name }}"),
        note("after", "After the loop"),
      ],
    });
    const runId = await runOf(d, id, "run-each");
    await succeed(d, runId, 20_000);
    const titles = (await notes(d)).map((r) => r.fields.title);
    for (const title of ["Ada", "Bea", "Cy", "After the loop"]) assert.equal(titles.filter((t) => t === title).length, 1, titles.join(","));
    // records.query orders by created_at, then id. The three iteration titles keep input order in that list.
    assert.deepEqual(titles.filter((t) => t === "Ada" || t === "Bea" || t === "Cy"), ["Ada", "Bea", "Cy"]);
    assert.ok(titles.indexOf("After the loop") > titles.indexOf("Cy"));
  } finally { await d.stop(); }
});

test("a wait of 2s inside one parallel lane does not block the other lane's note, then the parent joins once", async () => {
  const d = await boot(seededDir());
  try {
    const id = await automation(d, "lane-wait", {
      triggers: [{ key: "manual" }],
      start: ["par"],
      nodes: [
        parallel("par", "all", [{ label: "Left", to: "pause" }, { label: "Right", to: "right" }], ["join"]),
        { id: "pause", key: "wait", input: { forDuration: "2s" }, next: ["left"] },
        note("left", "Left after the wait", ["join"]),
        note("right", "Right during the wait", ["join"]),
        note("join", "Joined once"),
      ],
    });
    const runId = await runOf(d, id, "run-lane-wait");
    await until("the other lane's note before the wait lane writes", 8_000, async () => {
      const right = await countOf(d, "Right during the wait");
      const left = await countOf(d, "Left after the wait");
      if (left > 0) assert.fail("the wait lane wrote its note before the other lane was seen");
      return right === 1 ? true : undefined;
    });
    assert.equal(await countOf(d, "Joined once"), 0, "the parent has not joined while one lane is still waiting");
    await succeed(d, runId, 20_000);
    assert.equal(await countOf(d, "Left after the wait"), 1);
    assert.equal(await countOf(d, "Right during the wait"), 1);
    assert.equal(await countOf(d, "Joined once"), 1);
  } finally { await d.stop(); }
});

test("stopping the parent while a child is waiting does not write the note after that wait", async () => {
  const d = await boot(seededDir());
  try {
    const id = await automation(d, "stop-parent", {
      triggers: [{ key: "manual" }],
      start: ["par"],
      nodes: [
        parallel("par", "all", [{ label: "Wait", to: "pause" }, { label: "Other", to: "other" }], ["join"]),
        { id: "pause", key: "wait", input: { forDuration: "5s" }, next: ["later"] },
        note("later", "After the stopped wait", ["join"]),
        note("other", "Other lane", ["join"]),
        note("join", "Joined after stop"),
      ],
    });
    const runId = await runOf(d, id, "run-stop");
    const childId = await until("a child to park on its wait", 10_000, async () => {
      const listed = (await ok(d, "/v1/runs/list", { scope: "subject", subject: { type: "automation", id }, statuses: ["waiting"], limit: 20 }))["runs"] as { id: string; parentRun?: string }[];
      const child = listed.find((r) => r.parentRun === runId);
      if (!child) return undefined;
      const steps = (await ok(d, "/v1/runs/steps", { runId: child.id }))["steps"] as { step: string; state: string }[];
      return steps.some((s) => s.step === "pause" && s.state === "waiting") ? child.id : undefined;
    });
    assert.equal(await countOf(d, "After the stopped wait"), 0);
    await ok(d, "/v1/runs/stop", { runId, reason: "stop parent" });
    assert.equal(await statusOf(d, runId), "stopped");
    assert.equal(await statusOf(d, childId), "stopped");
    const end = Date.now() + 6_000;
    while (Date.now() < end) {
      assert.equal(await countOf(d, "After the stopped wait"), 0);
      assert.equal(await countOf(d, "Joined after stop"), 0);
      assert.equal(await statusOf(d, runId), "stopped");
      await new Promise((r) => setTimeout(r, 400));
    }
  } finally { await d.stop(); }
});

test("retrying a failed loop does not run again the iterations that already succeeded", async () => {
  const d = await boot(seededDir());
  try {
    const id = await automation(d, "each-retry", {
      triggers: [{ key: "manual" }],
      start: ["each"],
      nodes: [
        { id: "each", key: "loop", input: { items: [{ id: "a", name: "Ada" }, { id: "b", name: "Bea" }, { id: "c", name: "Cy" }], concurrency: 1 }, branches: [{ label: "body", to: "make" }] },
        note("make", "{{ item.name }}", ["check"]),
        { id: "check", key: "if", input: { condition: "item.name == 'Bea'" }, branches: [{ label: "then", to: "boom" }, { label: "else", to: "fine" }] },
        { id: "boom", key: "stop", input: { outcome: "failed", message: "Bea is not ready" } },
        { id: "fine", key: "stop", input: {} },
      ],
    });
    const runId = await runOf(d, id, "run-each-retry");
    const ended = async (rid: string): Promise<void> => { await until("the run to fail", 20_000, async () => { const r = (await ok(d, "/v1/runs/get", { runId: rid }))["run"] as { status?: string }; return r.status === "failed" ? true : undefined; }); };
    await ended(runId);
    assert.equal(await countOf(d, "Ada"), 1);
    const again = String((await ok(d, "/v1/runs/retry", { runId }))["runId"]);
    await ended(again);
    assert.equal(await countOf(d, "Ada"), 1, "Ada went out once, however many times the run is retried");
    assert.equal(await countOf(d, "Bea"), 2, "the iteration that failed ran again");
    // the Automation page retries through its own call, which links the new Run itself
    const third = String((await ok(d, "/v1/automations/retry", { automationId: id, runId: again }))["runId"]);
    await ended(third);
    assert.equal(await countOf(d, "Ada"), 1, "the same through automations.retry");
    assert.equal(await countOf(d, "Bea"), 3);
    assert.equal(await countOf(d, "Cy"), 0, "the item after the failure never started");
  } finally { await d.stop(); }
});
