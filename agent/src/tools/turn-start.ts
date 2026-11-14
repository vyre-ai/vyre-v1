// When each agent's current turn began (F50). The engine knows it (the turn row); a CLI engine's tool calls come through the MCP session, which lives across many turns and carries no turn of its own. So the engine
// notes the start here when it takes a turn off the queue, and the tool layer reads it for a call that arrived without one: an agent's write to a thing it never read in this turn is then written on the version the thing
// had when that turn began, the same rule an API engine's turn follows. Keyed by chat and agent; the newest turn of the pair wins.
const starts = new Map<string, number>();
const MAX = 2000;

export function noteTurnStart(threadId: string, agentId: string, at: number): void {
  const k = `${threadId}|${agentId}`;
  starts.delete(k);
  starts.set(k, at);
  if (starts.size > MAX) starts.delete(starts.keys().next().value as string);
}

export function turnStartOf(threadId: string, agentId: string): number | undefined {
  return starts.get(`${threadId}|${agentId}`);
}
