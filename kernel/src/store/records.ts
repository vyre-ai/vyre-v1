// The RecordStore facade (ARCH 4.3.1). `records.rows` is an inline projection: record events fold into one `rt_<type>` table per record type, in the same transaction as the append.
// `createRecordStore` implements the 0.6 Store contract over those tables, so kernel/conformance keeps guarding it. A write reads the row, checks the version the caller read (version_conflict
// for HTTP, MCP and outside-actor callers; sync ops carry per-field baseSeq and never come through here), then appends ONE event; the projection does the table write.
//
// Rows keep their data as JSON in `data`; the records module adds the typed, indexed column per field for views (ARCH 4.3). This facade reads a type's rows through the shared query code
// (query.ts), which is exact and bounded in memory, and is what the conformance suite measures.
import { DatabaseSync } from "node:sqlite";
import { canonical } from "../../../lib/canonical.ts";
import { isRecordId } from "../../../lib/ids.ts";
import { sha256Hex } from "../log/hash.ts";
import type { NewEvent, StoredEvent } from "../log/types.ts";
import { aggregate as agg, encodeCursor, fieldOf, page } from "./query.ts";
import { ProjectionHost, payloadOf } from "./projection.ts";
import type { InlineProjection, Tx } from "./projection.ts";
import { StoreError } from "./types.ts";
import type {
  AggregateRow,
  AggregateSpec,
  ChangeEntry,
  CreateManyResult,
  UpdateManyResult,
  DefineDiff,
  DefineResult,
  ExportChunk,
  FieldDef,
  Page,
  QuerySpec,
  SearchHit,
  SearchSpec,
  Store,
  StoredRecord,
  TypeDef,
} from "./types.ts";
import { checkValue } from "./values.ts";
import { AsyncLocalStorage } from "node:async_hooks";

/** The conformance suite revision this store last passed. Bump with kernel/conformance/suite.ts. */
export const CONFORMANCE_REVISION = 7;

const NAME = /^[a-z][a-z0-9_]{0,62}$/;
const table = (type: string): string => {
  if (!NAME.test(type))
    throw new StoreError("invalid", `record type names are lowercase letters, digits and underscores: ${type}`);
  return `rt_${type}`;
};

interface Row {
  id: string;
  version: number;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
  data: string;
}

// ---- the projection ----

const rowTable = (t: string): string =>
  `CREATE TABLE IF NOT EXISTS ${table(t)} (id TEXT PRIMARY KEY, version INTEGER NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER, data TEXT NOT NULL)`;

function note(
  tx: Tx,
  kind: string,
  type: string,
  id: string,
  version: number,
  at: number,
  before: unknown,
  after: unknown,
): void {
  tx.run(
    "INSERT INTO rs_changes (type, id, kind, version, at, before, after) VALUES (?, ?, ?, ?, ?, ?, ?)",
    type,
    id,
    kind,
    version,
    at,
    before === undefined ? null : JSON.stringify(before),
    JSON.stringify(after ?? {}),
  );
}

/** Moves whenever any `rs_types` table changes (schema.applied, a rebuild's reset), so `typesSnapshot` can keep its parsed list until then. Process-wide, which only ever makes a cache read again, never serve a stale list. */
let typesEpoch = 0;

/** `records.rows`: schema.applied, record.created, record.updated, record.removed, record.restored. Bump `version` to rebuild every rt_ table from the log on the next open. */
export const recordsRows: InlineProjection = {
  name: "records.rows",
  version: 1,
  mode: "inline",
  rebuild: "replay",
  init(tx) {
    tx.exec("CREATE TABLE IF NOT EXISTS rs_types (name TEXT PRIMARY KEY, def TEXT NOT NULL)");
    tx.exec(
      "CREATE TABLE IF NOT EXISTS rs_changes (cursor INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT NOT NULL, id TEXT NOT NULL, kind TEXT NOT NULL, version INTEGER NOT NULL, at INTEGER NOT NULL, before TEXT, after TEXT)",
    );
  },
  reset(tx) {
    for (const t of tx.all<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'rt\\_%' ESCAPE '\\'",
    ))
      tx.exec(`DROP TABLE IF EXISTS "${t.name}"`);
    tx.exec("DELETE FROM rs_types");
    typesEpoch++;
    tx.exec("DELETE FROM rs_changes");
    tx.exec("DELETE FROM sqlite_sequence WHERE name = 'rs_changes'");
  },
  on: {
    "schema.applied"(tx, e: StoredEvent) {
      const p = payloadOf<{ set?: TypeDef[]; removed?: string[] }>(e);
      typesEpoch++;
      for (const d of p.set ?? []) {
        tx.exec(rowTable(d.name));
        tx.run(
          "INSERT INTO rs_types (name, def) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET def = excluded.def",
          d.name,
          JSON.stringify(d),
        );
      }
      for (const n of p.removed ?? []) {
        tx.exec(`DROP TABLE IF EXISTS ${table(n)}`);
        tx.run("DELETE FROM rs_types WHERE name = ?", n);
      }
      typesEpoch++;
    },
    "record.created"(tx, e) {
      const p = payloadOf<{ type: string; id: string; data: object; at: number }>(e);
      tx.run(
        `INSERT INTO ${table(p.type)} (id, version, created_at, updated_at, deleted_at, data) VALUES (?, 1, ?, ?, NULL, ?)`,
        p.id,
        p.at,
        p.at,
        JSON.stringify(p.data),
      );
      note(tx, "created", p.type, p.id, 1, p.at, undefined, p.data);
    },
    "record.updated"(tx, e) {
      const p = payloadOf<{ type: string; id: string; data: object; before: object; version: number; at: number }>(e);
      tx.run(
        `UPDATE ${table(p.type)} SET data = ?, version = ?, updated_at = ? WHERE id = ?`,
        JSON.stringify(p.data),
        p.version,
        p.at,
        p.id,
      );
      note(tx, "updated", p.type, p.id, p.version, p.at, p.before, p.data);
    },
    /** A row's whole state again, written after the payloads of its older events were erased (a field was sealed): a rebuild skips those events and this puts the row back, refs only. */
    "record.rebased"(tx, e) {
      const p = payloadOf<{
        type: string;
        id: string;
        data: object;
        version: number;
        created_at: number;
        updated_at: number;
        deleted_at: number | null;
      }>(e);
      tx.exec(rowTable(p.type));
      tx.run(
        `INSERT INTO ${table(p.type)} (id, version, created_at, updated_at, deleted_at, data) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET version = excluded.version, updated_at = excluded.updated_at, deleted_at = excluded.deleted_at, data = excluded.data`,
        p.id,
        p.version,
        p.created_at,
        p.updated_at,
        p.deleted_at,
        JSON.stringify(p.data),
      );
    },
    "record.removed"(tx, e) {
      const p = payloadOf<{ type: string; id: string; version: number; at: number }>(e);
      tx.run(
        `UPDATE ${table(p.type)} SET version = ?, deleted_at = ?, updated_at = ? WHERE id = ?`,
        p.version,
        p.at,
        p.at,
        p.id,
      );
      note(
        tx,
        "removed",
        p.type,
        p.id,
        p.version,
        p.at,
        undefined,
        JSON.parse(tx.get<Row>(`SELECT data FROM ${table(p.type)} WHERE id = ?`, p.id)!.data),
      );
    },
    "record.restored"(tx, e) {
      const p = payloadOf<{ type: string; id: string; version: number; at: number }>(e);
      tx.run(
        `UPDATE ${table(p.type)} SET version = ?, deleted_at = NULL, updated_at = ? WHERE id = ?`,
        p.version,
        p.at,
        p.id,
      );
      note(
        tx,
        "restored",
        p.type,
        p.id,
        p.version,
        p.at,
        undefined,
        JSON.parse(tx.get<Row>(`SELECT data FROM ${table(p.type)} WHERE id = ?`, p.id)!.data),
      );
    },
  },
};

// ---- the facade ----

const clone = <T>(v: T): T => structuredClone(v);
const fail = (code: ConstructorParameters<typeof StoreError>[0], message: string): StoreError =>
  new StoreError(code, message);
const TRACE = (): string =>
  Array.from(globalThis.crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");

/** Who a record write is for, for the length of one call: the records module runs each handler inside `recordWriter.run`, so every event the store appends names the real actor. */
export interface RecordWriter {
  actor: string;
  onBehalf?: string | undefined;
  traceId?: string | undefined;
  runId?: string | undefined;
  /** Set by a handler that announces each record it makes with a module `record.created` event after the call: the record's own event then names who and how (see host/src/daemon/record-announce.ts), so a stop between the two writes can be repaired. */
  announce?: { quiet?: boolean; depth?: number; origin?: string } | undefined;
}
export const recordWriter = new AsyncLocalStorage<RecordWriter>();

export interface RecordStoreOptions {
  /** Who the events are attributed to. */
  actor?: string;
  clock?: () => number;
}

export function createRecordStore(host: ProjectionHost, o: RecordStoreOptions = {}): Store {
  const actor = o.actor ?? "svc_records";
  const clock = o.clock ?? Date.now;
  const tx = host.tx;

  const announceOf = (): { announce?: { quiet?: boolean; depth?: number; origin?: string } } => {
    const a = recordWriter.getStore()?.announce;
    return a ? { announce: { ...a } } : {};
  };
  const eventOf = (type: string, entity: string, entityId: string | undefined, payload: object): NewEvent => {
    // whoever made the call this write is part of (recordWriter.run): the person or agent, the person an agent acts for, the trace and the run; the store's own actor only when nobody is
    const w = recordWriter.getStore();
    const who = w
      ? {
          actor: w.actor,
          ...(w.onBehalf !== undefined && w.onBehalf !== w.actor ? { on_behalf: w.onBehalf } : {}),
          ...(w.runId !== undefined ? { run_id: w.runId } : {}),
        }
      : { actor };
    const trace = w?.traceId !== undefined && /^[0-9a-f]{32}$/.test(w.traceId) ? w.traceId : TRACE();
    return {
      type,
      sv: 1,
      trace_id: trace,
      ...who,
      vis: "space",
      entity,
      ...(entityId ? { entity_id: entityId } : {}),
      payload,
    };
  };
  const emit = (type: string, entity: string, entityId: string | undefined, payload: object): void => {
    try {
      host.append(eventOf(type, entity, entityId, payload));
    } catch (e) {
      throw fail("unavailable", e instanceof Error ? e.message : String(e));
    }
  };

  let snapshot: { epoch: number; defs: readonly TypeDef[] } | null = null;
  const defOf = (type: string): TypeDef | undefined => {
    const r = tx.get<{ def: string }>("SELECT def FROM rs_types WHERE name = ?", type);
    return r ? (JSON.parse(r.def) as TypeDef) : undefined;
  };
  const needType = (type: string): TypeDef => {
    const d = defOf(type);
    if (!d) throw fail("unknown_type", `no type ${type}`);
    return d;
  };
  const record = (type: string, r: Row): StoredRecord => ({
    type,
    id: r.id,
    version: r.version,
    data: JSON.parse(r.data),
    created_at: r.created_at,
    updated_at: r.updated_at,
    ...(r.deleted_at !== null ? { deleted_at: r.deleted_at } : {}),
  });
  const rowOf = (type: string, id: string): Row | undefined =>
    tx.get<Row>(`SELECT * FROM ${table(type)} WHERE id = ?`, id);
  function* rows(type: string, live: boolean): Generator<StoredRecord> {
    for (const r of tx.all<Row>(`SELECT * FROM ${table(type)}${live ? " WHERE deleted_at IS NULL" : ""}`))
      yield record(type, r);
  }

  const SINCE_OPS: Record<string, string> = { gt: ">", gte: ">=", lt: "<", lte: "<=" };
  /** Pages in SQL when the query has no sort and no filter beyond one comparison of created_at or updated_at with a number; null when the general path must answer. */
  function keyset(type: string, spec: QuerySpec): Page<StoredRecord> | null {
    if (spec.sort?.length) return null;
    const f = spec.filter as { field?: string; op?: string; value?: unknown } | undefined;
    let where = spec.include_deleted ? "1 = 1" : "deleted_at IS NULL";
    const args: unknown[] = [];
    if (f) {
      if (
        (f.field !== "updated_at" && f.field !== "created_at") ||
        SINCE_OPS[f.op ?? ""] === undefined ||
        typeof f.value !== "number"
      )
        return null;
      where += ` AND ${f.field} ${SINCE_OPS[f.op!]} ?`;
      args.push(f.value);
    }
    if (spec.page.cursor) {
      let key: unknown;
      try {
        key = JSON.parse(Buffer.from(spec.page.cursor, "base64url").toString("utf8"));
      } catch {
        return null;
      }
      if (!Array.isArray(key) || key.length !== 1 || typeof key[0] !== "string") return null;
      where += " AND id > ?";
      args.push(key[0]);
    }
    const limit = Math.max(1, Math.min(spec.page.limit, 500));
    const got = tx.all<Row>(`SELECT * FROM ${table(type)} WHERE ${where} ORDER BY id LIMIT ?`, ...args, limit + 1);
    const out = got.slice(0, limit).map((r) => record(type, r));
    return {
      rows: out,
      ...(got.length > limit && out.length ? { next_cursor: encodeCursor(out[out.length - 1], undefined) } : {}),
    };
  }

  function validate(def: TypeDef, data: Record<string, unknown>): void {
    const known = new Set(def.fields.map((f) => f.name));
    for (const k of Object.keys(data)) if (!known.has(k)) throw fail("unknown_field", `${def.name} has no field ${k}`);
    for (const f of def.fields) {
      const err = checkValue(f, data[f.name]);
      if (err === "sealed_value_refused")
        throw fail("sealed_value_refused", `${f.name} is sealed: a value is never stored, only a reference`);
      if (err) throw fail("invalid", err);
    }
  }
  /** What create asks of one new record before it writes: a contract id that is not taken (nor repeated in the batch), and values the type accepts. Throws the refusal. */
  function checkNewItem(
    def: TypeDef,
    type: string,
    it: { id: string; data: Readonly<Record<string, unknown>> },
    seen: ReadonlySet<string>,
  ): void {
    if (!isRecordId(it.id)) throw fail("invalid", "id must be a contract record id: rec_ then 32 hex digits");
    if (seen.has(it.id) || rowOf(type, it.id)) throw fail("invalid", `${type} ${it.id} already exists`);
    validate(def, it.data as Record<string, unknown>);
  }
  const uniques = (def: TypeDef): FieldDef[] => def.fields.filter((f) => f.unique === true);
  /** Refuse a value another LIVE record holds. */
  function checkUnique(def: TypeDef, data: Record<string, unknown>, selfId: string | null): void {
    for (const f of uniques(def)) {
      const v = data[f.name];
      if (v === undefined || v === null) continue;
      let holder: string | undefined;
      if (typeof v === "string" || typeof v === "number") {
        holder = tx.get<{ id: string }>(
          `SELECT id FROM ${table(def.name)} WHERE deleted_at IS NULL AND json_extract(data, ?) = ? AND id IS NOT ? LIMIT 1`,
          `$."${f.name}"`,
          v,
          selfId,
        )?.id;
      } else {
        const want = canonical(v);
        for (const r of rows(def.name, true))
          if (r.id !== selfId && r.data[f.name] !== undefined && canonical(r.data[f.name]) === want) {
            holder = r.id;
            break;
          }
      }
      if (holder)
        throw Object.assign(
          fail("unique_violation", `${f.name} must be unique: another ${def.name} already has that value`),
          { field: f.name, value: v },
        );
    }
  }
  function checkNoDuplicates(def: TypeDef): void {
    for (const f of uniques(def)) {
      const seen = new Set<string>();
      for (const r of rows(def.name, true)) {
        const v = r.data[f.name];
        if (v === undefined || v === null) continue;
        const k = canonical(v);
        if (seen.has(k))
          throw fail(
            "unique_violation",
            `${f.name} of ${def.name} already has duplicate values, so it cannot be made unique`,
          );
        seen.add(k);
      }
    }
  }
  const checkDef = (t: TypeDef): void => {
    if (!t || typeof t.name !== "string" || !Array.isArray(t.fields))
      throw fail("invalid", "a type needs a name and fields");
    table(t.name);
  };

  const store: Store = {
    async define(diff: DefineDiff): Promise<DefineResult> {
      const set: TypeDef[] = [],
        removed: string[] = [],
        changes: string[] = [];
      for (const t of diff.add_types ?? []) {
        checkDef(t);
        const had = defOf(t.name);
        if (had && canonical(had) === canonical(t)) continue;
        if (had) checkNoDuplicates(t);
        set.push(clone(t) as TypeDef);
        changes.push(had ? `changed type ${t.name}` : `added type ${t.name}`);
      }
      for (const t of diff.change_types ?? []) {
        checkDef(t);
        const had = defOf(t.name);
        if (!had) throw fail("unknown_type", `no type ${t.name}`);
        if (canonical(had) === canonical(t)) continue;
        checkNoDuplicates(t);
        set.push(clone(t) as TypeDef);
        changes.push(`changed type ${t.name}`);
      }
      for (const name of diff.remove_types ?? []) {
        if (!defOf(name)) continue;
        if (tx.get(`SELECT 1 AS x FROM ${table(name)} WHERE deleted_at IS NULL LIMIT 1`))
          throw fail("invalid", `type ${name} still has records`);
        removed.push(name);
        changes.push(`removed type ${name}`);
      }
      if (changes.length) emit("schema.applied", "schema", undefined, { set, removed });
      return { applied: changes.length > 0, changes };
    },
    async types() {
      return tx
        .all<{ def: string }>("SELECT def FROM rs_types ORDER BY rowid")
        .map((r) => JSON.parse(r.def) as TypeDef);
    },
    typesSnapshot() {
      // sync reads this once per row it scans: parse the types again only after a schema change
      if (snapshot && snapshot.epoch === typesEpoch) return snapshot.defs;
      const epoch = typesEpoch;
      const defs = tx
        .all<{ def: string }>("SELECT def FROM rs_types ORDER BY rowid")
        .map((r) => JSON.parse(r.def) as TypeDef);
      snapshot = { epoch, defs };
      return defs;
    },
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
      // The common read, the whole type in order of id (no sort), or the records changed since a time, is a keyset read in SQL: one page of rows is read and decoded, not the whole type for every page
      // (a pass over a 100,000-record type decoded every record once per page of 500, about 200 times over, and held the server for seconds).
      const fast = keyset(type, spec);
      if (fast) return fast;
      const p = page(rows(type, !spec.include_deleted), spec);
      if ("error" in p) throw fail("invalid", p.error);
      return p;
    },
    async aggregate(type, spec: AggregateSpec): Promise<AggregateRow[]> {
      const def = needType(type);
      const sealed = (f: unknown): boolean =>
        typeof f === "string" && def.fields.some((d) => d.name === f && d.kind === "sealed");
      for (const g of spec.group_by ?? [])
        if (sealed(g)) throw fail("invalid", `${g} is sealed: it cannot be grouped by`);
      for (const m of spec.measures ?? [])
        if (m && sealed(m.field)) throw fail("invalid", `${m.field} is sealed: it cannot be measured`);
      // how many records the type holds: a count in SQL, not every record decoded (a sync pass asks before it decides whether to read the type)
      const only = spec.measures.length === 1 ? spec.measures[0]! : null;
      if (!spec.filter && !(spec.group_by ?? []).length && only?.fn === "count" && !only.field)
        return [
          {
            group: {},
            values: {
              count: tx.get<{ n: number }>(`SELECT count(*) AS n FROM ${table(type)} WHERE deleted_at IS NULL`)?.n ?? 0,
            },
          },
        ];
      return agg(rows(type, true), spec);
    },
    async create(type, id, data) {
      const def = needType(type);
      if (!isRecordId(id)) throw fail("invalid", "id must be a contract record id: rec_ then 32 hex digits");
      if (rowOf(type, id)) throw fail("invalid", `${type} ${id} already exists`);
      validate(def, data as Record<string, unknown>);
      checkUnique(def, data as Record<string, unknown>, null);
      const at = clock();
      emit("record.created", type, id, { type, id, data: clone(data), at, ...announceOf() });
      return record(type, rowOf(type, id)!);
    },
    async checkNew(type, items) {
      const def = needType(type);
      const seen = new Set<string>();
      return items.map((it) => {
        try {
          checkNewItem(def, type, it, seen);
          seen.add(it.id);
          return null;
        } catch (e) {
          return e;
        }
      });
    },
    async createMany(type, items) {
      const def = needType(type);
      const out: CreateManyResult[] = new Array(items.length);
      // a unique field is checked against the records already stored, and a batch is not stored yet: one record at a time keeps that check exact
      if (uniques(def).length) {
        for (let i = 0; i < items.length; i++) {
          try {
            out[i] = { ok: true, record: await store.create(type, items[i]!.id, items[i]!.data) };
          } catch (e) {
            out[i] = { ok: false, error: e };
          }
        }
        return out;
      }
      const evs: NewEvent[] = [];
      const at: number[] = [];
      const seen = new Set<string>();
      items.forEach((it, i) => {
        try {
          checkNewItem(def, type, it, seen);
          seen.add(it.id);
          evs.push(eventOf("record.created", type, it.id, { type, id: it.id, data: clone(it.data), at: clock(), ...announceOf() }));
          at.push(i);
        } catch (e) {
          out[i] = { ok: false, error: e };
        }
      });
      // one transaction and one commit for the whole group (the log's group commit); a record's own projections still run for each event, in order
      let results: ReturnType<ProjectionHost["appendGroup"]>;
      try {
        results = host.appendGroup(evs);
      } catch (e) {
        throw fail("unavailable", e instanceof Error ? e.message : String(e));
      }
      results.forEach((r, k) => {
        const i = at[k]!;
        out[i] = r.ok
          ? { ok: true, record: record(type, rowOf(type, items[i]!.id)!) }
          : // the whole transaction failed (every item answers "internal", nothing was committed): the store is unavailable. One event the log refused on its own (the rest committed) is that row's refusal.
            {
              ok: false,
              error:
                r.code === "internal"
                  ? fail("unavailable", r.message)
                  : // a row the log refused alone: the caller gets a plain sentence; the log's own words stay on the error as `detail` for the host log
                    Object.assign(fail("invalid", "This record could not be saved."), { detail: r.message }),
            };
      });
      return out;
    },
    async updateMany(type, items) {
      const def = needType(type);
      const out: UpdateManyResult[] = new Array(items.length);
      // a unique field is checked against the records already stored, and an id that repeats must see its earlier update: one at a time keeps both exact
      if (uniques(def).length || new Set(items.map((x) => x.id)).size !== items.length) {
        for (let i = 0; i < items.length; i++) {
          try {
            out[i] = {
              ok: true,
              record: await store.update(type, items[i]!.id, items[i]!.patch, items[i]!.base_version),
            };
          } catch (e) {
            out[i] = { ok: false, error: e };
          }
        }
        return out;
      }
      const evs: NewEvent[] = [];
      const at: number[] = [];
      items.forEach((it, i) => {
        try {
          const r = rowOf(type, it.id);
          if (!r || r.deleted_at !== null) throw fail("not_found", `no ${type} ${it.id}`);
          if (r.version !== it.base_version)
            throw fail("version_conflict", `${type} ${it.id} is at version ${r.version}, not ${it.base_version}`);
          const before = JSON.parse(r.data) as Record<string, unknown>,
            merged = { ...before };
          for (const [k, v] of Object.entries(it.patch)) {
            if (v === null) delete merged[k];
            else merged[k] = clone(v);
          }
          validate(def, merged);
          // an update that changes nothing is not a write: no event, no new version
          if (sameValue(before, merged)) {
            out[i] = { ok: true, record: record(type, r) };
            return;
          }
          evs.push(
            eventOf("record.updated", type, it.id, {
              type,
              id: it.id,
              data: merged,
              before,
              version: r.version + 1,
              at: clock(),
            }),
          );
          at.push(i);
        } catch (e) {
          out[i] = { ok: false, error: e };
        }
      });
      if (!evs.length) return out;
      // one transaction and one commit for the whole group; a record's own projections still run for each event, in order
      let results: ReturnType<ProjectionHost["appendGroup"]>;
      try {
        results = host.appendGroup(evs);
      } catch (e) {
        throw fail("unavailable", e instanceof Error ? e.message : String(e));
      }
      results.forEach((r, k) => {
        const i = at[k]!;
        out[i] = r.ok
          ? { ok: true, record: record(type, rowOf(type, items[i]!.id)!) }
          : { ok: false, error: r.code === "internal" ? fail("unavailable", r.message) : fail("invalid", r.message) };
      });
      return out;
    },
    async update(type, id, patch, base) {
      const def = needType(type);
      const r = rowOf(type, id);
      if (!r || r.deleted_at !== null) throw fail("not_found", `no ${type} ${id}`);
      if (r.version !== base) throw fail("version_conflict", `${type} ${id} is at version ${r.version}, not ${base}`);
      const before = JSON.parse(r.data) as Record<string, unknown>,
        merged = { ...before };
      for (const [k, v] of Object.entries(patch)) {
        if (v === null) delete merged[k];
        else merged[k] = clone(v);
      }
      validate(def, merged);
      checkUnique(def, merged, id);
      // an update that changes nothing is not a write: no event, no new version (a writer that repeats itself every pass must not grow the log)
      if (sameValue(before, merged)) return record(type, rowOf(type, id)!);
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
          let score = 0,
            snippet: string | undefined;
          for (const f of def.fields) {
            if (f.kind === "sealed") continue;
            const v = fieldOf(r, f.name);
            const text =
              typeof v === "string" ? v : Array.isArray(v) && v.every((x) => typeof x === "string") ? v.join(" ") : "";
            const low = text.toLowerCase();
            for (const w of words)
              if (low.includes(w)) {
                score += 1;
                snippet = snippet ?? text.slice(0, 80);
              }
          }
          if (score) hits.push({ type: def.name, id: r.id, score, ...(snippet ? { snippet } : {}) });
        }
      }
      hits.sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      let start = 0;
      if (spec.page.cursor) {
        const i = hits.findIndex((h) => h.id === spec.page.cursor);
        start = i === -1 ? hits.length : i + 1;
      }
      const slice = hits.slice(start, start + spec.page.limit);
      return {
        rows: slice,
        ...(start + spec.page.limit < hits.length && slice.length ? { next_cursor: slice[slice.length - 1]!.id } : {}),
      };
    },
    async changes(since, limit) {
      if (since !== null && !/^c\d+$/.test(since)) throw fail("invalid", "bad changes cursor");
      const from = since ? Number(since.slice(1)) : 0;
      const rs = tx.all<{
        cursor: number;
        type: string;
        id: string;
        kind: ChangeEntry["kind"];
        version: number;
        at: number;
        before: string | null;
        after: string | null;
      }>("SELECT * FROM rs_changes WHERE cursor > ? ORDER BY cursor LIMIT ?", from, limit);
      const entries: ChangeEntry[] = rs.map((r) => ({
        cursor: `c${r.cursor}`,
        type: r.type,
        id: r.id,
        kind: r.kind,
        version: r.version,
        at: r.at,
        ...(r.before ? { before: JSON.parse(r.before) } : {}),
        ...(r.after ? { after: JSON.parse(r.after) } : {}),
      }));
      return { entries, cursor: `c${rs.length ? rs[rs.length - 1]!.cursor : from}` };
    },
    async health() {
      try {
        tx.get("SELECT 1");
        return { ok: true, checked_at: clock() };
      } catch (e) {
        return { ok: false, detail: String(e), checked_at: clock() };
      }
    },
    async version() {
      return { store: "recordstore", version: "1", conformance: CONFORMANCE_REVISION };
    },
    async *export(since?: string): AsyncGenerator<ExportChunk> {
      const all: StoredRecord[] = [];
      for (const def of await store.types())
        for (const r of rows(def.name, false)) if (!since || r.updated_at >= Number(since)) all.push(r);
      all.sort((a, b) => (a.id < b.id ? -1 : 1));
      let seq = 0;
      for (let i = 0; i < Math.max(1, all.length); i += 100) {
        const records = all.slice(i, i + 100);
        yield { seq: seq++, records, done: i + 100 >= all.length, checksum: sha256Hex(canonical(records)) };
      }
    },
    features() {
      return { aggregate: true, search: true, changes: true, cursor_paging: true as const };
    },
  };
  return store;
}

/** A host with `records.rows` registered, and the RecordStore over it. `path` is a file, or ":memory:" for tests. */
export function openRecordStore(o: {
  path: string;
  space: string;
  actor?: string;
  clock?: () => number;
  extra?: InlineProjection[];
}): { host: ProjectionHost; store: Store } {
  const db = new DatabaseSync(o.path);
  const host = new ProjectionHost({
    db,
    space: o.space,
    projections: [recordsRows, ...(o.extra ?? [])],
    ...(o.clock ? { clock: o.clock } : {}),
  });
  return {
    host,
    store: createRecordStore(host, { ...(o.actor ? { actor: o.actor } : {}), ...(o.clock ? { clock: o.clock } : {}) }),
  };
}

/** Structural equality of two JSON values (object key order does not matter). */
export function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => sameValue(x, b[i]));
  const ka = Object.keys(a as object),
    kb = Object.keys(b as object);
  return (
    ka.length === kb.length &&
    ka.every(
      (k) =>
        Object.prototype.hasOwnProperty.call(b, k) &&
        sameValue((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
    )
  );
}
