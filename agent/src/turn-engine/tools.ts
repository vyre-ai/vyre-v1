// The adapter between the tool session (agent/src/tools: callTool answers result | error | held) and the engine's ToolRunner (ARCH 6.7).
// A held outcome carries the Gate task: the engine parks the turn on it (turn.waiting { task }) and a wake continues it once the task is answered.
// Structural on purpose: any outcome with this shape fits, so the engine does not import the tool session.
import type { ToolRunner, ToolRunResult } from "./engine.ts";
import type { ToolResult } from "./types.ts";

export interface ToolOutcomeLike {
  kind: string;
  result: ToolResult;
  /** Present when kind is "held". */
  taskId?: string;
  runId?: string;
}

export function toolRunnerFrom(call: (c: { id: string; name: string; input: unknown }, ctx: Parameters<ToolRunner>[1]) => Promise<ToolOutcomeLike>): ToolRunner {
  return async (c, ctx): Promise<ToolRunResult> => {
    const out = await call(c, ctx);
    if (out.kind === "held" && typeof out.taskId === "string") {
      return { ...out.result, held: { taskId: out.taskId, ...(out.runId === undefined ? {} : { runId: out.runId }) } };
    }
    return { ok: out.result.ok, content: out.result.content };
  };
}
