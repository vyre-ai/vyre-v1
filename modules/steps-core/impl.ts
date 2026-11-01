// Steps-core module (lane L6). The host loads these handlers once the manifest status is live (ARCH 12.4).
// `runStep` is what the Run executor calls for each step of an Automation, Journey or Campaign; `evalExpr` and `render` are the expression language the editor checks against.
import { handlers } from "./handlers/index.ts";
import { runStep } from "./handlers/control.ts";
import { aiStep } from "./handlers/ai-step.ts";
import { runInSandbox, setCodeHost } from "./code-sandbox.ts";
import type { StepCall, StepNode } from "./handlers/control.ts";
import type { Ctx } from "../../packages/contracts/src/ctx.ts";
import { ERROR_CODE_SET, VyreErr } from "../../packages/contracts/src/errors.ts";
import type { ErrorCode } from "../../packages/contracts/src/types.ts";

export { handlers };
export { runStep, scopeOf } from "./handlers/control.ts";
export type { StepCall, StepEnv, StepNode, StepResult, WaitSpec } from "./handlers/control.ts";
export { SHEET_STEPS, labelOf } from "./handlers/sheets.ts";
export { codeAvailability, setCodeHost } from "./code-sandbox.ts";
export type { CodeHost } from "./code-sandbox.ts";

/** The host hands the sandbox its folder at boot (null at shutdown). */
export const hostSeams = { setCodeHost };
export { durationMs, evalExpr, momentMs, render, renderText, truthy } from "./projections.ts";

/**
 * The executor's way to run one step (P-L6_24): the host calls this as the Run's own principal, so the capability a step stands for is authorized as the person or service the Run acts as.
 * The Run, the step and what the engine hands it arrive as JSON; the answer is what `runStep` answers (an output, where to go next, or a wait).
 */
/**
 * A step names its own failures (stepError: a catalogue code and words for a person). The host masks anything a handler throws that is not a shaped error, so a step's words would reach the
 * Run as "something went wrong". A failure that carries a catalogue code is made a shaped error here, and the step's error rule (retry, route, substitute) sees the code it was written for.
 */
export function surface(e: unknown, traceId: string): unknown {
  const shaped = (e as { error?: { code?: unknown; message?: unknown; retryable?: unknown; next?: unknown } } | null)?.error;
  if (e instanceof VyreErr || Array.isArray(shaped?.next) || !shaped || typeof shaped.code !== "string" || !ERROR_CODE_SET.has(shaped.code) || typeof shaped.message !== "string" || shaped.message === "") return e;
  return new VyreErr({ code: shaped.code as ErrorCode, message: shaped.message.slice(0, 400), retryable: shaped.retryable === true, traceId, next: [{ kind: shaped.retryable === true ? "retry" : "report", label: shaped.retryable === true ? "Try again" : "Report a problem" }] });
}

export const hostCalls = {
  "steps-core.run_step": async (ctx: Ctx, i: { node: StepNode; call: StepCall; run: { id: string; label?: string; automation?: string; defHash?: string; depth?: number } }) => {
    try {
      return await runStep({
        ctx,
        run: i.run,
        ai: (node, input, call) => aiStep({ ctx, run: i.run }, node, input, call),
        code: async (_node, input) => ({ output: await runInSandbox(input.source, input.input, input.hosts) }),
      }, i.node, i.call);
    } catch (e) {
      throw surface(e, ctx.trace.traceId);
    }
  },
};
