// When each agent's current turn began (F50). The engine knows it (the turn row); a CLI engine's tool calls come through the MCP session, which lives across many turns and carries no turn of its own. So the engine
// notes the start here when it takes a turn off the queue, and the tool layer reads it for a call that arrived without one: an agent's write to a thing it never read in this turn is then written on the version the thing
// had when that turn began, the same rule an API engine's turn follows. Keyed by chat and agent; the newest turn of the pair wins.
const starts = new Map<string, { at: number; cause?: string }>();
const MAX = 2000;

/**
 * `cause` is why the engine started the turn: "message" (a person's or an agent's words), "interrupt", "handoff", "wake" (the engine started it on its own: a baton pass, a Routine, a background wait, a departure, a goal wake). A held call that was answered and the turn that goes on carries the cause of the turn it continues. A tool call carries it to the capability (ctx.turn), so a capability can tell a turn that was given work from one a person started with their words.
 */
export function noteTurnStart(threadId: string, agentId: string, at: number, cause?: string): void {
  const k = `${threadId}|${agentId}`;
  starts.delete(k);
  starts.set(k, { at, ...(cause ? { cause } : {}) });
  if (starts.size > MAX) starts.delete(starts.keys().next().value as string);
}

export function turnStartOf(threadId: string, agentId: string): number | undefined {
  return starts.get(`${threadId}|${agentId}`)?.at;
}

export function turnCauseOf(threadId: string, agentId: string): string | undefined {
  return starts.get(`${threadId}|${agentId}`)?.cause;
}

/** The turn ended: a call that comes now (a CLI engine's long-lived MCP session, between turns) has no cause. The start time stays (F50). */
export function clearTurnCause(threadId: string, agentId: string): void {
  const k = `${threadId}|${agentId}`;
  const s = starts.get(k);
  if (s?.cause) starts.set(k, { at: s.at });
}
