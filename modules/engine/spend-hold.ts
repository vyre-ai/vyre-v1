// A limit holds the next call of a command-line engine's turn (r42-runtime): the turn cannot be paused between calls from here, but every tool call of it passes the vyre-hook, which refuses it with the reason while the hold is on.
// The hold is kept in this process only, per chat and agent: it ends when the limit is raised (engine.resume_paused), when the turn ends (a Stop, or it finished), and with the server (a restart ends the CLI's process too).
const held = new Map<string, string>();
const k = (threadId: string, agentId: string): string => `${threadId}:${agentId}`;
export const HOLD_WORDS = "Spending limit reached; waiting for a person.";
export const holdOn = (threadId: string, agentId: string, reason: string = HOLD_WORDS): void =>
  void held.set(k(threadId, agentId), reason);
/** How many calls of a held turn were refused, by chat and agent: a model that goes on asking spends a step each time. */
const refused = new Map<string, number>();
/** After this many refused calls the turn ends as a pause (the engine's own doing), keeping its place. */
export const REFUSALS_BEFORE_END = 3;
export const holdOff = (threadId: string, agentId?: string): number => {
  let n = 0;
  for (const key of [...held.keys()])
    if (agentId === undefined ? key.startsWith(`${threadId}:`) : key === k(threadId, agentId))
      n += held.delete(key) ? 1 : 0;
  for (const key of [...refused.keys()])
    if (agentId === undefined ? key.startsWith(`${threadId}:`) : key === k(threadId, agentId)) refused.delete(key);
  return n;
};
export const holdOf = (threadId: string, agentId: string): string | undefined => held.get(k(threadId, agentId));

type Gate = (c: {
  threadId: string;
  agentId: string;
  subagent?: string;
  tool?: string;
}) => Promise<{ block: string | null; notes: string[] }>;
/**
 * The gate every tool call of a command-line turn passes (agent/src/mcp/server.ts): refused with the reason while a limit holds the agent in that chat, whichever tool and whoever (the main agent or one of its subagents);
 * else what the subagent's own gate says (a stop asked of it, a note told it).
 */
export const createSpendGate =
  (
    sub: () => { gate: (c: { threadId: string; subagent?: string }) => ReturnType<Gate> } | null,
    /** ends the held turn as a pause once the model has been refused enough times (REFUSALS_BEFORE_END) */
    end?: (threadId: string, agentId: string, reason: string) => void,
  ): Gate =>
  (c) => {
    const hold = holdOf(c.threadId, c.agentId);
    if (hold !== undefined) {
      const key = k(c.threadId, c.agentId);
      const n = (refused.get(key) ?? 0) + 1;
      refused.set(key, n);
      // refused again and again: each is a model step that spends, so the turn ends here (once), the hold stays until the limit is raised
      if (n === REFUSALS_BEFORE_END)
        try {
          end?.(c.threadId, c.agentId, hold);
        } catch {
          /* the turn is ending or gone: the refusal still stands */
        }
      return Promise.resolve({ block: hold, notes: [] });
    }
    return sub()?.gate(c) ?? Promise.resolve({ block: null, notes: [] });
  };
