// Web and the desktop shell's webview: sqlite3mc (SQLite3 Multiple Ciphers, package sqlite-wasm-cipher 2.2.4, chacha20) on OPFS.
// Spike S5: the stock opfs and opfs-sahpool VFS refuse a key. Open through sqlite3mc_vfs_create("<vfs>", 0)
// and file:/x.db?vfs=multipleciphers-<vfs>. No key and a wrong key are rejected. sqlite3_js_db_export returns decrypted pages: any export is plaintext.
// sync cannot import the package (boundary B6): the worker passes the initialised module.
import { ReplicaError } from "../replica/types.ts";
import type { SqlDriver, SqlValue } from "../replica/types.ts";
import { REPLICA_KEY_BYTES } from "./keys.ts";
import { toHex } from "./crypto.ts";
import { createSyncDriver } from "./driver.ts";

/** The oo1 statement subset used. */
export interface McStatement {
  bind(params: readonly SqlValue[]): McStatement;
  step(): boolean;
  get(target: Record<string, unknown>): Record<string, unknown>;
  reset(clearBindings?: boolean): McStatement;
  finalize(): void;
}

/** The oo1.DB subset used. */
export interface McDatabase {
  exec(sql: string): unknown;
  prepare(sql: string): McStatement;
  close(): void;
}

/** The initialised sqlite-wasm-cipher module subset used. */
export interface McModule {
  capi: { sqlite3mc_vfs_create(vfsName: string, makeDefault: number): number };
  oo1: { DB: new (filename: string, flags?: string) => McDatabase };
}

export interface CipherOpfsOpen {
  mod: McModule;
  /** The SAH-pool VFS installed by the worker before this call (installOpfsSAHPoolVfs). null opens the module's default VFS (Node and tests: the in-memory file system). */
  vfs: string | null;
  /** Full SQLite filename, overriding the one built from `file` and `vfs`. Tests use file:/x.db?vfs=memdb to read the stored bytes back. */
  uri?: string;
  file: string;
  key: Uint8Array;
}

/** The wrapper VFS is made once per module and name. */
const wrapped = new WeakMap<McModule, Set<string>>();
const CIPHER = "chacha20";
const hexKey = (key: Uint8Array): string => `"x'${toHex(key)}'"`;

function oneRow(db: McDatabase, sql: string): Record<string, unknown> | undefined {
  const s = db.prepare(sql);
  try {
    return s.step() ? s.get({}) : undefined;
  } finally {
    s.finalize();
  }
}

export function openCipherOpfs(o: CipherOpfsOpen): SqlDriver {
  if (o.key.length !== REPLICA_KEY_BYTES) throw new ReplicaError("bad_key", "replica key must be 32 bytes");
  if (!/^[A-Za-z0-9._-]+$/.test(o.file)) throw new ReplicaError("bad_name", "unsafe database file name");
  const vfs = o.vfs;
  if (vfs !== null) {
    let made = wrapped.get(o.mod);
    if (!made) { made = new Set<string>(); wrapped.set(o.mod, made); }
    if (!made.has(vfs)) {
      const rc = o.mod.capi.sqlite3mc_vfs_create(vfs, 0);
      if (rc !== 0) throw new ReplicaError("no_cipher", `sqlite3mc_vfs_create(${vfs}) returned ${rc}`);
      made.add(vfs);
    }
  }
  const db = new o.mod.oo1.DB(o.uri ?? (vfs === null ? `/${o.file}` : `file:/${o.file}?vfs=multipleciphers-${vfs}`), "c");
  try {
    db.exec(`PRAGMA cipher = '${CIPHER}'`);
    db.exec(`PRAGMA key = ${hexKey(o.key)}`);
    // The first page read fails on a missing or wrong key ("file is not a database").
    oneRow(db, "SELECT count(*) AS n FROM sqlite_master");
  } catch (e) {
    try { db.close(); } catch { /* already closed */ }
    if (e instanceof ReplicaError) throw e;
    throw new ReplicaError("wrong_key", "the replica key does not open this database");
  }
  const cache = new Map<string, McStatement>();
  const stmt = (sql: string): McStatement => {
    let s = cache.get(sql);
    if (!s) { s = db.prepare(sql); cache.set(sql, s); }
    return s;
  };
  const dropCache = (): void => {
    for (const s of cache.values()) s.finalize();
    cache.clear();
  };
  return createSyncDriver("wa", {
    exec(sql) {
      db.exec(sql);
      if (/\b(DROP\s+TABLE|CREATE\s+(VIRTUAL\s+)?TABLE|ALTER\s+TABLE)\b/i.test(sql)) dropCache();
    },
    run(sql, params) {
      const s = stmt(sql);
      try { if (params.length) s.bind(params);
      s.step(); } finally { s.reset(true); }
    },
    all(sql, params) {
      const s = stmt(sql);
      const out: Record<string, unknown>[] = [];
      try {
        if (params.length) s.bind(params);
        while (s.step()) out.push(s.get({}));
      } finally { s.reset(true); }
      return out;
    },
    close() {
      dropCache();
      db.close();
    },
  });
}

/** PRAGMA rekey on the open database. The caller keeps the driver; the next open uses the new key. */
export function rekeyCipherOpfs(driver: SqlDriver, next: Uint8Array): void {
  if (next.length !== REPLICA_KEY_BYTES) throw new ReplicaError("bad_key", "replica key must be 32 bytes");
  driver.exec(`PRAGMA rekey = ${hexKey(next)}`);
}
