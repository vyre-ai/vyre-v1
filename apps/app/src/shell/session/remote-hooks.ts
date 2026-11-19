// Screen hooks over the gateway: the same ScreenHooks a place reads from the replica (client createScreenHooks), answered by reading the capability on the Space's server.
// A LiveQuery shows `loading` until the first answer, then `ready` with the data; it keeps showing the last answer while it refreshes, and its snapshot changes only when the
// data does (useSyncExternalStore needs that). `invalidate()` re-reads every query someone is watching; queries nobody watches are marked stale and re-read when watched again.
// This stands in for the SQLite replica's per-capability readers until they land: a place never knows the difference, because the type is the same.
import type { LiveQuery, QueryState, ScreenHooks } from "../../../../../client/src/index.ts";
import type { ScreenIndexEntry } from "../../../../../generated/screens.ts";
import { resolveInput as resolvePointers } from "../../../../../client/src/fake/live-query.ts";
export { resolvePointers };
import { stableJson } from "./stable-json.ts";
export { stableJson };

/**
 * A screen query's input pointers against the screen state. `/state/k` is `state.k`; any other namespace a screen declares (`/route/k`, `/draft/k`, `/filter/k`, `/query/k`, `/scope/k`,
 * `/selected/k`, `/hit/k`) is `state[ns][k]`, which is how a place hands over its route and its drafts. A missing key is left out, not sent as undefined.
 */

export interface RemoteHooksOptions {
  screens: ReadonlyMap<string, ScreenIndexEntry>;
  /** Reads one capability as the signed-in person. */
  read(cap: string, input: Record<string, unknown>): Promise<unknown>;
  /** A read failed; the query keeps its last answer. */
  onError?(cap: string, error: unknown): void;
  /** A failure that is not the query's own (a 401: the session ended). The query keeps what it had and nobody is told, so nothing reacts to it. */
  ignoreError?(error: unknown): boolean;
  /**
   * The least time between two re-reads of one capability that a change in the Space asks for (by capability name). A change that arrives sooner is held and read once, when the time is up: a busy Space
   * costs one read per capability per period, however many changes it makes. The first read and an action of the person's own (`invalidate({ now: true })`) are never held. Absent: every change re-reads (what each query did before).
   */
  quietMs?: Readonly<Record<string, number>>;
  /** The clock, for tests. */
  now?: () => number;
  /**
   * What this device kept of the Space's answers (session/kept.ts). A read that was kept starts `ready` with the kept answer and is read again the moment something watches it: the screen draws at once
   * and changes in place. Each answer from the server is handed back to be kept; one the server refuses is dropped and shown as the failure it is.
   */
  kept?: {
    read(cap: string, input: Record<string, unknown>): { data: unknown } | undefined;
    wrote(cap: string, input: Record<string, unknown>, data: unknown, size: number): void;
    drop(cap: string, input: Record<string, unknown>): void;
  };
  /** Did the server answer and refuse (as opposed to not being reached)? A kept answer the server refuses goes; one it could not be asked about stays, marked as not refreshed. */
  refused?(error: unknown): boolean;
  /** The most reads warmed ahead of a press that may be on their way at once; the rest wait in a short line (default 4, and 12 waiting). */
  warmAtOnce?: number;
  /** A warmed answer newer than this is not asked for again (default 15 s). */
  warmFreshMs?: number;
}

export interface RemoteHooks extends ScreenHooks {
  /** A live query of one capability, for the shell's own lists (people, agents). */
  capQuery<T>(cap: string, input?: Record<string, unknown>): LiveQuery<T>;
  /** Used only by useChange (apps/app/src/load), which tests it. Show a changed answer for a watched read at once (an optimistic change); each patch can be taken back alone and the answer is always the last real one with the rest applied. Answers how to undo it; the next real answer replaces the patch either way. A read nobody has answered is left alone. */
  patch(cap: string, input: Record<string, unknown>, apply: (data: unknown) => unknown): () => void;
  /** Re-read every query that is being watched. `now` is the person's own action (a retry, a pin, a rename): it is read at once, never held for the quiet time. */
  invalidate(o?: { now?: boolean }): void;
  /** Hear each invalidate: what a card that reads by capability follows, on the same tick as the queries. */
  onInvalidate(listener: () => void): () => void;
  /** Warm a screen query: read it now with nobody watching, so the first draw of the place finds the answer. */
  prefetch(screenId: string, name: string, state?: Record<string, unknown>): void;
  /** The last answer held for a read, without reading: this session's own, else what the device kept. Undefined when there is none. */
  peek(cap: string, input?: Record<string, unknown>): unknown;
  /** Warm one capability read the same way. */
  prefetchCap(cap: string, input?: Record<string, unknown>): void;
  /**
   * Which part of the app is on screen (a place): every read watched from now on is remembered as one of that part's reads. `warmScope` reads again, with nobody watching, the ones of a part that
   * have gone stale: what pointing at a place in the rail does, so the place opens on answers that are already new.
   */
  scope(name: string | null): void;
  warmScope(name: string): void;
  /**
   * A thing of `kind` with this id is being opened: the reads first made in the next moments that name the id are remembered as what opening such a thing reads. `warmLike` makes those reads for
   * another id of the same kind, with nobody watching: what resting the pointer on a row does.
   */
  learn(kind: string, id: string): void;
  warmLike(kind: string, id: string): void;
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
  /** Optimistic changes shown over `base`, the last real answer: each can be taken back alone, and the answer is always base with the rest applied. */
  /** The failure of the last re-read of an answered query, kept beside the answer (never in it: the snapshot stays the same object). */
  staleFail: { message: string; code?: string; traceId?: string } | null;
  staleListeners: Set<() => void>;
  patches: { apply: (data: unknown) => unknown }[];
  base: { snap: QueryState<unknown>; json: string } | null;
  live: LiveQuery<unknown>;
  /** When the last read began, and the wait for the one a change asked for inside the quiet time. */
  lastAt: number;
  held: ReturnType<typeof setTimeout> | null;
  /** The answer on show came from this device's kept copy and the server has not confirmed it yet. */
  kept: boolean;
  /** When the server last answered. */
  answeredAt: number;
}

function failureOf(err: unknown): { message: string; code?: string; traceId?: string } {
  const o = (typeof err === "object" && err !== null ? err : {}) as {
    message?: unknown;
    code?: unknown;
    traceId?: unknown;
  };
  return {
    message: typeof o.message === "string" && o.message !== "" ? o.message : "The read failed.",
    ...(typeof o.code === "string" ? { code: o.code } : {}),
    ...(typeof o.traceId === "string" && o.traceId !== "" ? { traceId: o.traceId } : {}),
  };
}

export function createRemoteScreenHooks(opts: RemoteHooksOptions): RemoteHooks {
  const entries = new Map<string, Entry>();
  const followers = new Set<() => void>();
  let closed = false;
  const now = opts.now ?? Date.now;

  const notify = (e: Entry): void => {
    for (const l of [...e.listeners]) l();
  };

  const fetchEntry = (e: Entry): void => {
    if (closed) return;
    if (e.inflight) {
      e.dirty = true;
      return;
    }
    e.inflight = true;
    e.lastAt = now();
    e.stale = false;
    const done = (): void => {
      e.inflight = false;
      if (e.dirty && !closed) {
        e.dirty = false;
        fetchEntry(e);
      }
    };
    opts.read(e.cap, e.input).then(
      (data) => {
        const json = stableJson(data);
        e.kept = false;
        e.answeredAt = now();
        if (!closed) opts.kept?.wrote(e.cap, e.input, data, json.length);
        // a real answer ends every optimistic change
        const had = e.patches.length > 0;
        e.patches.length = 0;
        e.base = null;
        if (e.staleFail !== null) {
          e.staleFail = null;
          for (const l of [...e.staleListeners]) l();
        }
        if (e.snap.status !== "ready" || json !== e.json || had) {
          e.json = json;
          e.snap = { status: "ready", data };
          notify(e);
        }
        done();
      },
      (err: unknown) => {
        opts.onError?.(e.cap, err);
        if (opts.ignoreError?.(err)) {
          done();
          return;
        }
        // An answer this device kept from an earlier launch, and the server now refuses the read (access was taken away, the thing is gone): the kept answer is not shown a moment longer.
        if (e.kept && e.snap.status === "ready" && opts.refused?.(err) === true) {
          e.kept = false;
          opts.kept?.drop(e.cap, e.input);
          e.json = "";
          e.snap = { status: "loading", error: failureOf(err) };
          notify(e);
          done();
          return;
        }
        // Never answered: say why (a `ready` query keeps its last answer). The next read, when something changes, replaces this.
        // The same failure again keeps the same snapshot: a re-read that fails the same way must not look like a change (an effect that reacts to the snapshot would call, refresh, fail and react again, for ever).
        if (e.snap.status === "ready") {
          // the answer stays exactly as it is; one note beside it says the last re-read failed
          const f = failureOf(err);
          if (e.staleFail?.message !== f.message || e.staleFail?.code !== f.code) {
            e.staleFail = f;
            for (const l of [...e.staleListeners]) l();
          }
        }
        if (e.snap.status !== "ready") {
          const f = failureOf(err);
          const was = e.snap.error;
          if (!was || was.message !== f.message || was.code !== f.code) {
            e.snap = { status: "loading", error: f };
            notify(e);
          }
        }
        done();
      },
    );
  };

  const entryFor = (cap: string, input: Record<string, unknown>): Entry => {
    const inputJson = stableJson(input);
    const key = `${cap}\u0000${inputJson}`;
    let e = entries.get(key);
    if (e) return e;
    noteMade(cap, inputJson);
    // what this device kept of this read: shown at once, and read again as soon as something watches it (`stale`)
    const was = opts.kept?.read(cap, input);
    const made: Entry = {
      cap,
      input,
      listeners: new Set(),
      snap: was ? { status: "ready", data: was.data } : { status: "loading" },
      json: was ? stableJson(was.data) : "",
      inflight: false,
      dirty: false,
      stale: was !== undefined,
      kept: was !== undefined,
      answeredAt: -Infinity,
      staleFail: null,
      staleListeners: new Set(),
      patches: [],
      base: null,
      lastAt: -Infinity,
      held: null,
      live: {
        subscribe(l) {
          made.listeners.add(l);
          noteWatched(made);
          if (made.snap.status === "loading" || made.stale) fetchEntry(made);
          return () => {
            made.listeners.delete(l);
          };
        },
        getSnapshot: () => made.snap,
        // the side channel: `useLoad` reads it to say "Couldn't refresh" without the snapshot above ever changing
        stale: {
          subscribe(l: () => void) {
            made.staleListeners.add(l);
            return () => {
              made.staleListeners.delete(l);
            };
          },
          getSnapshot: () => made.staleFail,
        },
      } as LiveQuery<unknown>,
    };
    entries.set(key, made);
    e = made;
    return e;
  };

  // What each part of the app (a place) watches, newest last, so pointing at the place can bring those answers up to date before it opens.
  const SCOPE_MAX = 24;
  const scopes = new Map<string, Set<Entry>>();
  let scopeNow: string | null = null;
  const noteWatched = (e: Entry): void => {
    if (scopeNow === null) return;
    let set = scopes.get(scopeNow);
    if (!set) scopes.set(scopeNow, (set = new Set()));
    set.delete(e);
    set.add(e);
    if (set.size > SCOPE_MAX) set.delete(set.values().next().value as Entry);
  };
  // What opening a thing of a kind reads, learnt from the last one opened: each read with the thing's id replaced by a mark. A few per kind.
  const LEARN_MS = 2_500;
  const LEARN_MAX = 8;
  const ID_MARK = "\u0001id\u0001";
  const learned = new Map<string, { cap: string; input: string }[]>();
  let learning: { kind: string; id: string; until: number } | null = null;
  const noteMade = (cap: string, inputJson: string): void => {
    if (learning === null || now() > learning.until) return;
    const needle = JSON.stringify(learning.id).slice(1, -1);
    if (needle === "" || !inputJson.includes(`"${needle}"`)) return;
    const input = inputJson.split(`"${needle}"`).join(`"${ID_MARK}"`);
    const list = learned.get(learning.kind) ?? [];
    if (list.some((t) => t.cap === cap && t.input === input)) return;
    list.push({ cap, input });
    if (list.length > LEARN_MAX) list.shift();
    learned.set(learning.kind, list);
  };
  /** Nothing of the Vault, of keys or of sign-in is ever read ahead of the person asking for it. */
  const mayWarm = (cap: string): boolean =>
    !/^(vault|vault_requests|identity|providers|devices|members|console|oauth)\./.test(cap);

  // Reads warmed ahead of a press (a pointer resting on a row, a place being focused) never flood the Space: a few at once, a short line behind them (the newest wish wins a full line),
  // and nothing that is already watched, on its way, or was answered a moment ago.
  const warmAtOnce = opts.warmAtOnce ?? 4;
  const warmFreshMs = opts.warmFreshMs ?? 15_000;
  const WARM_LINE = 12;
  const warmLine: Entry[] = [];
  let warming = 0;
  const pump = (): void => {
    while (!closed && warming < warmAtOnce && warmLine.length > 0) {
      const e = warmLine.shift()!;
      if (e.inflight || e.listeners.size > 0 || now() - e.answeredAt < warmFreshMs) continue;
      warming += 1;
      e.inflight = true;
      e.lastAt = now();
      e.stale = false;
      const end = (): void => {
        e.inflight = false;
        warming -= 1;
        if (e.dirty && !closed) {
          e.dirty = false;
          fetchEntry(e);
        }
        pump();
      };
      opts.read(e.cap, e.input).then(
        (data) => {
          const json = stableJson(data);
          e.kept = false;
          e.answeredAt = now();
          if (!closed) opts.kept?.wrote(e.cap, e.input, data, json.length);
          if (e.patches.length === 0 && (e.snap.status !== "ready" || json !== e.json)) {
            e.json = json;
            e.snap = { status: "ready", data };
            notify(e);
          }
          end();
        },
        (err: unknown) => {
          // a warm-up that fails says nothing: the page asks again itself when it is opened, and reports what it finds
          if (e.snap.status === "ready") e.stale = true;
          if (e.kept && opts.refused?.(err) === true) {
            e.kept = false;
            opts.kept?.drop(e.cap, e.input);
            e.json = "";
            e.snap = { status: "loading" };
            notify(e);
          }
          end();
        },
      );
    }
  };
  const warm = (e: Entry): void => {
    if (closed || e.inflight || e.listeners.size > 0) return;
    // an answer nothing has changed since is as good as a new one (a change in the Space marks every unwatched read stale); one that is stale but a moment old is not asked for again yet
    if (e.snap.status === "ready" && (!e.stale || now() - e.answeredAt < warmFreshMs)) return;
    const at = warmLine.indexOf(e);
    if (at >= 0) warmLine.splice(at, 1);
    warmLine.push(e);
    if (warmLine.length > WARM_LINE) warmLine.shift();
    pump();
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
    patch(cap, input, apply) {
      const e = entries.get(`${cap}\u0000${stableJson(input)}`);
      if (!e || e.snap.status !== "ready") return () => undefined;
      const show = (): void => {
        if (e.base === null || e.base.snap.status !== "ready") return;
        // never equal to a real answer, so the next one always replaces what is shown
        if (e.patches.length === 0) {
          e.snap = e.base.snap;
          e.json = e.base.json;
          e.base = null;
        } else {
          e.snap = { status: "ready", data: e.patches.reduce((d, p) => p.apply(d), e.base.snap.data) };
          e.json = "\u0000patched";
        }
        notify(e);
      };
      if (e.patches.length === 0) e.base = { snap: e.snap, json: e.json };
      const mine = { apply };
      e.patches.push(mine);
      show();
      return () => {
        const at = e.patches.indexOf(mine);
        if (at < 0) return;
        e.patches.splice(at, 1);
        show();
      };
    },
    invalidate(o) {
      for (const e of entries.values()) {
        if (e.listeners.size === 0) {
          e.stale = true;
          continue;
        }
        const wait = (opts.quietMs?.[e.cap] ?? 0) - (now() - e.lastAt);
        if (wait > 0 && o?.now !== true) {
          // inside the quiet time: one read when it is up, whatever number of changes came meanwhile
          if (e.held === null)
            e.held = setTimeout(() => {
              e.held = null;
              if (closed) return;
              if (e.listeners.size > 0) fetchEntry(e);
              else e.stale = true;
            }, wait);
          continue;
        }
        if (e.held !== null) {
          clearTimeout(e.held);
          e.held = null;
        }
        fetchEntry(e);
      }
      for (const l of [...followers]) l();
    },
    onInvalidate(listener) {
      followers.add(listener);
      return () => {
        followers.delete(listener);
      };
    },
    prefetch(screenId, name, state = {}) {
      const screen = opts.screens.get(screenId);
      const q = screen?.queries[name];
      if (!q || !q.live) return;
      warm(entryFor(q.cap, resolvePointers(q.input, state)));
    },
    peek(cap, input = {}) {
      const e = entries.get(`${cap}\u0000${stableJson(input)}`);
      if (e && e.snap.status === "ready") return e.snap.data;
      return opts.kept?.read(cap, input)?.data;
    },
    prefetchCap(cap, input = {}) {
      if (mayWarm(cap)) warm(entryFor(cap, input));
    },
    scope(name) {
      scopeNow = name;
    },
    warmScope(name) {
      for (const e of scopes.get(name) ?? []) if (mayWarm(e.cap)) warm(e);
    },
    learn(kind, id) {
      if (id === "") return;
      learning = { kind, id, until: now() + LEARN_MS };
    },
    warmLike(kind, id) {
      if (id === "") return;
      for (const t of learned.get(kind) ?? []) {
        if (!mayWarm(t.cap)) continue;
        let input: Record<string, unknown>;
        try {
          input = JSON.parse(t.input.split(ID_MARK).join(JSON.stringify(id).slice(1, -1))) as Record<string, unknown>;
        } catch {
          continue;
        }
        warm(entryFor(t.cap, input));
      }
    },
    watching() {
      let n = 0;
      for (const e of entries.values()) if (e.listeners.size > 0) n++;
      return n;
    },
    close() {
      closed = true;
      followers.clear();
      for (const e of entries.values()) {
        e.listeners.clear();
        if (e.held !== null) clearTimeout(e.held);
      }
      entries.clear();
    },
  };
}
