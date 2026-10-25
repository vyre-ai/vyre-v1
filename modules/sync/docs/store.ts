// The server's document tables (ARCH 5.6). doc_updates is the append-only list of accepted updates per document, doc_snapshots the folded state with its Markdown projection and the named history versions.
// Two columns go beyond the architecture's DDL, both with defaults so a row written to the plain DDL still reads:
//   doc_updates.suggest  0 normal, 1 a suggestion waiting for a person (tracked change), 2 a suggestion that was rejected
//   doc_snapshots.base   1 when the row can start a rebuild (a fold), 0 for a named version taken while a suggestion is pending
// doc_meta says whether a document is end to end encrypted (enc 2) and which row owns it. The tables are created on first use, like the epoch tables of purge: the module's migrations file is another packet's.
import * as Y from "yjs";
import type { Tx } from "../../../kernel/src/store/projection.ts";
import { newDoc } from "./markdown.ts";

export type DocEnc = 0 | 2;

export interface DocOwner { entity: string; id: string }
export interface DocMeta { doc: string; enc: DocEnc; owner: DocOwner | null; created: number }
export interface StoredUpdate { seq: number; actor: string; at: number; bytes: Uint8Array; enc: DocEnc; suggest: 0 | 1 | 2 }
export interface StoredSnapshot { doc: string; upto: number; bytes: Uint8Array; md: string | null; at: number; named: string | null; base: boolean }

const DDL = `
CREATE TABLE IF NOT EXISTS doc_meta (doc TEXT PRIMARY KEY, enc INTEGER NOT NULL DEFAULT 0, owner_entity TEXT, owner_id TEXT, created INTEGER NOT NULL) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS doc_updates (doc TEXT NOT NULL, seq INTEGER NOT NULL, actor TEXT NOT NULL, at INTEGER NOT NULL, bytes BLOB NOT NULL, enc INTEGER NOT NULL DEFAULT 0, suggest INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (doc, seq)) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS doc_snapshots (doc TEXT NOT NULL, upto INTEGER NOT NULL, bytes BLOB NOT NULL, md TEXT, at INTEGER NOT NULL, named TEXT, base INTEGER NOT NULL DEFAULT 1, PRIMARY KEY (doc, upto)) WITHOUT ROWID;`;

const ready = new WeakSet<object>();
export function ensureDocTables(db: Tx): void {
  if (ready.has(db)) return;
  db.exec(DDL);
  ready.add(db);
}

const bytesOf = (v: unknown): Uint8Array => (v instanceof Uint8Array ? v : new Uint8Array(0));

export function docMeta(db: Tx, doc: string): DocMeta | undefined {
  ensureDocTables(db);
  const r = db.get<{ enc: number; owner_entity: string | null; owner_id: string | null; created: number }>("SELECT enc, owner_entity, owner_id, created FROM doc_meta WHERE doc = ?", doc);
  if (!r) return undefined;
  return { doc, enc: r.enc === 2 ? 2 : 0, owner: r.owner_entity && r.owner_id ? { entity: r.owner_entity, id: r.owner_id } : null, created: r.created };
}

export function ensureMeta(db: Tx, doc: string, enc: DocEnc, owner: DocOwner | null, at: number): DocMeta {
  const have = docMeta(db, doc);
  if (have) return have;
  db.run("INSERT INTO doc_meta (doc, enc, owner_entity, owner_id, created) VALUES (?, ?, ?, ?, ?)", doc, enc, owner?.entity ?? null, owner?.id ?? null, at);
  return { doc, enc, owner, created: at };
}

/** The highest seq in use for a document: an update or a fold. New updates always take the next number, even after every update was folded away. */
export function headSeq(db: Tx, doc: string): number {
  ensureDocTables(db);
  const r = db.get<{ n: number | null }>("SELECT MAX(m) AS n FROM (SELECT MAX(seq) AS m FROM doc_updates WHERE doc = ? UNION ALL SELECT MAX(upto) AS m FROM doc_snapshots WHERE doc = ?)", doc, doc);
  return r?.n ?? 0;
}

export function appendUpdate(db: Tx, u: { doc: string; actor: string; at: number; bytes: Uint8Array; enc: DocEnc; suggest: boolean }): number {
  const seq = headSeq(db, u.doc) + 1;
  db.run("INSERT INTO doc_updates (doc, seq, actor, at, bytes, enc, suggest) VALUES (?, ?, ?, ?, ?, ?, ?)", u.doc, seq, u.actor, u.at, u.bytes, u.enc, u.suggest ? 1 : 0);
  return seq;
}

export function updatesAfter(db: Tx, doc: string, after: number, upto = Number.MAX_SAFE_INTEGER): StoredUpdate[] {
  ensureDocTables(db);
  return db.all<{ seq: number; actor: string; at: number; bytes: unknown; enc: number; suggest: number }>(
    "SELECT seq, actor, at, bytes, enc, suggest FROM doc_updates WHERE doc = ? AND seq > ? AND seq <= ? ORDER BY seq", doc, after, upto,
  ).map((r) => ({ seq: r.seq, actor: r.actor, at: r.at, bytes: bytesOf(r.bytes), enc: r.enc === 2 ? 2 : 0, suggest: r.suggest === 1 ? 1 : r.suggest === 2 ? 2 : 0 }));
}

export function updateCount(db: Tx, doc: string): number {
  ensureDocTables(db);
  return db.get<{ n: number }>("SELECT COUNT(*) AS n FROM doc_updates WHERE doc = ?", doc)?.n ?? 0;
}

function snap(doc: string, r: { upto: number; bytes: unknown; md: string | null; at: number; named: string | null; base: number }): StoredSnapshot {
  return { doc, upto: r.upto, bytes: bytesOf(r.bytes), md: r.md, at: r.at, named: r.named, base: r.base === 1 };
}

/** The newest fold: where a rebuild starts. */
export function baseSnapshot(db: Tx, doc: string): StoredSnapshot | undefined {
  ensureDocTables(db);
  const r = db.get<{ upto: number; bytes: unknown; md: string | null; at: number; named: string | null; base: number }>("SELECT upto, bytes, md, at, named, base FROM doc_snapshots WHERE doc = ? AND base = 1 ORDER BY upto DESC LIMIT 1", doc);
  return r ? snap(doc, r) : undefined;
}

/** Named history versions, newest first. */
export function versions(db: Tx, doc: string): StoredSnapshot[] {
  ensureDocTables(db);
  return db.all<{ upto: number; bytes: unknown; md: string | null; at: number; named: string | null; base: number }>("SELECT upto, bytes, md, at, named, base FROM doc_snapshots WHERE doc = ? AND named IS NOT NULL ORDER BY upto DESC", doc).map((r) => snap(doc, r));
}

/** Write a fold (or a named version). A row at the same seq keeps its name unless a new one is given. */
export function writeSnapshot(db: Tx, s: { doc: string; upto: number; bytes: Uint8Array; md: string | null; at: number; named: string | null; base: boolean }): void {
  ensureDocTables(db);
  db.run(
    `INSERT INTO doc_snapshots (doc, upto, bytes, md, at, named, base) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(doc, upto) DO UPDATE SET bytes = excluded.bytes, md = excluded.md, at = excluded.at, named = COALESCE(excluded.named, doc_snapshots.named), base = MAX(excluded.base, doc_snapshots.base)`,
    s.doc, s.upto, s.bytes, s.md, s.at, s.named, s.base ? 1 : 0,
  );
}

/** After a fold at `upto`: the updates it holds go, and so do older unnamed folds. Named versions stay for ever. */
export function dropFolded(db: Tx, doc: string, upto: number): void {
  db.run("DELETE FROM doc_updates WHERE doc = ? AND seq <= ?", doc, upto);
  db.run("DELETE FROM doc_snapshots WHERE doc = ? AND upto < ? AND named IS NULL", doc, upto);
}

/** The document as the server holds it: the newest fold plus every update after it (up to `upto` when given). */
export function buildDoc(db: Tx, doc: string, upto = Number.MAX_SAFE_INTEGER): Y.Doc {
  const y = newDoc();
  const base = baseSnapshot(db, doc);
  let from = 0;
  if (base && base.upto <= upto) { Y.applyUpdate(y, base.bytes); from = base.upto; }
  for (const u of updatesAfter(db, doc, from, upto)) if (u.enc === 0) Y.applyUpdate(y, u.bytes);
  return y;
}

/** The seq of the oldest suggestion nobody has decided yet, or null. A fold never goes past it, so a suggestion can still be told apart from what was agreed. */
export function firstPendingSuggestion(db: Tx, doc: string): number | null {
  ensureDocTables(db);
  return db.get<{ n: number | null }>("SELECT MIN(seq) AS n FROM doc_updates WHERE doc = ? AND suggest = 1", doc)?.n ?? null;
}

export function pendingSuggestions(db: Tx, doc: string): StoredUpdate[] {
  return updatesAfter(db, doc, 0).filter((u) => u.suggest === 1);
}

/** Every doc that has updates waiting to fold, with the count and the time of the newest fold (0 when never). */
export function foldCandidates(db: Tx): { doc: string; updates: number; lastFold: number; oldest: number }[] {
  ensureDocTables(db);
  return db.all<{ doc: string; updates: number; oldest: number; last_fold: number | null }>(
    `SELECT u.doc AS doc, COUNT(*) AS updates, MIN(u.at) AS oldest, (SELECT MAX(s.at) FROM doc_snapshots s WHERE s.doc = u.doc AND s.base = 1) AS last_fold
     FROM doc_updates u JOIN doc_meta m ON m.doc = u.doc WHERE m.enc = 0 GROUP BY u.doc ORDER BY u.doc`,
  ).map((r) => ({ doc: r.doc, updates: r.updates, lastFold: r.last_fold ?? 0, oldest: r.oldest }));
}

