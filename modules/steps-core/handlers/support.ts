// Which live steps this server can run. Run code needs the sandbox; the AI step needs the engine's one-shot turn.
import { codeAvailability } from "../code-sandbox.ts";
import type { StepsCtx } from "../projections.ts";

export async function stepsSupport(_ctx: StepsCtx, _input: Record<string, never>): Promise<unknown> {
  const code = codeAvailability();
  return { code: code === null ? { available: true } : { available: false, reason: code }, ai: { available: true } };
}
