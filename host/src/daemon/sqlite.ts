// The one place the host opens a SQLite file itself (modules.db for ctx.db, and read-only opens for `doctor`). Everything else in the daemon takes a `HostDb`.
// B2 (scripts/boundaries.json) lists kernel, sync and search for node:sqlite; host/src/logsink already opens logs.db the same way, so this file is the second host exception and the only one in the daemon.
import { DatabaseSync } from "node:sqlite";
import type { StatementSync } from "node:sqlite";
import { pathToFileURL } from "node:url";
import type { RawDb } from "../ctx/db.ts";

export interface HostDb extends RawDb {
  exec(sql: string): void;
  /** run `fn` in one transaction; a throw rolls back */
  tx<T>(fn: () => T): T;
  close(): void;
}

export interface OpenDbOptions {
  readOnly?: boolean;
  /** read-only, and SQLite may assume nothing else writes the file: it then makes no -wal or -shm beside a WAL file (a stopped daemon's, read by doctor) */
  immutable?: boolean;
}

/** `file` as a SQLite URI that opens it immutable. */
const immutableUri = (file: string): URL => { const u = pathToFileURL(file); u.searchParams.set("immutable", "1"); return u; };

export function openDb(file: string, o: OpenDbOptions = {}): HostDb {
  const db = o.immutable ? new DatabaseSync(immutableUri(file), { readOnly: true }) : new DatabaseSync(file, o.readOnly ? { readOnly: true } : {});
  if (!o.readOnly && !o.immutable) db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000;");
  else db.exec("PRAGMA busy_timeout = 2000;");
  let depth = 0;
  // Prepared statements, kept by their SQL text (most of the host's and the modules' statements repeat on every call: preparing one was about a tenth of a write). Bounded: the oldest is
  // dropped past STATEMENT_CACHE. A schema change does not hand back a stale statement: SQLite prepares a kept statement again by itself when the schema it was prepared against has
  // changed (sqlite3_prepare_v2, which node:sqlite uses). Closing the database drops them all, and a closed database refuses every call, as before.
  const kept = new Map<string, StatementSync>();
  const prepared = (sql: string): StatementSync => {
    let st = kept.get(sql);
    if (st) { kept.delete(sql); kept.set(sql, st); return st; }
    st = db.prepare(sql);
    kept.set(sql, st);
    if (kept.size > STATEMENT_CACHE) kept.delete(kept.keys().next().value!);
    return st;
  };
  const handle: HostDb = {
    all: (sql, ...args) => prepared(sql).all(...(args as never[])) as unknown[],
    run: (sql, ...args) => ({ changes: Number(prepared(sql).run(...(args as never[])).changes) }),
    exec: (sql) => { db.exec(sql); },
    tx<T>(fn: () => T): T {
      if (depth > 0) return fn();
      db.exec("BEGIN IMMEDIATE");
      depth++;
      try { const r = fn(); db.exec("COMMIT"); return r; }
      catch (e) { try { db.exec("ROLLBACK"); } catch { /* already rolled back */ } throw e; }
      finally { depth--; }
    },
    close: () => { kept.clear(); db.close(); },
  };
  CACHES.set(handle, kept);
  return handle;
}

/** How many statements the host keeps prepared per database. */
export const STATEMENT_CACHE = 512;
const CACHES = new WeakMap<object, Map<string, StatementSync>>();
/** How many statements a database opened here keeps prepared now (tests). */
export const keptStatements = (db: HostDb): number => CACHES.get(db)?.size ?? 0;

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
