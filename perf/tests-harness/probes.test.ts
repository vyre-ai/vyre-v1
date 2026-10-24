// ARCH 9 harness: one budgets.json row per budget, a probe id in the catalog, median of 5, waterfall on failure.
import test from "node:test";
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import type { Budget, Sample, Span } from "../harness/types.ts";
import {
  SAMPLE_COUNT,
  HeadlessClient,
  budgetsMissingProbe,
  createClock,
  emitReport,
  failureText,
  judge,
  limitFor,
  loadBudgets,
  loadProbes,
  median,
  metricLine,
  parseBudgets,
  percentile,
  rollup,
  rowsForLane,
  runBudget,
} from "../harness/index.ts";

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
  "authz",
  "server_write",
  "engine_pool",
  "stream_render",
  "layout_shift",
  "prefetch",
  "connection_count",
  "console_speed",
];

function samples(values: readonly number[], spans: Span[] = []): Sample[] {
  return values.map((value, i) => ({ value, traceId: `tr_${i}`, spans: i === values.length - 1 ? spans : [] }));
}

function durationFor(budget: Budget): number {
  if (budget.sense === "exact" || budget.sense === "min") return budget.p95;
  if (budget.p95 === 0) return 0;
  return Math.min(1, budget.p95);
}

function must(budgets: readonly Budget[], id: string): Budget {
  const found = budgets.find((budget) => budget.id === id);
  if (!found) throw new Error(`missing budget ${id}`);
  return found;
}

const minimal = {
  id: "a",
  metric: "m",
  p50: 1,
  p95: 1,
  machine: "mid laptop",
  probe: "screen.console.speed",
  unit: "ms",
  sense: "max",
};

test("budgets.json has one row per ARCH 9 budget with id, metric, p50, p95, and machine", () => {
  const budgets = loadBudgets();
  assert.deepEqual(budgets.map((b) => b.id), ARCH_IDS);
  for (const budget of budgets) {
    assert.equal(budget.machine, "mid laptop");
    assert.equal(typeof budget.metric, "string");
    assert.ok(budget.p50 <= budget.p95);
    assert.ok(budget.probe.startsWith("screen."));
  }
  assert.deepEqual(limitFor(must(budgets, "startup"), "app.usable", "mid phone"), { p95: 1500, sense: "max" });
  assert.deepEqual(limitFor(must(budgets, "search"), "search.local"), { p95: 50, sense: "max" });
  assert.deepEqual(limitFor(must(budgets, "search"), "search.server"), { p95: 300, sense: "max" });
  assert.deepEqual(limitFor(must(budgets, "send"), "turn.first_token_overhead"), { p95: 150, sense: "max" });
  assert.deepEqual(limitFor(must(budgets, "edit"), "edit.remote_seen"), { p95: 500, sense: "max" });
  assert.deepEqual(limitFor(must(budgets, "table100k"), "records.search"), { p95: 50, sense: "max" });
  assert.deepEqual(limitFor(must(budgets, "authz"), "authz.per_sec"), { p95: 500000, sense: "min" });
  assert.deepEqual(limitFor(must(budgets, "space_switch"), "space.mixed_ids"), { p95: 0, sense: "max" });
  assert.throws(() => parseBudgets({ budgets: [minimal, { ...minimal }] }), /duplicate budget id a/);
  assert.throws(() => parseBudgets({ budgets: [{ ...minimal, p50: 2, p95: 1 }] }), /p50 2 is above p95 1/);
});

test("every budget row has a probe id in the probe catalog", () => {
  const budgets = loadBudgets();
  const loaded = loadProbes();
  assert.ok(loaded.source === "perf/generated/probes.json" || loaded.source === "generated/probes.json");
  assert.deepEqual(budgetsMissingProbe(budgets, loaded.probes), []);
  assert.ok(loaded.probes.some((probe) => probe.id === "screen.console.speed"));
});

test("median of 5 is the middle sample and p95 of 5 is the slowest", () => {
  const values = [5, 1, 4, 2, 3];
  assert.equal(SAMPLE_COUNT, 5);
  assert.equal(median(values), 3);
  assert.equal(percentile(values, 0.5), 3);
  assert.equal(percentile(values, 0.95), 5);
  const navigate = must(loadBudgets(), "navigate");
  let calls = 0;
  const report = runBudget(navigate, () => {
    calls += 1;
    return { value: 40, traceId: `tr_${calls}`, spans: [] };
  });
  assert.equal(calls, 5);
  assert.equal(report.p50, 40);
  assert.equal(report.samples.length, 5);
  assert.equal(report.ok, true);
});

test("output JSON is compared with the budget, and a miss prints the worst span waterfall", () => {
  const budgets = loadBudgets();
  const navigate = must(budgets, "navigate");
  const startup = must(budgets, "startup");
  const inside = judge(navigate, samples([40, 40, 40, 40, 40]));
  const out = JSON.parse(JSON.stringify(inside)) as typeof inside;
  assert.equal(out.metric, "nav.open");
  assert.equal(out.machine, "mid laptop");
  assert.equal(out.unit, "ms");
  assert.equal(out.p50, 40);
  assert.equal(out.p95, 40);
  assert.equal(out.budgetP50, 50);
  assert.equal(out.budgetP95, 100);
  assert.equal(out.ok, true);
  assert.equal("waterfall" in out, false);
  assert.equal(judge(navigate, samples([60, 60, 60, 60, 60])).ok, false);
  assert.equal(judge(startup, samples([1000, 1000, 1000, 1000, 1000])).ok, true);
  assert.equal(judge(startup, samples([1000, 1000, 1000, 1000, 1000.1])).ok, false);

  const trace: Span[] = [
    { id: "a", name: "app.start", budgetId: "startup", traceId: "tr_slow", parentId: null, startMs: 0, endMs: 10 },
    { id: "b", name: "replica.open", budgetId: "startup", traceId: "tr_slow", parentId: "a", startMs: 2, endMs: 8 },
    { id: "c", name: "app.usable", budgetId: "startup", traceId: "tr_slow", parentId: null, startMs: 10, endMs: 40 },
  ];
  const missed = judge(startup, [
    { value: 9, traceId: "tr_0", spans: [] },
    { value: 10, traceId: "tr_1", spans: [] },
    { value: 11, traceId: "tr_2", spans: [] },
    { value: 12, traceId: "tr_3", spans: [] },
    { value: 4000, traceId: "tr_slow", spans: trace },
  ]);
  assert.equal(missed.ok, false);
  assert.equal(missed.p50, 11);
  assert.equal(missed.p95, 4000);
  assert.equal(missed.worstTraceId, "tr_slow");
  const text = failureText(missed);
  assert.match(text, /^FAIL startup /);
  assert.match(text, /worst sample 4000 ms trace tr_slow/);
  assert.match(text, /app\.start 0 ms for 10 ms\n {2}replica\.open 2 ms for 6 ms/);
  assert.ok(text.indexOf("app.start") < text.indexOf("replica.open"));
  assert.ok(text.indexOf("replica.open") < text.indexOf("app.usable"));
  const written: string[] = [];
  emitReport(missed, (line) => written.push(line));
  assert.equal(written.length, 1);
  assert.match(written[0] ?? "", /replica\.open/);
  assert.doesNotMatch(failureText(inside), /worst sample/);
});

test("the fast lane runs the rows whose probe ids the changed paths touch", () => {
  const budgets = loadBudgets();
  const { probes } = loadProbes();
  assert.deepEqual(rowsForLane("fast", ["docs/lanes/L11.md"], budgets, probes), []);
  assert.deepEqual(rowsForLane("fast", ["ui/src/shell/other.tsx"], budgets, probes), []);
  assert.equal(rowsForLane("fast", ["perf/budgets.json"], budgets, probes).length, budgets.length);
  assert.equal(rowsForLane("fast", ["perf/harness/headless.ts"], budgets, probes).length, budgets.length);
  assert.equal(rowsForLane("full", ["docs/lanes/L11.md"], budgets, probes).length, budgets.length);
  assert.deepEqual(
    rowsForLane("fast", ["apps/app/src/home/checklist.tsx"], budgets, probes).map((b) => b.id).sort(),
    ["layout_shift", "startup"],
  );
  for (const budget of budgets) {
    const probe = probes.find((row) => row.id === budget.probe);
    if (!probe?.screen) throw new Error(`${budget.id} probe ${budget.probe} has no screen`);
    const changed = `ui/src/${probe.screen.replaceAll(".", "/")}.tsx`;
    const ids = rowsForLane("fast", [changed], budgets, probes).map((row) => row.id);
    assert.ok(ids.includes(budget.id), `${budget.id} via ${changed}`);
  }
});

test("the headless client keeps one sqlite connection across 20 screens and stores spans", () => {
  const clock = createClock(10);
  assert.equal(clock.advance(5), 15);
  assert.throws(() => clock.advance(-1), RangeError);
  const client = new HeadlessClient();
  try {
    for (let i = 0; i < 20; i++) client.openScreen("screen.console.speed");
    assert.equal(client.screenCount, 20);
    assert.equal(client.connectionCount, 1);
    assert.throws(() => client.db.prepare("INSERT INTO connection (id, device_id) VALUES (1, ?)").run("dev_other"));
    const parent = client.mark({ name: "app.start", budgetId: "startup", traceId: "tr_1", durMs: 5 });
    const child = client.mark({ name: "replica.open", budgetId: "startup", traceId: "tr_1", durMs: 2, parentId: parent.id });
    const rows = client.spans();
    assert.equal(rows[0]?.startMs, 0);
    assert.equal(rows[0]?.endMs, 5);
    assert.equal(rows[1]?.parentId, parent.id);
    assert.equal(child.parentId, parent.id);
    assert.throws(() => client.mark({ name: "x", budgetId: "startup", traceId: "tr_1", durMs: -1 }), RangeError);
  } finally {
    client.close();
  }
});

test("rollup marks a budget over when its p95 exceeds the row", () => {
  const budgets = loadBudgets();
  const client = new HeadlessClient();
  try {
    for (const budget of budgets) {
      const dur = durationFor(budget);
      for (let i = 0; i < 5; i++) client.mark({ name: budget.metric, budgetId: budget.id, traceId: `tr_${budget.id}_${i}`, durMs: dur });
    }
    for (const row of rollup(client.spans(), budgets)) assert.equal(row.over, false, row.budgetId);
    client.mark({ name: "app.usable", budgetId: "startup", traceId: "tr_over", durMs: 5000 });
    const again = rollup(client.spans(), budgets);
    const startup = again.find((row) => row.budgetId === "startup");
    if (!startup) throw new Error("missing startup rollup");
    assert.equal(startup.over, true);
    assert.equal(startup.worstTraceId, "tr_over");
    assert.ok(startup.p95 > startup.budgetP95);
    for (const row of again) if (row.budgetId !== "startup") assert.equal(row.over, false, row.budgetId);
  } finally {
    client.close();
  }
});

test("console_speed rollup of five samples stays inside the budgets.json row", () => {
  const budgets = loadBudgets();
  const row = must(budgets, "console_speed");
  assert.equal(row.p50, 50);
  assert.equal(row.p95, 100);
  assert.equal(row.unit, "ms");
  const client = new HeadlessClient();
  try {
    for (const budget of budgets) {
      const dur = durationFor(budget);
      for (let i = 0; i < SAMPLE_COUNT; i++) client.mark({ name: budget.metric, budgetId: budget.id, traceId: `tr_${budget.id}_${i}`, durMs: dur });
    }
    rollup(client.spans(), budgets);
    const values: number[] = [];
    for (let i = 0; i < SAMPLE_COUNT; i++) {
      const t0 = performance.now();
      rollup(client.spans(), budgets);
      values.push(performance.now() - t0);
    }
    const report = judge(row, values.map((value, i) => ({ value, traceId: `tr_console_${i}`, spans: client.spans() })));
    assert.equal(values.length, 5);
    assert.equal(report.p50, median(values));
    assert.equal(report.ok, true, failureText(report));
    assert.ok(report.p50 <= row.p50, `console_speed p50 ${report.p50} is over ${row.p50}`);
    assert.ok(report.p95 <= row.p95, `console_speed p95 ${report.p95} is over ${row.p95}`);
    const line = metricLine(report);
    console.log(JSON.stringify({ id: report.id, metric: report.metric, machine: report.machine, unit: report.unit, p50: report.p50, p95: report.p95, budgetP50: report.budgetP50, budgetP95: report.budgetP95, ok: report.ok }));
    console.log(line);
    const metric = JSON.parse(line.slice("METRIC ".length)) as { name: string; p50: number; p95: number; budget_p50: number; budget_p95: number; pass: boolean };
    assert.equal(metric.name, "console_speed");
    assert.equal(metric.pass, true);
    assert.equal(metric.budget_p50, row.p50);
    assert.equal(metric.budget_p95, row.p95);
    assert.ok(metric.p50 <= metric.budget_p50);
    assert.ok(metric.p95 <= metric.budget_p95);
  } finally {
    client.close();
  }
});
