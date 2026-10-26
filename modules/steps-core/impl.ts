// Steps-core module (lane L6). The host loads these handlers once the manifest status is live (ARCH 12.4).
// `runStep` is what the Run executor calls for each step of an Automation, Journey or Campaign; `evalExpr` and `render` are the expression language the editor checks against.
import { handlers } from "./handlers/index.ts";
import { runStep } from "./handlers/control.ts";
import { stepError } from "./projections.ts";
import type { StepCall, StepEnv, StepNode } from "./handlers/control.ts";
import type { Ctx } from "../../packages/contracts/src/ctx.ts";

export { handlers };
export { runStep, scopeOf } from "./handlers/control.ts";
export type { StepCall, StepEnv, StepNode, StepResult, WaitSpec } from "./handlers/control.ts";
export { SHEET_STEPS, labelOf } from "./handlers/sheets.ts";
export { durationMs, evalExpr, momentMs, render, renderText, truthy } from "./projections.ts";

/** The most nodes one lane or loop body may run for one call: a chain that loops back on itself is refused rather than run for ever. */
const CHAIN_CAP = 200;

/**
 * The executor's way to run one step (P-L6_24): the host calls this as the Run's own principal, so the capability a step stands for is authorized as the person or service the Run acts as.
 * The Run, the step and what the engine hands it arrive as JSON; the answer is what `runStep` answers (an output, where to go next, or a wait).
 * Parallel lanes and Loop bodies (P-L6_25) run here, inside the one call: `nodes` carries every node of the definition, a lane is the chain of nodes from the node a branch names (following
 * `next`, or the step's own `next`, until there is none), and a Loop's body is the chain from its "body" branch, run once per item with `item` and `index` in scope. Each node in a lane or body has
 * its own idempotency key, made from the step's, so a call that is made again after a crash repeats nothing. A step that parks the Run (a wait, an approval) cannot run inside a lane or a body
 * in v1: it fails the step by name (run.lane_wait) instead of leaving the Run parked on something the engine cannot resume.
 */
export const hostCalls = {
  "steps-core.run_step": async (ctx: Ctx, i: { node: StepNode; call: StepCall; run: { id: string; label?: string; automation?: string }; nodes?: StepNode[] }) => {
    const byId = new Map((i.nodes ?? []).map((n) => [n.id, n] as const));
    const chain = async (start: string, call: StepCall): Promise<unknown> => {
      const outputs: Record<string, unknown> = { ...call.outputs };
      let at: string | undefined = start, last: unknown, n = 0;
      while (at !== undefined) {
        const node = byId.get(at);
        if (!node) throw stepError("run.unknown_step", `The definition has no step ${at}.`);
        if (++n > CHAIN_CAP) throw stepError("run.chain_too_long", `A lane or loop body went past ${CHAIN_CAP} steps and was stopped.`);
        const inner = { ...call, outputs, key: `${call.key}/${node.id}` };
        const r = await runStep(env(inner, node), node, inner);
        if (r.wait) throw stepError("run.lane_wait", `The step ${node.id} waits, and a step that waits cannot run inside a parallel lane or a loop body yet.`);
        outputs[node.id] = r.output;
        last = r.output;
        at = r.next === null ? undefined : r.next ?? node.next?.[0];
      }
      return last;
    };
    const env = (call: StepCall, at: StepNode): StepEnv => {
      const body = at.key === "loop" ? at.branches?.find((b) => b.label.trim().toLowerCase() === "body")?.to : undefined;
      return {
        ctx, run: i.run,
        lane: async (name) => { await chain(name, { ...call, key: `${call.key}/lane:${name}` }); },
        ...(body !== undefined ? { body: (item: unknown, index: number) => chain(body, { ...call, item, index, key: `${call.key}/item:${index}` }) } : {}),
      };
    };
    try {
      return await runStep(env(i.call, i.node), i.node, i.call);
    } catch (e) {
      // A step's own failure (run.branch_failed, run.lane_wait, a Stop with outcome failed...) answers as data. Thrown out of a host call it would become internal.unexpected: the pipeline keeps the
      // code of a shaped error from the catalogue and nothing else, and these codes belong to the Run engine, which reads them from the step's error.
      const err = (e as { error?: { code?: unknown; message?: unknown } } | null)?.error;
      if (err && typeof err.code === "string") return { stepError: err };
      throw e;
    }
  },
};
