// console.speed: spans rolled up per budget id, p50 and p95 against perf/budgets.json, with the worst trace to open (ARCH 9).
import { speedRows } from "../projections.ts";
import type { ViewCtx } from "../projections.ts";

export async function speed(ctx: ViewCtx, input: { windowMinutes?: number }) {
  return { rows: await speedRows(ctx, input.windowMinutes) };
}
