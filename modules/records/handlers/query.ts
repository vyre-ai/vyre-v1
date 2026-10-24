// records.query, records.search, records.counts and the saved-view store (spec 2.9, 3.4; ARCH 7.4, ARCH 9).
// A view spec (filter, sort, group, window) compiles to one SQL statement over the rt_<type> projection. The sort gets a partial index
// (WHERE deleted_at IS NULL) on the same json_extract expressions, so a page is an index range scan of LIMIT rows and never a table scan.
// Paging is keyset (the same cursor as the RecordStore, kernel/src/store/query.ts) or OFFSET for a window. The row count of a view is cached
// per (type, filter) and stamped with the change cursor, so it is exact and costs one lookup until the next write.
// Search is FTS5 kept in step by triggers on rt_<type>. A filter the compiler cannot express (object or array operands) takes the server
// fallback: the exact in-memory code of the RecordStore over the live rows.
// Everything the module creates here has the qx_ prefix, so a projection reset (which drops rt_*) never meets an FTS shadow table.
import { canonical } from "../../../lib/canonical.ts";
import { encodeCursor, matches, page } from "../../../kernel/src/store/query.ts";
import type { Filter, Sort, TypeDef } from "../../../kernel/src/store/types.ts";
import { StoreError } from "../../../kernel/src/store/types.ts";
import type { Tx } from "../../../kernel/src/store/projection.ts";
import { mapError } from "./write.ts";
import type { RecordRow, WriteCtx } from "./write.ts";

const NAME = /^[a-z][a-z0-9_]{0,62}$/;
const SEG = /^[A-Za-z][A-Za-z0-9_]{0,62}$/;
const COLUMNS = new Set(["id", "version", "created_at", "updated_at"]);
export const DEFAULT_LIMIT = 200;
export const MAX_LIMIT = 500;

export interface ViewSpec {
  filter?: unknown;
  sort?: readonly { field: string; dir: "asc" | "desc" }[];
  group?: string;
  fields?: readonly string[];
  offset?: number;
  limit?: number;
  cursor?: string;
}

export interface QueryDeps {
  tx: Tx;
  /** Used by the saved-view store for its timestamps. */
  now?: () => number;
}

export interface QueryHandlers {
  "records.query"(ctx: Pick<WriteCtx, "trace">, input: { type: string } & ViewSpec): Promise<{ rows: RecordRow[]; next?: string; total?: number }>;
  "records.search"(ctx: Pick<WriteCtx, "trace">, input: { type: string; q: string; cursor?: string; limit?: number }): Promise<{ rows: RecordRow[]; next?: string; total?: number }>;
  "records.counts"(ctx: Pick<WriteCtx, "trace">, input: { type: string; filter?: unknown }): Promise<{ count: number }>;
}

class Unsupported extends Error {}

interface Raw { id: string; version: number; created_at: number; updated_at: number; deleted_at: number | null; data: string; label: number; holds: number }

// ---- schema owned by this file ----

const BASE = [
  "CREATE TABLE IF NOT EXISTS qx_counts (type TEXT NOT NULL, key TEXT NOT NULL, n INTEGER NOT NULL, stamp INTEGER NOT NULL, PRIMARY KEY (type, key))",
  `CREATE TABLE IF NOT EXISTS qx_views (
    view_id TEXT PRIMARY KEY, type TEXT NOT NULL, title TEXT NOT NULL, kind TEXT NOT NULL, spec TEXT NOT NULL,
    shared INTEGER NOT NULL DEFAULT 0, owner_id TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
  )`,
  "CREATE INDEX IF NOT EXISTS qx_views_type ON qx_views (type, shared)",
  "CREATE TABLE IF NOT EXISTS records_row_meta (type TEXT NOT NULL, id TEXT NOT NULL, owner TEXT, label INTEGER NOT NULL DEFAULT 0, holds INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (type, id))",
];
const ready = new WeakSet<object>();
function ensureBase(tx: Tx): void {
  const key = tx as unknown as object;
  if (ready.has(key)) return;
  for (const sql of BASE) tx.exec(sql);
  ready.add(key);
}

function typeDef(tx: Tx, type: string): TypeDef {
  if (!NAME.test(type)) throw new StoreError("invalid", `record type names are lowercase letters, digits and underscores: ${type}`);
  const r = tx.get<{ def: string }>("SELECT def FROM rs_types WHERE name = ?", type);
  if (!r) throw new StoreError("unknown_type", `no type ${type}`);
  return JSON.parse(r.def) as TypeDef;
}

// ---- expressions ----

/** SQL for a (possibly dotted) field of a row aliased r. The head must be a field of the type, every segment is a plain name, so the literal is safe. */
function expr(def: TypeDef, field: string, alias = "r."): string {
  if (COLUMNS.has(field)) return `${alias}${field}`;
  const parts = field.split(".");
  if (!parts.every((p) => SEG.test(p))) throw new StoreError("invalid", `bad field name ${field}`);
  if (!def.fields.some((f) => f.name === parts[0])) throw new StoreError("unknown_field", `${def.name} has no field ${parts[0]}`);
  return `json_extract(${alias}data, '$.${parts.map((p) => `"${p}"`).join(".")}')`;
}

const pathOf = (field: string): string => `$.${field.split(".").map((p) => `"${p}"`).join(".")}`;

type Bind = string | number | null;
function bindable(v: unknown): Bind {
  if (v === undefined || v === null) return null;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "number") { if (!Number.isFinite(v)) throw new Unsupported(); return v; }
  if (typeof v === "string") return v;
  throw new Unsupported();
}

interface Sql { text: string; args: Bind[] }

function compile(def: TypeDef, f: unknown): Sql {
  if (f === undefined || f === null) return { text: "1", args: [] };
  if (typeof f !== "object") throw new StoreError("invalid", "a filter is an object");
  const x = f as Record<string, unknown>;
  const list = (v: unknown): Sql[] => {
    if (!Array.isArray(v)) throw new StoreError("invalid", "and/or take a list of filters");
    return v.map((y) => compile(def, y));
  };
  const join = (parts: Sql[], op: string, empty: string): Sql =>
    parts.length ? { text: `(${parts.map((p) => p.text).join(` ${op} `)})`, args: parts.flatMap((p) => p.args) } : { text: empty, args: [] };
  if (x["and"] !== undefined) return join(list(x["and"]), "AND", "1");
  if (x["or"] !== undefined) return join(list(x["or"]), "OR", "0");
  if (x["not"] !== undefined) { const inner = compile(def, x["not"]); return { text: `(NOT COALESCE(${inner.text}, 0))`, args: inner.args }; }
  if (typeof x["field"] !== "string" || typeof x["op"] !== "string") throw new StoreError("invalid", "a filter needs field and op");
  const field = x["field"];
  const e = expr(def, field);
  const v = x["value"];
  switch (x["op"]) {
    case "eq": return { text: `(${e} IS ?)`, args: [bindable(v)] };
    case "ne": return { text: `(${e} IS NOT ?)`, args: [bindable(v)] };
    case "lt": case "lte": case "gt": case "gte": {
      const op = { lt: "<", lte: "<=", gt: ">", gte: ">=" }[x["op"]];
      return { text: `(${e} IS NOT NULL AND ${e} ${op} ?)`, args: [bindable(v)] };
    }
    case "between": {
      if (!Array.isArray(v) || v.length !== 2) throw new StoreError("invalid", "between takes [low, high]");
      return { text: `(${e} >= ? AND ${e} <= ?)`, args: [bindable(v[0]), bindable(v[1])] };
    }
    case "in": {
      if (!Array.isArray(v)) return { text: "0", args: [] };
      if (!v.length) return { text: "0", args: [] };
      return { text: `(${v.map(() => `${e} IS ?`).join(" OR ")})`, args: v.map(bindable) };
    }
    case "contains": {
      if (COLUMNS.has(field)) return { text: "0", args: [] };
      const needle = bindable(v);
      const text = typeof v === "string" ? `WHEN 'text' THEN instr(lower(${e}), lower(?)) > 0` : "";
      const jt = `json_type(r.data, '${pathOf(field)}')`;
      return {
        text: `(CASE ${jt} WHEN 'array' THEN EXISTS (SELECT 1 FROM json_each(r.data, '${pathOf(field)}') j WHERE j.value IS ?) ${text} ELSE 0 END)`,
        args: typeof v === "string" ? [needle, needle] : [needle],
      };
    }
    case "starts": return { text: `(typeof(${e}) = 'text' AND substr(${e}, 1, length(?)) = ?)`, args: [bindable(v), bindable(v)] };
    case "is_null": case "empty": return { text: `(${e} IS NULL OR ${e} = '')`, args: [] };
    case "notempty": return { text: `(${e} IS NOT NULL AND ${e} <> '')`, args: [] };
    default: throw new StoreError("invalid", `unknown filter op ${String(x["op"])}`);
  }
}

// ---- indexes ----

function fnv(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, "0");
}

/** Make sure the partial index of this sort exists. Cheap when it does: one catalogue lookup of a name. */
export function ensureSortIndex(tx: Tx, def: TypeDef, keys: readonly Sort[]): void {
  const cols = keys.filter((k) => k.field !== "id");
  const body = [...cols.map((k) => `${expr(def, k.field, "")} ${k.dir === "desc" ? "DESC" : "ASC"}`), "id ASC"];
  const name = `qx_${def.name}_${fnv(body.join(","))}`;
  if (tx.get("SELECT 1 AS x FROM sqlite_master WHERE type = 'index' AND name = ?", name)) return;
  tx.exec(`CREATE INDEX IF NOT EXISTS "${name}" ON rt_${def.name} (${body.join(", ")}) WHERE deleted_at IS NULL`);
}

// ---- ordering and paging ----

function effectiveSort(def: TypeDef, spec: ViewSpec): Sort[] {
  const out: Sort[] = [];
  if (spec.group) { expr(def, spec.group); out.push({ field: spec.group, dir: "asc" }); }
  for (const s of spec.sort ?? []) {
    if (!s || typeof s.field !== "string") throw new StoreError("invalid", "a sort needs a field");
    expr(def, s.field);
    out.push({ field: s.field, dir: s.dir === "desc" ? "desc" : "asc" });
  }
  if (!out.length) out.push({ field: "created_at", dir: "asc" });
  return out;
}

function decodeKey(cursor: string, n: number): unknown[] {
  try {
    const k = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as unknown;
    if (Array.isArray(k) && k.length === n) return k;
  } catch { /* falls through */ }
  throw new StoreError("invalid", "invalid cursor");
}

/** Rows strictly after the cursor in the total order (sort keys, then id). */
function after(def: TypeDef, keys: readonly Sort[], key: readonly unknown[]): Sql {
  const alts: string[] = [];
  const args: Bind[] = [];
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i]!;
    const e = expr(def, k.field);
    const eqs: string[] = [];
    const eqArgs: Bind[] = [];
    for (let j = 0; j < i; j++) { eqs.push(`${expr(def, keys[j]!.field)} IS ?`); eqArgs.push(bindable(key[j])); }
    const v = key[i];
    let cmp: string;
    const cmpArgs: Bind[] = [];
    if (k.dir === "asc") {
      if (v === null || v === undefined) cmp = `${e} IS NOT NULL`;
      else { cmp = `${e} > ?`; cmpArgs.push(bindable(v)); }
    } else if (v === null || v === undefined) cmp = "0";
    else { cmp = `(${e} < ? OR ${e} IS NULL)`; cmpArgs.push(bindable(v)); }
    alts.push(`(${[...eqs, cmp].join(" AND ")})`);
    args.push(...eqArgs, ...cmpArgs);
  }
  return { text: `(${alts.join(" OR ")})`, args };
}

function toRow(type: string, r: Raw, fields: readonly string[] | undefined): RecordRow {
  const all = JSON.parse(r.data) as Record<string, unknown>;
  let data = all;
  if (fields) { data = {}; for (const f of fields) if (Object.prototype.hasOwnProperty.call(all, f)) data[f] = all[f]; }
  return {
    id: r.id, type, version: r.version, label: r.label, fields: data, createdAt: r.created_at, updatedAt: r.updated_at, holds: r.holds,
    ...(r.deleted_at !== null ? { deletedAt: r.deleted_at } : {}),
  };
}

const SELECT = "SELECT r.id, r.version, r.created_at, r.updated_at, r.deleted_at, r.data, COALESCE(m.label, 0) AS label, COALESCE(m.holds, 0) AS holds";

function windowOf(spec: ViewSpec): { limit: number; offset: number } {
  const limit = Math.max(1, Math.min(Math.trunc(spec.limit ?? DEFAULT_LIMIT), MAX_LIMIT));
  const offset = Math.max(0, Math.trunc(spec.offset ?? 0));
  return { limit, offset };
}

function stampOf(tx: Tx): number {
  return tx.get<{ c: number | null }>("SELECT max(cursor) AS c FROM rs_changes")?.c ?? 0;
}

/** Exact row count of a filter, cached until the next write to the store. */
export function countOf(tx: Tx, def: TypeDef, filter: unknown): number {
  ensureBase(tx);
  const key = canonical(filter ?? null);
  const stamp = stampOf(tx);
  const hit = tx.get<{ n: number; stamp: number }>("SELECT n, stamp FROM qx_counts WHERE type = ? AND key = ?", def.name, key);
  if (hit && hit.stamp === stamp) return hit.n;
  let n: number;
  try {
    const w = compile(def, filter);
    n = tx.get<{ n: number }>(`SELECT count(*) AS n FROM rt_${def.name} r WHERE r.deleted_at IS NULL AND ${w.text}`, ...w.args)!.n;
  } catch (e) {
    if (!(e instanceof Unsupported)) throw e;
    n = 0;
    for (const r of tx.all<Raw>(`SELECT r.* FROM rt_${def.name} r WHERE r.deleted_at IS NULL`)) if (matches(filter as Filter | undefined, { ...r, data: JSON.parse(r.data) })) n++;
  }
  tx.run("INSERT INTO qx_counts (type, key, n, stamp) VALUES (?, ?, ?, ?) ON CONFLICT(type, key) DO UPDATE SET n = excluded.n, stamp = excluded.stamp", def.name, key, n, stamp);
  return n;
}

/** The view as SQL when it can be, else the exact in-memory fallback. */
export function runQuery(tx: Tx, type: string, spec: ViewSpec): { rows: RecordRow[]; next?: string; total: number } {
  ensureBase(tx);
  const def = typeDef(tx, type);
  const sort = effectiveSort(def, spec);
  const keys: Sort[] = [...sort, { field: "id", dir: "asc" }];
  const { limit, offset } = windowOf(spec);
  const fields = spec.fields && spec.fields.length ? spec.fields : undefined;
  const total = countOf(tx, def, spec.filter);
  let rows: Raw[];
  try {
    const where = compile(def, spec.filter);
    const args: Bind[] = [type, ...where.args];
    let text = `${SELECT} FROM rt_${type} r LEFT JOIN records_row_meta m ON m.type = ? AND m.id = r.id WHERE r.deleted_at IS NULL AND ${where.text}`;
    if (spec.cursor) {
      const a = after(def, keys, decodeKey(spec.cursor, keys.length));
      text += ` AND ${a.text}`;
      args.push(...a.args);
    }
    ensureSortIndex(tx, def, sort);
    text += ` ORDER BY ${keys.map((k) => `${expr(def, k.field)} ${k.dir === "desc" ? "DESC" : "ASC"}`).join(", ")} LIMIT ${limit + 1}`;
    if (offset && !spec.cursor) text += ` OFFSET ${offset}`;
    rows = tx.all<Raw>(text, ...args);
  } catch (e) {
    if (!(e instanceof Unsupported)) throw e;
    return fallback(tx, def, spec, sort, limit, offset, fields, total);
  }
  const more = rows.length > limit;
  if (more) rows = rows.slice(0, limit);
  const out = rows.map((r) => toRow(type, r, fields));
  const last = rows[rows.length - 1];
  const next = more && last ? encodeCursor({ ...last, data: JSON.parse(last.data) }, sort) : undefined;
  return { rows: out, ...(next !== undefined ? { next } : {}), total };
}

function fallback(tx: Tx, def: TypeDef, spec: ViewSpec, sort: Sort[], limit: number, offset: number, fields: readonly string[] | undefined, total: number): { rows: RecordRow[]; next?: string; total: number } {
  const meta = new Map(tx.all<{ id: string; label: number; holds: number }>("SELECT id, label, holds FROM records_row_meta WHERE type = ?", def.name).map((m) => [m.id, m]));
  const live = (function* () {
    for (const r of tx.all<Raw>(`SELECT * FROM rt_${def.name} WHERE deleted_at IS NULL`)) yield { ...r, type: def.name, data: JSON.parse(r.data) as Record<string, unknown> };
  })();
  const res = page(live, { ...(spec.filter !== undefined ? { filter: spec.filter as Filter } : {}), sort, page: { limit: limit + offset, ...(spec.cursor ? { cursor: spec.cursor } : {}) } });
  if ("error" in res) throw new StoreError("invalid", res.error);
  const sliced = res.rows.slice(offset);
  const rows = sliced.map((r: { id: string; version: number; created_at: number; updated_at: number; deleted_at: number | null; data: Record<string, unknown> }) => {
    const m = meta.get(r.id);
    return toRow(def.name, { ...r, data: JSON.stringify(r.data), label: m?.label ?? 0, holds: m?.holds ?? 0 }, fields);
  });
  const trimmed = rows.slice(0, limit);
  const lastRaw = sliced[trimmed.length - 1];
  const next = res.next_cursor !== undefined && lastRaw ? encodeCursor(lastRaw, sort) : undefined;
  return { rows: trimmed, ...(next !== undefined ? { next } : {}), total };
}

// ---- search ----

const BODY = (row: string): string => `COALESCE((SELECT group_concat(value, ' ') FROM json_each(${row}.data) WHERE type = 'text'), '')`;

/** FTS5 index of every text value of a type, kept by triggers. Returns false when FTS5 is not compiled in. */
function ensureSearch(tx: Tx, type: string): boolean {
  const fts = `qx_${type}_fts`;
  const trig = `${fts}_ai`;
  const haveTable = tx.get("SELECT 1 AS x FROM sqlite_master WHERE name = ?", fts) !== undefined;
  const haveTrig = tx.get("SELECT 1 AS x FROM sqlite_master WHERE type = 'trigger' AND name = ?", trig) !== undefined;
  if (haveTable && haveTrig) return true;
  try {
    if (haveTable) tx.exec(`DROP TABLE IF EXISTS "${fts}"`);
    tx.exec(`CREATE VIRTUAL TABLE "${fts}" USING fts5(body)`);
  } catch { return false; }
  tx.exec(`DROP TRIGGER IF EXISTS "${trig}"`);
  tx.exec(`DROP TRIGGER IF EXISTS "${fts}_au"`);
  tx.exec(`INSERT INTO "${fts}" (rowid, body) SELECT rowid, ${BODY(`rt_${type}`)} FROM rt_${type}`);
  tx.exec(`CREATE TRIGGER "${fts}_au" AFTER UPDATE OF data ON rt_${type} BEGIN
    DELETE FROM "${fts}" WHERE rowid = old.rowid;
    INSERT INTO "${fts}" (rowid, body) VALUES (new.rowid, ${BODY("new")});
  END`);
  tx.exec(`CREATE TRIGGER "${trig}" AFTER INSERT ON rt_${type} BEGIN
    INSERT INTO "${fts}" (rowid, body) VALUES (new.rowid, ${BODY("new")});
  END`);
  return true;
}

const WORD = /[\p{L}\p{N}_]+/gu;
const likeEscape = (s: string): string => s.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");

export function runSearch(tx: Tx, type: string, q: string, o: { cursor?: string; limit?: number }): { rows: RecordRow[]; next?: string; total?: number } {
  ensureBase(tx);
  const def = typeDef(tx, type);
  const words = q.match(WORD) ?? [];
  if (!words.length) return { rows: [], total: 0 };
  const limit = Math.max(1, Math.min(Math.trunc(o.limit ?? 50), MAX_LIMIT));
  let skip = 0;
  if (o.cursor) {
    try { skip = (JSON.parse(Buffer.from(o.cursor, "base64url").toString("utf8")) as { o: number }).o; } catch { throw new StoreError("invalid", "invalid cursor"); }
    if (!Number.isInteger(skip) || skip < 0) throw new StoreError("invalid", "invalid cursor");
  }
  let rows: Raw[];
  if (ensureSearch(tx, def.name)) {
    const match = words.map((w) => `"${w}"*`).join(" ");
    rows = tx.all<Raw>(
      `${SELECT} FROM "qx_${type}_fts" JOIN rt_${type} r ON r.rowid = "qx_${type}_fts".rowid LEFT JOIN records_row_meta m ON m.type = ? AND m.id = r.id
       WHERE "qx_${type}_fts" MATCH ? AND r.deleted_at IS NULL ORDER BY rank, r.id LIMIT ${limit + 1} OFFSET ${skip}`,
      type, match,
    );
  } else {
    const cond = words.map(() => `${BODY("r")} LIKE ? ESCAPE '\\'`).join(" AND ");
    rows = tx.all<Raw>(
      `${SELECT} FROM rt_${type} r LEFT JOIN records_row_meta m ON m.type = ? AND m.id = r.id WHERE r.deleted_at IS NULL AND ${cond} ORDER BY r.id LIMIT ${limit + 1} OFFSET ${skip}`,
      type, ...words.map((w) => `%${likeEscape(w)}%`),
    );
  }
  const more = rows.length > limit;
  if (more) rows = rows.slice(0, limit);
  const next = more ? Buffer.from(JSON.stringify({ o: skip + limit })).toString("base64url") : undefined;
  return { rows: rows.map((r) => toRow(type, r, undefined)), ...(next !== undefined ? { next } : {}) };
}

// ---- saved views ----

export interface SavedView {
  viewId: string;
  type: string;
  title: string;
  kind: string;
  spec: ViewSpec;
  shared: boolean;
  ownerId: string;
  createdAt: number;
  updatedAt: number;
}

interface ViewRow { view_id: string; type: string; title: string; kind: string; spec: string; shared: number; owner_id: string; created_at: number; updated_at: number }
const viewOf = (r: ViewRow): SavedView => ({
  viewId: r.view_id, type: r.type, title: r.title, kind: r.kind, spec: JSON.parse(r.spec) as ViewSpec, shared: r.shared === 1, ownerId: r.owner_id, createdAt: r.created_at, updatedAt: r.updated_at,
});

/**
 * Save or replace a view. The sort index and the count of its filter are built now, so the first open of the view is already a range scan
 * and its total is a lookup. A personal view can only be replaced by its owner.
 */
export function saveView(deps: QueryDeps, v: { viewId: string; type: string; title: string; kind?: string; spec: ViewSpec; shared?: boolean; ownerId: string }): SavedView {
  const { tx } = deps;
  ensureBase(tx);
  const def = typeDef(tx, v.type);
  if (!v.viewId || !v.title.trim()) throw new StoreError("invalid", "a view needs an id and a title");
  const sort = effectiveSort(def, v.spec);
  try { compile(def, v.spec.filter); } catch (e) { if (!(e instanceof Unsupported)) throw e; }
  const prior = tx.get<ViewRow>("SELECT * FROM qx_views WHERE view_id = ?", v.viewId);
  if (prior && prior.owner_id !== v.ownerId) throw new StoreError("invalid", "only the owner of a view changes it");
  const now = (deps.now ?? Date.now)();
  const spec = JSON.stringify(v.spec);
  tx.run(
    `INSERT INTO qx_views (view_id, type, title, kind, spec, shared, owner_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(view_id) DO UPDATE SET title = excluded.title, kind = excluded.kind, spec = excluded.spec, shared = excluded.shared, updated_at = excluded.updated_at`,
    v.viewId, v.type, v.title, v.kind ?? "table", spec, v.shared ? 1 : 0, v.ownerId, prior?.created_at ?? now, now,
  );
  try { ensureSortIndex(tx, def, sort); } catch (e) { if (!(e instanceof Unsupported)) throw e; }
  countOf(tx, def, v.spec.filter);
  return viewOf(tx.get<ViewRow>("SELECT * FROM qx_views WHERE view_id = ?", v.viewId)!);
}

/** Views of a type the person may open: their own and every shared one. */
export function listViews(deps: QueryDeps, type: string, ownerId: string): SavedView[] {
  ensureBase(deps.tx);
  return deps.tx.all<ViewRow>("SELECT * FROM qx_views WHERE type = ? AND (shared = 1 OR owner_id = ?) ORDER BY created_at, view_id", type, ownerId).map(viewOf);
}

export function deleteView(deps: QueryDeps, viewId: string, ownerId: string): boolean {
  ensureBase(deps.tx);
  return deps.tx.run("DELETE FROM qx_views WHERE view_id = ? AND owner_id = ?", viewId, ownerId).changes > 0;
}

/** Run a saved view with an optional cursor. */
export function runView(deps: QueryDeps, viewId: string, o: { cursor?: string } = {}): { rows: RecordRow[]; next?: string; total: number } {
  ensureBase(deps.tx);
  const r = deps.tx.get<ViewRow>("SELECT * FROM qx_views WHERE view_id = ?", viewId);
  if (!r) throw new StoreError("not_found", `no view ${viewId}`);
  const v = viewOf(r);
  return runQuery(deps.tx, v.type, { ...v.spec, ...(o.cursor ? { cursor: o.cursor } : {}) });
}

// ---- handlers ----

export function createQueryHandlers(deps: QueryDeps): QueryHandlers {
  const guard = <T>(ctx: Pick<WriteCtx, "trace">, run: () => T): Promise<T> => {
    try { return Promise.resolve(run()); } catch (e) { return Promise.resolve().then(() => mapError(ctx as WriteCtx, e)); }
  };
  return {
    "records.query": (ctx, input) => guard(ctx, () => {
      const { type, ...spec } = input;
      return runQuery(deps.tx, type, spec);
    }),
    "records.search": (ctx, input) => guard(ctx, () => runSearch(deps.tx, input.type, input.q, {
      ...(input.cursor !== undefined ? { cursor: input.cursor } : {}), ...(input.limit !== undefined ? { limit: input.limit } : {}),
    })),
    "records.counts": (ctx, input) => guard(ctx, () => ({ count: countOf(deps.tx, typeDef(deps.tx, input.type), input.filter) })),
  };
}

