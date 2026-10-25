// One Space's local store as the query layer sees it: synchronous SQL reads over the replica, plus the change feed.
// The replica wrapper reports every write; code that applies pulls must write through `replica` so the feed sees them.
import type { ReplicaStore, ReplicaWrite, SqlDriver, SqlRow, SqlValue } from "../../../sync/src/replica/index.ts";
import { createChangeFeed } from "./changes.ts";
import type { ChangeSink } from "./changes.ts";

export interface LocalDb {
  all(sql: string, params?: readonly SqlValue[]): SqlRow[];
}

export interface SpaceStore {
  readonly spaceId: string;
  readonly db: LocalDb;
  readonly changes: ChangeSink;
}

/** SQL reads over a synchronous driver. Statements are prepared once per text by the driver. */
export function localDb(driver: SqlDriver): LocalDb {
  if (!driver.sync) throw new Error("the query layer needs a driver that reads synchronously");
  return { all: (sql, params = []) => driver.prepare(sql).all(params) };
}

export function createSpaceStore(spaceId: string, driver: SqlDriver, changes: ChangeSink = createChangeFeed()): SpaceStore {
  if (!spaceId) throw new Error("a Space store needs its spaceId");
  return { spaceId, db: localDb(driver), changes };
}

/**
 * A ReplicaStore that tells the feed about each row it changes. Reads, blobs and state pass straight through.
 * Writes inside `changes.batch` reach the query layer as one batch.
 */
export function observeReplica(replica: ReplicaStore, changes: ChangeSink): ReplicaStore {
  return {
    get deviceClass() { return replica.deviceClass; },
    get registryHash() { return replica.registryHash; },
    get upgraded() { return replica.upgraded; },
    get preparedCount() { return replica.preparedCount; },
    write(input: ReplicaWrite) {
      const r = replica.write(input);
      if (r.applied) changes.emit({ entity: input.entity, id: input.id });
      return r;
    },
    read: (e, i) => replica.read(e, i),
    keep(entity, id, flags) { replica.keep(entity, id, flags); changes.emit({ entity, id }); },
    isKept: (e, i) => replica.isKept(e, i),
    hide(entity, id, seq) { replica.hide(entity, id, seq); changes.emit({ entity, id }); },
    subscribe: (m, fn) => replica.subscribe(m, fn),
    putBlob: (h, b) => replica.putBlob(h, b),
    getBlob: (h) => replica.getBlob(h),
    readFts: (e, i) => replica.readFts(e, i),
    pendingCount: () => replica.pendingCount(),
    getState: (k) => replica.getState(k),
    hasTable: (n) => replica.hasTable(n),
    load: (e, i) => replica.load(e, i),
    flush: () => replica.flush(),
    close: () => replica.close(),
  };
}
