// Screen hooks over the gateway: the same ScreenHooks a place reads from the replica (client createScreenHooks), answered by reading the capability on the Space's server.
// A LiveQuery shows `loading` until the first answer, then `ready` with the data; it keeps showing the last answer while it refreshes, and its snapshot changes only when the
// data does (useSyncExternalStore needs that). `invalidate()` re-reads every query someone is watching; queries nobody watches are marked stale and re-read when watched again.
// This stands in for the SQLite replica's per-capability readers until they land: a place never knows the difference, because the type is the same.
import type { LiveQuery, QueryState, ScreenHooks } from "../../../../../client/src/index.ts";
import type { ScreenIndexEntry } from "../../../../../generated/screens.ts";

/**
 * A screen query's input pointers against the screen state. `/state/k` is `state.k`; any other namespace a screen declares (`/route/k`, `/draft/k`, `/filter/k`, `/query/k`, `/scope/k`,
 * `/selected/k`, `/hit/k`) is `state[ns][k]`, which is how a place hands over its route and its drafts. A missing key is left out, not sent as undefined.
 */
export function resolvePointers(pointers: Record<string, string>, state: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, p] of Object.entries(pointers)) {
    const m = /^\/([a-z]+)\/(.+)$/.exec(p);
    if (!m) continue;
    const ns = m[1] ?? "", key = m[2] ?? "";
    const holder = ns === "state" ? state : state[ns];
    const v = holder !== null && typeof holder === "object" ? (holder as Record<string, unknown>)[key] : undefined;
    if (v !== undefined) out[k] = v;
  }
  return out;
}

export interface RemoteHooksOptions {
  screens: ReadonlyMap<string, ScreenIndexEntry>;
  /** Reads one capability as the signed-in person. */
  read(cap: string, input: Record<string, unknown>): Promise<unknown>;
  /** A read failed; the query keeps its last answer. */
  onError?(cap: string, error: unknown): void;
  /** A failure that is not the query's own (a 401: the session ended). The query keeps what it had and nobody is told, so nothing reacts to it. */
  ignoreError?(error: unknown): boolean;
}

export interface RemoteHooks extends ScreenHooks {
  /** A live query of one capability, for the shell's own lists (people, agents). */
  capQuery<T>(cap: string, input?: Record<string, unknown>): LiveQuery<T>;
  /** Re-read every query that is being watched. */
  invalidate(): void;
  /** Warm a screen query: read it now with nobody watching, so the first draw of the place finds the answer. */
  prefetch(screenId: string, name: string, state?: Record<string, unknown>): void;
  /** How many queries are being watched right now. */
  watching(): number;
  close(): void;
}

interface Entry {
  cap: string;
  input: Record<string, unknown>;
  listeners: Set<() => void>;
  snap: QueryState<unknown>;
  json: string;
  inflight: boolean;
  dirty: boolean;
  stale: boolean;
  live: LiveQuery<unknown>;
}

function failureOf(err: unknown): { message: string; code?: string; traceId?: string } {
  const o = (typeof err === "object" && err !== null ? err : {}) as { message?: unknown; code?: unknown; traceId?: unknown };
  return {
    message: typeof o.message === "string" && o.message !== "" ? o.message : "The read failed.",
    ...(typeof o.code === "string" ? { code: o.code } : {}),
    ...(typeof o.traceId === "string" && o.traceId !== "" ? { traceId: o.traceId } : {}),
  };
}

/** Key order does not change a query's identity. */
export function stableJson(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
  if (Array.isArray(v)) return `[${v.map(stableJson).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${stableJson(o[k])}`).join(",")}}`;
}

export function createRemoteScreenHooks(opts: RemoteHooksOptions): RemoteHooks {
  const entries = new Map<string, Entry>();
  let closed = false;

  const notify = (e: Entry): void => { for (const l of [...e.listeners]) l(); };

  const fetchEntry = (e: Entry): void => {
    if (closed) return;
    if (e.inflight) { e.dirty = true; return; }
    e.inflight = true;
    e.stale = false;
    const done = (): void => {
      e.inflight = false;
      if (e.dirty && !closed) { e.dirty = false; fetchEntry(e); }
    };
    opts.read(e.cap, e.input).then((data) => {
      const json = stableJson(data);
      if (e.snap.status !== "ready" || json !== e.json) {
        e.json = json;
        e.snap = { status: "ready", data };
        notify(e);
      }
      done();
    }, (err: unknown) => {
      opts.onError?.(e.cap, err);
      if (opts.ignoreError?.(err)) { done(); return; }
      // Never answered: say why (a `ready` query keeps its last answer). The next read, when something changes, replaces this.
      // The same failure again keeps the same snapshot: a re-read that fails the same way must not look like a change (an effect that reacts to the snapshot would call, refresh, fail and react again, for ever).
      if (e.snap.status !== "ready") {
        const f = failureOf(err);
        const was = e.snap.error;
        if (!was || was.message !== f.message || was.code !== f.code) { e.snap = { status: "loading", error: f }; notify(e); }
      }
      done();
    });
  };

  const entryFor = (cap: string, input: Record<string, unknown>): Entry => {
    const key = `${cap}\u0000${stableJson(input)}`;
    let e = entries.get(key);
    if (e) return e;
    const made: Entry = {
      cap, input, listeners: new Set(), snap: { status: "loading" }, json: "", inflight: false, dirty: false, stale: false,
      live: {
        subscribe(l) {
          made.listeners.add(l);
          if (made.snap.status === "loading" || made.stale) fetchEntry(made);
          return () => { made.listeners.delete(l); };
        },
        getSnapshot: () => made.snap,
      },
    };
    entries.set(key, made);
    e = made;
    return e;
  };

  return {
    query(screenId, name, state = {}) {
      const screen = opts.screens.get(screenId);
      if (!screen) throw new Error(`unknown screen ${screenId}`);
      const q = screen.queries[name];
      if (!q) throw new Error(`screen ${screenId} has no query ${name}`);
      if (!q.live) throw new Error(`query ${screenId}.${name} is not live`);
      return entryFor(q.cap, resolvePointers(q.input, state)).live;
    },
    capQuery<T>(cap: string, input: Record<string, unknown> = {}): LiveQuery<T> {
      return entryFor(cap, input).live as LiveQuery<T>;
    },
    invalidate() {
      for (const e of entries.values()) {
        if (e.listeners.size > 0) fetchEntry(e);
        else e.stale = true;
      }
    },
    prefetch(screenId, name, state = {}) {
      const screen = opts.screens.get(screenId);
      const q = screen?.queries[name];
      if (!q || !q.live) return;
      const e = entryFor(q.cap, resolvePointers(q.input, state));
      if (e.snap.status === "loading" && !e.inflight) fetchEntry(e);
    },
    watching() {
      let n = 0;
      for (const e of entries.values()) if (e.listeners.size > 0) n++;
      return n;
    },
    close() {
      closed = true;
      for (const e of entries.values()) e.listeners.clear();
      entries.clear();
    },
  };
}
