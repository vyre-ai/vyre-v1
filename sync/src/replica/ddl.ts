// Replica DDL. The spec names sync/generated/replica.sql. This repo generates generated/sync/replica.sql.
// The store reads that file. It does not import generated/ (that path is outside the layer packages).
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ReplicaError } from "./types.ts";
import type { SqlValue } from "./types.ts";

export function repoRoot(): string {
  return fileURLToPath(new URL("../../../", import.meta.url));
}

export function resolveReplicaSql(root = repoRoot()): string {
  const spec = path.join(root, "sync", "generated", "replica.sql");
  const repo = path.join(root, "generated", "sync", "replica.sql");
  if (existsSync(spec)) return spec;
  if (existsSync(repo)) return repo;
  throw new ReplicaError("no_ddl", "replica DDL is not on disk");
}

export function resolveEntities(root = repoRoot()): string {
  const spec = path.join(root, "sync", "generated", "entities.ts");
  const repo = path.join(root, "generated", "sync", "entities.ts");
  if (existsSync(spec)) return spec;
  if (existsSync(repo)) return repo;
  throw new ReplicaError("no_catalog", "sync entity catalog is not on disk");
}

export interface ColumnInfo {
  name: string;
  notNull: boolean;
  hasDefault: boolean;
  defaultValue: SqlValue;
}

export interface TableInfo {
  name: string;
  columns: ColumnInfo[];
  /** Field-meta table (id, field), not a row table. */
  fm: boolean;
}

/** Client-only tables (ARCH 5.10) plus the hide seq and the phone keep flags. */
export const CLIENT_SQL = `
CREATE TABLE IF NOT EXISTS pending_ops (
  n INTEGER PRIMARY KEY AUTOINCREMENT,
  op_id TEXT UNIQUE,
  trace_id TEXT,
  hlc TEXT,
  cap TEXT,
  v INTEGER,
  entity TEXT,
  id TEXT,
  input BLOB,
  base_seq TEXT,
  state TEXT,
  tries INTEGER,
  last_error TEXT,
  at INTEGER
);
CREATE TABLE IF NOT EXISTS sync_state (k TEXT PRIMARY KEY, v);
CREATE TABLE IF NOT EXISTS rejected (
  op_id TEXT PRIMARY KEY,
  error BLOB,
  copy_out BLOB,
  at INTEGER
);
CREATE TABLE IF NOT EXISTS conflicts_local (
  id TEXT PRIMARY KEY,
  entity TEXT,
  row_id TEXT,
  field TEXT,
  ours TEXT,
  theirs TEXT,
  base TEXT,
  state TEXT,
  plain_choice INTEGER,
  summary TEXT,
  at INTEGER
);
CREATE TABLE IF NOT EXISTS doc_local (
  doc TEXT PRIMARY KEY,
  state BLOB,
  sv BLOB,
  dirty INTEGER
);
CREATE VIRTUAL TABLE IF NOT EXISTS fts USING fts5(entity UNINDEXED, id UNINDEXED, title, body, tokenize='unicode61 remove_diacritics 2');
CREATE TABLE IF NOT EXISTS blob_cache (
  hash TEXT PRIMARY KEY,
  bytes BLOB,
  size INTEGER,
  last_used INTEGER
);
CREATE TABLE IF NOT EXISTS hide_seq (
  entity TEXT NOT NULL,
  id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  PRIMARY KEY (entity, id)
);
CREATE TABLE IF NOT EXISTS replica_keep (
  entity TEXT NOT NULL,
  id TEXT NOT NULL,
  starred INTEGER NOT NULL DEFAULT 0,
  follows INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (entity, id)
);
`;

const TABLE_RE = /CREATE TABLE IF NOT EXISTS "([^"]+)" \(([\s\S]*?)\);/g;
const COL_RE = /^\s*"([^"]+)"\s+[A-Za-z0-9_]+(.*)$/;

function parseDefault(rest: string): { hasDefault: boolean; defaultValue: SqlValue } {
  const m = /\bDEFAULT\s+(-?\d+|NULL)/i.exec(rest);
  if (!m) return { hasDefault: false, defaultValue: null };
  if (/^null$/i.test(m[1] ?? "")) return { hasDefault: true, defaultValue: null };
  return { hasDefault: true, defaultValue: Number(m[1]) };
}

export function parseTables(sql: string): TableInfo[] {
  const tables: TableInfo[] = [];
  for (const hit of sql.matchAll(TABLE_RE)) {
    const name = hit[1];
    const body = hit[2];
    if (!name || body === undefined) continue;
    const columns: ColumnInfo[] = [];
    for (const line of body.split("\n")) {
      const col = COL_RE.exec(line);
      if (!col) continue;
      const colName = col[1];
      const rest = col[2] ?? "";
      if (!colName) continue;
      const d = parseDefault(rest);
      columns.push({ name: colName, notNull: /NOT NULL/i.test(rest), hasDefault: d.hasDefault, defaultValue: d.defaultValue });
    }
    if (!columns.length) throw new ReplicaError("bad_ddl", `table ${name} has no columns`);
    tables.push({ name, columns, fm: name.endsWith("__fm") });
  }
  if (!tables.length) throw new ReplicaError("bad_ddl", "replica DDL has no tables");
  return tables;
}

let cachedSql: { path: string; sql: string; tables: TableInfo[] } | null = null;

export function loadReplicaSql(): { path: string; sql: string; tables: TableInfo[] } {
  const file = resolveReplicaSql();
  if (cachedSql && cachedSql.path === file) return cachedSql;
  const sql = readFileSync(file, "utf8");
  cachedSql = { path: file, sql, tables: parseTables(sql) };
  return cachedSql;
}
