// thread_queue (ARCH 6.1): one ordered queue per thread. Highest priority first, then qseq. Interrupts are priority 10.
import type { QueueItem } from "./types.ts";

export const PRIORITY_INTERRUPT = 10;

export type NewItem = Omit<QueueItem, "qseq" | "state">;

export interface QueueStore {
  enqueue(item: NewItem): QueueItem;
  /** The next queued item, not removed. */
  peek(threadId: string): QueueItem | null;
  /** Mark the next queued item running and return it. */
  dequeue(threadId: string): QueueItem | null;
  /** Queued steering rows for an agent, oldest first. */
  steerable(threadId: string, agentId: string): QueueItem[];
  setState(threadId: string, qseq: number, state: QueueItem["state"]): void;
  /** Cancel every queued row (stop all). Returns the rows cancelled. */
  cancelQueued(threadId: string): QueueItem[];
  /** Rows left in `running` state (their worker died). */
  running(threadId: string): QueueItem[];
  list(threadId: string): QueueItem[];
}

export function createMemoryQueue(): QueueStore {
  const rows = new Map<string, QueueItem[]>();
  const seq = new Map<string, number>();
  const of = (t: string): QueueItem[] => {
    let r = rows.get(t);
    if (!r) { r = []; rows.set(t, r); }
    return r;
  };
  const order = (a: QueueItem, b: QueueItem): number => b.priority - a.priority || a.qseq - b.qseq;
  const queued = (t: string): QueueItem[] => of(t).filter((r) => r.state === "queued").sort(order);

  return {
    enqueue(item) {
      const qseq = (seq.get(item.threadId) ?? 0) + 1;
      seq.set(item.threadId, qseq);
      const row: QueueItem = { ...item, qseq, state: "queued" };
      of(item.threadId).push(row);
      return row;
    },
    peek: (t) => queued(t)[0] ?? null,
    dequeue(t) {
      const next = queued(t)[0];
      if (!next) return null;
      next.state = "running";
      return next;
    },
    steerable: (t, agentId) => queued(t).filter((r) => r.steer && r.kind === "message" && r.agentId === agentId).sort((a, b) => a.qseq - b.qseq),
    setState(t, qseq, state) {
      const row = of(t).find((r) => r.qseq === qseq);
      if (row) row.state = state;
    },
    cancelQueued(t) {
      const out = queued(t);
      for (const r of out) r.state = "cancelled";
      return out;
    },
    running: (t) => of(t).filter((r) => r.state === "running"),
    list: (t) => of(t).slice(),
  };
}

