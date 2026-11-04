// The hooks port (lane l-hooks). The tool session, the turn engine and the MCP endpoint ask one thing, and the hooks module (modules/hooks) answers it: given an event, what the hooks of that agent,
// chat and run say. Nothing here runs a hook. A port that is absent, slow or throws means "no hook said anything": a hook never stops work by failing.
import type { HookEventName } from "../../../lib/hooks.ts";

export interface HookFire {
  event: HookEventName;
  agentId: string;
  asker: string;
  threadId: string;
  turnId?: string;
  /** The thread is a helper's, or a chat's: helpers inherit the run hooks of the thread that started them. */
  threadKind?: string;
  /** Which kind of engine is running the turn: api, claude_code, codex, grok. */
  engine?: string;
  /** Where the event came from: the engine, Vyre's own tool session, or a CLI's own built-in tool (through the vyre-hook shim). */
  source?: "engine" | "tools" | "cli";
  tool?: string;
  cap?: string;
  input?: unknown;
  output?: unknown;
  ok?: boolean;
  prompt?: string;
  title?: string;
}
export interface HookVerdict {
  /** The first block, if any: the reason a person reads, who made the hook, and which. */
  block: { reason: string; hookId: string; by: string; scope: string } | null;
  /** Lines to add to the model's context. */
  notes: string[];
  ran: number;
}
export const NO_VERDICT: HookVerdict = { block: null, notes: [], ran: 0 };
export interface HooksPort { fire(f: HookFire): Promise<HookVerdict> }

/** The port the host binds once (the engine runtime does), read by the MCP endpoint of CLI sessions, which is built apart from the engine. Unbound: no hook says anything. */
export const hooksHolder: { port: HooksPort | null } = { port: null };
export const bindHooksPort = (p: HooksPort | null): void => { hooksHolder.port = p; };
