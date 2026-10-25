// Hover and focus prefetch (ARCH 9): `prefetch(screenId, args)` on pointer-enter after 50 ms and on keyboard focus warms the screen's live queries, so the open that follows reads
// answers that are already computed. `open` is what the screen calls when it mounts; it records whether the open was prefetched (probe nav.prefetch_hit) and how long the first read took.
import type { ScreenIndexEntry } from "../../../generated/screens.ts";
import type { Scheduler } from "../connection/scheduler.ts";
import { screenKey } from "./keys.ts";
import type { QueryClient } from "./client.ts";
import type { ListDef, QueryDef } from "./types.ts";

export const HOVER_DELAY_MS = 50;

export type Def = ({ kind: "query" } & QueryDef<never, unknown>) | ({ kind: "list" } & ListDef<never, unknown>);
export const asQuery = <I, O>(d: QueryDef<I, O>): Def => ({ kind: "query", ...(d as unknown as QueryDef<never, unknown>) });
export const asList = <I, R>(d: ListDef<I, R>): Def => ({ kind: "list", ...(d as unknown as ListDef<never, unknown>) });

export interface OpenResult { prefetched: boolean; firstPaintMs: number; served: number; skipped: string[] }
export interface PrefetchStats { opens: number; hits: number; hitRate: number }

export interface Prefetcher {
  /** Pointer entered a link or row for this screen. Starts the 50 ms timer. */
  hover(screenId: string, args?: Record<string, unknown>): void;
  /** Pointer left before the timer fired. */
  leave(screenId: string, args?: Record<string, unknown>): void;
  /** Keyboard focus: no delay. */
  focus(screenId: string, args?: Record<string, unknown>): void;
  /** The screen mounts: read its live queries, count whether they were prefetched. */
  open(screenId: string, args?: Record<string, unknown>): OpenResult;
  stats(): PrefetchStats;
}

/** "/state/q" pointers against the screen state; a missing key is left out. */
export function inputOf(pointers: Record<string, string>, state: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, p] of Object.entries(pointers)) {
    const m = /^\/state\/(.+)$/.exec(p);
    const v = m ? state[m[1] ?? ""] : undefined;
    if (v !== undefined) out[k] = v;
  }
  return out;
}

export function createPrefetcher(o: {
  client: QueryClient;
  screens: ReadonlyMap<string, ScreenIndexEntry>;
  defs: ReadonlyMap<string, Def>;
  scheduler: Scheduler;
  /** Called with the screen id when its component chunk should be fetched too. */
  chunk?: (screenId: string) => void;
  delayMs?: number;
  clock?: () => number;
}): Prefetcher {
  const delay = o.delayMs ?? HOVER_DELAY_MS;
  const clock = o.clock ?? (() => performance.now());
  const timers = new Map<string, () => void>();
  const warmed = new Set<string>();
  const counts = { opens: 0, hits: 0 };

  const run = (screenId: string, args: Record<string, unknown>, warm: boolean): { served: number; skipped: string[] } => {
    const screen = o.screens.get(screenId);
    if (!screen) throw new Error(`unknown screen ${screenId}`);
    let served = 0;
    const skipped: string[] = [];
    for (const [name, q] of Object.entries(screen.queries)) {
      const def = o.defs.get(q.cap);
      if (!q.live || !def) { skipped.push(name); continue; }
      const input = inputOf(q.input, args);
      if (def.kind === "query") {
        const d = def as unknown as QueryDef<unknown, unknown>;
        if (warm) o.client.prefetch(d, input); else o.client.query(d, input).getSnapshot();
      } else {
        const d = def as unknown as ListDef<unknown, unknown>;
        if (warm) o.client.prefetchList(d, input); else { const s = o.client.list(d, input).getSnapshot(); if (s.status === "ready") s.data.rows(0, 50); }
      }
      served++;
    }
    return { served, skipped };
  };

  const keyOf = (screenId: string, args: Record<string, unknown>): string => screenKey(o.client.spaceId, screenId, args);

  const warm = (screenId: string, args: Record<string, unknown>): void => {
    run(screenId, args, true);
    o.chunk?.(screenId);
    warmed.add(keyOf(screenId, args));
  };

  return {
    hover(screenId, args = {}) {
      const k = keyOf(screenId, args);
      if (timers.has(k) || warmed.has(k)) return;
      timers.set(k, o.scheduler.after(delay, () => { timers.delete(k); warm(screenId, args); }));
    },
    leave(screenId, args = {}) {
      const k = keyOf(screenId, args);
      timers.get(k)?.();
      timers.delete(k);
    },
    focus(screenId, args = {}) {
      const k = keyOf(screenId, args);
      timers.get(k)?.();
      timers.delete(k);
      warm(screenId, args);
    },
    open(screenId, args = {}) {
      const t0 = clock();
      const hit = warmed.has(keyOf(screenId, args));
      const r = run(screenId, args, false);
      counts.opens++;
      if (hit) counts.hits++;
      return { prefetched: hit, firstPaintMs: clock() - t0, ...r };
    },
    stats: () => ({ ...counts, hitRate: counts.opens === 0 ? 0 : counts.hits / counts.opens }),
  };
}
