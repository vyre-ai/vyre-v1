// One queue per key, in this process: work for the same key runs one after another, each as a whole. Used where a write is planned from a read and then awaited (a grant per member, per agent),
// so that a change taking access away and a write still in flight for the same subject never interleave: the one that runs second sees what the first did.
// The queue only orders; it never waits for anything else. Work in it must not wait for other work of the same key, or it would wait for itself.
const queues = new Map<string, Promise<void>>();

export async function oneAtATime<T>(key: string, work: () => Promise<T>): Promise<T> {
  const before = queues.get(key) ?? Promise.resolve();
  let done!: () => void;
  const mine = new Promise<void>((r) => { done = r; });
  const tail = before.then(() => mine);
  queues.set(key, tail);
  await before;
  try { return await work(); } finally {
    done();
    if (queues.get(key) === tail) queues.delete(key);
  }
}
