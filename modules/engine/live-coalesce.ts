// The live line of a busy turn: a hundred tool calls a minute must not become a hundred frames to every open screen (hole 19). Steps and thinking gather and go out about once a second, in order, the first at
// once so a turn looks alive straight away. A frame of words, a start or an end sends what is waiting first, so nothing reads out of order. None of this is ever written to the log.
import type { StreamEvent } from "./handlers/bridge.ts";

export const LIVE_EVERY_MS = 1000;
type Step = Extract<StreamEvent, { kind: "step" }>;
type Think = Extract<StreamEvent, { kind: "thinking" }>;
interface Waiting { threadId: string; agentId: string; steps: Array<Omit<Step, "kind" | "threadId" | "turnId" | "agentId">>; thinking: string; asker?: string; timer: ReturnType<typeof setTimeout> | null; last: number }

export function coalesceLive(out: (e: StreamEvent) => void, o: { now?: () => number; everyMs?: number; later?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout> } = {}): (e: StreamEvent) => void {
  const now = o.now ?? Date.now;
  const every = o.everyMs ?? LIVE_EVERY_MS;
  const later = o.later ?? ((fn, ms) => { const t = setTimeout(fn, ms); if (typeof t === "object" && "unref" in t) t.unref(); return t; });
  const turns = new Map<string, Waiting>();
  const send = (turnId: string, w: Waiting): void => {
    if (w.timer) { clearTimeout(w.timer); w.timer = null; }
    w.last = now();
    if (w.steps.length > 0) out({ kind: "steps", threadId: w.threadId, turnId, agentId: w.agentId, steps: w.steps });
    if (w.thinking !== "") out({ kind: "thinking", threadId: w.threadId, turnId, agentId: w.agentId, text: w.thinking, ...(w.asker ? { asker: w.asker } : {}) });
    w.steps = []; w.thinking = "";
  };
  return (e) => {
    if (e.kind === "step" || e.kind === "thinking") {
      const w = turns.get(e.turnId) ?? { threadId: e.threadId, agentId: e.agentId, steps: [], thinking: "", timer: null, last: 0 };
      turns.set(e.turnId, w);
      if (e.kind === "thinking") { w.thinking += (e as Think).text; if ((e as Think).asker) w.asker = (e as Think).asker as string; }
      else { const { kind: _k, threadId: _t, turnId: _u, agentId: _a, ...step } = e; w.steps.push(step); }
      const wait = every - (now() - w.last);
      if (wait <= 0) send(e.turnId, w);
      else w.timer ??= later(() => { const x = turns.get(e.turnId); if (x) send(e.turnId, x); }, wait);
      return;
    }
    const w = "turnId" in e ? turns.get(e.turnId) : undefined;
    if (w) send(e.turnId, w);
    if (e.kind === "final" && w) turns.delete(e.turnId);
    out(e);
  };
}
