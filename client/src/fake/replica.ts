// In-memory fake replica (F9). One replica per spaceId; tables of rows keyed by id; every write bumps a version and notifies subscribers.
// The real replica is SQLite behind the same surface (ARCH 5), so hooks written against this fake do not change when it is swapped in.
import type { CapMap } from "../../../generated/types.ts";

export type Row = { id: string } & Record<string, unknown>;
export type Tables = ReadonlyMap<string, ReadonlyMap<string, Row>>;
/** Reads a capability's result out of the replica tables. Registered per capability; the real replica compiles these from the manifest. */
export type Resolver<C extends keyof CapMap> = (tables: Tables, input: CapMap[C]["in"]) => CapMap[C]["out"];

export interface FakeReplica {
  readonly spaceId: string;
  /** Bumps on every write; equal versions mean equal results. */
  version(): number;
  subscribe(listener: () => void): () => void;
  /** Insert or replace rows by id. */
  put(table: string, rows: Row[]): void;
  remove(table: string, ids: string[]): void;
  rows(table: string): Row[];
  /** Register how a capability's result is read from the tables. */
  resolve<C extends keyof CapMap>(cap: C, resolver: Resolver<C>): void;
  /** Run a registered query now; null when no resolver is registered (the hook reports `loading`). */
  run<C extends keyof CapMap>(cap: C, input: CapMap[C]["in"]): { data: CapMap[C]["out"] } | null;
}

export function createFakeReplica(spaceId: string): FakeReplica {
  const tables = new Map<string, Map<string, Row>>();
  const resolvers = new Map<string, Resolver<keyof CapMap>>();
  const listeners = new Set<() => void>();
  let version = 0;
  const bump = () => { version++; for (const l of [...listeners]) l(); };
  return {
    spaceId,
    version: () => version,
    subscribe(l) { listeners.add(l); return () => void listeners.delete(l); },
    put(table, rows) {
      let t = tables.get(table);
      if (!t) tables.set(table, (t = new Map()));
      for (const r of rows) t.set(r.id, structuredClone(r));
      bump();
    },
    remove(table, ids) {
      const t = tables.get(table);
      if (!t) return;
      let changed = false;
      for (const id of ids) changed = t.delete(id) || changed;
      if (changed) bump();
    },
    rows: (table) => structuredClone([...(tables.get(table)?.values() ?? [])]),
    resolve(cap, resolver) { resolvers.set(cap, resolver as unknown as Resolver<keyof CapMap>); bump(); },
    run(cap, input) {
      const r = resolvers.get(cap);
      return r ? { data: structuredClone(r(tables, input as never)) as never } : null;
    },
  };
}

/** Replicas by spaceId: opening the same id twice gives the same replica; different ids never share rows. */
export interface FakeReplicaSet { open(spaceId: string): FakeReplica; spaceIds(): string[] }
export function createFakeReplicaSet(): FakeReplicaSet {
  const spaces = new Map<string, FakeReplica>();
  return {
    open(spaceId) {
      let r = spaces.get(spaceId);
      if (!r) spaces.set(spaceId, (r = createFakeReplica(spaceId)));
      return r;
    },
    spaceIds: () => [...spaces.keys()].sort(),
  };
}
