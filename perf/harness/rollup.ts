// console.speed rollup: spans grouped by budget id, p50 and p95 against perf/budgets.json.

import type { Budget, Span, SpeedRow } from "./types.ts";
import { within } from "./compare.ts";
import { summarize } from "./stats.ts";

function duration(span: Span): number {
  return span.endMs - span.startMs;
}

function worstSpan(budget: Budget, group: readonly Span[]): Span | undefined {
  const first = group[0];
  if (!first) return undefined;
  let worst = first;
  for (const span of group) {
    const better = budget.sense === "min" ? duration(span) < duration(worst) : duration(span) > duration(worst);
    if (better) worst = span;
  }
  return worst;
}

/** One speed-page row per budget. A budget with no spans is not over a max ceiling. */
export function rollup(spans: readonly Span[], budgets: readonly Budget[]): SpeedRow[] {
  const byId = new Map<string, Span[]>();
  for (const span of spans) {
    const list = byId.get(span.budgetId) ?? [];
    list.push(span);
    byId.set(span.budgetId, list);
  }
  return budgets.map((budget) => {
    const group = byId.get(budget.id) ?? [];
    if (group.length === 0) {
      const over = budget.sense === "min" || budget.sense === "exact";
      return { budgetId: budget.id, p50: 0, p95: 0, budgetP95: budget.p95, over };
    }
    const stats = summarize(group.map(duration));
    const over = !within(budget, stats);
    const worst = worstSpan(budget, group);
    const row: SpeedRow = { budgetId: budget.id, p50: stats.p50, p95: stats.p95, budgetP95: budget.p95, over };
    if (worst) row.worstTraceId = worst.traceId;
    return row;
  });
}
