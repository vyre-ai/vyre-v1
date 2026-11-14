// The live line of a busy turn: a hundred tool calls a minute must not become a hundred frames to every open screen (hole 19). Steps and thinking gather and go out about once a second, in order, the first at
// once so a turn looks alive straight away. A frame of words, a start or an end sends what is waiting first, so nothing reads out of order. None of this is ever written to the log.
import { stepClass, stepWords } from "../../lib/plain-words.ts";
import type { StreamEvent } from "./handlers/bridge.ts";

export const LIVE_EVERY_MS = 1000;
type Step = Extract<StreamEvent, { kind: "step" }>;
type Think = Extract<StreamEvent, { kind: "thinking" }>;
interface Waiting {
  threadId: string;
  agentId: string;
  steps: Array<Omit<Step, "kind" | "threadId" | "turnId" | "agentId">>;
  /** a subagent's own lines: sent apart, to the person the turn runs for alone */
  sub: Array<Omit<Step, "kind" | "threadId" | "turnId" | "agentId">>;
  thinking: string;
  asker?: string;
  timer: ReturnType<typeof setTimeout> | null;
  last: number;
}

export function coalesceLive(
  out: (e: StreamEvent) => void,
  o: {
    now?: () => number;
    everyMs?: number;
    later?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  } = {},
): (e: StreamEvent) => void {
  const now = o.now ?? Date.now;
  const every = o.everyMs ?? LIVE_EVERY_MS;
  const later =
    o.later ??
    ((fn, ms) => {
      const t = setTimeout(fn, ms);
      if (typeof t === "object" && "unref" in t) t.unref();
      return t;
    });
  const turns = new Map<string, Waiting>();
  const send = (turnId: string, w: Waiting): void => {
    if (w.timer) {
      clearTimeout(w.timer);
      w.timer = null;
    }
    w.last = now();
    if (w.steps.length > 0) {
      // Everyone who reads the chat is told THAT work happened: the step's name, working or done, whether it went well. What a step touched (a file name, a path, a query, a line of output) goes only to the person
      // whose turn it is, in a frame of its own that the host sends to them alone; the rest get the same steps without it (F51).
      const plain = w.steps.map(({ detail: _d, name, ...rest }) => ({
        ...rest,
        ...(name ? { name: stepClass(name), words: stepWords(name) } : {}),
      }));
      const touched = w.steps.some((x) => x.detail !== undefined);
      if (touched && w.asker) {
        out({
          kind: "steps",
          threadId: w.threadId,
          turnId,
          agentId: w.agentId,
          steps: w.steps,
          asker: w.asker,
          audience: "asker",
        });
        out({
          kind: "steps",
          threadId: w.threadId,
          turnId,
          agentId: w.agentId,
          steps: plain,
          asker: w.asker,
          audience: "others",
        });
      } else out({ kind: "steps", threadId: w.threadId, turnId, agentId: w.agentId, steps: plain });
    }
    if (w.thinking !== "")
      out({
        kind: "thinking",
        threadId: w.threadId,
        turnId,
        agentId: w.agentId,
        text: w.thinking,
        ...(w.asker ? { asker: w.asker } : {}),
      });
    if (w.sub.length > 0 && w.asker)
      out({
        kind: "substeps",
        threadId: w.threadId,
        turnId,
        agentId: w.agentId,
        asker: w.asker,
        steps: w.sub as never,
      });
    w.sub = [];
    w.steps = [];
    w.thinking = "";
  };
  const askers = new Map<string, string>();
  return (e) => {
    if (e.kind === "start") {
      askers.set(e.turnId, e.asker);
      if (askers.size > 2_000) askers.delete(askers.keys().next().value as string);
    }
    if (e.kind === "step" || e.kind === "thinking") {
      const w = turns.get(e.turnId) ?? {
        threadId: e.threadId,
        agentId: e.agentId,
        steps: [],
        sub: [],
        thinking: "",
        ...(askers.get(e.turnId) ? { asker: askers.get(e.turnId) as string } : {}),
        timer: null,
        last: 0,
      };
      turns.set(e.turnId, w);
      if (e.kind === "thinking") {
        w.thinking += (e as Think).text;
        if ((e as Think).asker) w.asker = (e as Think).asker as string;
      } else {
        const { kind: _k, threadId: _t, turnId: _u, agentId: _a, result: _r, asker, ...step } = e as Step;
        // what a subagent is on is the asker's alone: its own frame, never mixed into the steps everyone who reads the chat gets
        if (step.parent) {
          w.sub.push(step);
          if (asker) w.asker = asker;
        } else w.steps.push(step);
      }
      const wait = every - (now() - w.last);
      if (wait <= 0) send(e.turnId, w);
      else
        w.timer ??= later(() => {
          const x = turns.get(e.turnId);
          if (x) send(e.turnId, x);
        }, wait);
      return;
    }
    const w = "turnId" in e ? turns.get(e.turnId) : undefined;
    if (w) send(e.turnId, w);
    if (e.kind === "final" && w) turns.delete(e.turnId);
    out(e);
  };
}
