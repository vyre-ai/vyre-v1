// The executor loop (P-L6_24): what makes a started Run actually run. runs.start only records a Run; the consumer below drives it, and drives it again when a wait ends.
//   consumer  runs.drive   on automation.run_started (a fired, tested, retried or replayed Automation) and run.resumed (a wait ended): asks the host for the Run's plan and executor and calls
//                          `drive` in this module's own ctx. A Run the host does not know how to execute (a Journey, a Gate Run) resolves to nothing and is left alone.
//   periodic  runs.sweep_waits   the clock consumer: ends a wait whose time came or that timed out, which emits run.resumed and so drives the Run on.
//   host call runs.recover  the Runs that were queued or running when the server stopped, driven again from their step log; the host calls it once after boot.
// The plan and the executor are the host's to build (it can see the Automation and steps-core, this module can see neither): setRunsHost gives it the way in (ruling 31), and the
// consumer only reads what it hands back. A step is keyed run:step:attempt, so a step that was running when the server stopped runs again with the same key and its capability dedupes.
// A consumer awaits its drive, so a very long step delays the events behind it; steps park (a wait, an approval) instead of holding, so a Run rarely holds a drive for long.
import { drive, recoverRuns, sweepWaits } from "./engine.ts";
import type { DriveOptions, Executor, PlanStep } from "./engine.ts";
import { findRun } from "../projections.ts";
import type { Run, RunsCtx } from "../projections.ts";

export interface ResolvedRun { plan: readonly PlanStep[]; exec: Executor; opts?: DriveOptions }
export interface RunsHost {
  /** What to execute for this Run, or nothing when it is not a Run this server executes. */
  resolve(run: Run): Promise<ResolvedRun | undefined> | ResolvedRun | undefined;
}

let host: RunsHost | null = null;
/** The host registers its half once at boot (ruling 31). Null takes it back. */
export function setRunsHost(h: RunsHost | null): void { host = h; driving.clear(); }

/** Runs being driven by this process right now: a second event for the same Run while one is in flight is the same work. */
const driving = new Set<string>();

async function driveOne(ctx: RunsCtx, run: Run): Promise<void> {
  if (!host || driving.has(run.id)) return;
  driving.add(run.id);
  try {
    const r = await host.resolve(run);
    if (r) await drive(ctx, run.id, r.plan, r.exec, r.opts);
  } finally { driving.delete(run.id); }
}

type Row = Record<string, unknown>;

/** The consumer: drive the Run the event names. */
export async function driveFromEvent(ctx: RunsCtx, event: { payload: Row }): Promise<void> {
  const runId = typeof event.payload["runId"] === "string" ? event.payload["runId"] : "";
  const run = runId ? findRun(ctx.db, runId) : undefined;
  if (run) await driveOne(ctx, run);
}

/** The host call: every Run the last server left queued or running is driven again. */
export async function recoverInterrupted(ctx: RunsCtx): Promise<Record<string, string>> {
  const h = host;
  if (!h) return {};
  const out = await recoverRuns(ctx, (run) => h.resolve(run));
  return Object.fromEntries(Object.entries(out).map(([id, r]) => [id, r.status]));
}

/** Every 5 seconds the clock consumer ends the waits whose time came. */
export const SWEEP_EVERY_MS = 5_000;
export const sweep = (ctx: RunsCtx): Promise<string[]> => sweepWaits(ctx);
