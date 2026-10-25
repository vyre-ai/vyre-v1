// One Space's local store as the query layer sees it: synchronous SQL reads over the replica, plus the change feed.
// client may not import sync (same layer), so the replica and its driver are described here by the few members the query layer touches; sync's ReplicaStore and SqlDriver fit them.
import { createChangeFeed } from "./changes.ts";
import type { ChangeSink } from "./changes.ts";

export type SqlValue = string | number | bigint | Uint8Array | null;
export type SqlRow = Record<string, SqlValue>;

export interface LocalDb {
  all(sql: string, params?: readonly SqlValue[]): SqlRow[];
}

export interface SpaceStore {
  readonly spaceId: string;
  readonly db: LocalDb;
  readonly changes: ChangeSink;
}

/** The part of sync's SqlDriver the query layer reads through. */
export interface DriverLike {
  readonly sync: boolean;
  prepare(sql: string): { all(params: readonly SqlValue[]): SqlRow[] };
}

/** SQL reads over a synchronous driver. Statements are prepared once per text by the driver. */
export function localDb(driver: DriverLike): LocalDb {
  if (!driver.sync) throw new Error("the query layer needs a driver that reads synchronously");
  return { all: (sql, params = []) => driver.prepare(sql).all(params) };
}

export function createSpaceStore(spaceId: string, driver: DriverLike, changes: ChangeSink = createChangeFeed()): SpaceStore {
  if (!spaceId) throw new Error("a Space store needs its spaceId");
  return { spaceId, db: localDb(driver), changes };
}

/** The writes that change rows: sync's ReplicaStore has all three. */
export interface ReplicaLike {
  write(input: { entity: string; id: string }): { applied: boolean };
  hide(entity: string, id: string, seq: number): void;
  keep(entity: string, id: string, flags: { starred?: boolean; follows?: boolean }): void;
}

/**
 * The same replica, telling the feed about each row it changes. Every other member passes straight through.
 * Code that applies pulls must write through the returned object so the feed sees them; writes inside `changes.batch` reach the query layer as one batch.
 */
export function observeReplica<T extends ReplicaLike>(replica: T, changes: ChangeSink): T {
  return new Proxy(replica, {
    get(target, prop) {
      if (prop === "write") {
        return (input: { entity: string; id: string }) => {
          const r = target.write(input);
          if (r.applied) changes.emit({ entity: input.entity, id: input.id });
          return r;
        };
      }
      if (prop === "hide") return (entity: string, id: string, seq: number) => { target.hide(entity, id, seq); changes.emit({ entity, id }); };
      if (prop === "keep") return (entity: string, id: string, flags: { starred?: boolean; follows?: boolean }) => { target.keep(entity, id, flags); changes.emit({ entity, id }); };
      const v: unknown = Reflect.get(target, prop, target);
      return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(target) : v;
    },
  });
}
