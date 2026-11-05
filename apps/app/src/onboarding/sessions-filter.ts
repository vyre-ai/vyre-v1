// A new Mac's folders hold sessions with nothing a person can read (snapshot-only files, setup text only). They are left out of the list, so Select all never picks junk. Discovery only sees
// metadata, so the newest sessions are previewed here, a few at a time and within a time budget; the ones not reached stay listed, and the import skips an empty one anyway.
export interface Previewable { sessionKey: string }

export async function dropEmpty<T extends Previewable>(sources: readonly T[], messageCount: (s: T) => Promise<number>, o: { limit?: number; concurrency?: number; budgetMs?: number; now?: () => number } = {}): Promise<T[]> {
  const limit = o.limit ?? 30, width = o.concurrency ?? 4, budget = o.budgetMs ?? 4000, now = o.now ?? Date.now;
  const start = now();
  const empty = new Set<string>();
  const queue = sources.slice(0, limit);
  const worker = async (): Promise<void> => {
    for (;;) {
      if (now() - start > budget) return;
      const next = queue.shift();
      if (!next) return;
      try { if ((await messageCount(next)) === 0) empty.add(next.sessionKey); } catch { /* unreadable here: it stays listed and the import says why */ }
    }
  };
  await Promise.all(Array.from({ length: Math.min(width, queue.length) }, () => worker()));
  return sources.filter((s) => !empty.has(s.sessionKey));
}
