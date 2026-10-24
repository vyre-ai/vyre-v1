// Contract: every row of perf/budgets.json has a probe id in perf/generated/probes.json.
// Also covers median of 5, fast-lane selection, the headless client, and the console_speed budget.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { PROTOCOL_VERSION } from "../../sync/src/protocol.ts";
import {
  PROBES_OUT,
  REPO_ROOT,
  SAMPLE_COUNT,
  affectedProbeIds,
  budgetProbeCatalog,
  builtinMeasure,
  compareRun,
  createFakeUiClock,
  createHeadlessClient,
  failureText,
  fileHits,
  formatWaterfall,
  isFullLane,
  loadBudgets,
  measureConsoleSpeed,
  median,
  percentile,
  refreshProbes,
  reportJson,
  rollup,
  runLane,
  selectRows,
  takeSamples,
} from "../harness/index.ts";
import type { SampleResult, Span } from "../harness/index.ts";

const ARCH_IDS = [
  "startup",
  "navigate",
  "search",
  "chat_open",
  "send",
  "scroll",
  "space_switch",
  "edit",
  "table100k",
  "sync_snapshot",
  "authorize",
  "server_write",
  "engine_pool",
  "stream_render",
  "layout_shift",
  "prefetch",
  "connection_count",
  "console_speed",
];

function span(id: string, name: string, durMs: number, extra?: { startMs?: number; parentId?: string; budgetId?: string; traceId?: string }): Span {
  const row: Span = {
    id,
    name,
    durMs,
    budgetId: extra?.budgetId ?? "edit",
    startMs: extra?.startMs ?? 0,
    traceId: extra?.traceId ?? "tr_w",
  };
  if (extra?.parentId) row.parentId = extra.parentId;
  return row;
}

test("perf/budgets.json has one row per ARCH 9 budget with id, metric, p50, p95, machine", () => {
  const rows = loadBudgets(REPO_ROOT);
  for (const row of rows) {
    assert.equal(typeof row.id, "string");
    assert.equal(typeof row.metric, "string");
    assert.equal(typeof row.p50, "number");
    assert.equal(typeof row.p95, "number");
    assert.ok(row.machine === "mid laptop" || row.machine === "mid phone");
    assert.ok(row.p50 <= row.p95);
  }
  const ids = new Set(rows.map((r) => r.id));
  for (const id of ARCH_IDS) assert.ok(ids.has(id), id);
  const startup = rows.filter((r) => r.id === "startup");
  assert.deepEqual(startup.map((r) => r.machine).sort(), ["mid laptop", "mid phone"]);
  assert.equal(startup.find((r) => r.machine === "mid laptop")?.p95, 1000);
  assert.equal(startup.find((r) => r.machine === "mid phone")?.p95, 1500);
  assert.equal(rows.find((r) => r.id === "navigate")?.p95, 100);
  assert.equal(rows.find((r) => r.id === "send")?.p95, 16);
  assert.equal(rows.find((r) => r.id === "scroll")?.p95, 16.7);
  assert.equal(rows.find((r) => r.id === "layout_shift")?.p95, 0);
  assert.equal(rows.find((r) => r.id === "connection_count")?.p95, 1);
  assert.equal(rows.find((r) => r.id === "console_speed")?.p95, 100);
  const catalog = new Set(budgetProbeCatalog().map((p) => p.id));
  for (const id of ids) assert.ok(catalog.has(id), `probe catalog missing ${id}`);
});

test("every budget row has a probe id in perf/generated/probes.json", () => {
  const dir = path.join(REPO_ROOT, "perf/generated");
  try {
    const written = refreshProbes(REPO_ROOT);
    const disk = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, PROBES_OUT), "utf8")) as { probes: Array<{ id: string }> };
    assert.equal(PROBES_OUT, "perf/generated/probes.json");
    const ids = new Set(disk.probes.map((p) => p.id));
    for (const row of loadBudgets(REPO_ROOT)) assert.ok(ids.has(row.id), `${row.id} missing from ${PROBES_OUT}`);
    assert.ok(ids.has("screen.console.speed"));
    assert.equal(written.length, disk.probes.length);
    const consoleProbe = disk.probes.find((p) => p.id === "console_speed") as { files?: string[] } | undefined;
    assert.ok(consoleProbe?.files?.includes("perf/"));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("median of 5 and p95: p95 of five samples is the largest and a short sample list is rejected", () => {
  assert.equal(SAMPLE_COUNT, 5);
  assert.equal(median([1, 5, 2, 4, 3]), 3);
  assert.equal(percentile([1, 5, 2, 4, 3], 95), 5);
  const budgets = loadBudgets(REPO_ROOT);
  const send = budgets.find((b) => b.id === "send")!;
  const samples = takeSamples(() => ({ value: 10, spans: [], traceId: "tr_ok" }));
  assert.equal(samples.length, 5);
  assert.equal(compareRun(send, samples).ok, true);
  assert.throws(() => compareRun(send, samples.slice(0, 4)), /5 samples/);
});

test("a run over budget fails and prints the span waterfall of the worst sample", () => {
  const budgets = loadBudgets(REPO_ROOT);
  const edit = budgets.find((b) => b.id === "edit")!;
  const slow = (value: number): SampleResult => ({
    value,
    traceId: "tr_slow",
    spans: [
      span("a", "edit.local", value),
      span("b", "sqlite.write", 1, { startMs: 0.5, parentId: "a" }),
    ],
  });
  const result = compareRun(edit, [slow(4), slow(4), slow(9), slow(4), slow(40)]);
  assert.equal(result.ok, false);
  assert.equal(result.p95, 40);
  assert.equal(result.p50, 4);
  const text = failureText(result);
  assert.match(text, /FAIL edit p95 40 exceeds budget 10/);
  assert.match(text, /span waterfall tr_slow/);
  assert.match(text, /edit\.local/);
  assert.match(text, /sqlite\.write/);
  assert.ok(text.indexOf("sqlite.write") > text.indexOf("edit.local"));
  const parsed = JSON.parse(reportJson({ lane: "fast", rows: [result], skipped: [] })) as { rows: Array<{ ok: boolean; budgetP95: number }> };
  assert.equal(parsed.rows[0]?.ok, false);
  assert.equal(parsed.rows[0]?.budgetP95, 10);
  assert.equal(failureText({ ...result, ok: true }), "");
});

test("fast lane runs affected rows via probes.json and main runs the full set", () => {
  const budgets = loadBudgets(REPO_ROOT);
  const probes = budgetProbeCatalog();
  assert.equal(isFullLane("main"), true);
  assert.equal(isFullLane("origin/main"), true);
  assert.equal(isFullLane("refs/tags/v1.0.0"), true);
  assert.equal(isFullLane("dryrun2/P-L11_01"), false);
  const fast = selectRows({ ref: "dryrun2/P-L11_01", changed: ["ui/src/list.tsx"], budgets, probes });
  const fastIds = new Set(fast.map((b) => b.id));
  assert.ok(fastIds.has("scroll"));
  assert.ok(fastIds.has("navigate"));
  assert.ok(fastIds.has("layout_shift"));
  assert.ok(!fastIds.has("server_write"));
  assert.ok(!fastIds.has("engine_pool"));
  assert.equal(selectRows({ ref: "main", changed: ["ui/src/list.tsx"], budgets, probes }).length, budgets.length);
  assert.equal(selectRows({ ref: "fast", changed: ["perf/budgets.json"], budgets, probes }).length, budgets.length);
  const forward = new Map<string, string[]>([["client/src/store/index.ts", ["client/src/store/replica.ts"]]]);
  const hit = affectedProbeIds(["client/src/store/replica.ts"], [{ id: "table100k", files: ["client/src/store/index.ts"] }], forward);
  assert.deepEqual(hit, ["table100k"]);
  assert.equal(fileHits("ui/src/list.tsx", "ui/"), true);
  assert.equal(fileHits("host/src/x.ts", "ui/"), false);
});

test("headless client keeps one socket, times edits on the fake clock, and stores rows in sqlite", () => {
  const clock = createFakeUiClock(10);
  const client = createHeadlessClient({ clock });
  try {
    assert.equal(client.protocol, PROTOCOL_VERSION);
    assert.equal(client.sockets(), 1);
    client.openScreens(20);
    assert.equal(client.screens(), 20);
    assert.equal(client.sockets(), 1);
    const open = client.begin("edit.local", "tr_edit", "edit");
    clock.advance(4);
    const timed = client.end(open);
    assert.equal(timed.durMs, 4);
    const wrote = client.edit("row_1", "hello");
    assert.equal(client.read("row_1"), "hello");
    assert.equal(wrote.durMs, 0);
    const names = client.spans().map((s) => s.name);
    assert.ok(names.includes("edit.local"));
    clock.advance(1);
    assert.equal(clock.now(), 15);
  } finally {
    client.close();
  }
  assert.throws(() => createFakeUiClock().advance(-1), /forward/);
});

test("console.speed rollup marks a row over when p95 exceeds the budget", () => {
  const budgets = loadBudgets(REPO_ROOT);
  const rows = rollup(
    [
      span("1", "edit.local", 4, { traceId: "tr_a" }),
      span("2", "edit.local", 4, { traceId: "tr_a" }),
      span("3", "edit.local", 30, { traceId: "tr_worst" }),
    ],
    budgets.filter((b) => b.id === "edit"),
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.over, true);
  assert.equal(rows[0]?.worstTraceId, "tr_worst");
  assert.equal(rows[0]?.budgetP95, 10);
  const waterfall = formatWaterfall([
    span("p", "app.start", 12, { budgetId: "startup" }),
    span("c", "app.usable", 9, { startMs: 1, parentId: "p", budgetId: "startup" }),
  ]);
  assert.match(waterfall, /span waterfall tr_w/);
  assert.ok(waterfall.indexOf("app.usable") > waterfall.indexOf("app.start"));
});

test("console_speed measured p95 is inside the perf/budgets.json row", () => {
  const budgets = loadBudgets(REPO_ROOT);
  const budget = budgets.find((b) => b.id === "console_speed" && b.machine === "mid laptop")!;
  const report = runLane({
    ref: "dryrun2/P-L11_01",
    changed: ["perf/harness/headless.ts"],
    budgets,
    probes: budgetProbeCatalog(),
    measure: builtinMeasure(budgets),
  });
  assert.equal(report.lane, "fast");
  const speed = report.rows.find((r) => r.id === "console_speed");
  const edit = report.rows.find((r) => r.id === "edit");
  const sockets = report.rows.find((r) => r.id === "connection_count");
  assert.ok(speed);
  assert.ok(edit);
  assert.ok(sockets);
  assert.equal(speed.samples.length, 5);
  assert.ok(speed.p95 <= speed.budgetP95, `console_speed p95 ${speed.p95} over ${speed.budgetP95}`);
  assert.ok(speed.p50 <= budget.p95);
  assert.equal(speed.ok, true);
  assert.equal(edit.ok, true);
  assert.equal(edit.p95, 3);
  assert.equal(sockets.p95, 1);
  assert.equal(sockets.ok, true);
  assert.ok(!report.rows.some((r) => r.id === "server_write"));
  const one = measureConsoleSpeed(budgets);
  assert.equal(one.traceId, "tr_console_speed");
  assert.ok(one.spans.some((s) => s.name === "spans.rollup"));
  console.log(`console_speed measured p50=${speed.p50} p95=${speed.p95} budget p95=${speed.budgetP95} machine=${speed.machine}`);
});
