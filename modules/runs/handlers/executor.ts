// The executor loop (P-L6_24): what makes a started Run actually run. runs.start only records a Run; the consumer below drives it, and drives it again when a wait ends.
//   consumer  runs.drive   on automation.run_started (a fired, tested, retried or replayed Automation) and run.resumed (a wait ended): asks the host for the Run's plan and executor and calls
//                          `drive` in this module's own ctx. A Run the host does not know how to execute (a Journey, a Gate Run) resolves to nothing and is left alone.
//   periodic  runs.sweep_waits   the clock consumer: ends a wait whose time came or that timed out, which emits run.resumed and so drives the Run on.
//   host calls  runs.drive_run (the host's queue drives one Run in a call of its own) and runs.interrupted (the Runs the last server left queued or running, driven again from their step log, once after boot).
// The plan and the executor are the host's to build (it can see the Automation and steps-core, this module can see neither): setRunsHost gives it the way in (ruling 31), and the
// consumer only reads what it hands back. A step is keyed run:step:attempt, so a step that was running when the server stopped runs again with the same key and its capability dedupes.
// The consumer does not drive: it asks the host to, and returns, so an AI step that takes minutes never holds the events behind it. The host queue runs a few drives at once, one per Run.
import { drive, interrupted, sweepWaits } from "./engine.ts";
import type { DriveOptions, Executor, PlanStep } from "./engine.ts";
import { findRun } from "../projections.ts";
import type { Run, RunsCtx } from "../projections.ts";

export interface ResolvedRun { plan: readonly PlanStep[]; exec: Executor; opts?: DriveOptions }
export interface RunsHost {
  /** What to execute for this Run, or nothing when it is not a Run this server executes. */
  resolve(run: Run): Promise<ResolvedRun | undefined> | ResolvedRun | undefined;
  /** Ask for this Run to be driven and return at once: the host queues it (a few at a time, one drive per Run) so a long step never holds an event consumer or the Runs behind it. */
  enqueue(runId: string): void;
}

let host: RunsHost | null = null;
/** The host registers its half once at boot (ruling 31). Null takes it back. */
export function setRunsHost(h: RunsHost | null): void { host = h; }

type Row = Record<string, unknown>;

/** The consumer: a Run was started or its wait ended, so the host is asked to drive it, and the consumer is done. */
export function driveFromEvent(ctx: RunsCtx, event: { payload: Row }): void {
  const runId = typeof event.payload["runId"] === "string" ? event.payload["runId"] : "";
  if (host && runId && findRun(ctx.db, runId)) host.enqueue(runId);
}

/** The host call the host's queue makes: drive one Run in a call of its own (its own ctx, its own commit), from its step log. */
export async function driveRun(ctx: RunsCtx, input: { runId: string }): Promise<string> {
  const run = findRun(ctx.db, input.runId);
  if (!host || !run) return "gone";
  const r = await host.resolve(run);
  if (!r) return "not_ours";
  return (await drive(ctx, run.id, r.plan, r.exec, r.opts)).status;
}

/** The Runs the last server left queued or running. */
export const interruptedIds = (ctx: RunsCtx): string[] => interrupted(ctx.db);

/** Every 5 seconds the clock consumer ends the waits whose time came. */
export const SWEEP_EVERY_MS = 5_000;
export const sweep = (ctx: RunsCtx): Promise<string[]> => sweepWaits(ctx);
