// Main-thread handle on the db worker. Every method is a message; nothing here runs SQL.
import { Worker } from "node:worker_threads";
import { LogError } from "./errors.ts";
import type { LogErrorCode } from "./errors.ts";
import type { AppendResult, NewEvent, ReadQuery, StoredEvent, VerifyResult } from "./types.ts";
import type { IdemBackend, IdemRecord } from "../idempotency/index.ts";
import { createIdempotency } from "../idempotency/index.ts";
import type { CompactResult, CompactSubject } from "../events/compact.ts";

export interface OpenOptions {
  path: string;
  space: string;
  /** group-commit window, default 2 ms */
  windowMs?: number;
  /** most appends per transaction, default 64 */
  maxBatch?: number;
}

type Pending = { resolve: (v: any) => void; reject: (e: Error) => void };

export class LogClient {
  private worker: Worker;
  private next = 1;
  private pending = new Map<number, Pending>();
  private closed = false;
  head: { seq: number; hash: string };

  private constructor(worker: Worker, head: { seq: number; hash: string }) {
    this.worker = worker;
    this.head = head;
    worker.on("message", (m: { req: number; ok: boolean; value?: any; error?: { code: LogErrorCode; message: string } }) => {
      const p = this.pending.get(m.req);
      if (!p) return;
      this.pending.delete(m.req);
      if (m.ok) p.resolve(m.value); else p.reject(new LogError(m.error!.code, m.error!.message));
    });
    worker.on("error", (e) => this.failAll(e));
    worker.on("exit", () => this.failAll(new LogError("log_closed", "the db worker stopped")));
  }

  static async open(o: OpenOptions): Promise<LogClient> {
    const worker = new Worker(new URL("./worker.ts", import.meta.url), { workerData: { path: o.path, space: o.space, windowMs: o.windowMs ?? 2, maxBatch: o.maxBatch ?? 64 } });
    const first = await new Promise<{ ready: boolean; head?: { seq: number; hash: string }; error?: { code: LogErrorCode; message: string } }>((resolve, reject) => {
      worker.once("message", resolve);
      worker.once("error", reject);
    });
    if (!first.ready) { await worker.terminate(); throw new LogError(first.error!.code, first.error!.message); }
    return new LogClient(worker, first.head!);
  }

  private failAll(e: Error): void {
    this.closed = true;
    for (const p of this.pending.values()) p.reject(e);
    this.pending.clear();
  }

  private call<T>(op: string, args?: unknown): Promise<T> {
    if (this.closed) return Promise.reject(new LogError("log_closed", "the log is closed"));
    const req = this.next++;
    return new Promise<T>((resolve, reject) => { this.pending.set(req, { resolve, reject }); this.worker.postMessage({ req, op, args }); });
  }

  /** Append one event. Resolves when its group commit has been written. Rejects with LogError for a refused event. */
  async append(ev: NewEvent): Promise<StoredEvent> {
    const r = await this.call<AppendResult>("append", ev);
    if (!r.ok) throw new LogError(r.code as LogErrorCode, r.message);
    return r.event;
  }

  /** Like append but also says whether the id was already in the log. */
  appendResult(ev: NewEvent): Promise<AppendResult> { return this.call<AppendResult>("append", ev); }

  async get(seq: number): Promise<StoredEvent | null> { return this.call("get", { seq }); }
  read(q: ReadQuery = {}): Promise<StoredEvent[]> { return this.call("read", q); }
  verify(o: { from?: number; prev?: string } = {}): Promise<VerifyResult> { return this.call("verify", o); }
  proves(seq: number): Promise<boolean> { return this.call("proves", { seq }); }
  erase(seq: number): Promise<boolean> { return this.call("erase", { seq }); }
  /** Erase the payloads of everything about a subject (kernel/src/events/compact.ts), in the worker that owns the file, then scrub it. */
  compact(subject: CompactSubject, o: { vacuum?: boolean } = {}): Promise<CompactResult> { return this.call("compact", { subject, ...(o.vacuum === undefined ? {} : { vacuum: o.vacuum }) }); }
  /** Erase these events by seq (what a restore replays from a tombstone). */
  compactSeqs(seqs: readonly number[], o: { vacuum?: boolean } = {}): Promise<CompactResult> { return this.call("compact_seqs", { seqs, ...(o.vacuum === undefined ? {} : { vacuum: o.vacuum }) }); }
  async currentHead(): Promise<{ seq: number; hash: string }> { this.head = await this.call("head"); return this.head; }
  flush(): Promise<void> { return this.call("flush"); }

  /** Idempotency over events.db: records live in the worker's connection. */
  idempotency() {
    const backend: IdemBackend = {
      get: (key) => this.call<IdemRecord | null>("idem_get", { key }),
      put: (key, principal, cap, rec) => this.call("idem_put", { key, principal, cap, rec }),
    };
    return createIdempotency(backend);
  }
  purgeIdempotency(): Promise<number> { return this.call("idem_purge"); }

  async close(): Promise<void> {
    if (this.closed) return;
    await this.call("close").catch(() => {});
    this.closed = true;
    await this.worker.terminate();
  }
}
