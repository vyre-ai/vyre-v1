// thread_queue (ARCH 6.1): one ordered queue per thread. Highest priority first, then qseq. Interrupts are priority 10.
import type { QueueItem } from "./types.ts";

export const PRIORITY_INTERRUPT = 10;

export type NewItem = Omit<QueueItem, "qseq" | "state">;

export interface QueueStore {
  enqueue(item: NewItem): QueueItem;
  /** The next queued item, not removed. With `accept`, the first queued item it accepts (one turn per agent: a row whose agent is busy is skipped, never reordered). */
  peek(threadId: string, accept?: (item: QueueItem) => boolean): QueueItem | null;
  /** Mark the next queued item (the first one `accept` takes) running and return it. */
  dequeue(threadId: string, accept?: (item: QueueItem) => boolean): QueueItem | null;
  /** Queued steering rows for an agent, oldest first. */
  steerable(threadId: string, agentId: string): QueueItem[];
  setState(threadId: string, qseq: number, state: QueueItem["state"], stopReason?: string): void;
  /** The turn of this row called a tool. Written before the tool runs, so a crash in the middle of it still counts. */
  touch(threadId: string, qseq: number): void;
  /** Cancel every queued row (stop all), or only one agent's rows. Returns the rows cancelled. */
  cancelQueued(threadId: string, agentId?: string): QueueItem[];
  /** Rows left in `running` state (their worker died). */
  running(threadId: string): QueueItem[];
  list(threadId: string): QueueItem[];
}

export function createMemoryQueue(): QueueStore {
  const rows = new Map<string, QueueItem[]>();
  const seq = new Map<string, number>();
  const of = (t: string): QueueItem[] => {
    let r = rows.get(t);
    if (!r) {
      r = [];
      rows.set(t, r);
    }
    return r;
  };
  const order = (a: QueueItem, b: QueueItem): number => b.priority - a.priority || a.qseq - b.qseq;
  const queued = (t: string): QueueItem[] =>
    of(t)
      .filter((r) => r.state === "queued")
      .sort(order);

  return {
    enqueue(item) {
      const qseq = (seq.get(item.threadId) ?? 0) + 1;
      seq.set(item.threadId, qseq);
      const row: QueueItem = { ...item, qseq, state: "queued" };
      of(item.threadId).push(row);
      return row;
    },
    peek: (t, accept) => queued(t).find((r) => !accept || accept(r)) ?? null,
    dequeue(t, accept) {
      const next = queued(t).find((r) => !accept || accept(r));
      if (!next) return null;
      next.state = "running";
      return next;
    },
    steerable: (t, agentId) =>
      queued(t)
        .filter((r) => r.steer && r.kind === "message" && r.agentId === agentId)
        .sort((a, b) => a.qseq - b.qseq),
    setState(t, qseq, state, stopReason) {
      const row = of(t).find((r) => r.qseq === qseq);
      if (row) {
        row.state = state;
        if (stopReason !== undefined) row.stopReason = stopReason;
      }
    },
    touch(t, qseq) {
      const row = of(t).find((r) => r.qseq === qseq);
      if (row) row.touched = true;
    },
    cancelQueued(t, agentId) {
      const out = queued(t).filter((r) => agentId === undefined || r.agentId === agentId);
      for (const r of out) r.state = "cancelled";
      return out;
    },
    running: (t) => of(t).filter((r) => r.state === "running"),
    list: (t) => of(t).slice(),
  };
}
