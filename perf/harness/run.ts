// Compare a median of 5 with budgets.json. On failure, print the worst sample's span waterfall.
//   node perf/harness/run.ts            fast lane, console_speed (and other builtins the change hits)
//   node perf/harness/run.ts --full     every row that has a builtin measure

import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadBudgets } from "./budgets.ts";
import { createFakeUiClock } from "./clock.ts";
import { createHeadlessClient } from "./headless.ts";
import { budgetProbeCatalog, isFullLane, readScreenProbes, mergeProbes, selectRows } from "./probes.ts";
import { measureConsoleSpeed } from "./rollup.ts";
import { SAMPLE_COUNT, median, percentile } from "./stats.ts";
import type { Budget, CompareResult, Lane, SampleResult } from "./types.ts";
import { formatWaterfall } from "./waterfall.ts";

export function takeSamples(measure: () => SampleResult, n = SAMPLE_COUNT): SampleResult[] {
  if (!Number.isInteger(n) || n < 1) throw new Error("sample count must be a positive integer");
  const out: SampleResult[] = [];
  for (let i = 0; i < n; i++) out.push(measure());
  return out;
}

/** Fail when p95 exceeds the row. Equal to the budget is inside it. */
export function compareRun(budget: Budget, samples: SampleResult[]): CompareResult {
  if (samples.length !== SAMPLE_COUNT) throw new Error(`${budget.id} needs ${SAMPLE_COUNT} samples, got ${samples.length}`);
  const values = samples.map((s) => {
    if (!Number.isFinite(s.value)) throw new Error(`${budget.id} sample is not finite`);
    return s.value;
  });
  let worst = samples[0]!;
  for (const s of samples) if (s.value > worst.value) worst = s;
  const p95 = percentile(values, 95);
  return {
    id: budget.id,
    metric: budget.metric,
    machine: budget.machine,
    p50: median(values),
    p95,
    budgetP50: budget.p50,
    budgetP95: budget.p95,
    ok: p95 <= budget.p95,
    samples: values,
    waterfall: formatWaterfall(worst.spans, worst.traceId),
  };
}

export function failureText(result: CompareResult): string {
  if (result.ok) return "";
  return `FAIL ${result.id} p95 ${result.p95} exceeds budget ${result.budgetP95} (${result.metric}, ${result.machine})\n${result.waterfall}`;
}

export interface LaneReport {
  lane: Lane;
  rows: CompareResult[];
  skipped: string[];
}

export function reportJson(report: LaneReport): string {
  const rows = report.rows.map((r) => ({
    id: r.id,
    metric: r.metric,
    machine: r.machine,
    p50: r.p50,
    p95: r.p95,
    budgetP50: r.budgetP50,
    budgetP95: r.budgetP95,
    ok: r.ok,
    samples: r.samples,
  }));
  return JSON.stringify({ lane: report.lane, rows, skipped: report.skipped }, null, 2);
}

export function printFailures(rows: CompareResult[], write: (line: string) => void = console.error): void {
  for (const row of rows) {
    const text = failureText(row);
    if (text) write(text);
  }
}

/** Measures this packet can run without a browser. Later packets register the rest. */
export function builtinMeasure(budgets: Budget[]): (budget: Budget) => SampleResult | null {
  return (budget) => {
    if (budget.id === "console_speed" && budget.machine === "mid laptop") return measureConsoleSpeed(budgets);
    if (budget.id === "connection_count") return measureSockets();
    if (budget.id === "edit" && budget.machine === "mid laptop") return measureEdit();
    return null;
  };
}

function measureSockets(): SampleResult {
  const client = createHeadlessClient({ clock: createFakeUiClock() });
  try {
    client.openScreens(20);
    const traceId = "tr_conn";
    return {
      value: client.sockets(),
      traceId,
      spans: [{ id: "c1", name: "ws.connections", budgetId: "connection_count", startMs: 0, durMs: client.sockets(), traceId }],
    };
  } finally {
    client.close();
  }
}

function measureEdit(): SampleResult {
  const clock = createFakeUiClock();
  const client = createHeadlessClient({ clock });
  try {
    const open = client.begin("edit.local", "tr_edit", "edit");
    clock.advance(3);
    const span = client.end(open);
    client.edit("c_1", "x");
    return { value: span.durMs, spans: client.spans(), traceId: "tr_edit" };
  } finally {
    client.close();
  }
}

export function runLane(opts: {
  ref: string;
  changed: string[];
  budgets: Budget[];
  probes: ReturnType<typeof budgetProbeCatalog>;
  forward?: Map<string, string[]>;
  measure: (budget: Budget) => SampleResult | null;
}): LaneReport {
  const lane: Lane = isFullLane(opts.ref) ? "full" : "fast";
  const picked = selectRows(opts);
  const rows: CompareResult[] = [];
  const skipped: string[] = [];
  for (const budget of picked) {
    const first = opts.measure(budget);
    if (!first) {
      skipped.push(budget.id);
      continue;
    }
    const rest = takeSamples(() => {
      const sample = opts.measure(budget);
      if (!sample) throw new Error(`measure ${budget.id} returned no sample`);
      return sample;
    }, SAMPLE_COUNT - 1);
    rows.push(compareRun(budget, [first, ...rest]));
  }
  return { lane, rows, skipped };
}

const self = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === self) {
  const root = path.resolve(path.dirname(self), "../..");
  const budgets = loadBudgets(root);
  const probes = mergeProbes(readScreenProbes(root), budgetProbeCatalog());
  const ref = process.argv.includes("--full") ? "main" : "fast";
  const changedAt = process.argv.indexOf("--changed");
  const changed = changedAt >= 0 ? process.argv.slice(changedAt + 1).filter((a) => !a.startsWith("--")) : ["perf/budgets.json"];
  const report = runLane({ ref, changed, budgets, probes, measure: builtinMeasure(budgets) });
  process.stdout.write(`${reportJson(report)}\n`);
  printFailures(report.rows);
  if (report.rows.some((r) => !r.ok)) process.exitCode = 1;
}
