// The one data hook (contract P3). A live query becomes a Load: loading, failed (with the reason and Retry) or ready. The client keeps a read that never answered in `loading` with its reason in
// `error`; this is the one place that turns that into `failed`, so no screen can leave a failed read looking like a wait.
//   soft          a read the screen can do without: it never fails (a failed one is ready with null), so no error card appears where a missing extra was harmless
//   keepPrevious  while the next answer for a changed input is on its way, the last answer stays (a search box and its rows do not vanish with each key)
//   enabled       false: nothing is asked and the read stays loading
import { useMemo, useRef, useSyncExternalStore } from "react";
import type { LiveQuery, QueryState } from "../../../../client/src/index.ts";
import { retryLoads } from "../../../../ui/src/States/Loads.tsx";
import type { Load } from "../../../../ui/src/States/Loadable.tsx";
import { useScreens } from "./screens.tsx";

export type LoadSource =
  | { screen: readonly [id: string, name: string, state?: Record<string, unknown>] }
  | { cap: string; input?: Record<string, unknown> };
export interface LoadOptions {
  enabled?: boolean;
  keepPrevious?: boolean;
  soft?: boolean;
}

const LOADING: QueryState<never> = { status: "loading" };
const IDLE: LiveQuery<never> = { subscribe: () => () => undefined, getSnapshot: () => LOADING };
const WAITING: Load<never> = { state: "loading" };

export function useLoad<T>(src: LoadSource, o: LoadOptions & { soft: true }): Load<T | null>;
export function useLoad<T>(src: LoadSource, o?: LoadOptions): Load<T>;
export function useLoad<T>(src: LoadSource, o: LoadOptions = {}): Load<T | null> {
  const screens = useScreens();
  const enabled = o.enabled !== false;
  const key = JSON.stringify(src);
  const query = useMemo((): LiveQuery<T> => {
    if (!enabled) return IDLE;
    const s = JSON.parse(key) as LoadSource;
    if ("screen" in s) return screens.query(s.screen[0], s.screen[1], s.screen[2] ?? {}) as LiveQuery<T>;
    const capQuery = (screens as { capQuery?: <U>(cap: string, input?: Record<string, unknown>) => LiveQuery<U> })
      .capQuery;
    // hooks that cannot answer a capability (a replica without per-capability readers) stay loading, as the Console's reads always did
    return capQuery ? (capQuery.call(screens, s.cap, s.input ?? {}) as LiveQuery<T>) : IDLE;
  }, [screens, key, enabled]);
  const snap = useSyncExternalStore(query.subscribe, query.getSnapshot, query.getSnapshot);
  const held = useRef<{ data: T } | null>(null);
  if (snap.status === "ready") held.current = { data: snap.data };
  const soft = o.soft === true;
  const keep = o.keepPrevious === true;
  // one object per answer, so a screen can use it as a dependency
  return useMemo((): Load<T | null> => {
    if (!enabled) return WAITING;
    if (snap.status === "ready") return { state: "ready", data: snap.data };
    if (snap.error !== undefined)
      return soft ? { state: "ready", data: null } : { state: "failed", failure: snap.error, retry: retryLoads };
    if (keep && held.current) return { state: "ready", data: held.current.data };
    return WAITING;
  }, [snap, enabled, soft, keep]);
}
