// Timing samples the app measures on this device (app start to usable, Cmd-K) and sends to the Space it was measured in, so Console, Infrastructure, Speed shows real numbers against the performance
// budgets. A sample is stamped with the Space it belongs to and is only ever uploaded by that Space's own session, with that Space's token: switching Spaces never sends one Space's timings to another,
// and a signed-out or unreachable Space keeps its samples (up to a bound) until its session can send them. Nothing here touches the network itself; a session attaches an uploader.

export interface Sample { budgetId: string; value: number; at: number }
export interface Uploader {
  spaceId: string;
  /** True while the session is signed in and the Space answers. */
  ready(): boolean;
  upload(samples: Sample[]): Promise<void>;
}
export interface Recorder {
  record(spaceId: string, budgetId: string, value: number): void;
  /** A session offers itself; returns how it leaves. */
  attach(u: Uploader): () => void;
  flush(): Promise<void>;
  pending(spaceId?: string): number;
  stop(): void;
}

const MAX_PER_SPACE = 200;
const BATCH = 50;

export function createRecorder(o: { now?: () => number; flushMs?: number; setTimer?: (f: () => void, ms: number) => unknown; clearTimer?: (t: unknown) => void } = {}): Recorder {
  const now = o.now ?? Date.now;
  const setT = o.setTimer ?? ((f, ms) => setTimeout(f, ms));
  const clearT = o.clearTimer ?? ((t) => clearTimeout(t as ReturnType<typeof setTimeout>));
  const flushMs = o.flushMs ?? 5_000;
  const queues = new Map<string, Sample[]>();
  const uploaders = new Set<Uploader>();
  let timer: unknown = null;
  let sending = false;

  const schedule = (): void => { if (timer === null && !sending) timer = setT(() => { timer = null; void flush(); }, flushMs); };

  async function flush(): Promise<void> {
    if (sending) return;
    sending = true;
    try {
      for (const u of [...uploaders]) {
        if (!u.ready()) continue;
        const q = queues.get(u.spaceId);
        while (q && q.length > 0) {
          const batch = q.slice(0, BATCH);
          try { await u.upload(batch); } catch { break; }   // kept: the next flush tries again
          q.splice(0, batch.length);
        }
        if (q && q.length === 0) queues.delete(u.spaceId);
      }
    } finally { sending = false; }
    if ([...queues.values()].some((q) => q.length > 0)) schedule();
  }

  return {
    record(spaceId, budgetId, value) {
      if (!spaceId || !Number.isFinite(value) || value < 0) return;
      const q = queues.get(spaceId) ?? [];
      q.push({ budgetId, value, at: now() });
      while (q.length > MAX_PER_SPACE) q.shift();
      queues.set(spaceId, q);
      schedule();
    },
    attach(u) { uploaders.add(u); schedule(); return () => { uploaders.delete(u); }; },
    flush,
    pending: (spaceId) => spaceId === undefined ? [...queues.values()].reduce((n, q) => n + q.length, 0) : queues.get(spaceId)?.length ?? 0,
    stop() { if (timer !== null) clearT(timer); timer = null; },
  };
}

/** The one recorder of the page. */
export const speed = createRecorder();
