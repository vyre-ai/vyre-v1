// wa-sqlite adapter (ARCH 5.10 fallback, wa-sqlite 1.0.0). sync cannot import wa-sqlite (boundary B6).
// The app passes an opened database. Statements are prepared at open. Writes update the replica
// and invalidate before the async SQL commit finishes; flush() waits for that commit.
import { asRow, asValue, isDuplicateColumn } from "./sql.ts";
import { openReplica } from "./store.ts";
import { ReplicaError } from "./types.ts";
import type { HideRow, OpenReplicaOptions, RebuildTarget, ReplicaStore, SqlDriver, SqlRow, SqlStatement, SqlValue } from "./types.ts";

const SQLITE_ROW = 100;

/** The statement shape we use from wa-sqlite (prepare, bind, step, row). */
export interface WaStatement {
  bind(params: readonly SqlValue[]): void | Promise<void>;
  /** True when a row is waiting. */
  step(): Promise<boolean>;
  row(): unknown[];
  columns(): string[];
  reset(): void | Promise<void>;
  finalize(): void | Promise<void>;
}

/** Async database. `bindWaSqlite` builds this from the raw wa-sqlite module. */
export interface WaDatabase {
  exec(sql: string): Promise<void>;
  prepare(sql: string): Promise<WaStatement>;
  get(sql: string, params: readonly SqlValue[]): Promise<SqlRow | undefined>;
  all(sql: string, params: readonly SqlValue[]): Promise<SqlRow[]>;
  close(): Promise<void>;
}

/** The raw wa-sqlite 1.0.0 module surface this adapter binds. */
export interface WaSqlite3 {
  exec(db: number, sql: string): Promise<void>;
  prepare_v2(db: number, sql: string): Promise<number | null>;
  bind_collection(stmt: number, values: readonly unknown[]): void | Promise<void>;
  step(stmt: number): Promise<number>;
  column_count(stmt: number): number;
  column_name(stmt: number, i: number): string;
  column(stmt: number, i: number): unknown;
  reset(stmt: number): void | Promise<void>;
  finalize(stmt: number): void | Promise<void>;
  close(db: number): Promise<void>;
  row?(stmt: number): unknown[];
  column_names?(stmt: number): string[];
}

function rowFrom(stmt: WaStatement): SqlRow {
  const cols = stmt.columns();
  const vals = stmt.row();
  const out: SqlRow = {};
  for (let i = 0; i < cols.length; i++) out[cols[i] ?? `c${i}`] = asValue(vals[i]);
  return out;
}

/** Wrap a raw wa-sqlite handle. `sqliteRow` defaults to SQLITE_ROW (100). */
export function bindWaSqlite(sqlite3: WaSqlite3, handle: number, sqliteRow = SQLITE_ROW): WaDatabase {
  const wrap = (stmt: number): WaStatement => ({
    bind(params) {
      return sqlite3.bind_collection(stmt, params);
    },
    async step() {
      return (await sqlite3.step(stmt)) === sqliteRow;
    },
    row() {
      if (sqlite3.row) return sqlite3.row(stmt);
      const n = sqlite3.column_count(stmt);
      const vals: unknown[] = [];
      for (let i = 0; i < n; i++) vals.push(sqlite3.column(stmt, i));
      return vals;
    },
    columns() {
      if (sqlite3.column_names) return sqlite3.column_names(stmt);
      const n = sqlite3.column_count(stmt);
      const names: string[] = [];
      for (let i = 0; i < n; i++) names.push(sqlite3.column_name(stmt, i));
      return names;
    },
    reset() {
      return sqlite3.reset(stmt);
    },
    finalize() {
      return sqlite3.finalize(stmt);
    },
  });

  async function read(sql: string, params: readonly SqlValue[], many: boolean): Promise<SqlRow[]> {
    const stmt = await sqlite3.prepare_v2(handle, sql);
    if (stmt === null) return [];
    const wrapped = wrap(stmt);
    try {
      await wrapped.bind(params);
      const out: SqlRow[] = [];
      while (await wrapped.step()) {
        out.push(rowFrom(wrapped));
        if (!many) break;
      }
      return out;
    } finally {
      await wrapped.finalize();
    }
  }

  return {
    exec(sql) {
      return sqlite3.exec(handle, sql);
    },
    async prepare(sql) {
      const stmt = await sqlite3.prepare_v2(handle, sql);
      if (stmt === null) throw new ReplicaError("bad_sql", "wa-sqlite did not prepare the statement");
      return wrap(stmt);
    },
    async get(sql, params) {
      const rows = await read(sql, params, false);
      return rows[0];
    },
    all(sql, params) {
      return read(sql, params, true);
    },
    close() {
      return sqlite3.close(handle);
    },
  };
}

export function createWaDriver(db: WaDatabase): SqlDriver {
  let tail: Promise<void> = Promise.resolve();
  let capture: Array<() => Promise<void>> | null = null;
  const enqueue = (job: () => Promise<void>): void => {
    if (capture) {
      capture.push(job);
      return;
    }
    tail = tail.then(job, job);
  };
  const statement = (sql: string): SqlStatement => {
    const slot: { stmt: WaStatement | null } = { stmt: null };
    enqueue(async () => {
      slot.stmt = await db.prepare(sql);
    });
    return {
      run(params) {
        enqueue(async () => {
          const stmt = slot.stmt;
          if (!stmt) throw new ReplicaError("not_ready", "statement is not prepared");
          await stmt.bind(params);
          await stmt.step();
          await stmt.reset();
        });
      },
      // Sync reads go through the store's memory. Async reads use query().
      get() {
        return undefined;
      },
      all() {
        return [];
      },
    };
  };
  return {
    kind: "wa",
    sync: false,
    exec(sql) {
      enqueue(async () => {
        try {
          await db.exec(sql);
        } catch (e) {
          if (isDuplicateColumn(e) && sql.includes("ADD COLUMN pending")) return;
          throw e;
        }
      });
    },
    prepare: statement,
    transaction(fn) {
      const ops: Array<() => Promise<void>> = [];
      const prev = capture;
      capture = ops;
      try {
        fn();
      } finally {
        capture = prev;
      }
      enqueue(async () => {
        await db.exec("BEGIN IMMEDIATE");
        try {
          for (const op of ops) await op();
          await db.exec("COMMIT");
        } catch (e) {
          try {
            await db.exec("ROLLBACK");
          } catch {
            // The connection may already be closing.
          }
          throw e;
        }
      });
    },
    query(sql, params) {
      return tail.then(() => db.get(sql, params)).then((row) => (row ? asRow(row) : undefined));
    },
    flush() {
      return tail;
    },
    close() {
      enqueue(async () => {
        await db.close();
      });
    },
  };
}

type WaOpen = Omit<OpenReplicaOptions, "driver" | "storedRegistryHash" | "rebuildTargets" | "hideRows" | "starredKeys" | "followsKeys">;

function intOf(v: SqlValue | undefined): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "bigint") return Number(v);
  return null;
}

/** Missing client tables are normal on a fresh file. Any other failure is not swallowed. */
async function optionalRows(db: WaDatabase, sql: string): Promise<SqlRow[]> {
  try {
    return await db.all(sql, []);
  } catch {
    return [];
  }
}

/** Open a wa-sqlite replica. Prepares every statement before the store is returned. */
export async function openWaReplica(db: WaDatabase, opts: WaOpen): Promise<ReplicaStore> {
  await db.exec("CREATE TABLE IF NOT EXISTS sync_state (k TEXT PRIMARY KEY, v)");
  let stored: string | null = null;
  try {
    const row = await db.get("SELECT v FROM sync_state WHERE k = ?", ["registry_hash"]);
    if (row && row.v !== null) stored = String(row.v);
  } catch {
    stored = null;
  }
  const upgraded = stored !== null && stored !== opts.registryHash;
  let rebuildTargets: RebuildTarget[] | undefined;
  let hideRows: HideRow[] = [];
  const starredKeys: string[] = [];
  const followsKeys: string[] = [];
  if (upgraded) {
    const rows = await db.all("SELECT name, type, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'", []);
    rebuildTargets = [];
    for (const r of rows) {
      if (r.type !== "table" || typeof r.name !== "string") continue;
      const sql = typeof r.sql === "string" ? r.sql : "";
      rebuildTargets.push({ name: r.name, virtual: /^CREATE\s+VIRTUAL/i.test(sql) });
    }
  } else {
    for (const r of await optionalRows(db, "SELECT entity, id, seq FROM hide_seq")) {
      const seq = intOf(r.seq);
      if (typeof r.entity === "string" && typeof r.id === "string" && seq !== null) hideRows.push({ entity: r.entity, id: r.id, seq });
    }
  }
  // replica_keep survives a schema rebuild, so its flags are read in both cases.
  for (const r of await optionalRows(db, "SELECT entity, id, starred, follows FROM replica_keep")) {
    if (typeof r.entity !== "string" || typeof r.id !== "string") continue;
    const key = `${r.entity}\0${r.id}`;
    if (intOf(r.starred) === 1) starredKeys.push(key);
    if (intOf(r.follows) === 1) followsKeys.push(key);
  }
  const driver = createWaDriver(db);
  const store = openReplica({
    ...opts,
    driver,
    storedRegistryHash: stored,
    hideRows,
    starredKeys,
    followsKeys,
    ...(rebuildTargets ? { rebuildTargets } : {}),
  });
  await driver.flush();
  return store;
}
