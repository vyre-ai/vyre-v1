// The kernel log, in-process. Production runs the same LogStore behind a db worker thread (group commit); a test has no concurrency to batch, and a worker costs more than the whole 80 ms boot budget,
// so the testkit opens the store directly on the main thread. Same SQL, same hash chain, same idempotency table; the store's clock is the fake clock.
import { DatabaseSync } from "node:sqlite";
import { LogError, LogStore } from "../../kernel/src/log/index.ts";
import type { NewEvent, ReadQuery, StoredEvent, VerifyResult } from "../../kernel/src/log/index.ts";
import { createIdempotency } from "../../kernel/src/idempotency/index.ts";
import { IdempotencyTable } from "../../kernel/src/idempotency/table.ts";

export class InProcLog {
  readonly store: LogStore;
  private idem: IdempotencyTable;
  private clock: () => number;
  constructor(file: string, space: string, clock: () => number) {
    this.clock = clock;
    this.store = new LogStore({ db: new DatabaseSync(file), space, clock });
    this.idem = new IdempotencyTable(this.store.db);
  }
  async append(ev: NewEvent): Promise<StoredEvent> {
    const r = this.store.appendBatch([ev])[0]!;
    if (!r.ok) throw new LogError(r.code as never, r.message);
    return r.event;
  }
  async read(q: ReadQuery = {}): Promise<StoredEvent[]> { return this.store.read(q); }
  async currentHead(): Promise<{ seq: number; hash: string }> { return this.store.head; }
  async verify(): Promise<VerifyResult> { return this.store.verify(); }
  idempotency() {
    return createIdempotency({
      get: (key) => this.idem.get(key, this.clock()),
      put: (key, principal, cap, rec) => this.idem.put(key, principal, cap, rec, this.clock()),
    });
  }
  async close(): Promise<void> { this.store.close(); }
}
