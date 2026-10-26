// Remove log rows past a cutoff (governance retention; P-CC_39). It is the logs module's own daily retention (runRetention) run to a cutoff the caller names: rows older than `before` are folded into the
// per-day summaries and deleted, with their spans and events; summaries older than the aggregate window go too. A hold on the logs (logs_hold) stops it and is counted.
// DECISION: the cutoff is exact, so `before` is mapped to the retention clock (now = before + the full-detail window) and the same fold runs; there is one folding code path, not two.
import { DAY_MS, readSettings, runRetention } from "./sink.ts";
import type { LogCtx } from "./index.ts";

export async function purge(ctx: LogCtx, input: { before: number; limit?: number; idempotencyKey: string }) {
  const s = readSettings(ctx.db, ctx.space);
  const r = runRetention(ctx.db, ctx.space, input.before + s.fullDays * DAY_MS);
  ctx.emit("logs.purged", `entity/${r.deleted}`, { removed: r.deleted });
  return { removed: r.deleted, more: false, ...(r.held ? { skippedOnHold: 1 } : {}) };
}
