// Per-step failure policy, shared by the automations module and the host seam.
// The host cannot import modules, so this is the one implementation both call.
// Keep StepOnError in step with OnError in modules/automations/projections.ts.

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

export interface StepOnError {
  mode: "fail" | "continue" | "retry" | "route" | "skip" | "substitute";
  max?: number;
  route?: string;
  codes?: readonly string[];
  output?: unknown;
}

export type FailureDecision = { output: unknown; next?: string } | "retry" | "throw";

/** Retry count the engine will accept: at least 1, at most 10. */
export function clampRetry(max: number): number {
  return Math.max(1, Math.min(10, Math.floor(max)));
}

export function normalizePolicy(policy: FailurePolicy): { engine: EngineOnError; skip: boolean; substitute?: unknown; codes?: readonly string[] } {
  switch (policy.action) {
    case "retry":
      return { engine: { mode: "retry", max: clampRetry(policy.max) }, skip: false };
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

function messageOf(error: unknown): string {
  const boxed = error as { error?: { message?: string }; message?: string } | null;
  return boxed?.error?.message ?? boxed?.message ?? "The step failed.";
}

function codeOf(error: unknown): string | undefined {
  const code = (error as { error?: { code?: unknown } } | null)?.error?.code;
  return typeof code === "string" ? code : undefined;
}

/**
 * What the host should do with a failed step. "retry" and "throw" mean rethrow so the engine can retry or fail the run.
 * Skip and substitute are results, not another attempt. Continue records the error and goes on, which is not a skip.
 */
export function failureResult(onError: StepOnError | undefined, error: unknown): FailureDecision {
  if (onError === undefined) return "throw";
  const message = messageOf(error);
  switch (onError.mode) {
    case "fail":
      return "throw";
    case "retry":
      return "retry";
    case "continue":
      return { output: { error: message } };
    case "skip": {
      const normalized = normalizePolicy({ action: "skip" });
      if (!normalized.skip) return "throw";
      return { output: { skipped: true, error: message } };
    }
    case "substitute": {
      if (onError.output === undefined) return { output: { substituted: true } };
      const normalized = normalizePolicy({ action: "substitute", output: onError.output });
      return { output: normalized.substitute === undefined ? { substituted: true } : normalized.substitute };
    }
    case "route": {
      const route = onError.route;
      if (typeof route !== "string" || route.length === 0) return "throw";
      const listed = Array.isArray(onError.codes) && onError.codes.length > 0 ? onError.codes : undefined;
      const normalized = normalizePolicy(listed ? { action: "route", to: route, codes: listed } : { action: "route", to: route });
      const next = normalized.engine.route;
      if (!next) return "throw";
      if (normalized.codes && normalized.codes.length > 0) {
        const code = codeOf(error);
        if (code === undefined || !normalized.codes.includes(code)) return "throw";
      }
      return { output: { error: message }, next };
    }
    default:
      return "throw";
  }
}
