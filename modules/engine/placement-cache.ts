// Where a chat runs, read once per chat and kept (the turn's context line and the locked-account check both ask on every turn). A placement changes when a computer links or drops, when the person pins or
// unpins the chat (engine.placement.set), and when a server joins or leaves, so those clear it; five minutes is the backstop for anything else.
const TTL_MS = 5 * 60_000;
const kept = new Map<string, { placement: string | undefined; at: number }>();

export function forgetPlacement(threadId?: string): void { if (threadId === undefined) kept.clear(); else for (const k of [...kept.keys()]) if (k.startsWith(`${threadId}|`)) kept.delete(k); }

export async function placementOf(read: () => Promise<string | undefined>, key: { threadId: string; agentId: string; asker: string }, now: number): Promise<string | undefined> {
  const k = `${key.threadId}|${key.agentId}|${key.asker}`;
  const hit = kept.get(k);
  if (hit && now - hit.at < TTL_MS) return hit.placement;
  const placement = await read();
  kept.set(k, { placement, at: now });
  if (kept.size > 500) kept.delete(kept.keys().next().value as string);
  return placement;
}
