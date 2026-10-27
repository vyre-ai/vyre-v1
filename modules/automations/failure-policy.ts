// Per-step failure policy. failureResult lives in lib/step-failure.ts so the host seam can call the same function.
// The host cannot import this module. Skip and substitute are explicit so a person can tell "record the error and go on" from "do not run this effect".

export type { EngineOnError, FailureDecision, FailurePolicy, StepOnError } from "../../lib/step-failure.ts";
export { failureResult, normalizePolicy } from "../../lib/step-failure.ts";

/** A live rerun is not a sandbox replay. Outward and destructive steps can happen again. */
export function liveRerunWarning(effects: readonly string[]): string | null {
  const outward = effects.filter((e) => e === "outward" || e === "destructive");
  if (outward.length === 0) return null;
  return `A live rerun can repeat ${outward.length === 1 ? "an outward step" : `${outward.length} outward steps`}. Replay in the sandbox does not.`;
}
