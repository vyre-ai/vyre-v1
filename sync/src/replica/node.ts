// node:sqlite adapter. The headless client and the device sidecar use this driver.
// Statements are prepared once and reused. WAL plus NORMAL sync keeps a one-row edit under the 10 ms budget.
import { DatabaseSync } from "node:sqlite";
import type { StatementSync } from "node:sqlite";
import { asRow, bind, schemaChanged } from "./sql.ts";
import type { SqlDriver, SqlRow, SqlStatement } from "./types.ts";

export function createNodeDriver(file = ":memory:"): SqlDriver {
  const db = new DatabaseSync(file);
  db.exec("PRAGMA foreign_keys = OFF");
  db.exec("PRAGMA busy_timeout = 5000");
  if (file !== ":memory:") {
    db.exec("PRAGMA journal_mode = WAL");
    db.exec("PRAGMA synchronous = NORMAL");
  }
  const cache = new Map<string, StatementSync>();
  const stmt = (sql: string): StatementSync => {
    let s = cache.get(sql);
    if (!s) {
      s = db.prepare(sql);
      cache.set(sql, s);
    }
    return s;
  };
  const prepare = (sql: string): SqlStatement => ({
    run(params) {
      stmt(sql).run(...bind(params));
    },
    get(params) {
      return asRow(stmt(sql).get(...bind(params)));
    },
    all(params) {
      const rows = stmt(sql).all(...bind(params));
      const out: SqlRow[] = [];
      for (const row of rows) {
        const r = asRow(row);
        if (r) out.push(r);
      }
      return out;
    },
  });
  return {
    kind: "node",
    sync: true,
    exec(sql) {
      db.exec(sql);
      if (schemaChanged(sql)) cache.clear();
    },
    prepare,
    transaction(fn) {
      db.exec("BEGIN IMMEDIATE");
      try {
        fn();
        db.exec("COMMIT");
      } catch (e) {
        db.exec("ROLLBACK");
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
      cache.clear();
      db.close();
    },
  };
}
