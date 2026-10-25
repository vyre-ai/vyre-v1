// Test doubles for the two cipher engines, built on node:sqlite so they run in CI without native or WASM cipher packages.
// They keep SQLCipher's and sqlite3mc's visible rules: a file is created under the first key; a missing or different key fails the first page read with "file is not a database".
// They do NOT encrypt bytes: encryption at rest is proven by spikes S5 (browser) and the P-PR_47b device run, not here.
import { DatabaseSync } from "node:sqlite";
import type { ExpoDatabase, ExpoRunResult, ExpoStatement } from "../replica/expo.ts";
import type { SqlValue } from "../replica/types.ts";
import type { McDatabase, McModule, McStatement } from "./sqlite3mc.ts";

export class KeyedFiles {
  private readonly keys = new Map<string, string>();
  /** First key sets the file's key; later opens must present the same one. Returns null when the file's key is right. */
  check(file: string, key: string | null): string | null {
    const have = this.keys.get(file);
    if (have === undefined) {
      if (key !== null) this.keys.set(file, key);
      return null;
    }
    return have === key ? null : "file is not a database";
  }
  /** The rekey path: replace a file's key. */
  rekey(file: string, key: string): void {
    this.keys.set(file, key);
  }
}

const isQuery = (sql: string): boolean => /^\s*(select|pragma|with)\b/i.test(sql);
const params = (p: readonly SqlValue[]): SqlValue[] => [...p];

interface Session { key: string | null; checked: boolean; file: string }

function guard(files: KeyedFiles, s: Session): void {
  if (s.checked) return;
  const bad = files.check(s.file, s.key);
  if (bad) throw new Error(bad);
  s.checked = true;
}

export interface FakeSqlCipher {
  open(file: string): ExpoDatabase;
  files: KeyedFiles;
  /** Pretend this build has no SQLCipher: PRAGMA cipher_version returns nothing. */
  withoutCipher: boolean;
}

/** An expo-sqlite stand-in whose database files live in `dir`. */
export function createFakeSqlCipher(dir: string): FakeSqlCipher {
  const files = new KeyedFiles();
  const fake: FakeSqlCipher = {
    files,
    withoutCipher: false,
    open(name) {
      const db = new DatabaseSync(`${dir}/${name}`);
      const s: Session = { key: null, checked: false, file: name };
      return {
        execSync(sql) {
          const k = /^\s*PRAGMA\s+key\s*=\s*(.+)$/i.exec(sql);
          if (k) { s.key = k[1] ?? null; return; }
          const r = /^\s*PRAGMA\s+rekey\s*=\s*(.+)$/i.exec(sql);
          if (r) { guard(files, s); files.rekey(s.file, r[1] ?? ""); s.key = r[1] ?? null; return; }
          guard(files, s);
          db.exec(sql);
        },
        prepareSync(sql): ExpoStatement {
          if (/^\s*PRAGMA\s+cipher_version\b/i.test(sql)) {
            return { executeSync: (): ExpoRunResult => ({ getFirstSync: () => (fake.withoutCipher ? null : { cipher_version: "4.5.6 community" }), getAllSync: () => [], changes: 0, lastInsertRowid: 0 }), finalizeSync() {} };
          }
          guard(files, s);
          const stmt = db.prepare(sql);
          const query = isQuery(sql);
          return {
            executeSync(p: readonly SqlValue[] = []): ExpoRunResult {
              if (query) {
                const rows = stmt.all(...params(p)) as Record<string, unknown>[];
                return { getFirstSync: () => rows[0] ?? null, getAllSync: () => rows, changes: 0, lastInsertRowid: 0 };
              }
              const info = stmt.run(...params(p)) as { changes?: number; lastInsertRowid?: number | bigint };
              return { getFirstSync: () => null, getAllSync: () => [], changes: Number(info.changes ?? 0), lastInsertRowid: Number(info.lastInsertRowid ?? 0) };
            },
            finalizeSync() {},
          };
        },
        closeSync() { db.close(); },
        withTransactionSync(fn) {
          db.exec("BEGIN IMMEDIATE");
          try { fn(); db.exec("COMMIT"); } catch (e) { db.exec("ROLLBACK"); throw e; }
        },
      };
    },
  };
  return fake;
}

export interface FakeMc {
  mod: McModule;
  files: KeyedFiles;
  /** Names passed to sqlite3mc_vfs_create, in order. */
  vfsCreated: string[];
}

/** A sqlite-wasm-cipher stand-in. Files open as `<dir>/<name>` for `file:/<name>?vfs=multipleciphers-<vfs>`. */
export function createFakeMc(dir: string): FakeMc {
  const files = new KeyedFiles();
  const vfsCreated: string[] = [];
  class DB implements McDatabase {
    private readonly db: DatabaseSync;
    private readonly s: Session;
    constructor(filename: string) {
      const m = /^file:\/([^?]+)\?vfs=multipleciphers-(.+)$/.exec(filename);
      if (!m || !m[1]) throw new Error("the cipher VFS is required: open through file:/x.db?vfs=multipleciphers-<vfs>");
      this.s = { key: null, checked: false, file: m[1] };
      this.db = new DatabaseSync(`${dir}/${m[1]}`);
    }
    exec(sql: string): unknown {
      const k = /^\s*PRAGMA\s+key\s*=\s*(.+)$/i.exec(sql);
      if (k) { this.s.key = k[1] ?? null; return undefined; }
      if (/^\s*PRAGMA\s+cipher\s*=/i.test(sql)) return undefined;
      const r = /^\s*PRAGMA\s+rekey\s*=\s*(.+)$/i.exec(sql);
      if (r) { guard(files, this.s); files.rekey(this.s.file, r[1] ?? ""); this.s.key = r[1] ?? null; return undefined; }
      guard(files, this.s);
      this.db.exec(sql);
      return undefined;
    }
    prepare(sql: string): McStatement {
      guard(files, this.s);
      const stmt = this.db.prepare(sql);
      const query = isQuery(sql);
      let bound: SqlValue[] = [];
      let rows: Record<string, unknown>[] | null = null;
      let at = 0;
      const self: McStatement = {
        bind(p) { bound = params(p); return self; },
        step() {
          if (!query) { stmt.run(...bound); return false; }
          rows ??= stmt.all(...bound) as Record<string, unknown>[];
          return at++ < rows.length;
        },
        get(target) { return Object.assign(target, rows?.[at - 1] ?? {}); },
        reset() { rows = null; at = 0; bound = []; return self; },
        finalize() {},
      };
      return self;
    }
    close(): void { this.db.close(); }
  }
  return {
    files,
    vfsCreated,
    mod: {
      capi: { sqlite3mc_vfs_create(name) { vfsCreated.push(name); return 0; } },
      oo1: { DB },
    },
  };
}
