// Who is typing where: the server tells a person's open app when someone who may read a chat types in it (a `typing` frame: the chat and the person, nothing else), and this keeps each name for 5 seconds
// of silence. Sending is the other half: the composer says "I am typing" in a chat at most once every 2 seconds. Nothing here is saved or logged.

export const TYPING_GONE_MS = 5_000;
export const TYPING_SEND_MS = 2_000;

export interface Typing {
  onFrame(frame: unknown): void;
  /** The people (ids) typing in a chat now. The array identity changes only when the set does. */
  who(threadId: string): readonly string[];
  /** The person in this app is typing in a chat: told to the server, at most every 2 seconds per chat. */
  say(threadId: string): void;
  subscribe(listener: () => void): () => void;
  dispose(): void;
}

export function createTyping(o: { send(frame: unknown): boolean; now?: () => number; me?: () => string | undefined }): Typing {
  const now = o.now ?? Date.now;
  const seen = new Map<string, Map<string, number>>(); // chat -> person -> when last heard
  const sentAt = new Map<string, number>();
  const listeners = new Set<() => void>();
  const cache = new Map<string, readonly string[]>();
  const EMPTY: readonly string[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  const tell = (): void => {
    cache.clear();
    for (const l of [...listeners]) l();
  };
  const sweep = (): void => {
    timer = null;
    const t = now();
    let changed = false;
    let next = Infinity;
    for (const [chat, people] of seen) {
      for (const [p, at] of people) {
        if (t - at >= TYPING_GONE_MS) {
          people.delete(p);
          changed = true;
        } else next = Math.min(next, at + TYPING_GONE_MS);
      }
      if (people.size === 0) seen.delete(chat);
    }
    if (changed) tell();
    if (next !== Infinity) timer = setTimeout(sweep, Math.max(50, next - t));
    (timer as unknown as { unref?: () => void } | null)?.unref?.();
  };
  return {
    onFrame(frame) {
      const f = frame as { t?: unknown; threadId?: unknown; person?: unknown };
      if (f.t !== "typing" || typeof f.threadId !== "string" || typeof f.person !== "string") return;
      if (f.person === o.me?.()) return;
      let people = seen.get(f.threadId);
      if (!people) seen.set(f.threadId, (people = new Map()));
      const had = people.has(f.person);
      people.set(f.person, now());
      if (!had) tell();
      if (timer === null) {
        timer = setTimeout(sweep, TYPING_GONE_MS);
        (timer as unknown as { unref?: () => void }).unref?.();
      }
    },
    who(threadId) {
      const hit = cache.get(threadId);
      if (hit) return hit;
      const list = [...(seen.get(threadId)?.keys() ?? [])];
      const out = list.length === 0 ? EMPTY : list;
      cache.set(threadId, out);
      return out;
    },
    say(threadId) {
      const t = now();
      if (t - (sentAt.get(threadId) ?? 0) < TYPING_SEND_MS) return;
      sentAt.set(threadId, t);
      o.send({ t: "typing", threadId });
    },
    subscribe(l) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    dispose() {
      if (timer) clearTimeout(timer);
      timer = null;
      listeners.clear();
      seen.clear();
    },
  };
}
