// What Records and Files share when they are built over the Space's runtime: a live query of any capability (the session's screen hooks answer one: capQuery), and a name lookup from the
// Space's people. A runtime whose hooks cannot answer a capability query (a replica without per-capability readers) gives a query that stays loading, so a place draws its loading frame.
import type { LiveQuery, QueryState } from "../../../../../client/src/index.ts";
import type { Principal } from "../session/runtime-data.ts";
import { unnamed } from "../../places/chats/names.ts";
import type { ShellRuntime } from "./runtime.tsx";

type CapQuery = <T>(cap: string, input?: Record<string, unknown>) => LiveQuery<T>;

// one snapshot object for good: a store that answers a new object on every read makes React loop ("getSnapshot should be cached")
const LOADING: QueryState<never> = { status: "loading" };
const NEVER: LiveQuery<never> = { subscribe: () => () => undefined, getSnapshot: (): QueryState<never> => LOADING };

/** A live query of a capability over the Space. Inputs are compared by value inside the hooks, so asking again for the same input gives the same query. */
export function capLive<T>(rt: ShellRuntime, cap: string, input: Record<string, unknown> = {}): LiveQuery<T> {
  const q = (rt.screens as { capQuery?: CapQuery }).capQuery;
  return q ? q.call(rt.screens, cap, input) as LiveQuery<T> : NEVER;
}

/** What a name reads while the directory has not answered (or failed to): not "Someone", which would say the person is unknown. */
export const NAME_LOADING = "\u2026";

/**
 * The name of a person, agent or group by id. While the directory has not loaded (or failed) it is NAME_LOADING, never a word that claims the person is unknown; once it has loaded, one it does not
 * hold is a plain word ("Someone", "An agent"). The id itself is never the answer.
 */
export function nameLookup(rt: ShellRuntime): (id: string) => string {
  return (id) => {
    if (id === rt.me.id) return rt.me.name;
    const s = rt.principals.getSnapshot();
    if (s.status !== "ready") return NAME_LOADING;
    const p: Principal | undefined = s.data.find((x) => x.id === id);
    // never a raw id: a service (svc_host) is Vyre, and anyone not known is a plain word
    return p ? p.name : unnamed(id);
  };
}
