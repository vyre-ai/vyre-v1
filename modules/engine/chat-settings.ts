// What a chat says about how its agents answer, read before every turn (threads.get as the asker): the mode (Ask first, Auto, Plan), and the model, provider and effort chosen for the agent in this chat.
// The engine keeps its own copy of an agent from when the thread was opened; a person changes these in the composer at any time, so the copy is never trusted for them. The account is not set here:
// engine.account.resolve reads the chat's account (the member's accountRef) itself, and the session spec carries the account it chose.
import type { EngineSession, OpenSession, SessionSpec } from "../../agent/src/turn-engine/types.ts";
import type { ChatMode, Effort } from "../../agent/src/turn-engine/types.ts";

type Call = (cap: string, input: unknown, as?: string) => Promise<unknown>;

interface ThreadOut {
  thread?: { mode?: unknown; planMode?: unknown; agents?: Array<{ agentId?: string; model?: string; provider?: string; effort?: string }> };
}

const MODES: ReadonlySet<string> = new Set(["ask", "auto", "plan"]);
const EFFORTS: ReadonlySet<string> = new Set(["low", "medium", "high", "max"]);

export interface ChatSettings { mode?: ChatMode; model?: string; provider?: string; effort?: Effort }

/** The settings of one agent in one chat; nothing for a thread that cannot be read (a step, a one-shot job): the session then keeps the older behaviour. */
export async function chatSettings(call: Call, threadId: string, agentId: string, asker: string): Promise<ChatSettings> {
  let out: ThreadOut;
  try { out = (await call("threads.get", { threadId }, asker)) as ThreadOut; } catch { return {}; }
  const t = out?.thread;
  if (!t) return {};
  const member = t.agents?.find((a) => a.agentId === agentId);
  const mode = typeof t.mode === "string" && MODES.has(t.mode) ? (t.mode as ChatMode) : t.planMode === true ? "plan" : undefined;
  return {
    ...(mode !== undefined ? { mode } : {}),
    ...(member?.model ? { model: member.model } : {}),
    ...(member?.provider ? { provider: member.provider } : {}),
    ...(member?.effort && EFFORTS.has(member.effort) ? { effort: member.effort as Effort } : {}),
  };
}

/** Put a chat's settings on the session spec of each turn, before the pool picks a session for it (a different mode or effort is a different session). */
export function withChatSettings(open: OpenSession, call: Call): OpenSession {
  return async (spec: SessionSpec): Promise<EngineSession> => {
    if (spec.tools === "none") return open(spec);   // an automation's AI step has no chat
    const s = await chatSettings(call, spec.threadId, spec.agent.id, spec.asker);
    const agent = { ...spec.agent, ...(s.model !== undefined ? { model: s.model } : {}), ...(s.effort !== undefined ? { effort: s.effort } : {}) };
    return open({ ...spec, agent, ...(s.mode !== undefined ? { mode: s.mode } : {}) });
  };
}
