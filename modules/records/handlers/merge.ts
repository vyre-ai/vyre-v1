// records.merge, records.bulk_upsert, records.export (spec 2.9, ARCH 7.4).
// Not wired into impl.ts here: impl.ts and handlers/index.ts belong to P-L3_01, so a later packet that owns them exports createMergeHandlers next to the write and query handlers.
//
// Merge: the survivor keeps its id; each field takes the value of the record named in picks (default: the survivor's value, or the first merged
// record's value when the survivor has none). Everything the survivor loses and everything the merged records held goes to records_field_history, and the
// merged records' own history rows are copied under the survivor, so a merge keeps all history. Relations that point at a merged record are rewritten to the
// survivor (own-row links are dropped). Merged records move to Trash (30 days); the journal row (qm_merges) lets undoMerge put everything back inside the window.
// Followers, Journeys and channels live in other modules; they repoint on the record.merged event.
// Synced records are linked, not merged: a type with a sync binding is refused.
//
// Bulk upsert: match on the named fields, quiet by default (events carry quiet: true so automations skip them, spec 2.10 last bullet), idempotent: a second run of
// the same rows changes nothing. Rows are validated and planned before the first write; a store refusal on row N leaves rows before N applied (a rerun finishes the job).
//
// Export: CSV (RFC 4180, UTF-8 BOM, formula-safe) or XLSX (inline strings, stored zip). Sealed values are masked. The bytes go to the files module through deps.putFile.
import { canonical } from "../../../lib/canonical.ts";
import { formatHlc } from "../../../lib/hlc.ts";
import { mintUuid } from "../../../lib/ids.ts";
import { mintRecordId } from "../ids.ts";
import type { Tx } from "../../../kernel/src/store/projection.ts";
import { isSealedRef } from "../../../kernel/src/store/values.ts";
import { StoreError } from "../../../kernel/src/store/types.ts";
import type { FieldDef, Filter, Store, StoredRecord, TypeDef } from "../../../kernel/src/store/types.ts";
import { RecordsError, fail, mapError, toRow } from "./write.ts";
import type { RecordRow, WriteCtx } from "./write.ts";
import { MAX_LIMIT, runQuery } from "./query.ts";
import type { ViewSpec } from "./query.ts";

export const UNDO_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
export const MAX_MERGED = 50;
export const MAX_UPSERT_ROWS = 10_000;
/** Excel's own row limit, header included. */
export const XLSX_MAX_ROWS = 1_048_576;

export type MergeCtx = Pick<WriteCtx, "trace" | "emit"> & { actor?: string };
export type ExportCtx = Pick<WriteCtx, "trace"> & {
  actor?: string;
  /** The host decision for the caller on one record. An export writes a file, which the row filter on the way out cannot reach, so the rows are checked here (the label against the clearance lives in it). */
  authorize?: (action: { perm: string | null; level: "view" | "use" | "edit" | "manage" }, resource: { type: string; id: string | null }) => { effect: "allow" | "deny" | "hold"; reason?: string };
};

export interface MergeDeps {
  store: Store;
  tx: Tx;
  now?: () => number;
  /** Stores the export bytes as a file and returns its id (files module). */
  putFile?: (f: { name: string; mime: string; bytes: Uint8Array }) => Promise<string>;
}

export interface MergeHandlers {
  "records.merge"(ctx: MergeCtx, input: { type: string; survivorId: string; mergedIds: string[]; picks: Record<string, string> }): Promise<{ record: RecordRow; undoUntil: number }>;
  "records.bulk_upsert"(ctx: MergeCtx, input: { type: string; rows: Record<string, unknown>[]; match: string[]; runAutomations?: boolean }): Promise<{ created: number; updated: number; skipped: number }>;
  "records.export"(ctx: ExportCtx, input: { type: string; format: "csv" | "xlsx"; recordIds?: string[] } & ViewSpec): Promise<{ fileId: string }>;
}

function bad(ctx: Pick<WriteCtx, "trace">, message: string): never {
  return mapError(ctx as WriteCtx, new StoreError("invalid", message));
}

const same = (a: unknown, b: unknown): boolean => {
  const x = a === undefined ? null : a;
  const y = b === undefined ? null : b;
  if (x === y) return true;
  try { return canonical(x) === canonical(y); } catch { return false; }
};
const present = (v: unknown): boolean => v !== null && v !== undefined && v !== "" && !(Array.isArray(v) && v.length === 0);
const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);

// ---- schema owned by this file ----

const ready = new WeakSet<object>();
function ensure(tx: Tx): void {
  if (ready.has(tx)) return;
  tx.exec(`CREATE TABLE IF NOT EXISTS qm_merges (
    merge_id TEXT PRIMARY KEY, type TEXT NOT NULL, survivor TEXT NOT NULL, merged TEXT NOT NULL, before TEXT NOT NULL, rewrites TEXT NOT NULL,
    actor TEXT NOT NULL, created_at INTEGER NOT NULL, undo_until INTEGER NOT NULL, undone_at INTEGER
  )`);
  tx.exec("CREATE INDEX IF NOT EXISTS qm_merges_survivor ON qm_merges (type, survivor)");
  tx.exec(`CREATE TABLE IF NOT EXISTS records_field_history (
    type TEXT NOT NULL, id TEXT NOT NULL, field TEXT NOT NULL, value TEXT, hlc TEXT NOT NULL, actor TEXT NOT NULL, seq INTEGER NOT NULL, reason TEXT NOT NULL
  )`);
  tx.exec("CREATE INDEX IF NOT EXISTS records_field_history_row ON records_field_history (type, id, field)");
  tx.exec("CREATE TABLE IF NOT EXISTS records_row_meta (type TEXT NOT NULL, id TEXT NOT NULL, owner TEXT, label INTEGER NOT NULL DEFAULT 0, holds INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (type, id))");
  ready.add(tx);
}

const TYPE_NAME = /^[a-z][a-z0-9_]{0,62}$/;

async function needType(store: Store, type: string): Promise<TypeDef> {
  const def = (await store.types()).find((t) => t.name === type);
  if (!def) throw new StoreError("unknown_type", `no type ${type}`);
  return def;
}

const metaOf = (tx: Tx, type: string, id: string): { label: number; holds: number } => {
  const m = tx.get<{ label: number; holds: number }>("SELECT label, holds FROM records_row_meta WHERE type = ? AND id = ?", type, id);
  return { label: m?.label ?? 0, holds: m?.holds ?? 0 };
};

const rowOf = (tx: Tx, r: StoredRecord): RecordRow => toRow(r, metaOf(tx, r.type, r.id));

function historyText(kind: string | undefined, field: string, value: unknown): string {
  if (kind === "sealed") return JSON.stringify({ sealed: field, masked: true });
  try { return JSON.stringify(value ?? null); } catch { return "null"; }
}

function clockSeq(tx: Tx, type: string, id: string, field: string): number {
  if (!TYPE_NAME.test(type)) return 0;
  try { return tx.get<{ seq: number }>(`SELECT seq FROM "rt_${type}__fm" WHERE id = ? AND field = ?`, id, field)?.seq ?? 0; } catch { return 0; }
}

// ---- relations ----

const isRelation = (f: FieldDef): boolean => f.kind === "link" || f.kind === "relation";
const targetOf = (f: FieldDef): string | undefined => {
  if (typeof f.to === "string") return f.to;
  const o = f["options"] as unknown;
  return isObj(o) && typeof o["target"] === "string" ? (o["target"] as string) : undefined;
};

/** The record id a relation item names, when it names a record of `type`. */
function refOf(item: unknown, type: string, bare: boolean): string | null {
  if (typeof item === "string") return bare ? item : null;
  if (isObj(item) && typeof item["urn"] === "string") {
    const urn = item["urn"];
    if (!urn.startsWith("vyre://")) return null;
    const s = urn.slice(7).split("/");
    return s.length >= 3 && s[1] === type ? (s[2] ?? null) : null;
  }
  return null;
}

function repoint(item: unknown, survivor: string): unknown {
  if (typeof item === "string") return survivor;
  if (isObj(item) && typeof item["urn"] === "string") {
    const s = (item["urn"] as string).slice(7).split("/");
    s[2] = survivor;
    return { ...item, urn: `vyre://${s.join("/")}` };
  }
  return item;
}

/** The new value of one relation field after merged ids point at the survivor, or undefined when nothing changes. */
function rewriteValue(value: unknown, type: string, bare: boolean, merged: ReadonlySet<string>, survivor: string, dropSelf: string | null): unknown {
  const keyOf = (x: unknown): string => (typeof x === "string" ? x : isObj(x) && typeof x["urn"] === "string" ? (x["urn"] as string) : canonical(x));
  if (Array.isArray(value)) {
    let hit = false;
    const out: unknown[] = [];
    const seen = new Set<string>();
    for (const item of value) {
      const ref = refOf(item, type, bare);
      let next = item;
      if (ref !== null && merged.has(ref)) { next = repoint(item, survivor); hit = true; }
      const nref = refOf(next, type, bare);
      if (dropSelf !== null && nref === dropSelf) { hit = true; continue; }
      const k = keyOf(next);
      if (seen.has(k)) { hit = true; continue; }
      seen.add(k);
      out.push(next);
    }
    return hit ? out : undefined;
  }
  const ref = refOf(value, type, bare);
  if (ref === null || !merged.has(ref)) return undefined;
  const next = repoint(value, survivor);
  return dropSelf !== null && refOf(next, type, bare) === dropSelf ? null : next;
}

interface Rewrite { type: string; id: string; field: string; before: unknown; after: unknown }
interface Journal {
  mergeId: string;
  type: string;
  survivor: string;
  merged: string[];
  before: Record<string, unknown>;
  rewrites: Rewrite[];
}

async function scan(store: Store, type: string, each: (r: StoredRecord) => Promise<void>): Promise<void> {
  let cursor: string | undefined;
  for (;;) {
    const page = await store.query(type, { page: { limit: MAX_LIMIT, ...(cursor ? { cursor } : {}) } });
    for (const r of page.rows) await each(r);
    if (!page.next_cursor) return;
    cursor = page.next_cursor;
  }
}

// ---- merge ----

const isSynced = (def: TypeDef): boolean => !!def["sync"] || !!def["synced"];

async function applyMerge(deps: MergeDeps, ctx: MergeCtx, input: { type: string; survivorId: string; mergedIds: string[]; picks: Record<string, string> }): Promise<{ record: RecordRow; undoUntil: number }> {
  const { store, tx } = deps;
  ensure(tx);
  const now = deps.now ?? Date.now;
  const actor = ctx.actor ?? "merge";
  const def = await needType(store, input.type);
  if (def["protected"] === true) throw new RecordsError("protected", `type ${input.type} is protected: its records cannot be deleted, so they cannot be merged away`);
  if (isSynced(def)) bad(ctx, `${input.type} is a synced type: synced records are linked, not merged`);
  const mergedIds = [...new Set(input.mergedIds)];
  if (mergedIds.length === 0) bad(ctx, "mergedIds is empty: name at least one record to merge into the survivor");
  if (mergedIds.length > MAX_MERGED) bad(ctx, `a merge takes at most ${MAX_MERGED} records`);
  if (mergedIds.includes(input.survivorId)) bad(ctx, "the survivor cannot be one of the merged records");
  const survivor = await store.get(input.type, input.survivorId);
  if (!survivor) throw new StoreError("not_found", `no ${input.type} ${input.survivorId}`);
  const merged: StoredRecord[] = [];
  for (const id of mergedIds) {
    const r = await store.get(input.type, id);
    if (!r) throw new StoreError("not_found", `no ${input.type} ${id}`);
    if (metaOf(tx, input.type, id).holds > 0) throw new RecordsError("on_hold", `record ${id} is on hold`);
    merged.push(r);
  }
  const known = new Map(def.fields.map((f) => [f.name, f]));
  const sources = new Map<string, StoredRecord>([[survivor.id, survivor], ...merged.map((r) => [r.id, r] as const)]);
  for (const [field, from] of Object.entries(input.picks)) {
    if (!known.has(field)) throw new StoreError("unknown_field", `${input.type} has no field ${field}`);
    if (!sources.has(from)) bad(ctx, `pick for ${field} names ${from}, which is neither the survivor nor a merged record`);
  }

  // The value of every field after the merge.
  const patch: Record<string, unknown> = {};
  const before: Record<string, unknown> = {};
  for (const f of def.fields) {
    const pick = input.picks[f.name];
    let value: unknown;
    if (pick !== undefined) value = sources.get(pick)!.data[f.name];
    else {
      value = survivor.data[f.name];
      if (!present(value)) for (const m of merged) if (present(m.data[f.name])) { value = m.data[f.name]; break; }
    }
    if (!same(value, survivor.data[f.name])) { patch[f.name] = value === undefined ? null : value; before[f.name] = survivor.data[f.name] ?? null; }
  }

  const journal: Journal = { mergeId: mintUuid(), type: input.type, survivor: survivor.id, merged: mergedIds, before, rewrites: [] };
  const removed: string[] = [];
  let updated = false;
  try {
    if (Object.keys(patch).length) {
      await store.update(input.type, survivor.id, patch, survivor.version);
      updated = true;
    }
    const mergedSet = new Set(mergedIds);
    for (const other of await store.types()) {
      const fields = other.fields.filter((f) => {
        if (!isRelation(f)) return false;
        const to = targetOf(f);
        return to === undefined || to === input.type;
      });
      if (!fields.length) continue;
      await scan(store, other.name, async (row) => {
        if (mergedSet.has(row.id) && other.name === input.type) return;
        const next: Record<string, unknown> = {};
        for (const f of fields) {
          const bare = targetOf(f) === input.type;
          const dropSelf = other.name === input.type && row.id === survivor.id ? survivor.id : null;
          const v = rewriteValue(row.data[f.name], input.type, bare, mergedSet, survivor.id, dropSelf);
          if (v !== undefined) { next[f.name] = v; journal.rewrites.push({ type: other.name, id: row.id, field: f.name, before: row.data[f.name] ?? null, after: v }); }
        }
        if (Object.keys(next).length) await store.update(other.name, row.id, next, row.version);
      });
    }
    for (const m of merged) {
      const cur = await store.get(input.type, m.id);
      if (cur) { await store.remove(input.type, m.id, cur.version); removed.push(m.id); }
    }
  } catch (e) {
    await revert(deps, journal, removed, updated);
    return mapError(ctx as WriteCtx, e);
  }

  // History: what the survivor lost, what the merged records held that did not survive, and the merged records' own history.
  const stamp = formatHlc({ ms: now(), counter: 0, deviceId: "merge" });
  const tag = `merge:${journal.mergeId}`;
  const ins = (id: string, field: string, kind: string | undefined, value: unknown, reason: string): void => {
    tx.run("INSERT INTO records_field_history (type, id, field, value, hlc, actor, seq, reason) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      input.type, survivor.id, field, historyText(kind, field, value), stamp, actor, clockSeq(tx, input.type, id, field), reason);
  };
  const final = (await store.get(input.type, survivor.id)) ?? survivor;
  for (const f of def.fields) {
    if (Object.prototype.hasOwnProperty.call(before, f.name) && present(survivor.data[f.name])) ins(survivor.id, f.name, f.kind, survivor.data[f.name], `${tag}:survivor_replaced`);
    for (const m of merged) {
      const v = m.data[f.name];
      if (present(v) && !same(v, final.data[f.name])) ins(m.id, f.name, f.kind, v, `${tag}:lost_from:${m.id}`);
    }
  }
  for (const id of mergedIds) {
    tx.run(
      "INSERT INTO records_field_history (type, id, field, value, hlc, actor, seq, reason) SELECT type, ?, field, value, hlc, actor, seq, ? || ':history_of:' || ? || ':' || reason FROM records_field_history WHERE type = ? AND id = ? AND reason NOT LIKE 'merge:%'",
      survivor.id, tag, id, input.type, id,
    );
  }
  const undoUntil = now() + UNDO_WINDOW_MS;
  tx.run("INSERT INTO qm_merges (merge_id, type, survivor, merged, before, rewrites, actor, created_at, undo_until) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    journal.mergeId, input.type, survivor.id, JSON.stringify(mergedIds), JSON.stringify(before), JSON.stringify(journal.rewrites), actor, now(), undoUntil);
  for (const id of mergedIds) ctx.emit("record.merged", `record/${survivor.id}`, { survivorId: survivor.id, mergedId: id, type: input.type });
  return { record: rowOf(tx, final), undoUntil };
}

/** Put everything a merge (or its failed attempt) changed back. Returns the items it could not restore. */
async function revert(deps: MergeDeps, j: Journal, removed: readonly string[], survivorUpdated: boolean): Promise<string[]> {
  const { store } = deps;
  const stuck: string[] = [];
  for (const id of removed) {
    try { await store.restore(j.type, id); } catch (e) { if (!(e instanceof StoreError && e.code === "invalid")) stuck.push(`restore ${id}`); }
  }
  for (const w of [...j.rewrites].reverse()) {
    try {
      const cur = await store.get(w.type, w.id);
      if (!cur) continue;
      if (!same(cur.data[w.field], w.after)) continue; // changed since: leave the newer value
      await store.update(w.type, w.id, { [w.field]: w.before }, cur.version);
    } catch { stuck.push(`${w.type}/${w.id}.${w.field}`); }
  }
  if (survivorUpdated) {
    for (const [field, was] of Object.entries(j.before)) {
      try {
        const cur = await store.get(j.type, j.survivor);
        if (!cur) break;
        await store.update(j.type, j.survivor, { [field]: was }, cur.version);
      } catch { stuck.push(`${j.type}/${j.survivor}.${field}`); }
    }
  }
  return stuck;
}

interface MergeRow { merge_id: string; type: string; survivor: string; merged: string; before: string; rewrites: string; actor: string; created_at: number; undo_until: number; undone_at: number | null }

/** The most recent merge into a survivor that is still open, or the one named by mergeId. */
export function findMerge(deps: Pick<MergeDeps, "tx">, o: { survivorId?: string; mergeId?: string }): { mergeId: string; type: string; survivorId: string; mergedIds: string[]; createdAt: number; undoUntil: number; undoneAt?: number } | null {
  ensure(deps.tx);
  const r = o.mergeId
    ? deps.tx.get<MergeRow>("SELECT * FROM qm_merges WHERE merge_id = ?", o.mergeId)
    : deps.tx.get<MergeRow>("SELECT * FROM qm_merges WHERE survivor = ? AND undone_at IS NULL ORDER BY created_at DESC, rowid DESC LIMIT 1", o.survivorId ?? "");
  if (!r) return null;
  return { mergeId: r.merge_id, type: r.type, survivorId: r.survivor, mergedIds: JSON.parse(r.merged) as string[], createdAt: r.created_at, undoUntil: r.undo_until, ...(r.undone_at !== null ? { undoneAt: r.undone_at } : {}) };
}

/** Undo a merge inside its 30 days: merged records come back from Trash, relations and survivor fields return, the history rows of the merge go. Needs records.delete (host). */
export async function undoMerge(deps: MergeDeps, ctx: Pick<WriteCtx, "trace"> & { emit?: WriteCtx["emit"] }, o: { survivorId?: string; mergeId?: string }): Promise<{ restored: string[]; unrestored: string[] }> {
  ensure(deps.tx);
  const now = (deps.now ?? Date.now)();
  const row = o.mergeId
    ? deps.tx.get<MergeRow>("SELECT * FROM qm_merges WHERE merge_id = ?", o.mergeId)
    : deps.tx.get<MergeRow>("SELECT * FROM qm_merges WHERE survivor = ? AND undone_at IS NULL ORDER BY created_at DESC, rowid DESC LIMIT 1", o.survivorId ?? "");
  if (!row) throw new StoreError("not_found", "no merge to undo");
  if (row.undone_at !== null) bad(ctx, "this merge was already undone");
  if (now > row.undo_until) bad(ctx, "the 30 days to undo this merge have passed");
  const j: Journal = { mergeId: row.merge_id, type: row.type, survivor: row.survivor, merged: JSON.parse(row.merged) as string[], before: JSON.parse(row.before) as Record<string, unknown>, rewrites: JSON.parse(row.rewrites) as Rewrite[] };
  const unrestored = await revert(deps, j, j.merged, true);
  deps.tx.run("DELETE FROM records_field_history WHERE type = ? AND id = ? AND reason LIKE ?", j.type, j.survivor, `merge:${j.mergeId}:%`);
  deps.tx.run("UPDATE qm_merges SET undone_at = ? WHERE merge_id = ?", now, j.mergeId);
  return { restored: j.merged.filter((id) => !unrestored.includes(`restore ${id}`)), unrestored };
}

// ---- bulk upsert ----

function keyFor(row: Record<string, unknown>, match: readonly string[]): string {
  return canonical(match.map((m) => row[m]));
}

const changedOf = (keys: string[], data: Record<string, unknown>): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  for (const k of keys) out[k] = Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null;
  return out;
};

async function upsert(deps: MergeDeps, ctx: MergeCtx, input: { type: string; rows: Record<string, unknown>[]; match: string[]; runAutomations?: boolean }): Promise<{ created: number; updated: number; skipped: number }> {
  const { store, tx } = deps;
  ensure(tx);
  const def = await needType(store, input.type);
  const known = new Map(def.fields.map((f) => [f.name, f]));
  if (!input.match.length) bad(ctx, "match is empty: name the fields that identify a row (for example email)");
  for (const m of input.match) {
    const f = known.get(m);
    if (!f) throw new StoreError("unknown_field", `${input.type} has no field ${m}`);
    if (f.kind === "sealed") bad(ctx, `${m} is sealed and cannot be a match field`);
  }
  if (input.rows.length > MAX_UPSERT_ROWS) bad(ctx, `a bulk upsert takes at most ${MAX_UPSERT_ROWS} rows: split them into smaller batches`);
  const quiet = input.runAutomations !== true;

  // Plan: one entry per distinct match key; later rows with the same key fold into the first.
  interface Plan { existing: { id: string; version: number; fields: Record<string, unknown> } | null; values: Record<string, unknown>; index: number }
  const plans = new Map<string, Plan>();
  let folded = 0;
  for (let i = 0; i < input.rows.length; i++) {
    const row = input.rows[i];
    if (!isObj(row)) bad(ctx, `row ${i} is not an object`);
    for (const k of Object.keys(row!)) if (!known.has(k)) throw new StoreError("unknown_field", `row ${i}: ${input.type} has no field ${k}`);
    for (const m of input.match) if (!present(row![m])) bad(ctx, `row ${i} has no value for match field ${m}`);
    const key = keyFor(row!, input.match);
    const prior = plans.get(key);
    if (prior) { Object.assign(prior.values, row); folded++; continue; }
    const filter: Filter = { and: input.match.map((m) => ({ field: m, op: "eq" as const, value: row![m] })) };
    const found = runQuery(tx, input.type, { filter, limit: 2 });
    if (found.rows.length > 1) throw new StoreError("unique_violation", `row ${i}: ${found.rows.length} records already match ${input.match.join(", ")}; resolve the duplicates first`);
    const hit = found.rows[0];
    plans.set(key, { existing: hit ? { id: hit.id, version: hit.version, fields: hit.fields } : null, values: { ...row! }, index: i });
  }

  let created = 0;
  let updated = 0;
  let skipped = folded;
  for (const plan of plans.values()) {
    try {
      if (!plan.existing) {
        const id = mintRecordId();
        const rec = await store.create(input.type, id, plan.values);
        created++;
        ctx.emit("record.created", `record/${rec.id}`, { recordId: rec.id, type: rec.type, fields: { ...rec.data }, ...(quiet ? { quiet: true } : {}) });
        continue;
      }
      const diff: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(plan.values)) if (!same(plan.existing.fields[k], v)) diff[k] = v;
      if (!Object.keys(diff).length) { skipped++; continue; }
      const rec = await store.update(input.type, plan.existing.id, diff, plan.existing.version);
      updated++;
      const keys = Object.keys(diff);
      const prev: Record<string, unknown> = {};
      for (const k of keys) if (Object.prototype.hasOwnProperty.call(plan.existing.fields, k)) prev[k] = plan.existing.fields[k];
      ctx.emit("record.updated", `record/${rec.id}`, { recordId: rec.id, type: rec.type, fields: changedOf(keys, rec.data), prev, version: rec.version, ...(quiet ? { quiet: true } : {}) });
    } catch (e) {
      if (e instanceof RecordsError) throw mapErr(ctx, new RecordsError(e.reason, `row ${plan.index}: ${e.message}`));
      if (e instanceof StoreError) throw mapErr(ctx, new StoreError(e.code, `row ${plan.index}: ${e.message}`));
      throw e;
    }
  }
  return { created, updated, skipped };
}

function mapErr(ctx: Pick<WriteCtx, "trace">, e: unknown): unknown {
  try { return mapError(ctx as WriteCtx, e); } catch (out) { return out; }
}

// ---- export ----

const FORMULA = /^[=+\-@\t\r]/;

/** One cell as text. Sealed values never leave: present shows a mask. */
export function cellText(f: FieldDef, v: unknown): { text: string; number?: number } {
  if (v === null || v === undefined) return { text: "" };
  if (f.kind === "sealed" || isSealedRef(v)) return { text: isObj(v) && v["present"] === false ? "" : "[sealed]" };
  if (typeof v === "number") return { text: String(v), number: v };
  if (typeof v === "boolean") return { text: v ? "true" : "false" };
  if (typeof v === "string") return { text: v };
  if (f.kind === "money" && isObj(v) && typeof v["amount"] === "number") return { text: `${v["amount"]} ${String(v["currency"] ?? "")}`.trim() };
  if (Array.isArray(v) && v.every((x) => typeof x === "string")) return { text: JSON.stringify(v) };
  try { return { text: canonical(v) }; } catch { return { text: JSON.stringify(v) }; }
}

const csvCell = (c: { text: string; number?: number }, plainText: boolean): string => {
  let s = c.text;
  if (c.number === undefined && plainText && FORMULA.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
};

export function toCsv(columns: readonly FieldDef[], rows: readonly Record<string, unknown>[]): string {
  const lines = [columns.map((c) => csvCell({ text: c.label ?? c.name }, true)).join(",")];
  for (const r of rows) lines.push(columns.map((c) => csvCell(cellText(c, r[c.name]), true)).join(","));
  return `\ufeff${lines.join("\r\n")}\r\n`;
}

const xmlEsc = (s: string): string =>
  s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const colName = (i: number): string => {
  let s = "";
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
};

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
const crc32 = (b: Uint8Array): number => { let c = 0xffffffff; for (const x of b) c = CRC[(c ^ x) & 0xff]! ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };

/** A zip with stored (uncompressed) entries. */
export function zipStore(files: readonly { name: string; data: Uint8Array }[]): Uint8Array {
  const enc = new TextEncoder();
  const locals: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name);
    const crc = crc32(f.data);
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, 0, true);
    lh.setUint16(10, 0, true); lh.setUint16(12, 0x21, true); lh.setUint32(14, crc, true); lh.setUint32(18, f.data.length, true); lh.setUint32(22, f.data.length, true); lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true); ch.setUint16(10, 0, true);
    ch.setUint16(12, 0, true); ch.setUint16(14, 0x21, true); ch.setUint32(16, crc, true); ch.setUint32(20, f.data.length, true); ch.setUint32(24, f.data.length, true); ch.setUint16(28, name.length, true);
    ch.setUint32(42, offset, true);
    locals.push(new Uint8Array(lh.buffer), name, f.data);
    central.push(new Uint8Array(ch.buffer), name);
    offset += 30 + name.length + f.data.length;
  }
  const size = central.reduce((n, p) => n + p.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true); end.setUint32(12, size, true); end.setUint32(16, offset, true);
  const parts = [...locals, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

export function toXlsx(sheet: string, columns: readonly FieldDef[], rows: readonly Record<string, unknown>[]): Uint8Array {
  const enc = new TextEncoder();
  const cell = (ref: string, c: { text: string; number?: number }): string => {
    if (c.number !== undefined) return `<c r="${ref}"><v>${c.number}</v></c>`;
    if (c.text === "") return "";
    const text = c.text.length > 32767 ? c.text.slice(0, 32767) : c.text;
    return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xmlEsc(text)}</t></is></c>`;
  };
  const body: string[] = [];
  body.push(`<row r="1">${columns.map((c, i) => cell(`${colName(i)}1`, { text: c.label ?? c.name })).join("")}</row>`);
  rows.forEach((r, n) => body.push(`<row r="${n + 2}">${columns.map((c, i) => cell(`${colName(i)}${n + 2}`, cellText(c, r[c.name]))).join("")}</row>`));
  const name = xmlEsc(sheet.replace(/[\\/?*[\]:]/g, " ").slice(0, 31) || "Sheet1");
  const xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
  return zipStore([
    { name: "[Content_Types].xml", data: enc.encode(`${xml}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`) },
    { name: "_rels/.rels", data: enc.encode(`${xml}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`) },
    { name: "xl/workbook.xml", data: enc.encode(`${xml}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${name}" sheetId="1" r:id="rId1"/></sheets></workbook>`) },
    { name: "xl/_rels/workbook.xml.rels", data: enc.encode(`${xml}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`) },
    { name: "xl/worksheets/sheet1.xml", data: enc.encode(`${xml}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${body.join("")}</sheetData></worksheet>`) },
  ]);
}

async function exportRows(deps: MergeDeps, ctx: ExportCtx, input: { type: string; format: "csv" | "xlsx"; recordIds?: string[] } & ViewSpec): Promise<{ fileId: string }> {
  const { store, tx } = deps;
  ensure(tx);
  if (!deps.putFile) throw new Error("records.export needs a file store: createMergeHandlers was given no putFile");
  // fail closed: a file cannot be filtered after it is written, so with no way to ask what the caller may read, nothing is exported
  if (!ctx.authorize) fail(ctx as WriteCtx, "permission.no_grant", "This export cannot check what you may read, so it exports nothing.");
  const def = await needType(store, input.type);
  const wanted = input.fields && input.fields.length ? input.fields : def.fields.map((f) => f.name);
  const byName = new Map(def.fields.map((f) => [f.name, f]));
  const columns: FieldDef[] = [];
  for (const name of wanted) {
    const f = byName.get(name);
    if (!f) throw new StoreError("unknown_field", `${input.type} has no field ${name}`);
    columns.push(f);
  }
  const cap = input.format === "xlsx" ? XLSX_MAX_ROWS - 1 : Number.MAX_SAFE_INTEGER;
  const want = input.limit ?? Number.MAX_SAFE_INTEGER;
  // a hand-picked selection: only these ids, taken from what the view returns, so an id the caller may not read (or that is gone) simply is not there
  const picked = input.recordIds === undefined ? null : new Set(input.recordIds);
  const rows: Record<string, unknown>[] = [];
  const first: ViewSpec = { ...(input.filter !== undefined ? { filter: input.filter } : {}), ...(input.sort ? { sort: input.sort } : {}), ...(input.offset ? { offset: input.offset } : {}), limit: MAX_LIMIT };
  let cursor: string | undefined;
  for (;;) {
    const res = runQuery(tx, input.type, { ...first, ...(cursor ? { cursor } : {}) });
    for (const r of res.rows) {
      if (picked !== null && !picked.has(r.id)) continue;
      // only what the caller may read goes into the file, picked or not
      if (ctx.authorize({ perm: null, level: "view" }, { type: "record", id: r.id }).effect !== "allow") continue;
      if (rows.length >= want) break;
      if (rows.length >= cap) bad(ctx, "Excel holds at most 1,048,575 data rows: export CSV or narrow the view");
      rows.push(r.fields);
    }
    if (!res.next || rows.length >= want || (picked !== null && picked.size === 0)) break;
    cursor = res.next;
  }
  const stamp = new Date((deps.now ?? Date.now)()).toISOString().slice(0, 10);
  const base = `${input.type}-${stamp}`;
  const fileId = input.format === "csv"
    ? await deps.putFile({ name: `${base}.csv`, mime: "text/csv; charset=utf-8", bytes: new TextEncoder().encode(toCsv(columns, rows)) })
    : await deps.putFile({ name: `${base}.xlsx`, mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", bytes: toXlsx(def.label ?? def.name, columns, rows) });
  return { fileId };
}

// ---- handlers ----

export function createMergeHandlers(deps: MergeDeps): MergeHandlers {
  return {
    "records.merge": (ctx, input) => applyMerge(deps, ctx, input).catch((e) => { throw mapErr(ctx, e); }),
    "records.bulk_upsert": (ctx, input) => upsert(deps, ctx, input).catch((e) => { throw mapErr(ctx, e); }),
    "records.export": (ctx, input) => exportRows(deps, ctx, input).catch((e) => { throw mapErr(ctx, e); }),
  };
}
