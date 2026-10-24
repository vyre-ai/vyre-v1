// expo-sqlite adapter. Phones open the replica with openDatabaseSync (SQLCipher in a later packet).
// This file does not import expo-sqlite: sync may not take that dependency (boundary B6). The app passes the database.
import { asRow, bind, schemaChanged } from "./sql.ts";
import type { SqlDriver, SqlRow, SqlStatement, SqlValue } from "./types.ts";

/** The sync half of expo-sqlite's SQLiteStatement (SDK 52 and later). */
export interface ExpoStatement {
  executeSync(params?: readonly SqlValue[]): ExpoRunResult;
  finalizeSync(): void;
}

export interface ExpoRunResult {
  getFirstSync(): Record<string, unknown> | null;
  getAllSync(): Record<string, unknown>[];
  changes: number;
  lastInsertRowid: number;
}

/** The sync half of expo-sqlite's SQLiteDatabase from openDatabaseSync. */
export interface ExpoDatabase {
  execSync(sql: string): void;
  prepareSync(sql: string): ExpoStatement;
  closeSync(): void;
  withTransactionSync?(fn: () => void): void;
}

function rowsOf(result: ExpoRunResult): SqlRow[] {
  const out: SqlRow[] = [];
  for (const row of result.getAllSync()) {
    const r = asRow(row);
    if (r) out.push(r);
  }
  return out;
}

export function createExpoDriver(db: ExpoDatabase): SqlDriver {
  const cache = new Map<string, ExpoStatement>();
  const stmt = (sql: string): ExpoStatement => {
    let s = cache.get(sql);
    if (!s) {
      s = db.prepareSync(sql);
      cache.set(sql, s);
    }
    return s;
  };
  const prepare = (sql: string): SqlStatement => ({
    run(params) {
      stmt(sql).executeSync(bind(params));
    },
    get(params) {
      const first = stmt(sql).executeSync(bind(params)).getFirstSync();
      return first ? asRow(first) : undefined;
    },
    all(params) {
      return rowsOf(stmt(sql).executeSync(bind(params)));
    },
  });
  return {
    kind: "expo",
    sync: true,
    exec(sql) {
      db.execSync(sql);
      if (schemaChanged(sql)) {
        for (const s of cache.values()) s.finalizeSync();
        cache.clear();
      }
    },
    prepare,
    transaction(fn) {
      if (db.withTransactionSync) {
        db.withTransactionSync(fn);
        return;
      }
      db.execSync("BEGIN IMMEDIATE");
      try {
        fn();
        db.execSync("COMMIT");
      } catch (e) {
        db.execSync("ROLLBACK");
        throw e;
      }
    },
    query(sql, params) {
      return Promise.resolve(prepare(sql).get(params));
    },
    flush() {
      return Promise.resolve();
    },
    close() {
      for (const s of cache.values()) s.finalizeSync();
      cache.clear();
      db.closeSync();
    },
  };
}
