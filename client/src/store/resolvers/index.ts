// Replica-first screen hooks (ARCH 9, spec 603-604). ScreenHooks answer from the local SQLite copy first: a read capability that has a resolver here is run against the replica through the
// query layer, so a place paints with no network, works offline and updates when a pull changes the rows it read. A capability with no local projection, and an input the replica cannot
// answer (a MISS), go to the fallback hooks, which are the gateway-backed ones. The result has the ScreenHooks shape, so the shell swaps one for the other with no place changing.
import type { ScreenIndexEntry } from "../../../../generated/screens.ts";
import { resolveInput } from "../../fake/live-query.ts";
import type { LiveQuery, QueryState, ScreenHooks } from "../../fake/live-query.ts";
import { createQueryClient } from "../../query/index.ts";
import type { QueryClient, QueryDef } from "../../query/index.ts";
import type { SpaceStore } from "../space.ts";
import { notificationsList } from "./notifications.ts";
import { listCalendars, listEvents } from "./calendar.ts";
import { messagesList, threadsGet, threadsList } from "./chat.ts";
import { starsList } from "./stars.ts";
import { MISS } from "./types.ts";
import type { Resolver, ResolverCtx } from "./types.ts";

export { MISS } from "./types.ts";
export type { Resolver, ResolverCtx } from "./types.ts";

/** Every read capability the replica can answer today. The rest stay on the gateway (chat.recent needs server-side unread state, for one). */
export const RESOLVERS: readonly Resolver[] = [threadsGet, threadsList, messagesList, starsList, listCalendars, listEvents, notificationsList];

type Hit = { hit: false } | { hit: true; data: unknown };

/** The local answer while it has one, the fallback's while it does not. One stable snapshot per state, so useSyncExternalStore does not loop. */
function replicaFirst(local: LiveQuery<Hit>, fallback: () => LiveQuery<unknown>): LiveQuery<unknown> {
  let remote: LiveQuery<unknown> | null = null;
  const far = (): LiveQuery<unknown> => (remote ??= fallback());
  let seen: QueryState<Hit> | null = null;
  let shown: QueryState<unknown> = { status: "loading" };
  const hitOf = (s: QueryState<Hit>): boolean => s.status === "ready" && s.data.hit;
  return {
    subscribe(listener) {
      let offFar: (() => void) | null = null;
      const sync = (): void => {
        const wantFar = !hitOf(local.getSnapshot());
        if (wantFar && !offFar) offFar = far().subscribe(listener);
        if (!wantFar && offFar) { offFar(); offFar = null; }
      };
      const offLocal = local.subscribe(() => { sync(); listener(); });
      sync();
      return () => { offLocal(); offFar?.(); offFar = null; };
    },
    getSnapshot() {
      const s = local.getSnapshot();
      if (!hitOf(s)) return far().getSnapshot();
      if (s !== seen) { seen = s; shown = { status: "ready", data: (s as { data: { data: unknown } }).data.data }; }
      return shown;
    },
  };
}

export interface ReplicaHooksOptions {
  store: SpaceStore;
  screens: ReadonlyMap<string, ScreenIndexEntry>;
  ctx: ResolverCtx;
  /** The gateway-backed hooks: asked for capabilities with no resolver and for inputs the replica cannot answer. */
  fallback: ScreenHooks;
  resolvers?: readonly Resolver[];
  /** An existing query client for this Space (so prefetch and the hooks share entries). Default: a new one on `store`. */
  client?: QueryClient;
}

export function createReplicaHooks(o: ReplicaHooksOptions): ScreenHooks & { client: QueryClient; local(cap: string): boolean } {
  const client = o.client ?? createQueryClient(o.store);
  const byCap = new Map((o.resolvers ?? RESOLVERS).map((r) => [r.cap, r]));
  return {
    client,
    local: (cap) => byCap.has(cap),
    query(screenId, name, state = {}) {
      const screen = o.screens.get(screenId);
      const q = screen?.queries[name];
      const r = q ? byCap.get(q.cap) : undefined;
      if (!screen || !q || !q.live || !r) return o.fallback.query(screenId, name, state);
      const input = resolveInput(q.input, state);
      const def: QueryDef<Record<string, unknown>, Hit> = {
        cap: r.cap, entities: r.entities,
        run: (db, i) => { const v = (r as Resolver<Record<string, unknown>>).run(db, i, o.ctx); return v === MISS ? { hit: false } : { hit: true, data: v }; },
        ...(r.affects ? { affects: (c, i) => (r as Resolver<Record<string, unknown>>).affects!(c, i) } : {}),
      };
      return replicaFirst(client.query(def, input), () => o.fallback.query(screenId, name, state));
    },
  };
}
