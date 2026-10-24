// Per-thread queue over thread_seq (ARCH 6.1, 6.2).
// Dequeue picks the highest priority, then the earliest thread_seq, then qseq.
// Interrupt uses priority 10 so it runs before steering and ordinary messages.
// qseq is the per-thread append order. thread_seq is the message log order and wins inside one priority.

import type { AccountChoice, QueueItem, QueueKind, QueueState } from "./types.ts";

export interface EnqueueInput {
  threadId: string;
  threadSeq: number;
  kind: QueueKind;
  messageId: string | null;
  agentId: string;
  from: string;
  priority: number;
  routine: boolean;
  account: AccountChoice;
  enqueuedAt: number;
}

export class ThreadQueue {
  private readonly rows: QueueItem[] = [];
  private readonly nextQ = new Map<string, number>();

  items(threadId: string): readonly QueueItem[] {
    return this.rows.filter((row) => row.threadId === threadId);
  }

  get(threadId: string, qseq: number): QueueItem | undefined {
    return this.rows.find((row) => row.threadId === threadId && row.qseq === qseq);
  }

  enqueue(input: EnqueueInput): QueueItem {
    const qseq = (this.nextQ.get(input.threadId) ?? 0) + 1;
    this.nextQ.set(input.threadId, qseq);
    const item: QueueItem = {
      threadId: input.threadId,
      qseq,
      threadSeq: input.threadSeq,
      kind: input.kind,
      messageId: input.messageId,
      agentId: input.agentId,
      from: input.from,
      priority: input.priority,
      state: "queued",
      enqueuedAt: input.enqueuedAt,
      routine: input.routine,
      account: input.account,
    };
    this.rows.push(item);
    return item;
  }

  /** Highest priority, then earliest thread_seq, then qseq. Marks the row running. */
  dequeue(threadId: string): QueueItem | undefined {
    const ready = this.rows.filter((row) => row.threadId === threadId && row.state === "queued");
    ready.sort(byTurnOrder);
    const item = ready[0];
    if (!item) return undefined;
    item.state = "running";
    return item;
  }

  /** Steering rows still waiting: ordinary messages, not interrupt, wake or handoff. */
  peekSteering(threadId: string): QueueItem[] {
    const ready = this.rows.filter((row) => row.threadId === threadId && row.state === "queued" && row.kind === "message");
    ready.sort(byTurnOrder);
    return ready;
  }

  mark(item: QueueItem, state: QueueState): void {
    item.state = state;
  }

  cancelQueued(threadId: string, agentId: string | undefined): number {
    let n = 0;
    for (const row of this.rows) {
      if (row.threadId !== threadId || row.state !== "queued") continue;
      if (agentId !== undefined && row.agentId !== agentId) continue;
      row.state = "cancelled";
      n += 1;
    }
    return n;
  }
}

function byTurnOrder(a: QueueItem, b: QueueItem): number {
  return b.priority - a.priority || a.threadSeq - b.threadSeq || a.qseq - b.qseq;
}
