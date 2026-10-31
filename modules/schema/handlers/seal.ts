// Sealing an existing field (field.retype to sealed): the one way a field becomes sealed after it holds values. It is one way.
//   move     inside the apply, in two steps. First every value, live rows and Trash, goes to the Vault over the seam (one Vault item per value, put by a key that names the record and field, so doing it
//            again finds the same items); if the Vault fails here nothing in the Space has changed. Then the field becomes sealed and each row keeps its reference. A crash in that second step leaves
//            some rows moved and the rest as text; pressing Seal again moves what is left.
//   clean    after the apply committed: the plaintext is taken out of every copy the Space kept. The payloads of the old record events (their commitments and the chain stay, as in events.compact),
//            the change feed, the per-field history, and Trash entries of the field. A job row (sc_seal_jobs) says it is still owed, so a boot after a crash finishes it.
// The Vault is the host's (setSchemaVault, the same driver Records uses).
import { isSealedRef } from "../../../kernel/src/store/values.ts";
import { isErased } from "../../../kernel/src/events/compact.ts";
import type { StoredRecord } from "../../../kernel/src/store/types.ts";
import type { Tx } from "../../../kernel/src/store/projection.ts";
import { refuse } from "../projections.ts";
import type { SchemaCtx, SchemaDeps } from "../projections.ts";

export interface SealVault {
  put(o: { type: string; recordId: string; field: string; value: string; ref?: string }): Promise<string>;
  /** The host's part of the cleaning: the Space log, kept answers, sync copies and the search index. */
  scrubField?(type: string, field: string): Promise<void>;
}
let vault: SealVault | null = null;
/** The host hands the Vault (a seam like the others). */
export function setSchemaVault(v: SealVault | null): void { vault = v; }
/** The Vault now wired (a test wraps it to make a put fail halfway). */
export const schemaVault = (): SealVault | null => vault;

/** The field types whose values can move into the Vault as text. */
export const SEALABLE_FROM: ReadonlySet<string> = new Set(["text", "longtext", "email", "phone", "number", "url"]);

const JOBS = `CREATE TABLE IF NOT EXISTS sc_seal_jobs (type TEXT NOT NULL, field TEXT NOT NULL, moved INTEGER NOT NULL, started_at INTEGER NOT NULL, change_id TEXT, PRIMARY KEY (type, field))`;
const ready = new WeakSet<Tx>();
export function ensureSealTables(tx: Tx): void { if (ready.has(tx)) return; tx.exec(JOBS); ready.add(tx); }

const asText = (v: unknown): string => (typeof v === "string" ? v : typeof v === "number" || typeof v === "boolean" ? String(v) : JSON.stringify(v));
const plain = (v: unknown): boolean => v !== undefined && v !== null && !isSealedRef(v);

/** Every row of the type with a plaintext in the field, Trash included, one page at a time. */
async function eachPlain(deps: SchemaDeps, type: string, field: string, fn: (r: StoredRecord) => Promise<void>): Promise<void> {
  let cursor: string | undefined;
  do {
    const page = await deps.store.query(type, { include_deleted: true, page: { limit: 200, ...(cursor ? { cursor } : {}) } });
    for (const r of page.rows) if (plain(r.data[field])) await fn(r);
    cursor = page.next_cursor;
  } while (cursor);
}

export async function countPlain(deps: SchemaDeps, type: string, field: string): Promise<number> {
  let n = 0;
  await eachPlain(deps, type, field, async () => { n++; });
  return n;
}

/** What the move has ready: each row with a plaintext, and the Vault item its value is now in. */
export interface Move { row: StoredRecord; ref: string }

/**
 * Step one of the move: every plaintext goes into the Vault and nothing else changes, so a Vault that fails halfway leaves the Space exactly as it was (the items already made are found again
 * by the next try, each put being keyed by its record and field). Throws when the Vault cannot take them.
 */
export async function putInVault(deps: SchemaDeps, ctx: SchemaCtx, type: string, field: string): Promise<Move[]> {
  const rows: StoredRecord[] = [];
  await eachPlain(deps, type, field, async (r) => { rows.push(r); });
  if (rows.length === 0) return [];
  if (!vault) refuse(ctx, "internal.unavailable", "The Vault is not available on this server, so nothing was sealed.");
  const moves: Move[] = [];
  for (const row of rows) moves.push({ row, ref: await vault!.put({ type, recordId: row.id, field, value: asText(row.data[field]) }) });
  return moves;
}

/** Step two, once the field is sealed in the store: each row keeps the reference in place of its value. A row that was already moved by an earlier try is not in `moves`. */
export async function writeRefs(deps: SchemaDeps, type: string, field: string, moves: readonly Move[]): Promise<number> {
  for (const { row: r, ref } of moves) {
    const patch = { [field]: { sealed: field, ref, present: true, set_at: Date.now() } };
    if (r.deleted_at === null || r.deleted_at === undefined) await deps.store.update(type, r.id, patch, r.version);
    else {
      // a record in Trash comes out, takes the reference and goes back, so its value is not left behind
      const back = await deps.store.restore(type, r.id);
      const next = await deps.store.update(type, r.id, patch, back.version);
      await deps.store.remove(type, r.id, next.version);
    }
  }
  return moves.length;
}

export function openJob(deps: SchemaDeps, type: string, field: string, moved: number, changeId: string, now: number): void {
  ensureSealTables(deps.tx);
  deps.tx.run("INSERT INTO sc_seal_jobs (type, field, moved, started_at, change_id) VALUES (?, ?, ?, ?, ?) ON CONFLICT(type, field) DO UPDATE SET moved = moved + excluded.moved", type, field, moved, now, changeId);
}

/** Does this old event hold a plaintext of the field? Created and updated events carry the whole row (`data`) and what it was (`before`). */
function holds(payload: Record<string, unknown>, type: string, field: string): boolean {
  if (payload["type"] !== type) return false;
  for (const k of ["data", "before"] as const) {
    const part = payload[k];
    if (part && typeof part === "object" && plain((part as Record<string, unknown>)[field])) return true;
  }
  return false;
}

/** Take the plaintext out of every copy the store kept. Safe to run twice; what is gone stays gone. */
export async function cleanField(deps: SchemaDeps, type: string, field: string): Promise<{ events: number }> {
  const host = deps.host;
  const { tx } = deps;
  const erasedSeqs: number[] = [];
  const touched = new Set<string>();
  // freed pages keep their bytes unless SQLite is told otherwise: from here on a freed page is overwritten
  host?.store.db.exec("PRAGMA secure_delete = ON");
  if (host) {
    const dec = new TextDecoder();
    for (let after = 0; ;) {
      const page = host.store.read({ after, limit: 2000, entity: type });
      if (page.length === 0) break;
      for (const e of page) {
        if ((e.type !== "record.created" && e.type !== "record.updated") || isErased(e)) continue;
        let p: Record<string, unknown>;
        try { p = JSON.parse(dec.decode(e.payload)) as Record<string, unknown>; } catch { continue; }
        if (!holds(p, type, field)) continue;
        host.store.erase(e.seq);
        erasedSeqs.push(e.seq);
        if (typeof p["id"] === "string") touched.add(p["id"]);
      }
      after = page[page.length - 1]!.seq;
      if (page.length < 2000) break;
    }
    // a rebuild skips an erased event, so the row's whole state is written again, references only, and a rebuild finds it
    for (const id of touched) {
      const row = tx.get<{ version: number; created_at: number; updated_at: number; deleted_at: number | null; data: string }>(`SELECT version, created_at, updated_at, deleted_at, data FROM rt_${type} WHERE id = ?`, id);
      if (!row) continue;
      host.append({ type: "record.rebased", sv: 1, trace_id: "5ea1".repeat(8), actor: "svc_records", vis: "space", entity: type, entity_id: id, payload: { type, id, data: JSON.parse(row.data), version: row.version, created_at: row.created_at, updated_at: row.updated_at, deleted_at: row.deleted_at } });
    }
  }
  // the sync change feed copied the fields of those events (its rows stay, so a device's cursor still lands; the same blanking as erase)
  if (erasedSeqs.length) {
    try { for (let i = 0; i < erasedSeqs.length; i += 400) { const part = erasedSeqs.slice(i, i + 400); tx.run(`UPDATE sync_changes SET fields = '{}' WHERE seq IN (${part.map(() => "?").join(",")})`, ...part); } } catch { /* sync is not on this store */ }
  }
  // the change feed keeps what a row was before and after each change
  tx.run(`UPDATE rs_changes SET before = CASE WHEN before IS NULL THEN NULL ELSE json_remove(before, ?) END, after = CASE WHEN after IS NULL THEN NULL ELSE json_remove(after, ?) END WHERE type = ?`, `$.${field}`, `$.${field}`, type);
  // the per-field history of a lost edit
  try { tx.run("DELETE FROM records_field_history WHERE type = ? AND field = ?", type, field); } catch { /* the records tables are not on this store */ }
  // what a retype or a drop of this field once kept in Trash
  tx.run("DELETE FROM sc_trash WHERE type = ? AND field = ?", type, field);
  // the copies only the host reaches
  await vault?.scrubField?.(type, field);
  tx.run("DELETE FROM sc_seal_jobs WHERE type = ? AND field = ?", type, field);
  if (host) {
    // scrub the file every time a job runs, not only when it erased something: a try that stopped before this point left the freed pages behind
    const db = host.store.db;
    db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    db.exec("VACUUM");
    db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  }
  return { events: erasedSeqs.length };
}

/** Finish every cleaning still owed: called after an apply and at boot. */
export async function finishJobs(deps: SchemaDeps): Promise<number> {
  ensureSealTables(deps.tx);
  const jobs = deps.tx.all<{ type: string; field: string }>("SELECT type, field FROM sc_seal_jobs");
  for (const j of jobs) await cleanField(deps, j.type, j.field);
  return jobs.length;
}
