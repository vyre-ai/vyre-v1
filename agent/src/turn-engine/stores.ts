// Message and wait ports of the turn engine (ARCH 6.1, 6.2, 6.7). Held in memory by default; module engine persists the same rows in SQL
// so a second host that takes over a thread (recover) sees the message bodies and the parked tool calls the first host left.
import type { StoredMessage, ToolResult } from "./types.ts";

/** The messages a thread's turns are routed from and replayed with. The store assigns the per-thread sequence. */
export interface MessageStore {
  /** Persist a message and return it with its per-thread sequence (1, 2, 3 ...). */
  append(msg: Omit<StoredMessage, "threadSeq">): StoredMessage;
  get(id: string): StoredMessage | null;
  /** The last `limit` messages of a thread, oldest first. */
  recent(threadId: string, limit: number): StoredMessage[];
}

export interface WaitResolution { approved: boolean; result: ToolResult }

/** A turn parked on a held tool call (turn.waiting { task }). It lives until the wake that continues it has started. */
export interface WaitRow {
  taskId: string;
  threadId: string;
  turnId: string;
  agentId: string;
  /** The model's id for the held tool call: the resumed turn answers it. */
  callId: string;
  toolName: string;
  /** The account that was paying: the resumed turn runs on it. */
  asker: string;
  runId: string | null;
  at: number;
  resolution: WaitResolution | null;
  /** Queue row of the wake that continues the turn, once the task was answered. */
  wakeQseq: number | null;
}

export interface WaitStore {
  put(row: WaitRow): void;
  get(taskId: string): WaitRow | null;
  /** Record the answer and the wake. False when the task is unknown or was already answered (a second answer is ignored). */
  resolve(taskId: string, resolution: WaitResolution, wakeQseq: number): boolean;
  /** The wait a wake queue row continues. */
  forWake(threadId: string, qseq: number): WaitRow | null;
  remove(taskId: string): void;
  /** Waits of a thread, answered or not. */
  open(threadId: string): WaitRow[];
}

export function createMemoryMessages(): MessageStore {
  const byThread = new Map<string, StoredMessage[]>();
  const byId = new Map<string, StoredMessage>();
  return {
    append(msg) {
      let list = byThread.get(msg.threadId);
      if (!list) { list = []; byThread.set(msg.threadId, list); }
      const stored: StoredMessage = { ...msg, mentions: [...msg.mentions], threadSeq: list.length + 1 };
      list.push(stored);
      byId.set(stored.id, stored);
      return { ...stored, mentions: [...stored.mentions] };
    },
    get(id) {
      const m = byId.get(id);
      return m ? { ...m, mentions: [...m.mentions] } : null;
    },
    recent(threadId, limit) {
      const list = byThread.get(threadId) ?? [];
      return list.slice(Math.max(0, list.length - limit)).map((m) => ({ ...m, mentions: [...m.mentions] }));
    },
  };
}

export function createMemoryWaits(): WaitStore {
  const rows = new Map<string, WaitRow>();
  return {
    put(row) { rows.set(row.taskId, { ...row }); },
    get(taskId) {
      const r = rows.get(taskId);
      return r ? { ...r } : null;
    },
    resolve(taskId, resolution, wakeQseq) {
      const r = rows.get(taskId);
      if (!r || r.resolution) return false;
      r.resolution = resolution;
      r.wakeQseq = wakeQseq;
      return true;
    },
    forWake(threadId, qseq) {
      for (const r of rows.values()) if (r.threadId === threadId && r.wakeQseq === qseq) return { ...r };
      return null;
    },
    remove(taskId) { rows.delete(taskId); },
    open: (threadId) => [...rows.values()].filter((r) => r.threadId === threadId).map((r) => ({ ...r })),
  };
}
