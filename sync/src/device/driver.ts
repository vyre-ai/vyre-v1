// A SqlDriver over any engine whose calls finish before they return (SQLCipher through expo-sqlite sync calls, sqlite3mc in a worker).
import { asRow } from "../replica/sql.ts";
import type { SqlDriver, SqlRow, SqlStatement, SqlValue } from "../replica/types.ts";

export interface SyncEngine {
  /** Run a script. A script that changes the schema must drop the engine's cached statements. */
  exec(sql: string): void;
  /** Run with parameters, no result rows needed. */
  run(sql: string, params: readonly SqlValue[]): void;
  all(sql: string, params: readonly SqlValue[]): Record<string, unknown>[];
  close(): void;
}

export function createSyncDriver(kind: SqlDriver["kind"], engine: SyncEngine): SqlDriver {
  const prepare = (sql: string): SqlStatement => ({
    run(params) { engine.run(sql, params); },
    get(params) {
      const first = engine.all(sql, params)[0];
      return first ? asRow(first) : undefined;
    },
    all(params) {
      const out: SqlRow[] = [];
      for (const r of engine.all(sql, params)) {
        const row = asRow(r);
        if (row) out.push(row);
      }
      return out;
    },
  });
  return {
    kind,
    sync: true,
    exec(sql) { engine.exec(sql); },
    prepare,
    transaction(fn) {
      engine.exec("BEGIN IMMEDIATE");
      try {
        fn();
        engine.exec("COMMIT");
      } catch (e) {
        engine.exec("ROLLBACK");
        throw e;
      }
    },
    query(sql, params) { return Promise.resolve(prepare(sql).get(params)); },
    flush() { return Promise.resolve(); },
    close() { engine.close(); },
  };
}
