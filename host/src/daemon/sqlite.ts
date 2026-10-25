// The one place the host opens a SQLite file itself (modules.db for ctx.db, and read-only opens for `doctor`). Everything else in the daemon takes a `HostDb`.
// B2 (scripts/boundaries.json) lists kernel, sync and search for node:sqlite; host/src/logsink already opens logs.db the same way, so this file is the second host exception and the only one in the daemon.
import { DatabaseSync } from "node:sqlite";
import type { RawDb } from "../ctx/db.ts";

export interface HostDb extends RawDb {
  exec(sql: string): void;
  /** run `fn` in one transaction; a throw rolls back */
  tx<T>(fn: () => T): T;
  close(): void;
}

export interface OpenDbOptions { readOnly?: boolean }

export function openDb(file: string, o: OpenDbOptions = {}): HostDb {
  const db = new DatabaseSync(file, o.readOnly ? { readOnly: true } : {});
  if (!o.readOnly) db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000;");
  else db.exec("PRAGMA busy_timeout = 2000;");
  let depth = 0;
  return {
    all: (sql, ...args) => db.prepare(sql).all(...(args as never[])) as unknown[],
    run: (sql, ...args) => ({ changes: Number(db.prepare(sql).run(...(args as never[])).changes) }),
    exec: (sql) => { db.exec(sql); },
    tx<T>(fn: () => T): T {
      if (depth > 0) return fn();
      db.exec("BEGIN IMMEDIATE");
      depth++;
      try { const r = fn(); db.exec("COMMIT"); return r; }
      catch (e) { try { db.exec("ROLLBACK"); } catch { /* already rolled back */ } throw e; }
      finally { depth--; }
    },
    close: () => { db.close(); },
  };
}

/** One value from events.db's log_meta (`space`, `head_seq`, `head_hash`), read-only. null when the file, table or key is missing. */
export function readLogMeta(file: string, key: string): string | null {
  let db: HostDb | null = null;
  try {
    db = openDb(file, { readOnly: true });
    const r = db.all("SELECT value FROM log_meta WHERE key = ?", key)[0] as { value?: unknown } | undefined;
    return typeof r?.value === "string" ? r.value : null;
  } catch { return null; }
  finally { db?.close(); }
}
