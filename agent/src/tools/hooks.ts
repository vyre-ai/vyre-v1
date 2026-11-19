// The hooks port (lane l-hooks). The tool session, the turn engine and the MCP endpoint ask one thing, and the hooks module (modules/hooks) answers it: given an event, what the hooks of that agent,
// chat and run say. Nothing here runs a hook. A port that is absent, slow or throws means "no hook said anything": a hook never stops work by failing.

// HookFire and HookVerdict live in lib/hooks.ts so the hooks module reads them without importing agent (the layer rule)
export type { HookFire, HookVerdict } from "../../../lib/hooks.ts";
import type { HookFire, HookVerdict } from "../../../lib/hooks.ts";
export const NO_VERDICT: HookVerdict = { block: null, notes: [], ran: 0 };
export interface HooksPort {
  fire(f: HookFire): Promise<HookVerdict>;
  /** The reason of the newest block in this chat since `since` (ms), if any: a turn that ends with no words after a stop says so itself. */
  stoppedSince?(threadId: string, since: number): string | undefined;
}

/** The port the host binds once (the engine runtime does), read by the MCP endpoint of CLI sessions, which is built apart from the engine. Unbound: no hook says anything. */
export const hooksHolder: { port: HooksPort | null } = { port: null };
export const bindHooksPort = (p: HooksPort | null): void => {
  hooksHolder.port = p;
};

/**
 * What a command-line engine's own subagent is allowed to do (r42-runtime): the vyre-hook of a call made INSIDE a subagent carries its agent_id (the id of the task that started it). The host answers whether that subagent was
 * asked to stop (then its next call is blocked with a reason) and what it was told meanwhile (read as notes at that call). Unbound, or a subagent it does not know: nothing to say.
 */
export type SubagentGate = (c: {
  threadId: string;
  subagent: string;
  tool?: string;
}) => Promise<{ block: string | null; notes: string[] }>;
export const subagentGateHolder: { gate: SubagentGate | null } = { gate: null };
export const bindSubagentGate = (g: SubagentGate | null): void => {
  subagentGateHolder.gate = g;
};
