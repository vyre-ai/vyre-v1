// The device outbox (ARCH 5.4, 5.10): local changes wait here as ops until the server has them. Rows live in the replica's `pending_ops` table so a restart loses nothing.
import type { ConflictNotice, Op, RejectedOp } from "../protocol.ts";

/** `queued` ops are sent; `held` ops are waiting for an approval and are not resent. */
export type OutboxState = "queued" | "held";

export interface OutboxRow {
  n: number;
  op: Op;
  state: OutboxState;
  tries: number;
  lastError: string | null;
  at: number;
}

export interface RejectedRow { opId: string; error: unknown; copyOut: unknown; at: number }

/** Storage of the outbox. The SQL form is the replica's tables; the memory form is for tests and the web fallback. */
export interface OutboxStore {
  insert(op: Op, at: number): number;
  /** Queued rows in order. */
  queued(): OutboxRow[];
  /** Rows (queued or held) of one record, in order. */
  forRow(entity: string, id: string): OutboxRow[];
  remove(opId: string): void;
  setHeld(opId: string, taskId: string): void;
  bump(opId: string, error: string): void;
  reject(r: RejectedRow): void;
  rejected(): RejectedRow[];
  /** Ops waiting: queued and held. */
  count(): number;
}

export interface Ack {
  applied: string[];
  rejected: RejectedOp[];
  held: { opId: string; taskId: string }[];
  conflicts: ConflictNotice[];
}
