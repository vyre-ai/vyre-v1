// The query client of one Space (ARCH 9). One subscription to the Space's change feed serves every query and list; a change marks only the entries that read the changed entity,
// and an entry with no listener is recomputed lazily on its next read. Lists keep a window cache and patch one row per change instead of re-running the whole query.
import type { Change, SpaceStore } from "../store/index.ts";
import { queryKey } from "./keys.ts";
import type { ListDef, ListWindow, LiveQuery, QueryDef, QueryState } from "./types.ts";

interface Entry {
  key: string;
  listeners: Set<() => void>;
  /** Called with a batch; returns true when listeners should be told. */
  handle(batch: readonly Change[]): boolean;
  used: number;
}

export interface QueryStats { runs: number; listRowReads: number; listRebuilds: number; notifications: number; entries: number; feedListeners: number }

export interface QueryClient {
  readonly spaceId: string;
  query<I, O>(def: QueryDef<I, O>, input: I): LiveQuery<O>;
  list<I, R>(def: ListDef<I, R>, input: I): LiveQuery<ListWindow<R>>;
  /** Run a query now and keep the answer, so the next read is free. Returns true when it ran. */
  prefetch<I, O>(def: QueryDef<I, O>, input: I): boolean;
  prefetchList<I, R>(def: ListDef<I, R>, input: I, count?: number): boolean;
  has(cap: string, input: unknown): boolean;
  stats(): QueryStats;
  close(): void;
}

export function createQueryClient(store: SpaceStore, o: { maxEntries?: number; windowRows?: number } = {}): QueryClient {
  const entries = new Map<string, Entry>();
  const maxEntries = o.maxEntries ?? 500;
  const keep = o.windowRows ?? 2000;
  const stats = { runs: 0, listRowReads: 0, listRebuilds: 0, notifications: 0 };
  let tick = 0;
  let off: (() => void) | null = null;
  let closed = false;

  const ensureFeed = (): void => {
    if (off || closed) return;
    off = store.changes.subscribe((batch) => {
      for (const e of [...entries.values()]) {
        if (e.handle(batch) && e.listeners.size > 0) {
          stats.notifications++;
          for (const l of [...e.listeners]) l();
        }
      }
    });
  };

  const evict = (): void => {
    if (entries.size <= maxEntries) return;
    const idle = [...entries.values()].filter((e) => e.listeners.size === 0).sort((a, b) => a.used - b.used);
    for (const e of idle) { if (entries.size <= maxEntries) break; entries.delete(e.key); }
  };

  const register = <E extends Entry>(e: E): E => {
    ensureFeed();
    entries.set(e.key, e);
    evict();
    return e;
  };

  function liveOf<T>(e: Entry, get: () => QueryState<T>): LiveQuery<T> {
    return {
      subscribe(l) {
        e.listeners.add(l);
        return () => { e.listeners.delete(l); };
      },
      getSnapshot() { e.used = ++tick; return get(); },
    };
  }

  type QEntry = Entry & { snap: QueryState<unknown> | null; dirty: boolean };

  function query<I, O>(def: QueryDef<I, O>, input: I): LiveQuery<O> {
    const key = queryKey(store.spaceId, def.cap, input);
    let e = entries.get(key) as QEntry | undefined;
    if (!e) {
      const made: QEntry = {
        key, listeners: new Set(), used: ++tick, snap: null, dirty: true,
        handle(batch) {
          const hit = batch.some((c) => def.entities.includes(c.entity) && (def.affects ? def.affects(c, input) : true));
          if (hit) made.dirty = true;
          return hit;
        },
      };
      e = register(made);
    }
    const entry = e;
    return liveOf<O>(entry, () => {
      if (entry.dirty || !entry.snap) {
        stats.runs++;
        entry.snap = { status: "ready", data: def.run(store.db, input) };
        entry.dirty = false;
      }
      return entry.snap as QueryState<O>;
    });
  }

  type LEntry<R> = Entry & { win: ListState<R> };

  class ListState<R> {
    ids: readonly string[] = [];
    pos = new Map<string, number>();
    cache = new Map<string, R>();
    version = 0;
    snap: ListWindow<R>;
    readonly def: ListDef<unknown, R>;
    readonly input: unknown;
    constructor(def: ListDef<unknown, R>, input: unknown) {
      this.def = def;
      this.input = input;
      this.rebuild(false);
      this.snap = this.windowOf();
    }
    rebuild(count = true): void {
      if (count) stats.listRebuilds++;
      this.ids = this.def.orderIds(store.db, this.input);
      this.pos = new Map(this.ids.map((id, i) => [id, i]));
      for (const id of [...this.cache.keys()]) if (!this.pos.has(id)) this.cache.delete(id);
    }
    windowOf(): ListWindow<R> {
      return {
        version: this.version,
        count: this.ids.length,
        ids: this.ids,
        row: (id) => this.cache.get(id),
        rows: (start, end) => {
          const want = this.ids.slice(Math.max(0, start), Math.min(this.ids.length, end));
          const missing = want.filter((id) => !this.cache.has(id));
          if (missing.length) {
            stats.listRowReads += missing.length;
            for (const r of this.def.readRows(store.db, missing)) this.cache.set(this.def.idOf(r), r);
            if (this.cache.size > keep) {
              const near = new Set(want);
              for (const id of [...this.cache.keys()]) { if (this.cache.size <= keep) break; if (!near.has(id)) this.cache.delete(id); }
            }
          }
          return want.map((id) => this.cache.get(id));
        },
      };
    }
    /** Apply a batch. True when the list changed. */
    apply(batch: readonly Change[]): boolean {
      let reorder = false;
      let changed = false;
      for (const c of batch) {
        if (c.entity !== this.def.entity) continue;
        if (this.pos.has(c.id)) {
          const [row] = this.def.readRows(store.db, [c.id]);
          stats.listRowReads++;
          if (!row || (this.def.matches && !this.def.matches(row, this.input))) { reorder = true; changed = true; continue; }
          const prev = this.cache.get(c.id);
          if (this.def.orderKey) {
            if (prev === undefined || JSON.stringify(this.def.orderKey(prev)) !== JSON.stringify(this.def.orderKey(row))) reorder = true;
          } else reorder = true;
          if (prev !== undefined) this.cache.set(c.id, row);
          changed = true;
        } else {
          const [row] = this.def.readRows(store.db, [c.id]);
          stats.listRowReads++;
          if (row && (!this.def.matches || this.def.matches(row, this.input))) { reorder = true; changed = true; }
        }
      }
      if (reorder) this.rebuild();
      if (changed) { this.version++; this.snap = this.windowOf(); }
      return changed;
    }
  }

  function list<I, R>(def: ListDef<I, R>, input: I): LiveQuery<ListWindow<R>> {
    const key = queryKey(store.spaceId, def.cap, input);
    let e = entries.get(key) as LEntry<R> | undefined;
    if (!e) {
      const win = new ListState<R>(def as unknown as ListDef<unknown, R>, input);
      const made: LEntry<R> = { key, listeners: new Set(), used: ++tick, win, handle: (b) => win.apply(b) };
      e = register(made);
    }
    const entry = e;
    return liveOf<ListWindow<R>>(entry, () => ({ status: "ready", data: entry.win.snap }));
  }

  return {
    spaceId: store.spaceId,
    query,
    list,
    prefetch(def, input) {
      const had = entries.has(queryKey(store.spaceId, def.cap, input));
      const q = query(def, input);
      const before = stats.runs;
      q.getSnapshot();
      return !had || stats.runs > before;
    },
    prefetchList(def, input, count = 50) {
      const had = entries.has(queryKey(store.spaceId, def.cap, input));
      const q = list(def, input);
      const snap = q.getSnapshot();
      if (snap.status === "ready") snap.data.rows(0, count);
      return !had;
    },
    has: (cap, input) => entries.has(queryKey(store.spaceId, cap, input)),
    stats: () => ({ ...stats, entries: entries.size, feedListeners: store.changes.listeners() }),
    close() {
      closed = true;
      off?.();
      off = null;
      entries.clear();
    },
  };
}

/** One client per Space; switching drops the old Space's entries so nothing of it can show in the new one. */
export function createQueryClients(open: (spaceId: string) => SpaceStore): { forSpace(spaceId: string): QueryClient; drop(spaceId: string): void; spaceIds(): string[] } {
  const clients = new Map<string, QueryClient>();
  return {
    forSpace(spaceId) {
      let c = clients.get(spaceId);
      if (!c) { c = createQueryClient(open(spaceId)); clients.set(spaceId, c); }
      return c;
    },
    drop(spaceId) { clients.get(spaceId)?.close(); clients.delete(spaceId); },
    spaceIds: () => [...clients.keys()].sort(),
  };
}
