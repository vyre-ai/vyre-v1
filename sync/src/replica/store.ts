// ReplicaStore (ARCH 5.10, 5.11, 9). One write path: a SQL transaction, then invalidation
// of (entity, id). Prepared statements are created at open. A registry hash change rebuilds
// the schema from the generated replica DDL. The local edit returns after that write.
import { compareHlc, parseHlc } from "../../../lib/hlc.ts";
import { loadCatalog } from "./catalog.ts";
import { CLIENT_SQL, loadReplicaSql } from "./ddl.ts";
import type { ColumnInfo, TableInfo } from "./ddl.ts";
import { admit, fieldsAboveCeiling, labelRankOf, rowTime } from "./profile.ts";
import { quoteIdent } from "./sql.ts";
import { BLOB_BUDGET_BYTES, ReplicaError } from "./types.ts";
import type {
  DeviceClass, EntityInfo, HideRow, LabelName, OpenReplicaOptions, PendingOp, RebuildTarget, ReplicaStore, ReplicaWrite,
  ReplicaWriteResult, SqlDriver, SqlRow, SqlStatement, SqlValue, SubscribeMatch, WriteOrigin,
} from "./types.ts";

const HASH_KEY = "registry_hash";
const ORDER_FIELDS = ["updated_at", "updatedAt", "createdAt", "created_at", "at"];

interface RowSql {
  columns: ColumnInfo[];
  names: Set<string>;
  select: SqlStatement;
  delete: SqlStatement;
  upsert: SqlStatement;
  count: SqlStatement | null;
  ids: SqlStatement | null;
}

interface FmSql {
  select: SqlStatement;
  upsert: SqlStatement;
  clear: SqlStatement;
}

interface Prepared {
  rows: Map<string, RowSql>;
  fm: Map<string, FmSql>;
  stateGet: SqlStatement;
  stateSet: SqlStatement;
  ftsDelete: SqlStatement;
  ftsInsert: SqlStatement;
  ftsSelect: SqlStatement;
  blobUpsert: SqlStatement;
  blobGet: SqlStatement;
  blobSum: SqlStatement;
  blobOldest: SqlStatement;
  blobDelete: SqlStatement;
  blobTouch: SqlStatement;
  keepUpsert: SqlStatement;
  keepDelete: SqlStatement;
  keepAll: SqlStatement;
  hideUpsert: SqlStatement;
  hideAll: SqlStatement;
  pendingInsert: SqlStatement;
  pendingCount: SqlStatement;
  tableExists: SqlStatement;
  count: number;
}

function pair(entity: string, id: string): string {
  return `${entity}\0${id}`;
}

function num(v: SqlValue | undefined): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "bigint") return Number(v);
  return 0;
}

function text(v: SqlValue | undefined): string {
  return typeof v === "string" ? v : "";
}

function orderColumn(names: Set<string>): string | null {
  for (const name of ORDER_FIELDS) if (names.has(name)) return name;
  return null;
}

function upsertSql(table: string, columns: string[]): string {
  const updates = columns.filter((c) => c !== "id");
  if (!updates.length) throw new ReplicaError("bad_ddl", `${table} has no columns beside id`);
  const cols = columns.map(quoteIdent).join(", ");
  const marks = columns.map(() => "?").join(", ");
  const sets = updates.map((c) => `${quoteIdent(c)} = excluded.${quoteIdent(c)}`).join(", ");
  return `INSERT INTO ${quoteIdent(table)} (${cols}) VALUES (${marks}) ON CONFLICT("id") DO UPDATE SET ${sets}`;
}

function copyFields(input: Record<string, SqlValue | boolean>): Record<string, SqlValue> {
  const out: Record<string, SqlValue> = {};
  for (const [k, v] of Object.entries(input)) {
    if (v === undefined) continue;
    out[k] = typeof v === "boolean" ? (v ? 1 : 0) : v;
  }
  return out;
}

function hlcNewer(prev: string, next: string): boolean {
  const a = parseHlc(prev);
  const b = parseHlc(next);
  if (!a || !b) return false;
  return compareHlc(a, b) > 0;
}

function ftsOf(entity: EntityInfo, row: SqlRow): { title: string; body: string } | null {
  const parts: string[] = [];
  for (const field of entity.fts) {
    const v = row[field];
    if (typeof v === "string" && v.length) parts.push(v);
    else if (typeof v === "number" || typeof v === "bigint") parts.push(String(v));
  }
  const title = parts[0];
  if (title === undefined) return null;
  return { title, body: parts.slice(1).join("\n") };
}

function readHash(driver: SqlDriver): string | null {
  driver.exec("CREATE TABLE IF NOT EXISTS sync_state (k TEXT PRIMARY KEY, v)");
  const row = driver.prepare("SELECT v FROM sync_state WHERE k = ?").get([HASH_KEY]);
  if (!row || row.v === null) return null;
  return String(row.v);
}

/** Client-only tables that hold the person's own work or device state. A schema rebuild never drops them (unsynced edits must survive). */
const KEEP_ON_REBUILD: ReadonlySet<string> = new Set(["pending_ops", "rejected", "conflicts_local", "doc_local", "blob_cache", "replica_keep", "sync_state", "sqlite_sequence"]);

function dropTargets(driver: SqlDriver, all: readonly RebuildTarget[]): void {
  const targets = all.filter((t) => !KEEP_ON_REBUILD.has(t.name));
  const lines: string[] = [];
  for (const t of targets) if (t.virtual) lines.push(`DROP TABLE IF EXISTS ${quoteIdent(t.name)}`);
  for (const t of targets) {
    if (t.virtual || t.name.startsWith("fts_")) continue;
    lines.push(`DROP TABLE IF EXISTS ${quoteIdent(t.name)}`);
  }
  if (lines.length) driver.exec(lines.join(";\n"));
}

function listTargets(driver: SqlDriver): RebuildTarget[] {
  const rows = driver.prepare("SELECT name, type, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'").all([]);
  const out: RebuildTarget[] = [];
  for (const r of rows) {
    if (r.type !== "table" || typeof r.name !== "string") continue;
    const sql = typeof r.sql === "string" ? r.sql : "";
    out.push({ name: r.name, virtual: /^CREATE\s+VIRTUAL/i.test(sql) });
  }
  return out;
}

function ensurePending(driver: SqlDriver, tables: readonly TableInfo[]): void {
  for (const t of tables) {
    if (!t.fm) continue;
    const quoted = quoteIdent(t.name);
    if (driver.sync) {
      const row = driver.prepare(`SELECT name FROM pragma_table_info('${t.name}') WHERE name = 'pending'`).get([]);
      if (row) continue;
    }
    driver.exec(`ALTER TABLE ${quoted} ADD COLUMN pending INTEGER NOT NULL DEFAULT 0`);
  }
}

function prepareAll(driver: SqlDriver, tables: readonly TableInfo[]): Prepared {
  let count = 0;
  const prep = (sql: string): SqlStatement => {
    count += 1;
    return driver.prepare(sql);
  };
  const rows = new Map<string, RowSql>();
  const fm = new Map<string, FmSql>();
  const byName = new Map(tables.map((t) => [t.name, t] as const));
  for (const t of tables) {
    if (t.fm) continue;
    const names = new Set(t.columns.map((c) => c.name));
    const order = orderColumn(names);
    const where = names.has("deleted_at") ? " WHERE deleted_at IS NULL" : "";
    const q = quoteIdent(t.name);
    rows.set(t.name, {
      columns: t.columns,
      names,
      select: prep(`SELECT * FROM ${q} WHERE id = ?`),
      delete: prep(`DELETE FROM ${q} WHERE id = ?`),
      upsert: prep(upsertSql(t.name, t.columns.map((c) => c.name))),
      count: order ? prep(`SELECT count(*) AS n FROM ${q}${where}`) : null,
      ids: order ? prep(`SELECT id FROM ${q}${where} ORDER BY ${quoteIdent(order)} DESC`) : null,
    });
    const meta = byName.get(`${t.name}__fm`);
    if (!meta) continue;
    const fq = quoteIdent(meta.name);
    fm.set(t.name, {
      select: prep(`SELECT field, hlc FROM ${fq} WHERE id = ?`),
      upsert: prep(`INSERT INTO ${fq} (id, field, hlc, actor, seq, pending) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(id, field) DO UPDATE SET hlc = excluded.hlc, actor = excluded.actor, seq = excluded.seq, pending = excluded.pending`),
      clear: prep(`DELETE FROM ${fq} WHERE id = ?`),
    });
  }
  return {
    rows,
    fm,
    stateGet: prep("SELECT v FROM sync_state WHERE k = ?"),
    stateSet: prep("INSERT INTO sync_state (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v"),
    ftsDelete: prep("DELETE FROM fts WHERE entity = ? AND id = ?"),
    ftsInsert: prep("INSERT INTO fts (entity, id, title, body) VALUES (?, ?, ?, ?)"),
    ftsSelect: prep("SELECT title, body FROM fts WHERE entity = ? AND id = ?"),
    blobUpsert: prep("INSERT INTO blob_cache (hash, bytes, size, last_used) VALUES (?, ?, ?, ?) ON CONFLICT(hash) DO UPDATE SET bytes = excluded.bytes, size = excluded.size, last_used = excluded.last_used"),
    blobGet: prep("SELECT bytes FROM blob_cache WHERE hash = ?"),
    blobSum: prep("SELECT coalesce(sum(size), 0) AS total FROM blob_cache"),
    blobOldest: prep("SELECT hash, size FROM blob_cache ORDER BY last_used ASC, hash ASC LIMIT 1"),
    blobDelete: prep("DELETE FROM blob_cache WHERE hash = ?"),
    blobTouch: prep("UPDATE blob_cache SET last_used = ? WHERE hash = ?"),
    keepUpsert: prep("INSERT INTO replica_keep (entity, id, starred, follows) VALUES (?, ?, ?, ?) ON CONFLICT(entity, id) DO UPDATE SET starred = excluded.starred, follows = excluded.follows"),
    keepDelete: prep("DELETE FROM replica_keep WHERE entity = ? AND id = ?"),
    keepAll: prep("SELECT entity, id, starred, follows FROM replica_keep"),
    hideUpsert: prep("INSERT INTO hide_seq (entity, id, seq) VALUES (?, ?, ?) ON CONFLICT(entity, id) DO UPDATE SET seq = excluded.seq"),
    hideAll: prep("SELECT entity, id, seq FROM hide_seq"),
    pendingInsert: prep("INSERT INTO pending_ops (op_id, trace_id, hlc, cap, v, entity, id, input, base_seq, state, tries, last_error, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', 0, NULL, ?) ON CONFLICT(op_id) DO NOTHING"),
    pendingCount: prep("SELECT count(*) AS n FROM pending_ops WHERE state = 'queued'"),
    tableExists: prep("SELECT 1 AS x FROM sqlite_master WHERE name = ?"),
    count,
  };
}

class Replica implements ReplicaStore {
  readonly deviceClass: DeviceClass;
  readonly registryHash: string;
  readonly upgraded: boolean;
  readonly preparedCount: number;
  private readonly driver: SqlDriver;
  private readonly phoneCeiling: LabelName;
  private readonly personId: string | null;
  private readonly clock: () => number;
  private readonly blobBudget: number;
  private readonly catalog: Map<string, EntityInfo>;
  private readonly sql: Prepared;
  private readonly overlay = new Map<string, SqlRow | null>();
  private readonly ftsCache = new Map<string, { title: string; body: string } | null>();
  private readonly hides = new Map<string, number>();
  private readonly starred = new Set<string>();
  private readonly follows = new Set<string>();
  private readonly subs = new Set<{ entity: string; id?: string; fn: () => void }>();
  private closed = false;

  constructor(opts: OpenReplicaOptions, upgraded: boolean, sql: Prepared, catalog: Map<string, EntityInfo>) {
    this.driver = opts.driver;
    this.deviceClass = opts.deviceClass;
    this.registryHash = opts.registryHash;
    this.upgraded = upgraded;
    this.preparedCount = sql.count;
    this.phoneCeiling = opts.phoneCeiling ?? "confidential";
    this.personId = opts.personId ?? null;
    this.clock = opts.clock ?? Date.now;
    this.blobBudget = opts.blobBudgetBytes ?? BLOB_BUDGET_BYTES[opts.deviceClass];
    this.catalog = catalog;
    this.sql = sql;
    this.seed(opts);
  }

  private seed(opts: OpenReplicaOptions): void {
    if ("hideRows" in opts) {
      for (const h of opts.hideRows ?? []) this.hides.set(pair(h.entity, h.id), h.seq);
    } else if (this.driver.sync) {
      for (const r of this.sql.hideAll.all([])) {
        if (typeof r.entity === "string" && typeof r.id === "string") this.hides.set(pair(r.entity, r.id), num(r.seq));
      }
    }
    if ("starredKeys" in opts || "followsKeys" in opts) {
      for (const k of opts.starredKeys ?? []) this.starred.add(k);
      for (const k of opts.followsKeys ?? []) this.follows.add(k);
      return;
    }
    if (!this.driver.sync) return;
    for (const r of this.sql.keepAll.all([])) {
      if (typeof r.entity !== "string" || typeof r.id !== "string") continue;
      const key = pair(r.entity, r.id);
      if (num(r.starred) === 1) this.starred.add(key);
      if (num(r.follows) === 1) this.follows.add(key);
    }
  }

  private alive(): void {
    if (this.closed) throw new ReplicaError("closed", "replica is closed");
  }

  private emit(entity: string, id: string): void {
    for (const sub of [...this.subs]) {
      if (sub.entity !== entity) continue;
      if (sub.id !== undefined && sub.id !== id) continue;
      sub.fn();
    }
  }

  private existing(entity: string, id: string, row: RowSql): SqlRow | null {
    const key = pair(entity, id);
    if (this.overlay.has(key)) return this.overlay.get(key) ?? null;
    if (!this.driver.sync) return null;
    return row.select.get([id]) ?? null;
  }

  private fmPrev(table: string, id: string): Map<string, string> {
    const out = new Map<string, string>();
    const fm = this.sql.fm.get(table);
    if (!fm || !this.driver.sync) return out;
    for (const r of fm.select.all([id])) {
      if (typeof r.field === "string" && typeof r.hlc === "string") out.set(r.field, r.hlc);
    }
    return out;
  }

  private writeFts(entity: EntityInfo, id: string, row: SqlRow): { title: string; body: string } | null {
    this.sql.ftsDelete.run([entity.key, id]);
    const hit = ftsOf(entity, row);
    if (hit) this.sql.ftsInsert.run([entity.key, id, hit.title, hit.body]);
    return hit;
  }

  private trim(entity: EntityInfo, row: RowSql, removed: string[]): void {
    const cap = entity.profile[this.deviceClass] === "window" ? entity.window.recentCount : undefined;
    if (cap === undefined || !row.count || !row.ids) return;
    if (num(row.count.get([])?.n) <= cap) return;
    let seen = 0;
    for (const r of row.ids.all([])) {
      if (typeof r.id !== "string") continue;
      seen += 1;
      if (seen <= cap) continue;
      const key = pair(entity.key, r.id);
      if (this.starred.has(key)) continue;
      row.delete.run([r.id]);
      this.sql.fm.get(entity.table)?.clear.run([r.id]);
      this.sql.ftsDelete.run([entity.key, r.id]);
      this.sql.keepDelete.run([entity.key, r.id]);
      removed.push(r.id);
    }
  }

  private insertOp(input: ReplicaWrite, op: PendingOp): void {
    this.sql.pendingInsert.run([op.opId, op.traceId, input.hlc, op.cap, op.v, input.entity, input.id, op.input, op.baseSeq, this.clock()]);
  }

  write(input: ReplicaWrite): ReplicaWriteResult {
    this.alive();
    if (!input.entity || !input.id) throw new ReplicaError("bad_write", "entity and id are required");
    if (!input.hlc || !input.actor) throw new ReplicaError("bad_write", "hlc and actor are required");
    const entity = this.catalog.get(input.entity);
    if (!entity) throw new ReplicaError("unknown_entity", `no replica entity ${input.entity}`);
    const row = this.sql.rows.get(entity.table);
    if (!row) throw new ReplicaError("unknown_entity", `no table for ${input.entity}`);
    const origin: WriteOrigin = input.origin ?? "local";
    const key = pair(input.entity, input.id);
    const hidden = this.hides.get(key);
    if (hidden !== undefined && (input.seq === undefined || input.seq <= hidden)) return { applied: false, reason: "hidden" };

    const stripped = new Set(fieldsAboveCeiling(entity, this.deviceClass, this.phoneCeiling));
    const fields = copyFields(input.fields);
    const supplied = Object.keys(fields);
    for (const k of supplied) if (stripped.has(k)) delete fields[k];
    if (supplied.length > 0 && supplied.every((k) => stripped.has(k))) return { applied: false, reason: "above_label" };

    const existing = this.existing(input.entity, input.id, row);
    if (origin === "local") {
      if (row.names.has("version") && !Object.prototype.hasOwnProperty.call(fields, "version")) {
        fields.version = (existing && typeof existing.version === "number" ? existing.version : 0) + 1;
      }
      if (row.names.has("updated_at") && !Object.prototype.hasOwnProperty.call(fields, "updated_at")) fields.updated_at = this.clock();
    }
    for (const k of Object.keys(fields)) {
      if (k !== "id" && !row.names.has(k)) throw new ReplicaError("bad_field", `${input.entity}.${k} is not a column`);
    }

    const base: SqlRow = {};
    for (const col of row.columns) {
      if (existing && Object.prototype.hasOwnProperty.call(existing, col.name)) base[col.name] = existing[col.name] ?? null;
      else if (col.hasDefault) base[col.name] = col.defaultValue;
      else base[col.name] = null;
    }
    base.id = input.id;
    const proposed: SqlRow = { ...base };
    for (const [k, v] of Object.entries(fields)) {
      if (k === "id" || v === undefined) continue;
      proposed[k] = v;
    }
    const starred = input.starred === true || (input.starred !== false && this.starred.has(key));
    const follows = input.follows === true || (input.follows !== false && this.follows.has(key));
    const ownerField = entity.ownerField;
    const ownerValue = ownerField ? proposed[ownerField] : null;
    const decision = admit({
      deviceClass: this.deviceClass,
      phoneCeiling: this.phoneCeiling,
      entity,
      rowLabel: input.label !== undefined ? labelRankOf(input.label) : labelRankOf(proposed.label),
      at: rowTime(row.names, entity.datetimeFields, proposed),
      now: this.clock(),
      starred,
      follows,
      owner: typeof ownerValue === "string" ? ownerValue : null,
      personId: this.personId,
      origin,
      exists: existing !== null,
    });
    if (!decision.ok) return { applied: false, reason: decision.reason };

    const prev = origin === "mirror" ? this.fmPrev(entity.table, input.id) : new Map<string, string>();
    const changed: string[] = [];
    const merged: SqlRow = { ...base };
    for (const [k, v] of Object.entries(fields)) {
      if (k === "id" || v === undefined) continue;
      const was = prev.get(k);
      if (was !== undefined && hlcNewer(was, input.hlc)) continue;
      merged[k] = v;
      changed.push(k);
    }
    if (!changed.length && existing) return { applied: false, reason: "older" };

    const values = row.columns.map((col) => {
      if (col.name === "id") return input.id;
      const v = merged[col.name];
      if (v !== undefined && v !== null) return v;
      if (col.hasDefault) return col.defaultValue;
      return null;
    });
    const removed: string[] = [];
    const op = input.op;
    this.driver.transaction(() => {
      row.upsert.run(values);
      const fm = this.sql.fm.get(entity.table);
      const pending = origin === "local" ? 1 : 0;
      if (fm) {
        for (const k of changed) fm.upsert.run([input.id, k, input.hlc, input.actor, input.seq ?? null, pending]);
      }
      if (input.starred === true) this.starred.add(key);
      else if (input.starred === false) this.starred.delete(key);
      if (input.follows === true) this.follows.add(key);
      else if (input.follows === false) this.follows.delete(key);
      if (input.starred !== undefined || input.follows !== undefined) {
        this.sql.keepUpsert.run([input.entity, input.id, this.starred.has(key) ? 1 : 0, this.follows.has(key) ? 1 : 0]);
      }
      const hit = this.writeFts(entity, input.id, merged);
      this.ftsCache.set(key, hit);
      if (op) this.insertOp(input, op);
      this.trim(entity, row, removed);
    });

    const stored: SqlRow = {};
    row.columns.forEach((col, i) => {
      stored[col.name] = values[i] ?? null;
    });
    this.overlay.set(key, stored);
    for (const id of removed) {
      const rk = pair(input.entity, id);
      this.overlay.set(rk, null);
      this.ftsCache.set(rk, null);
      this.starred.delete(rk);
      this.follows.delete(rk);
    }
    this.emit(input.entity, input.id);
    for (const id of removed) if (id !== input.id) this.emit(input.entity, id);
    return { applied: true, reason: "ok" };
  }

  read(entity: string, id: string): SqlRow | null {
    this.alive();
    const key = pair(entity, id);
    if (this.overlay.has(key)) return this.overlay.get(key) ?? null;
    const info = this.catalog.get(entity);
    const row = info ? this.sql.rows.get(info.table) : undefined;
    if (!row || !this.driver.sync) return null;
    const found = row.select.get([id]);
    if (!found) return null;
    this.overlay.set(key, found);
    return found;
  }

  hide(entity: string, id: string, seq: number): void {
    this.alive();
    const key = pair(entity, id);
    const prev = this.hides.get(key);
    const next = prev === undefined ? seq : Math.max(prev, seq);
    this.hides.set(key, next);
    const info = this.catalog.get(entity);
    this.driver.transaction(() => {
      this.sql.hideUpsert.run([entity, id, next]);
      if (info) {
        this.sql.rows.get(info.table)?.delete.run([id]);
        this.sql.fm.get(info.table)?.clear.run([id]);
      }
      this.sql.ftsDelete.run([entity, id]);
      this.sql.keepDelete.run([entity, id]);
    });
    this.overlay.set(key, null);
    this.ftsCache.set(key, null);
    this.starred.delete(key);
    this.follows.delete(key);
    this.emit(entity, id);
  }

  subscribe(match: SubscribeMatch, fn: () => void): () => void {
    const sub = match.id === undefined ? { entity: match.entity, fn } : { entity: match.entity, id: match.id, fn };
    this.subs.add(sub);
    return () => {
      this.subs.delete(sub);
    };
  }

  putBlob(hash: string, bytes: Uint8Array): void {
    this.alive();
    const size = bytes.byteLength;
    this.driver.transaction(() => {
      this.sql.blobUpsert.run([hash, bytes, size, this.clock()]);
      let total = num(this.sql.blobSum.get([])?.total);
      while (total > this.blobBudget) {
        const old = this.sql.blobOldest.get([]);
        if (!old || typeof old.hash !== "string") break;
        this.sql.blobDelete.run([old.hash]);
        total -= num(old.size);
        if (old.hash === hash) break;
      }
    });
  }

  getBlob(hash: string): Uint8Array | null {
    this.alive();
    const row = this.sql.blobGet.get([hash]);
    const bytes = row?.bytes;
    if (!(bytes instanceof Uint8Array)) return null;
    this.sql.blobTouch.run([this.clock(), hash]);
    return bytes;
  }

  readFts(entity: string, id: string): { title: string; body: string } | null {
    this.alive();
    const key = pair(entity, id);
    if (this.ftsCache.has(key)) return this.ftsCache.get(key) ?? null;
    if (!this.driver.sync) return null;
    const row = this.sql.ftsSelect.get([entity, id]);
    if (!row) return null;
    const hit = { title: text(row.title), body: text(row.body) };
    this.ftsCache.set(key, hit);
    return hit;
  }

  pendingCount(): number {
    this.alive();
    return num(this.sql.pendingCount.get([])?.n);
  }

  getState(key: string): string | null {
    this.alive();
    const row = this.sql.stateGet.get([key]);
    if (!row || row.v === null) return null;
    return String(row.v);
  }

  hasTable(name: string): boolean {
    this.alive();
    return this.sql.tableExists.get([name]) !== undefined;
  }

  load(entity: string, id: string): Promise<SqlRow | null> {
    this.alive();
    const info = this.catalog.get(entity);
    const row = info ? this.sql.rows.get(info.table) : undefined;
    if (!info || !row) return Promise.resolve(null);
    const sql = `SELECT * FROM ${quoteIdent(info.table)} WHERE id = ?`;
    return this.driver.flush().then(() => this.driver.query(sql, [id])).then((found) => {
      const key = pair(entity, id);
      if (!found) {
        this.overlay.set(key, null);
        return null;
      }
      this.overlay.set(key, found);
      return found;
    });
  }

  flush(): Promise<void> {
    return this.driver.flush();
  }

  close(): Promise<void> {
    if (this.closed) return Promise.resolve();
    this.closed = true;
    if (this.driver.sync) {
      this.driver.close();
      return Promise.resolve();
    }
    return this.driver.flush().then(() => {
      this.driver.close();
      return this.driver.flush();
    });
  }
}

/** Open a replica on a driver that runs SQL before returning (node:sqlite, expo-sqlite). */
export function openReplica(opts: OpenReplicaOptions): ReplicaStore {
  const catalog = loadCatalog();
  const ddl = loadReplicaSql();
  const driver = opts.driver;
  driver.exec("PRAGMA foreign_keys = OFF");
  const stored = "storedRegistryHash" in opts ? (opts.storedRegistryHash ?? null) : readHash(driver);
  const upgraded = stored !== null && stored !== opts.registryHash;
  if (upgraded) dropTargets(driver, "rebuildTargets" in opts && opts.rebuildTargets ? opts.rebuildTargets : listTargets(driver));
  driver.exec(ddl.sql);
  driver.exec(CLIENT_SQL);
  ensurePending(driver, ddl.tables);
  const sql = prepareAll(driver, ddl.tables);
  if (upgraded) {
    // The row tables are empty again: forget the cursor so the sync engine takes a snapshot; pending_ops stay and are re-applied on top.
    driver.prepare("DELETE FROM sync_state WHERE k <> ?").run([HASH_KEY]);
    sql.stateSet.run(["needs_snapshot", "1"]);
  }
  sql.stateSet.run([HASH_KEY, opts.registryHash]);
  return new Replica(opts, upgraded, sql, catalog);
}

export type { HideRow };
