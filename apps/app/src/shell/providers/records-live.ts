// What Records and Files share when they are built over the Space's runtime: a live query of any capability (the session's screen hooks answer one: capQuery), and a name lookup from the
// Space's people. A runtime whose hooks cannot answer a capability query (a replica without per-capability readers) gives a query that stays loading, so a place draws its loading frame.
import type { LiveQuery, QueryState } from "../../../../../client/src/index.ts";
import type { Principal } from "../../places/home/sections-a/data.tsx";
import type { ShellRuntime } from "./runtime.tsx";

type CapQuery = <T>(cap: string, input?: Record<string, unknown>) => LiveQuery<T>;

const NEVER: LiveQuery<never> = { subscribe: () => () => undefined, getSnapshot: (): QueryState<never> => ({ status: "loading" }) };

/** A live query of a capability over the Space. Inputs are compared by value inside the hooks, so asking again for the same input gives the same query. */
export function capLive<T>(rt: ShellRuntime, cap: string, input: Record<string, unknown> = {}): LiveQuery<T> {
  const q = (rt.screens as { capQuery?: CapQuery }).capQuery;
  return q ? q.call(rt.screens, cap, input) as LiveQuery<T> : NEVER;
}

/** The name of a person, agent or group by id; the id itself when nobody is known by it. */
export function nameLookup(rt: ShellRuntime): (id: string) => string {
  return (id) => {
    if (id === rt.me.id) return rt.me.name;
    const s = rt.principals.getSnapshot();
    const p: Principal | undefined = s.status === "ready" ? s.data.find((x) => x.id === id) : undefined;
    return p ? p.name : id;
  };
}
