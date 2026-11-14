// The speed of the sidebar's one read: a person with 5,000 chats and 200 channels. The budget is perf/budgets.json "navigate" (a place opens: p95 100 ms), because this read is what that open waits on. The first page and a `more`
// page are each measured over 50 runs on one box, p95 against it, plus the count of database reads per call, which must be the same for a page of 50 whatever the number of chats (not one per row).
// @reads /perf/budgets.json
import test from "node:test";
import { loadavg } from "node:os";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { handlers } from "../handlers/index.ts";
import { INTAKE, MAYA, harness, openRaw } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";

const h = handlers as unknown as Record<string, (ctx: Harness["ctx"], input: any) => Promise<any>>; // eslint-disable-line @typescript-eslint/no-explicit-any
const CHATS = 5000;
const CHANNELS = 200;
const RUNS = 50;

const p95 = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.ceil(xs.length * 0.95) - 1]!;

test("perf navigate: one sidebar read, first page and a later page, at 5,000 chats and 200 channels", async () => {
  const parsed = JSON.parse(readFileSync(new URL("../../../perf/budgets.json", import.meta.url), "utf8")) as {
    budgets: { id: string; p95: number }[];
  };
  const budget = parsed.budgets.find((b) => b.id === "navigate")!.p95;
  const raw = openRaw();
  let queries = 0;
  const counted = { all: (sql: string, ...a: unknown[]) => (queries++, raw.all(sql, ...a)), run: raw.run.bind(raw) };
  const hn = harness({
    raw: counted as never,
    calls: {
      "stars.list": () => ({ stars: [] }),
      "notifications.unseen_by_thread": () => ({ counts: [], capped: false }),
      "tasks.needs_you": () => ({ total: 0, items: [] }),
      "goals.list": () => ({ goals: [] }),
      "projects.list": () => ({ projects: [] }),
      "agents.list": () => ({ agents: [{ agentId: INTAKE, name: "Intake" }] }),
      "access.principals.list": () => ({ principals: [{ id: MAYA, name: "Maya" }] }),
      "engine.now": () => ({ working: [] }),
      "engine.thread_states": () => ({ states: [] }),
      "identity.whoami": () => ({ permissions: ["chats.private"] }),
    },
  });
  for (let i = 0; i < CHATS; i++) {
    const r = await h["chat.start"]!(hn.ctx, { kind: "chat", agentIds: [INTAKE], idempotencyKey: `perf${i}` });
    await h["chat.post"]!(hn.ctx, { threadId: r.thread.threadId, body: `m${i}`, idempotencyKey: `perfp${i}` });
    hn.advance(10);
  }
  for (let i = 0; i < CHANNELS; i++) await h["channels.create"]!(hn.ctx, { name: `room-${i}`, visibility: "public" });
  const first: number[] = [];
  const firstCpu: number[] = [];
  const laterCpu: number[] = [];
  const later: number[] = [];
  const reads: number[] = [];
  let after: string | undefined;
  for (let i = 0; i < RUNS; i++) {
    const q0 = queries;
    const c0 = process.cpuUsage();
    const t0 = performance.now();
    const out = await h["chats.sidebar"]!(hn.ctx, {});
    first.push(performance.now() - t0);
    const c1 = process.cpuUsage(c0);
    firstCpu.push((c1.user + c1.system) / 1000);
    reads.push(queries - q0);
    after = out.chats.next;
  }
  for (let i = 0; i < RUNS; i++) {
    const c0 = process.cpuUsage();
    const t0 = performance.now();
    await h["chats.sidebar"]!(hn.ctx, { more: { section: "chats", after, limit: 50 } });
    later.push(performance.now() - t0);
    const c1 = process.cpuUsage(c0);
    laterCpu.push((c1.user + c1.system) / 1000);
  }
  console.log(
    "METRIC " +
      JSON.stringify({
        name: "navigate",
        metric: "chats.sidebar.first_page",
        p95_ms: Math.round(p95(first)),
        p95_cpu_ms: Math.round(p95(firstCpu)),
        box_load: loadavg()[0],
        budget_ms: budget,
        chats: CHATS,
        channels: CHANNELS,
        runs: RUNS,
        db_reads_per_call: reads[0],
      }),
  );
  console.log(
    "METRIC " +
      JSON.stringify({
        name: "navigate",
        metric: "chats.sidebar.more_page",
        p95_ms: Math.round(p95(later)),
        p95_cpu_ms: Math.round(p95(laterCpu)),
        budget_ms: budget,
      }),
  );
  assert.ok(
    new Set(reads).size === 1,
    `the same number of database reads every call (${[...new Set(reads)].join(",")})`,
  );
  assert.ok(reads[0]! <= 12, `a page of 50 is a constant handful of reads, not one per chat (${reads[0]})`);
  assert.ok(
    p95(first) < budget,
    `first page p95 ${p95(first).toFixed(1)} ms must be under ${budget} (processor time ${p95(firstCpu).toFixed(1)} ms, box load ${loadavg()[0]})`,
  );
  assert.ok(
    p95(later) < budget,
    `a later page p95 ${p95(later).toFixed(1)} ms must be under ${budget} (processor time ${p95(laterCpu).toFixed(1)} ms)`,
  );
});
