// Runs module (lane L6). The host loads these handlers once the manifest status is live (ARCH 12.4).
// The engine is exported for the modules that execute work as Runs (automations, journeys, steps-core, gate): they call `drive` with their plan and executor.
import { handlers } from "./handlers/index.ts";

export { handlers };
export { backoffMs, drive, finishRun, interrupted, markWaiting, parseDuration, recoverRuns, resumeRun, sweepWaits, wake, NO_RETRY } from "./handlers/engine.ts";
export type { DriveOptions, DriveResult, Executor, PlanStep, RetryPolicy, StepCall, StepResult } from "./handlers/engine.ts";
export { planUndo, ruleFor, RULES } from "./handlers/undo.ts";
export * from "./handlers/alerts.ts";

// The executor (P-L6_24): a Run that was started is driven, and driven again when a wait ends.
import { driveFromEvent, recoverInterrupted, setRunsHost, SWEEP_EVERY_MS, sweep } from "./handlers/executor.ts";
import type { SeamSetters } from "../../host/src/seams/index.ts";
export { setRunsHost };
export type { RunsHost, ResolvedRun } from "./handlers/executor.ts";
export const consumers = {
  "runs.drive": { on: ["automation.run_started", "run.resumed"], run: (ctx: Parameters<typeof driveFromEvent>[0], event: Parameters<typeof driveFromEvent>[1]) => driveFromEvent(ctx, event) },
};
export const periodic = {
  "runs.sweep_waits": { everyMs: SWEEP_EVERY_MS, run: (ctx: Parameters<typeof sweep>[0]) => sweep(ctx) },
};
export const hostCalls = {
  "runs.recover": (ctx: Parameters<typeof recoverInterrupted>[0]) => recoverInterrupted(ctx),
};
/** Where the host registers its half at boot (ruling 31). */
export const hostSeams: SeamSetters = { setRunsHost };
