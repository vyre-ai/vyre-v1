// The turns that are being written right now, per chat (chat streaming). The live socket carries `turn` frames from the host: a turn starts, text arrives in pieces, the turn ends, and
// the host says which chat message the finished turn became. Each turn gets one StreamStore (the same store the message list already renders with StreamText), so what is typed on the
// screen is the very text the saved message will hold. The finished message is a normal row that arrives through the usual re-read; this registry keeps the store a moment longer under
// that message's id, so the row appears with the words already in place and nothing jumps.
import { createStreamStore } from "../../../../../ui/src/stream/store.ts";
import type { StreamStore } from "../../../../../ui/src/stream/store.ts";

export interface LiveTurn {
  turnId: string;
  threadId: string;
  agentId: string;
  store: StreamStore;
  /** writing: text may still come. ended: the turn is over and the message is being saved. */
  state: "writing" | "ended";
  /** The chat message this turn became, once the host has saved it. null: nothing was saved (the turn made no message). */
  messageId?: string | null;
  startedAt: number;
}

export interface TurnStreams {
  /** One `turn` frame from the live socket. Anything else is ignored. */
  onFrame(frame: unknown): void;
  /** Turns of this chat that still show a row of their own, oldest first. The array identity changes only when the set or a state changes. */
  turnsOf(threadId: string): readonly LiveTurn[];
  /** The store behind a row: a turn's own id while it writes (`turn:<id>`), or the message id it became until the row is on screen. */
  streamOf(rowId: string): StreamStore | undefined;
  /** The row of this message is on screen: the turn behind it can go. */
  settle(messageId: string): void;
  subscribe(listener: () => void): () => void;
  /** The link dropped: what was being written cannot finish here; the saved message will arrive by the normal re-read. */
  reset(): void;
  dispose(): void;
}

export interface TurnStreamOptions {
  now?: () => number;
  /** A turn that goes quiet this long is dropped (a lost link, a dead host). */
  quietMs?: number;
  /** How long a finished turn waits for its row before it goes. */
  settleMs?: number;
  makeStore?: () => StreamStore;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (h: unknown) => void;
}

export const turnRowId = (turnId: string): string => `turn:${turnId}`;

const str = (v: unknown): string => (typeof v === "string" ? v : "");

export function createTurnStreams(o: TurnStreamOptions = {}): TurnStreams {
  const now = o.now ?? Date.now;
  const quietMs = o.quietMs ?? 90_000;
  const settleMs = o.settleMs ?? 10_000;
  const makeStore = o.makeStore ?? (() => createStreamStore());
  const setT = o.setTimer ?? ((fn, ms) => { const h = setTimeout(fn, ms) as unknown as { unref?: () => void }; h.unref?.(); return h; });   // unref: a quiet turn's timer never keeps a server-side render or a test process alive
  const clearT = o.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  const turns = new Map<string, LiveTurn>();
  const timers = new Map<string, unknown>();
  const byThread = new Map<string, readonly LiveTurn[]>();
  const listeners = new Set<() => void>();

  const rebuild = (threadId: string): void => {
    const list = [...turns.values()].filter((t) => t.threadId === threadId).sort((a, b) => a.startedAt - b.startedAt);
    byThread.set(threadId, list);
  };
  const tell = (threadId: string): void => { rebuild(threadId); for (const l of [...listeners]) l(); };
  const arm = (turnId: string, ms: number): void => {
    const old = timers.get(turnId);
    if (old !== undefined) clearT(old);
    timers.set(turnId, setT(() => drop(turnId), ms));
  };
  function drop(turnId: string): void {
    const t = turns.get(turnId);
    const h = timers.get(turnId);
    if (h !== undefined) clearT(h);
    timers.delete(turnId);
    if (!t) return;
    turns.delete(turnId);
    tell(t.threadId);
  }
  const ensure = (turnId: string, threadId: string, agentId: string): LiveTurn => {
    const have = turns.get(turnId);
    if (have) return have;
    const t: LiveTurn = { turnId, threadId, agentId, store: makeStore(), state: "writing", startedAt: now() };
    turns.set(turnId, t);
    return t;
  };

  return {
    onFrame(frame) {
      if (typeof frame !== "object" || frame === null) return;
      const f = frame as { t?: unknown; turn?: unknown; delta?: unknown };
      if (f.t !== "turn" || typeof f.turn !== "string" || typeof f.delta !== "object" || f.delta === null) return;
      const d = f.delta as Record<string, unknown>;
      const threadId = str(d["threadId"]), agentId = str(d["agentId"]), kind = str(d["kind"]);
      if (threadId === "" || agentId === "") return;
      const turnId = f.turn;
      if (kind === "start" || kind === "delta") {
        const fresh = !turns.has(turnId);
        const t = ensure(turnId, threadId, agentId);
        if (kind === "delta") { const text = str(d["text"]); if (text !== "") t.store.push(text); }
        arm(turnId, quietMs);
        if (fresh) tell(threadId);
        return;
      }
      if (kind === "end") {
        const t = turns.get(turnId);
        if (!t || t.state === "ended") return;
        t.store.end();
        turns.set(turnId, { ...t, state: "ended" });
        arm(turnId, settleMs);
        tell(threadId);
        return;
      }
      if (kind === "final") {
        const t = turns.get(turnId);
        if (!t) return;
        const messageId = typeof d["messageId"] === "string" && d["messageId"] !== "" ? (d["messageId"] as string) : null;
        if (messageId === null) { drop(turnId); return; }
        if (t.state === "writing") t.store.end();
        turns.set(turnId, { ...t, state: "ended", messageId });
        arm(turnId, settleMs);
        tell(threadId);
      }
    },
    turnsOf: (threadId) => byThread.get(threadId) ?? [],
    streamOf(rowId) {
      if (rowId.startsWith("turn:")) return turns.get(rowId.slice(5))?.store;
      for (const t of turns.values()) if (t.messageId === rowId) return t.store;
      return undefined;
    },
    settle(messageId) { for (const t of turns.values()) if (t.messageId === messageId) { drop(t.turnId); return; } },
    subscribe(l) { listeners.add(l); return () => { listeners.delete(l); }; },
    reset() {
      const ids = [...turns.keys()];
      const threads = new Set([...turns.values()].map((t) => t.threadId));
      for (const id of ids) { const h = timers.get(id); if (h !== undefined) clearT(h); timers.delete(id); }
      turns.clear();
      for (const th of threads) rebuild(th);
      if (ids.length) for (const l of [...listeners]) l();
    },
    dispose() { for (const h of timers.values()) clearT(h); timers.clear(); turns.clear(); byThread.clear(); listeners.clear(); },
  };
}
