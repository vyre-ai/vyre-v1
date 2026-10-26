// Steps-core module (lane L6). The host loads these handlers once the manifest status is live (ARCH 12.4).
// `runStep` is what the Run executor calls for each step of an Automation, Journey or Campaign; `evalExpr` and `render` are the expression language the editor checks against.
import { handlers } from "./handlers/index.ts";
import { runStep } from "./handlers/control.ts";
import type { StepCall, StepNode } from "./handlers/control.ts";
import type { Ctx } from "../../packages/contracts/src/ctx.ts";

export { handlers };
export { runStep, scopeOf } from "./handlers/control.ts";
export type { StepCall, StepEnv, StepNode, StepResult, WaitSpec } from "./handlers/control.ts";
export { SHEET_STEPS, labelOf } from "./handlers/sheets.ts";
export { durationMs, evalExpr, momentMs, render, renderText, truthy } from "./projections.ts";

/**
 * The executor's way to run one step (P-L6_24): the host calls this as the Run's own principal, so the capability a step stands for is authorized as the person or service the Run acts as.
 * The Run, the step and what the engine hands it arrive as JSON; the answer is what `runStep` answers (an output, where to go next, or a wait).
 */
export const hostCalls = {
  "steps-core.run_step": (ctx: Ctx, i: { node: StepNode; call: StepCall; run: { id: string; label?: string; automation?: string } }) =>
    runStep({ ctx, run: i.run }, i.node, i.call),
};
