// The offline queue for reports: a pending op for reports.submit, kept in order and sent on reconnect with the bundle it was built with,
// so the trace ids are the ones from when the person pressed Send (spec 4.11, "Offline, N changes waiting").
import type { SubmitIn } from "./bundle.ts";

export interface PendingOp {
  id: string;
  cap: "reports.submit";
  input: SubmitIn;
  /** The trace id of the newest action in the bundle: the op keeps it through the outbox (spec 4.14 trace id). */
  traceId: string | null;
  at: number;
}

/** The slice of the client's pending_ops table this sheet uses. The replica packet provides the SQLite one; this is the same surface in memory. */
export interface Outbox {
  enqueue(op: PendingOp): void;
  list(): readonly PendingOp[];
  remove(id: string): void;
}

export function createMemoryOutbox(initial: readonly PendingOp[] = []): Outbox {
  let ops: PendingOp[] = initial.slice();
  return {
    enqueue: (op) => { ops = [...ops, op]; },
    list: () => ops.slice(),
    remove: (id) => { ops = ops.filter((o) => o.id !== id); },
  };
}
