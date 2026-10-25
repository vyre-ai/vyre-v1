// Per-screen performance probes (ARCH 9, perf harness). Each KitScreenDef.perf yields User Timing measures named from the
// generated probe id: `screen.<id>.first-paint` (start to the first committed frame) and `screen.<id>` (start to the
// screen's terminal state: ready, empty, offline or error). The browser probe reads these with performance.getEntriesByName.
import type { KitScreenDef } from "../types.ts";

export interface TimingApi {
  now(): number;
  measure(name: string, options: { start: number; end: number }): unknown;
}

export interface ProbeResult {
  id: string;
  firstPaintMs: number | null;
  completeMs: number | null;
  withinBudget: boolean | null;
}

/** The generated probe id for a screen (generated/probes.json: `screen.<id>`). */
export function probeId(screenId: string): string {
  return `screen.${screenId}`;
}

function defaultTiming(): TimingApi | null {
  const p = (globalThis as { performance?: Partial<TimingApi> }).performance;
  return p && typeof p.now === "function" && typeof p.measure === "function" ? (p as TimingApi) : null;
}

export interface ScreenProbe {
  readonly id: string;
  /** Call once, after the first committed frame. */
  firstPaint(): void;
  /** Call once, when the screen reaches a terminal state. */
  complete(): void;
  result(): ProbeResult;
}

/** Starts timing a screen. A def without `perf` yields a probe that measures nothing. */
export function startProbe(def: Pick<KitScreenDef, "id" | "perf">, timing: TimingApi | null = defaultTiming()): ScreenProbe {
  const id = probeId(def.id);
  const active = Boolean(def.perf) && timing !== null;
  const start = active ? timing!.now() : 0;
  let first: number | null = null;
  let done: number | null = null;
  return {
    id,
    firstPaint() {
      if (!active || first !== null) return;
      const end = timing!.now();
      first = end - start;
      timing!.measure(`${id}.first-paint`, { start, end });
    },
    complete() {
      if (!active || done !== null) return;
      const end = timing!.now();
      done = end - start;
      timing!.measure(id, { start, end });
    },
    result() {
      const budget = def.perf;
      const within = budget && first !== null && done !== null ? first <= budget.firstPaintMs && done <= budget.completeMs : null;
      return { id, firstPaintMs: first, completeMs: done, withinBudget: within };
    },
  };
}
