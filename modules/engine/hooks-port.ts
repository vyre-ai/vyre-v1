// The engine's side of the hooks layer (lane l-hooks): the port the tool session, the turn engine and the MCP endpoint ask, answered by the hooks module's hooks.fire as the person asking. A module that is
// away, slow or failing answers "no hook said anything": a hook never stops work by failing.
import { NO_VERDICT } from "../../agent/src/tools/hooks.ts";
import type { HookFire, HookVerdict, HooksPort } from "../../agent/src/tools/hooks.ts";
import type { CallHooks } from "../../agent/src/tools/call.ts";

type Call = (cap: string, input: unknown, as?: string) => Promise<unknown>;
const SLOW_MS = 45_000;

export function hooksPortOf(call: Call, log?: (msg: string, attrs?: Record<string, unknown>) => void): HooksPort {
  // the newest block in each chat, so a turn that stops and then says nothing can say what happened (the tool session and the CLI shim both ask through this port)
  const stops = new Map<string, { reason: string; at: number }>();
  return {
    stoppedSince(threadId, since) { const s = stops.get(threadId); return s && s.at >= since ? s.reason : undefined; },
    async fire(f: HookFire): Promise<HookVerdict> {
      try {
        const { asker, ...rest } = f;
        const r = await Promise.race([call("hooks.fire", rest, asker), new Promise<null>((ok) => setTimeout(() => ok(null), SLOW_MS).unref?.())]);
        const v = (r as HookVerdict | null) ?? NO_VERDICT;
        if (v.block && f.threadId) { stops.set(f.threadId, { reason: v.block.reason, at: Date.now() }); if (stops.size > 500) stops.delete(stops.keys().next().value as string); }
        return v;
      } catch (e) { log?.("hooks did not answer", { event: f.event, error: e instanceof Error ? e.message : String(e) }); return NO_VERDICT; }
    },
  };
}

/** The tool session's hooks, from the port: tool.before, outward.before and tool.after of Vyre's own tools, for the engine named. */
export function callHooksOf(port: HooksPort, engine: string, source: "tools" = "tools"): CallHooks {
  return {
    fire: (ctx, f) => port.fire({ ...f, agentId: ctx.agentId, asker: ctx.asker, threadId: ctx.thread.threadId, threadKind: ctx.thread.kind, ...(ctx.turnId ? { turnId: ctx.turnId } : {}), engine, source }),
  };
}
