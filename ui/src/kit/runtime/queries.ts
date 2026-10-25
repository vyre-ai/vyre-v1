// Binds a screen's `queries` to the generated hooks. Live queries come from the replica (client ScreenHooks); a query marked
// `live: false` is a one-shot server read through env.read. One store per screen: one subscription, one stable snapshot.
import type { KitScreenDef } from "../types.ts";
import type { KitEnv } from "./env.ts";
import { resolveInputMap, isEmptyValue } from "./pointer.ts";

export type QuerySnapshot =
  | { status: "loading" }
  | { status: "ready"; data: unknown }
  | { status: "error"; error: string };

export type QuerySnapshots = Readonly<Record<string, QuerySnapshot>>;

export interface QuerySet {
  subscribe(listener: () => void): () => void;
  getSnapshot(): QuerySnapshots;
}

type Part = { subscribe(l: () => void): () => void; snapshot(): QuerySnapshot };

function sameSnapshot(a: QuerySnapshot, b: QuerySnapshot): boolean {
  if (a === b) return true;
  if (a.status !== b.status) return false;
  if (a.status === "ready" && b.status === "ready") return a.data === b.data;
  if (a.status === "error" && b.status === "error") return a.error === b.error;
  return true;
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function liveParts(def: KitScreenDef, env: KitEnv, state: Record<string, unknown>): Record<string, Part> {
  const parts: Record<string, Part> = {};
  for (const [name, q] of Object.entries(def.queries)) {
    if (q.live) {
      try {
        const live = env.hooks.query(def.id, name, state);
        parts[name] = {
          subscribe: (l) => live.subscribe(l),
          snapshot: () => {
            const s = live.getSnapshot();
            return s.status === "ready" ? { status: "ready", data: s.data } : { status: "loading" };
          },
        };
      } catch (e) {
        const error: QuerySnapshot = { status: "error", error: message(e) };
        parts[name] = { subscribe: () => () => {}, snapshot: () => error };
      }
      continue;
    }
    let snap: QuerySnapshot = env.read ? { status: "loading" } : { status: "error", error: "no server reads on this host" };
    let started = false;
    const listeners = new Set<() => void>();
    parts[name] = {
      subscribe(l) {
        listeners.add(l);
        if (!started && env.read && env.online) {
          started = true;
          const input = resolveInputMap(q.input, { queries: {}, state });
          env.read(q.cap, input).then(
            (data) => { snap = { status: "ready", data }; listeners.forEach((f) => f()); },
            (e: unknown) => { snap = { status: "error", error: message(e) }; listeners.forEach((f) => f()); },
          );
        }
        return () => { listeners.delete(l); };
      },
      snapshot: () => snap,
    };
  }
  return parts;
}

/** One store over every query a screen declares. The snapshot object changes only when a query's snapshot changes. */
export function createQuerySet(def: KitScreenDef, env: KitEnv, state: Record<string, unknown>): QuerySet {
  const parts = liveParts(def, env, state);
  const names = Object.keys(parts);
  let last: QuerySnapshots = {};
  let primed = false;
  return {
    subscribe(listener) {
      const offs = names.map((n) => parts[n]!.subscribe(listener));
      return () => offs.forEach((off) => off());
    },
    getSnapshot() {
      const next: Record<string, QuerySnapshot> = {};
      let changed = !primed;
      for (const n of names) {
        const s = parts[n]!.snapshot();
        next[n] = primed && sameSnapshot(last[n]!, s) ? last[n]! : s;
        if (next[n] !== last[n]) changed = true;
      }
      if (changed) { last = next; primed = true; }
      return last;
    },
  };
}

export type ScreenStatus = "loading" | "ready" | "empty" | "offline" | "error";

/**
 * The state a screen shows. Error wins; then offline (a server read cannot finish); then loading; then empty when the first
 * declared query came back with nothing; else ready. Local replica reads still work offline, so they never cause offline.
 */
export function deriveStatus(def: KitScreenDef, snaps: QuerySnapshots, online: boolean): ScreenStatus {
  const names = Object.keys(def.queries);
  if (names.some((n) => snaps[n]?.status === "error")) return "error";
  if (!online && names.some((n) => !def.queries[n]!.live && snaps[n]?.status !== "ready")) return "offline";
  if (names.some((n) => snaps[n]?.status !== "ready")) return "loading";
  if (names.length > 0) {
    const first = snaps[names[0]!]!;
    if (first.status === "ready" && isEmptyValue(listOf(first.data))) return "empty";
  }
  return "ready";
}

/** A query result that wraps its rows ({ items: [...] }) is empty when the rows are. */
function listOf(data: unknown): unknown {
  if (data && typeof data === "object" && !Array.isArray(data)) {
    const rows = (data as Record<string, unknown>).items;
    if (Array.isArray(rows)) return rows;
  }
  return data;
}

/** Plain data by query name for a layout scope. A query that has not arrived is undefined. */
export function queryData(snaps: QuerySnapshots): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [n, s] of Object.entries(snaps)) if (s.status === "ready") out[n] = s.data;
  return out;
}
