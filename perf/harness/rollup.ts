// Roll spans up per budget id the way console.speed does, and time that rollup.

import { median, percentile } from "./stats.ts";
import type { Budget, SampleResult, Span, SpeedRow } from "./types.ts";

/** p50 and p95 of span durations per budget row. over is true when p95 exceeds that row. */
export function rollup(spans: Span[], budgets: Budget[]): SpeedRow[] {
  const groups = new Map<string, Span[]>();
  for (const s of spans) {
    const list = groups.get(s.budgetId);
    if (list) list.push(s);
    else groups.set(s.budgetId, [s]);
  }
  return budgets.map((b) => {
    const mine = groups.get(b.id) ?? [];
    if (mine.length === 0) return { budgetId: b.id, p50: 0, p95: 0, budgetP95: b.p95, worstTraceId: null, over: false };
    const values = mine.map((s) => s.durMs);
    let worst = mine[0]!;
    for (const s of mine) if (s.durMs > worst.durMs) worst = s;
    const p95 = percentile(values, 95);
    return { budgetId: b.id, p50: median(values), p95, budgetP95: b.p95, worstTraceId: worst.traceId, over: p95 > b.p95 };
  });
}

/** One span set per budget id, durations sitting on that row's p95 (the first row wins when ids repeat). */
export function fixtureSpans(budgets: Budget[]): Span[] {
  const seen = new Set<string>();
  const out: Span[] = [];
  let n = 0;
  for (const b of budgets) {
    if (seen.has(b.id)) continue;
    seen.add(b.id);
    for (let i = 0; i < 32; i++) {
      n += 1;
      out.push({ id: `fx${n}`, name: b.metric, budgetId: b.id, startMs: i, durMs: b.p95, traceId: `tr_${b.id}` });
    }
  }
  return out;
}

/**
 * Wall time of one console.speed rollup. The sample value is that duration in ms.
 * The spans are the two phases, so a failure can print a waterfall.
 */
export function measureConsoleSpeed(budgets: Budget[]): SampleResult {
  const traceId = "tr_console_speed";
  const t0 = performance.now();
  const built = fixtureSpans(budgets);
  const t1 = performance.now();
  rollup(built, budgets);
  const t2 = performance.now();
  const spans: Span[] = [
    { id: "s1", name: "spans.build", budgetId: "console_speed", startMs: 0, durMs: t1 - t0, traceId },
    { id: "s2", name: "spans.rollup", budgetId: "console_speed", startMs: t1 - t0, durMs: t2 - t1, traceId, parentId: "s1" },
  ];
  return { value: t2 - t0, spans, traceId };
}
