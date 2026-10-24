// The RecordStore facade (ARCH 4.3.1). `records.rows` is an inline projection: record events fold into one `rt_<type>` table per record type, in the same transaction as the append.
// `createRecordStore` implements the 0.6 Store contract over those tables, so kernel/conformance keeps guarding it. A write reads the row, checks the version the caller read (version_conflict
// for HTTP, MCP and outside-actor callers; sync ops carry per-field baseSeq and never come through here), then appends ONE event; the projection does the table write.
//
// Rows keep their data as JSON in `data`; the records module adds the typed, indexed column per field for views (ARCH 4.3). This facade reads a type's rows through the shared query code
// (query.ts), which is exact and bounded in memory, and is what the conformance suite measures.
import { DatabaseSync } from "node:sqlite";
import { canonical } from "../../../lib/canonical.ts";
import { isUuid } from "../../../lib/ids.ts";
import { sha256Hex } from "../log/hash.ts";
import type { StoredEvent } from "../log/types.ts";
import { aggregate as agg, fieldOf, page } from "./query.ts";
import { ProjectionHost, payloadOf } from "./projection.ts";
import type { InlineProjection, Tx } from "./projection.ts";
import { StoreError } from "./types.ts";
import type {
  AggregateRow, AggregateSpec, ChangeEntry, DefineDiff, DefineResult, ExportChunk, FieldDef, Page, QuerySpec, SearchHit, SearchSpec, Store, StoredRecord, TypeDef,
} from "./types.ts";
import { checkValue } from "./values.ts";

/** The conformance suite revision this store last passed. Bump with kernel/conformance/suite.ts. */
export const CONFORMANCE_REVISION = 7;

const NAME = /^[a-z][a-z0-9_]{0,62}$/;
const table = (type: string): string => {
  if (!NAME.test(type)) throw new StoreError("invalid", `record type names are lowercase letters, digits and underscores: ${type}`);
  return `rt_${type}`;
};

interface Row { id: string; version: number; created_at: number; updated_at: number; deleted_at: number | null; data: string }

// ---- the projection ----

const rowTable = (t: string): string => `CREATE TABLE IF NOT EXISTS ${table(t)} (id TEXT PRIMARY KEY, version INTEGER NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER, data TEXT NOT NULL)`;

function note(tx: Tx, kind: string, type: string, id: string, version: number, at: number, before: unknown, after: unknown): void {
  tx.run("INSERT INTO rs_changes (type, id, kind, version, at, before, after) VALUES (?, ?, ?, ?, ?, ?, ?)", type, id, kind, version, at, before === undefined ? null : JSON.stringify(before), JSON.stringify(after ?? {}));
}

/** `records.rows`: schema.applied, record.created, record.updated, record.removed, record.restored. Bump `version` to rebuild every rt_ table from the log on the next open. */
export const recordsRows: InlineProjection = {
  name: "records.rows", version: 1, mode: "inline", rebuild: "replay",
  init(tx) {
    tx.exec("CREATE TABLE IF NOT EXISTS rs_types (name TEXT PRIMARY KEY, def TEXT NOT NULL)");
    tx.exec("CREATE TABLE IF NOT EXISTS rs_changes (cursor INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT NOT NULL, id TEXT NOT NULL, kind TEXT NOT NULL, version INTEGER NOT NULL, at INTEGER NOT NULL, before TEXT, after TEXT)");
  },
  reset(tx) {
    for (const t of tx.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'rt\\_%' ESCAPE '\\'")) tx.exec(`DROP TABLE IF EXISTS "${t.name}"`);
    tx.exec("DELETE FROM rs_types");
    tx.exec("DELETE FROM rs_changes");
    tx.exec("DELETE FROM sqlite_sequence WHERE name = 'rs_changes'");
  },
  on: {
    "schema.applied"(tx, e: StoredEvent) {
      const p = payloadOf<{ set?: TypeDef[]; removed?: string[] }>(e);
      for (const d of p.set ?? []) {
        tx.exec(rowTable(d.name));
        tx.run("INSERT INTO rs_types (name, def) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET def = excluded.def", d.name, JSON.stringify(d));
      }
      for (const n of p.removed ?? []) { tx.exec(`DROP TABLE IF EXISTS ${table(n)}`); tx.run("DELETE FROM rs_types WHERE name = ?", n); }
    },
    "record.created"(tx, e) {
      const p = payloadOf<{ type: string; id: string; data: object; at: number }>(e);
      tx.run(`INSERT INTO ${table(p.type)} (id, version, created_at, updated_at, deleted_at, data) VALUES (?, 1, ?, ?, NULL, ?)`, p.id, p.at, p.at, JSON.stringify(p.data));
      note(tx, "created", p.type, p.id, 1, p.at, undefined, p.data);
    },
    "record.updated"(tx, e) {
      const p = payloadOf<{ type: string; id: string; data: object; before: object; version: number; at: number }>(e);
      tx.run(`UPDATE ${table(p.type)} SET data = ?, version = ?, updated_at = ? WHERE id = ?`, JSON.stringify(p.data), p.version, p.at, p.id);
      note(tx, "updated", p.type, p.id, p.version, p.at, p.before, p.data);
    },
    "record.removed"(tx, e) {
      const p = payloadOf<{ type: string; id: string; version: number; at: number }>(e);
      tx.run(`UPDATE ${table(p.type)} SET version = ?, deleted_at = ?, updated_at = ? WHERE id = ?`, p.version, p.at, p.at, p.id);
      note(tx, "removed", p.type, p.id, p.version, p.at, undefined, JSON.parse(tx.get<Row>(`SELECT data FROM ${table(p.type)} WHERE id = ?`, p.id)!.data));
    },
    "record.restored"(tx, e) {
      const p = payloadOf<{ type: string; id: string; version: number; at: number }>(e);
      tx.run(`UPDATE ${table(p.type)} SET version = ?, deleted_at = NULL, updated_at = ? WHERE id = ?`, p.version, p.at, p.id);
      note(tx, "restored", p.type, p.id, p.version, p.at, undefined, JSON.parse(tx.get<Row>(`SELECT data FROM ${table(p.type)} WHERE id = ?`, p.id)!.data));
    },
  },
};

// ---- the facade ----

const clone = <T,>(v: T): T => structuredClone(v);
const fail = (code: ConstructorParameters<typeof StoreError>[0], message: string): StoreError => new StoreError(code, message);
const TRACE = (): string => Array.from(globalThis.crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");

export interface RecordStoreOptions {
  /** Who the events are attributed to. */
  actor?: string;
  clock?: () => number;
}

export function createRecordStore(host: ProjectionHost, o: RecordStoreOptions = {}): Store {
  const actor = o.actor ?? "svc_records";
  const clock = o.clock ?? Date.now;
  const tx = host.tx;

  const emit = (type: string, entity: string, entityId: string | undefined, payload: object): void => {
    try {
      host.append({ type, sv: 1, trace_id: TRACE(), actor, vis: "space", entity, ...(entityId ? { entity_id: entityId } : {}), payload });
    } catch (e) { throw fail("unavailable", e instanceof Error ? e.message : String(e)); }
  };

  const defOf = (type: string): TypeDef | undefined => {
    const r = tx.get<{ def: string }>("SELECT def FROM rs_types WHERE name = ?", type);
    return r ? (JSON.parse(r.def) as TypeDef) : undefined;
  };
  const needType = (type: string): TypeDef => { const d = defOf(type); if (!d) throw fail("unknown_type", `no type ${type}`); return d; };
  const record = (type: string, r: Row): StoredRecord => ({
    type, id: r.id, version: r.version, data: JSON.parse(r.data), created_at: r.created_at, updated_at: r.updated_at, ...(r.deleted_at !== null ? { deleted_at: r.deleted_at } : {}),
  });
  const rowOf = (type: string, id: string): Row | undefined => tx.get<Row>(`SELECT * FROM ${table(type)} WHERE id = ?`, id);
  function* rows(type: string, live: boolean): Generator<StoredRecord> {
    for (const r of tx.all<Row>(`SELECT * FROM ${table(type)}${live ? " WHERE deleted_at IS NULL" : ""}`)) yield record(type, r);
  }

  function validate(def: TypeDef, data: Record<string, unknown>): void {
    const known = new Set(def.fields.map((f) => f.name));
    for (const k of Object.keys(data)) if (!known.has(k)) throw fail("unknown_field", `${def.name} has no field ${k}`);
    for (const f of def.fields) {
      const err = checkValue(f, data[f.name]);
      if (err === "sealed_value_refused") throw fail("sealed_value_refused", `${f.name} is sealed: a value is never stored, only a reference`);
      if (err) throw fail("invalid", err);
    }
  }
  const uniques = (def: TypeDef): FieldDef[] => def.fields.filter((f) => f.unique === true);
  /** Refuse a value another LIVE record holds. */
  function checkUnique(def: TypeDef, data: Record<string, unknown>, selfId: string | null): void {
    for (const f of uniques(def)) {
      const v = data[f.name];
      if (v === undefined || v === null) continue;
      let holder: string | undefined;
      if (typeof v === "string" || typeof v === "number") {
        holder = tx.get<{ id: string }>(`SELECT id FROM ${table(def.name)} WHERE deleted_at IS NULL AND json_extract(data, ?) = ? AND id IS NOT ? LIMIT 1`, `$."${f.name}"`, v, selfId)?.id;
      } else {
        const want = canonical(v);
        for (const r of rows(def.name, true)) if (r.id !== selfId && r.data[f.name] !== undefined && canonical(r.data[f.name]) === want) { holder = r.id; break; }
      }
      if (holder) throw Object.assign(fail("unique_violation", `${f.name} must be unique: another ${def.name} already has that value`), { field: f.name, value: v });
    }
  }
  function checkNoDuplicates(def: TypeDef): void {
    for (const f of uniques(def)) {
      const seen = new Set<string>();
      for (const r of rows(def.name, true)) {
        const v = r.data[f.name];
        if (v === undefined || v === null) continue;
        const k = canonical(v);
        if (seen.has(k)) throw fail("unique_violation", `${f.name} of ${def.name} already has duplicate values, so it cannot be made unique`);
        seen.add(k);
      }
    }
  }
  const checkDef = (t: TypeDef): void => {
    if (!t || typeof t.name !== "string" || !Array.isArray(t.fields)) throw fail("invalid", "a type needs a name and fields");
    table(t.name);
  };

  const store: Store = {
    async define(diff: DefineDiff): Promise<DefineResult> {
      const set: TypeDef[] = [], removed: string[] = [], changes: string[] = [];
      for (const t of diff.add_types ?? []) {
        checkDef(t);
        const had = defOf(t.name);
        if (had && canonical(had) === canonical(t)) continue;
        if (had) checkNoDuplicates(t);
        set.push(clone(t) as TypeDef); changes.push(had ? `changed type ${t.name}` : `added type ${t.name}`);
      }
      for (const t of diff.change_types ?? []) {
        checkDef(t);
        const had = defOf(t.name);
        if (!had) throw fail("unknown_type", `no type ${t.name}`);
        if (canonical(had) === canonical(t)) continue;
        checkNoDuplicates(t);
        set.push(clone(t) as TypeDef); changes.push(`changed type ${t.name}`);
      }
      for (const name of diff.remove_types ?? []) {
        if (!defOf(name)) continue;
        if (tx.get(`SELECT 1 AS x FROM ${table(name)} WHERE deleted_at IS NULL LIMIT 1`)) throw fail("invalid", `type ${name} still has records`);
        removed.push(name); changes.push(`removed type ${name}`);
      }
      if (changes.length) emit("schema.applied", "schema", undefined, { set, removed });
      return { applied: changes.length > 0, changes };
    },
    async types() { return tx.all<{ def: string }>("SELECT def FROM rs_types ORDER BY rowid").map((r) => JSON.parse(r.def) as TypeDef); },
    async describe(type) {
      const t = defOf(type);
      return t ? { name: t.name, fields: t.fields.map((f) => ({ name: f.name, kind: f.kind })) } : null;
    },
    async get(type, id, opts = {}) {
      needType(type);
      const r = rowOf(type, id);
      return r && (r.deleted_at === null || opts.include_deleted) ? record(type, r) : null;
    },
    async query(type, spec: QuerySpec): Promise<Page<StoredRecord>> {
      needType(type);
      const p = page(rows(type, !spec.include_deleted), spec);
      if ("error" in p) throw fail("invalid", p.error);
      return p;
    },
    async aggregate(type, spec: AggregateSpec): Promise<AggregateRow[]> {
      const def = needType(type);
      const sealed = (f: unknown): boolean => typeof f === "string" && def.fields.some((d) => d.name === f && d.kind === "sealed");
      for (const g of spec.group_by ?? []) if (sealed(g)) throw fail("invalid", `${g} is sealed: it cannot be grouped by`);
      for (const m of spec.measures ?? []) if (m && sealed(m.field)) throw fail("invalid", `${m.field} is sealed: it cannot be measured`);
      return agg(rows(type, true), spec);
    },
    async create(type, id, data) {
      const def = needType(type);
      if (!isUuid(id)) throw fail("invalid", "id must be a time-prefixed uuid");
      if (rowOf(type, id)) throw fail("invalid", `${type} ${id} already exists`);
      validate(def, data as Record<string, unknown>);
      checkUnique(def, data as Record<string, unknown>, null);
      const at = clock();
      emit("record.created", type, id, { type, id, data: clone(data), at });
      return record(type, rowOf(type, id)!);
    },
    async update(type, id, patch, base) {
      const def = needType(type);
      const r = rowOf(type, id);
      if (!r || r.deleted_at !== null) throw fail("not_found", `no ${type} ${id}`);
      if (r.version !== base) throw fail("version_conflict", `${type} ${id} is at version ${r.version}, not ${base}`);
      const before = JSON.parse(r.data) as Record<string, unknown>, merged = { ...before };
      for (const [k, v] of Object.entries(patch)) { if (v === null) delete merged[k]; else merged[k] = clone(v); }
      validate(def, merged);
      checkUnique(def, merged, id);
      emit("record.updated", type, id, { type, id, data: merged, before, version: r.version + 1, at: clock() });
      return record(type, rowOf(type, id)!);
    },
    async remove(type, id, base) {
      needType(type);
      const r = rowOf(type, id);
      if (!r || r.deleted_at !== null) throw fail("not_found", `no ${type} ${id}`);
      if (r.version !== base) throw fail("version_conflict", `${type} ${id} is at version ${r.version}, not ${base}`);
      emit("record.removed", type, id, { type, id, version: r.version + 1, at: clock() });
      return record(type, rowOf(type, id)!);
    },
    async restore(type, id) {
      const def = needType(type);
      const r = rowOf(type, id);
      if (!r || r.deleted_at === null) throw fail("not_found", `no deleted ${type} ${id}`);
      checkUnique(def, JSON.parse(r.data), id);
      emit("record.restored", type, id, { type, id, version: r.version + 1, at: clock() });
      return record(type, rowOf(type, id)!);
    },
    async search(spec: SearchSpec): Promise<Page<SearchHit>> {
      const words = spec.text.toLowerCase().split(/\s+/).filter(Boolean);
      const hits: SearchHit[] = [];
      for (const def of await store.types()) {
        if (spec.types && !spec.types.includes(def.name)) continue;
        for (const r of rows(def.name, true)) {
          let score = 0, snippet: string | undefined;
          for (const f of def.fields) {
            if (f.kind === "sealed") continue;
            const v = fieldOf(r, f.name);
            const text = typeof v === "string" ? v : Array.isArray(v) && v.every((x) => typeof x === "string") ? v.join(" ") : "";
            const low = text.toLowerCase();
            for (const w of words) if (low.includes(w)) { score += 1; snippet = snippet ?? text.slice(0, 80); }
          }
          if (score) hits.push({ type: def.name, id: r.id, score, ...(snippet ? { snippet } : {}) });
        }
      }
      hits.sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      let start = 0;
      if (spec.page.cursor) { const i = hits.findIndex((h) => h.id === spec.page.cursor); start = i === -1 ? hits.length : i + 1; }
      const slice = hits.slice(start, start + spec.page.limit);
      return { rows: slice, ...(start + spec.page.limit < hits.length && slice.length ? { next_cursor: slice[slice.length - 1]!.id } : {}) };
    },
    async changes(since, limit) {
      if (since !== null && !/^c\d+$/.test(since)) throw fail("invalid", "bad changes cursor");
      const from = since ? Number(since.slice(1)) : 0;
      const rs = tx.all<{ cursor: number; type: string; id: string; kind: ChangeEntry["kind"]; version: number; at: number; before: string | null; after: string | null }>(
        "SELECT * FROM rs_changes WHERE cursor > ? ORDER BY cursor LIMIT ?", from, limit);
      const entries: ChangeEntry[] = rs.map((r) => ({
        cursor: `c${r.cursor}`, type: r.type, id: r.id, kind: r.kind, version: r.version, at: r.at,
        ...(r.before ? { before: JSON.parse(r.before) } : {}), ...(r.after ? { after: JSON.parse(r.after) } : {}),
      }));
      return { entries, cursor: `c${rs.length ? rs[rs.length - 1]!.cursor : from}` };
    },
    async health() { try { tx.get("SELECT 1"); return { ok: true, checked_at: clock() }; } catch (e) { return { ok: false, detail: String(e), checked_at: clock() }; } },
    async version() { return { store: "recordstore", version: "1", conformance: CONFORMANCE_REVISION }; },
    async *export(since?: string): AsyncGenerator<ExportChunk> {
      const all: StoredRecord[] = [];
      for (const def of await store.types()) for (const r of rows(def.name, false)) if (!since || r.updated_at >= Number(since)) all.push(r);
      all.sort((a, b) => (a.id < b.id ? -1 : 1));
      let seq = 0;
      for (let i = 0; i < Math.max(1, all.length); i += 100) {
        const records = all.slice(i, i + 100);
        yield { seq: seq++, records, done: i + 100 >= all.length, checksum: sha256Hex(canonical(records)) };
      }
    },
    features() { return { aggregate: true, search: true, changes: true, cursor_paging: true as const }; },
  };
  return store;
}

/** A host with `records.rows` registered, and the RecordStore over it. `path` is a file, or ":memory:" for tests. */
export function openRecordStore(o: { path: string; space: string; actor?: string; clock?: () => number; extra?: InlineProjection[] }): { host: ProjectionHost; store: Store } {
  const db = new DatabaseSync(o.path);
  const host = new ProjectionHost({ db, space: o.space, projections: [recordsRows, ...(o.extra ?? [])], ...(o.clock ? { clock: o.clock } : {}) });
  return { host, store: createRecordStore(host, { ...(o.actor ? { actor: o.actor } : {}), ...(o.clock ? { clock: o.clock } : {}) }) };
}

