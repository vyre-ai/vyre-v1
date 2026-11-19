// A limit holds the next call of a command-line engine's turn (r42-runtime): the turn cannot be paused between calls from here, but every tool call of it passes the vyre-hook, which refuses it with the reason while the hold is on.
// The hold is kept in this process only, per chat and agent: it ends when the limit is raised (engine.resume_paused), when the turn ends (a Stop, or it finished), and with the server (a restart ends the CLI's process too).
const held = new Map<string, string>();
const k = (threadId: string, agentId: string): string => `${threadId}:${agentId}`;
export const HOLD_WORDS = "Spending limit reached; waiting for a person.";
export const holdOn = (threadId: string, agentId: string, reason: string = HOLD_WORDS): void =>
  void held.set(k(threadId, agentId), reason);
export const holdOff = (threadId: string, agentId?: string): number => {
  let n = 0;
  for (const key of [...held.keys()])
    if (agentId === undefined ? key.startsWith(`${threadId}:`) : key === k(threadId, agentId))
      n += held.delete(key) ? 1 : 0;
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
  (sub: () => { gate: (c: { threadId: string; subagent?: string }) => ReturnType<Gate> } | null): Gate =>
  (c) => {
    const hold = holdOf(c.threadId, c.agentId);
    if (hold !== undefined) return Promise.resolve({ block: hold, notes: [] });
    return sub()?.gate(c) ?? Promise.resolve({ block: null, notes: [] });
  };
