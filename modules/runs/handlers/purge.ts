// Erase one Run, or remove Runs and their step logs past retention (governance; P-CC_39). A Run's words live in its step log (input_json, output_json), its summary and its wait label, so a Run goes whole:
// the row, the steps, the wait, the extra facts, the alert state, the trigger, the idempotency keys.
// DECISION: retention removes only Runs that have ended (succeeded, failed or stopped) and ended before the cutoff, oldest first, one batch per call; a Run still queued, running or waiting is never purged.
// DECISION: the Run module does not know about holds (they are governance's); governance checks the Run's subject and thread before it calls runs.erase, and the age purge reports no skipped count.
import type { RunsCtx } from "../projections.ts";

const TABLES = ["runs_steps", "runs_waits", "runs_extra", "runs_alerts", "runs_trigger"] as const;
const DEFAULT_LIMIT = 500;

function removeRun(ctx: RunsCtx, id: string): void {
  for (const t of TABLES) {
    try { ctx.db.run(`DELETE FROM ${t} WHERE "run_id" = ?`, id); } catch (e) { if (!/no such table/i.test(e instanceof Error ? e.message : String(e))) throw e; }   // a table a later migration adds may not be there yet
  }
  ctx.db.run(`DELETE FROM runs_idem WHERE "run_id" = ?`, id);
  ctx.db.run(`DELETE FROM runs_items__fm WHERE "id" = ?`, id);
  ctx.db.run(`DELETE FROM runs_items WHERE "id" = ?`, id);
}

export async function erase(ctx: RunsCtx, input: { runId: string; idempotencyKey: string }) {
  const row = ctx.db.all(`SELECT "id" FROM runs_items WHERE "id" = ?`, input.runId)[0];
  if (!row) return { erased: false };
  removeRun(ctx, input.runId);
  ctx.emit("run.erased", `entity/${input.runId}`, { runId: input.runId });
  return { erased: true };
}

export async function purge(ctx: RunsCtx, input: { before: number; limit?: number; idempotencyKey: string }) {
  const limit = input.limit ?? DEFAULT_LIMIT;
  const ids = (ctx.db.all(
    `SELECT "id" FROM runs_items WHERE "ended_at" IS NOT NULL AND "ended_at" < ? AND "status" IN ('succeeded', 'failed', 'stopped') ORDER BY "ended_at" ASC LIMIT ?`, input.before, limit + 1,
  ) as { id: string }[]).map((r) => String(r.id));
  const batch = ids.slice(0, limit);
  for (const id of batch) removeRun(ctx, id);
  ctx.emit("runs.purged", `entity/${batch.length}`, { removed: batch.length });
  return { removed: batch.length, more: ids.length > limit };
}
