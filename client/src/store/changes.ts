// The change feed of one Space's replica: every local write and every applied pull change reports the (entity, id) it touched, in batches.
// The query layer reads this feed once per Space. It never subscribes per row (ARCH 9: no per-row subscriptions).
export interface Change { entity: string; id: string }

export interface ChangeFeed {
  subscribe(fn: (batch: readonly Change[]) => void): () => void;
  /** Listeners attached right now (a test asserts this stays 1). */
  listeners(): number;
}

export interface ChangeSink extends ChangeFeed {
  emit(change: Change): void;
  /** Changes made inside `fn` reach listeners as one batch when it returns, even if it throws. */
  batch<T>(fn: () => T): T;
}

export function createChangeFeed(): ChangeSink {
  const subs = new Set<(batch: readonly Change[]) => void>();
  let depth = 0;
  let pending: Change[] = [];
  const flush = (): void => {
    if (pending.length === 0) return;
    const batch = pending;
    pending = [];
    for (const fn of [...subs]) fn(batch);
  };
  return {
    subscribe(fn) { subs.add(fn); return () => void subs.delete(fn); },
    listeners: () => subs.size,
    emit(change) { pending.push(change); if (depth === 0) flush(); },
    batch(fn) {
      depth++;
      try { return fn(); } finally { depth--; if (depth === 0) flush(); }
    },
  };
}
