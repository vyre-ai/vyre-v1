// One queue per key, in this process: work for the same key runs one after another, each as a whole. Used where a write is planned from a read and then awaited (a grant per member, per agent),
// so that a change taking access away and a write still in flight for the same subject never interleave: the one that runs second sees what the first did.
// The queue only orders; it never waits for anything else. Work in it must not wait for other work of the same key, or it would wait for itself.
// Work that does not settle within its time limit (two minutes unless told) fails loudly: its caller gets an error, `onLimit` is told (a log line), and the queue moves on to the next work.
// The stuck work itself cannot be stopped from here; if it ever finishes, what it wrote lands after the work that ran next, which is why the limit is generous and the case is said out loud.
const queues = new Map<string, Promise<void>>();

export const QUEUE_LIMIT_MS = 120_000;

export interface QueueOptions {
  /** how long one piece of work may take before it fails and the queue moves on */
  limitMs?: number;
  /** told when work ran past its limit: the key and the limit */
  onLimit?(key: string, limitMs: number): void;
}

export async function oneAtATime<T>(key: string, work: () => Promise<T>, o: QueueOptions = {}): Promise<T> {
  const before = queues.get(key) ?? Promise.resolve();
  let done!: () => void;
  const mine = new Promise<void>((r) => {
    done = r;
  });
  const tail = before.then(() => mine);
  queues.set(key, tail);
  await before;
  const limitMs = o.limitMs ?? QUEUE_LIMIT_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limit = new Promise<never>((_, fail) => {
    timer = setTimeout(() => {
      try {
        o.onLimit?.(key, limitMs);
      } catch {
        /* a log line never stops the queue */
      }
      fail(new Error(`work queued for ${key} did not finish within ${limitMs} ms; the queue moved on`));
    }, limitMs);
    timer.unref?.();
  });
  try {
    return await Promise.race([work(), limit]);
  } finally {
    clearTimeout(timer);
    done();
    if (queues.get(key) === tail) queues.delete(key);
  }
}
