// A rewind and a turn of the same agent in the same chat must never run together: the turn writes into the folder the rewind is putting back. While a rewind of (chat, agent) is going back, that agent's turn
// starts wait here (the turn start already awaits its checkpoint); a rewind that finds a turn running refuses instead. A short limit, so a stuck rewind never holds a chat.
const held = new Map<string, { done: Promise<void>; release: () => void }>();
const key = (threadId: string, agentId: string): string => `${threadId}|${agentId}`;

/** The rewind is going back for this agent in this chat: turn starts wait until `release` is called. */
export function holdTurns(threadId: string, agentId: string): () => void {
  const k = key(threadId, agentId);
  let release = (): void => undefined;
  const done = new Promise<void>((r) => (release = r));
  const mine = { done, release };
  held.set(k, mine);
  return () => {
    mine.release();
    if (held.get(k) === mine) held.delete(k);
  };
}

export const WAIT_LIMIT_MS = 20_000;

/** A turn about to start: waits while a rewind holds this agent in this chat. "waited" when it did, "timeout" when the limit passed first (the turn then goes on), "free" when nothing held it. */
export async function turnMayStart(
  threadId: string,
  agentId: string,
  limitMs = WAIT_LIMIT_MS,
): Promise<"free" | "waited" | "timeout"> {
  const h = held.get(key(threadId, agentId));
  if (!h) return "free";
  let timer: ReturnType<typeof setTimeout> | undefined;
  const out = await Promise.race([
    h.done.then(() => "waited" as const),
    new Promise<"timeout">((r) => {
      timer = setTimeout(() => r("timeout"), limitMs);
    }),
  ]);
  if (timer) clearTimeout(timer);
  return out;
}
