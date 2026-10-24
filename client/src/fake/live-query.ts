// Live query runtime. A LiveQuery has the shape React's useSyncExternalStore wants (subscribe + a stable getSnapshot), so the
// UI binding is one line per hook and no React import lives here. Snapshots are cached per replica version: no write, same object.
import type { CapMap } from "../../../generated/types.ts";
import type { ScreenIndexEntry } from "../../../generated/screens.ts";
import type { FakeReplica } from "./replica.ts";

export type QueryState<T> = { status: "loading" } | { status: "ready"; data: T };
export interface LiveQuery<T> { subscribe(listener: () => void): () => void; getSnapshot(): QueryState<T> }

/** A live query for one capability and input over a replica. */
export function liveQuery<C extends keyof CapMap>(replica: FakeReplica, cap: C, input: CapMap[C]["in"]): LiveQuery<CapMap[C]["out"]> {
  let at = -1, snap: QueryState<CapMap[C]["out"]> = { status: "loading" };
  return {
    subscribe: (l) => replica.subscribe(l),
    getSnapshot() {
      if (replica.version() === at) return snap;
      at = replica.version();
      const r = replica.run(cap, input);
      snap = r ? { status: "ready", data: r.data } : { status: "loading" };
      return snap;
    },
  };
}

/** Resolves a screen query's input pointers ("/state/query") against the screen state. A missing key is left out, not sent as undefined. */
export function resolveInput(pointers: Record<string, string>, state: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, p] of Object.entries(pointers)) {
    const m = /^\/state\/(.+)$/.exec(p);
    if (!m) continue;
    const v = state[m[1]!];
    if (v !== undefined) out[k] = v;
  }
  return out;
}

export type ScreenHooks = {
  /** The live query a screen declares in `queries` (generated/screens.ts). Throws on an unknown screen or query name. */
  query(screenId: string, name: string, state?: Record<string, unknown>): LiveQuery<unknown>;
};

/** Hooks over a replica for the generated screen index. Only queries marked `live` are served; others throw. */
export function createScreenHooks(replica: FakeReplica, screens: ReadonlyMap<string, ScreenIndexEntry>): ScreenHooks {
  return {
    query(screenId, name, state = {}) {
      const screen = screens.get(screenId);
      if (!screen) throw new Error(`unknown screen ${screenId}`);
      const q = screen.queries[name];
      if (!q) throw new Error(`screen ${screenId} has no query ${name}`);
      if (!q.live) throw new Error(`query ${screenId}.${name} is not live`);
      return liveQuery(replica, q.cap as keyof CapMap, resolveInput(q.input, state) as never);
    },
  };
}
