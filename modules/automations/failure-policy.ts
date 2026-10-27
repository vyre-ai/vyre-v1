// Per-step failure policy. The existing engine understands fail, continue, retry, and route.
// Skip and substitute are explicit so a person can tell "record the error and go on" from "do not run this effect".

export type FailurePolicy =
  | { action: "retry"; max: number }
  | { action: "skip" }
  | { action: "substitute"; output: unknown }
  | { action: "stop" }
  | { action: "route"; to: string; codes?: readonly string[] };

export interface EngineOnError {
  mode: "fail" | "continue" | "retry" | "route";
  max?: number;
  route?: string;
}

export function normalizePolicy(policy: FailurePolicy): { engine: EngineOnError; skip: boolean; substitute?: unknown; codes?: readonly string[] } {
  switch (policy.action) {
    case "retry": {
      const max = Math.max(1, Math.min(10, Math.floor(policy.max)));
      return { engine: { mode: "retry", max }, skip: false };
    }
    case "skip":
      return { engine: { mode: "continue" }, skip: true };
    case "substitute":
      return { engine: { mode: "continue" }, skip: true, substitute: policy.output };
    case "stop":
      return { engine: { mode: "fail" }, skip: false };
    case "route":
      return { engine: { mode: "route", route: policy.to }, skip: false, ...(policy.codes ? { codes: policy.codes } : {}) };
  }
}

/** A live rerun is not a sandbox replay. Outward and destructive steps can happen again. */
export function liveRerunWarning(effects: readonly string[]): string | null {
  const outward = effects.filter((e) => e === "outward" || e === "destructive");
  if (outward.length === 0) return null;
  return `A live rerun can repeat ${outward.length === 1 ? "an outward step" : `${outward.length} outward steps`}. Replay in the sandbox does not.`;
}
