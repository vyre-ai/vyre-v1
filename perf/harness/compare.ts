// Compare a run's JSON with one budgets.json row. A miss prints the worst sample's span waterfall.

import type { Budget, RunReport, Sample } from "./types.ts";
import { SAMPLE_COUNT, summarize } from "./stats.ts";
import type { Summary } from "./stats.ts";
import { formatWaterfall } from "./waterfall.ts";

/** max: p50 and p95 must be at or under the row. min: both at or over the floor. exact: every sample equals p95. */
export function within(budget: Budget, stats: Summary): boolean {
  if (budget.sense === "exact") return stats.min === budget.p95 && stats.max === budget.p95;
  if (budget.sense === "min") return stats.p50 >= budget.p50 && stats.p95 >= budget.p95;
  return stats.p50 <= budget.p50 && stats.p95 <= budget.p95;
}

function worstSample(budget: Budget, samples: readonly Sample[]): Sample {
  const first = samples[0];
  if (!first) throw new Error("no samples");
  let worst = first;
  for (const sample of samples) {
    if (budget.sense === "min") {
      if (sample.value < worst.value) worst = sample;
    } else if (sample.value > worst.value) worst = sample;
  }
  return worst;
}

/** Output JSON for one budget. `ok` is false when p95 is over the row by any amount (max sense). */
export function judge(budget: Budget, samples: readonly Sample[]): RunReport {
  if (samples.length === 0) throw new Error(`no samples for ${budget.id}`);
  const values = samples.map((sample) => sample.value);
  const stats = summarize(values);
  const ok = within(budget, stats);
  const worst = worstSample(budget, samples);
  const report: RunReport = {
    id: budget.id,
    metric: budget.metric,
    machine: budget.machine,
    unit: budget.unit,
    samples: values,
    p50: stats.p50,
    p95: stats.p95,
    budgetP50: budget.p50,
    budgetP95: budget.p95,
    ok,
    worstTraceId: worst.traceId,
  };
  if (!ok) report.waterfall = formatWaterfall(worst.spans, worst.traceId, worst.value, budget.unit);
  return report;
}

/** Takes `n` samples (5 unless a caller asks otherwise) and compares them to the row. */
export function runBudget(budget: Budget, sample: () => Sample, n = SAMPLE_COUNT): RunReport {
  if (!Number.isInteger(n) || n < 1) throw new RangeError("run count must be a positive integer");
  const samples: Sample[] = [];
  for (let i = 0; i < n; i++) samples.push(sample());
  return judge(budget, samples);
}

export function failureText(report: RunReport): string {
  const head = `${report.ok ? "ok" : "FAIL"} ${report.id} p50 ${report.p50} p95 ${report.p95} budget p50 ${report.budgetP50} p95 ${report.budgetP95}`;
  if (report.ok || report.waterfall === undefined) return head;
  return `${head}\n${report.waterfall}`;
}

export function emitReport(report: RunReport, write: (line: string) => void = console.log): void {
  write(failureText(report));
}

/** One METRIC line for the perf proof. The name is the budget id. */
export function metricLine(report: RunReport): string {
  return "METRIC " + JSON.stringify({
    name: report.id,
    p50: report.p50,
    p95: report.p95,
    budget_p50: report.budgetP50,
    budget_p95: report.budgetP95,
    unit: report.unit,
    machine: report.machine,
    pass: report.ok,
  });
}
