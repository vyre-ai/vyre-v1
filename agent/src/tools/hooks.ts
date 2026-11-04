// The hooks port (lane l-hooks). The tool session, the turn engine and the MCP endpoint ask one thing, and the hooks module (modules/hooks) answers it: given an event, what the hooks of that agent,
// chat and run say. Nothing here runs a hook. A port that is absent, slow or throws means "no hook said anything": a hook never stops work by failing.

// HookFire and HookVerdict live in lib/hooks.ts so the hooks module reads them without importing agent (the layer rule)
export type { HookFire, HookVerdict } from "../../../lib/hooks.ts";
import type { HookFire, HookVerdict } from "../../../lib/hooks.ts";
export const NO_VERDICT: HookVerdict = { block: null, notes: [], ran: 0 };
export interface HooksPort { fire(f: HookFire): Promise<HookVerdict> }

/** The port the host binds once (the engine runtime does), read by the MCP endpoint of CLI sessions, which is built apart from the engine. Unbound: no hook says anything. */
export const hooksHolder: { port: HooksPort | null } = { port: null };
export const bindHooksPort = (p: HooksPort | null): void => { hooksHolder.port = p; };
