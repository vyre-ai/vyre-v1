// A scheduled job that drives a Run and is parked as dead after its last try (ctx/schedule.ts) left that Run queued for ever, and its owner was never told (lead, 12 Nov). The jobs that drive a Run
// are listed here; when one dies, its Run is ended failed with the reason, as the person who scheduled it, so the owner gets run.failed like any other failed Run.
import type { ScheduledCall } from "../ctx/schedule.ts";

/** The capabilities whose scheduled job carries a Run through (input.runId) and ends it itself on success or failure. */
export const RUN_DRIVERS: ReadonlySet<string> = new Set(["connectors.sync_run"]);

/** The call that ends the Run a dead job was driving, or null when the job drives none. */
export function endOfDeadJob(call: ScheduledCall, error: unknown): ScheduledCall | null {
  if (!RUN_DRIVERS.has(call.cap)) return null;
  const runId = (call.input as { runId?: unknown } | null)?.runId;
  if (typeof runId !== "string" || runId === "") return null;
  const why = (error as { error?: { message?: string } } | null)?.error?.message ?? (error instanceof Error ? error.message : String(error));
  const message = `It stopped after ${call.tries + 1} tries: ${why}`.slice(0, 500);
  return { ...call, cap: "runs.finish", input: { runId, status: "failed", summary: message, error: { code: "provider.unavailable", message } } };
}
