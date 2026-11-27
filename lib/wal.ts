// Truncating the write-ahead log of a database on purpose (a purge, a re-seal, a wiped key): the values taken out of the tables must not stay in the -wal file. A checkpoint of another connection (the host's
// checkpoint worker looks at modules.db, logs.db and the Space store every 50 ms, host/src/daemon/checkpointer.ts) holds the checkpoint lock for a moment, and a TRUNCATE that meets it answers busy and
// truncates nothing: it is asked again, a few milliseconds later, until it answers that it did (a worker's pass is a few milliseconds).
type Rows = { prepare(sql: string): { get(): unknown } } | { all(sql: string, ...a: unknown[]): unknown[] };

const sleep = (ms: number): void => void Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/** `PRAGMA wal_checkpoint(TRUNCATE)` until it is not busy (at most `tries` times); true when the log was truncated. */
export function truncateWal(db: Rows, tries = 100): boolean {
  const sql = "PRAGMA wal_checkpoint(TRUNCATE)";
  for (let i = 0; i < tries; i++) {
    const r = ("prepare" in db ? db.prepare(sql).get() : db.all(sql)[0]) as
      | { busy?: number; log?: number; checkpointed?: number }
      | undefined;
    if (!r || (!r.busy && (r.log ?? 0) <= (r.checkpointed ?? 0))) return true;
    sleep(i < 10 ? 2 : 10);
  }
  return false;
}
