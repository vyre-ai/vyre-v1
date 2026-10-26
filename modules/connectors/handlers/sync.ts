// Synced types and the sync engine's capabilities (spec 2.10, ARCH 4.3.1 and 8): sync_types.* (17), connectors.sync_now, connectors.outbox.list/retry/cancel and connectors.push.
// This file owns the BINDING of a record type to a remote object (table cn_synced_types) and everything a person or an agent does to it: bind, change, pause, review remote schema
// changes, detach, read the log and the outbox, start a sync Run. The work of a pass (three-way compare, outbox flush, undo, conflict settling) is the sync engine in modules/sources
// (P-L3_06). Modules are leaf nodes (boundary B1), so the engine is not imported: the host hands it in as `deps.engine` (SyncEngine below), the same way it hands in the Vault.
// With no engine wired, the handlers that need one refuse with internal.unavailable and everything else works. sync_now starts a Run of kind connector_sync and writes what it was
// asked to do into cn_sync_requests; the Run executor (the sources engine) reads the request by run id.
// The engine's tables (sy_log, sy_outbox, sy_conflicts, sy_state) are read here and the outbox and conflict status flips below are the only writes to them.
// @reads /modules/connectors/migrations/0001_connectors.sql
// @reads /modules/sources/migrations/0001_sources.sql
import type { Tx } from "../../../kernel/src/store/projection.ts";
import { ensureTables, mintShort, nowOf, PAGE, refuse, seedBuiltins } from "../projections.ts";
import type { ConnectionDb, ConnectorDef, ConnectorsCtx, ConnectorsDeps } from "../projections.ts";
import { executeAction } from "./runtime.ts";

export type Dir = "pull" | "push" | "both" | "off";
export type DeleteMode = "off" | "soft" | "travel";
export type ConflictRule = "newest" | "source" | "vyre" | "ask";
export type SyncState = "initial" | "syncing" | "paused" | "needs_review" | "error";
export type SyncMode = "incremental" | "reconcile" | "backfill" | "dry_run";
export type OutboxState = "pending" | "sent" | "failed" | "canceled" | "undone";

export interface FieldMapRow { key: string; remote: string; dir: Dir; transform?: string }
export interface PollingRow { activeSec: number; idleSec: number; dormantSec: number }
export interface SchemaChange { changeKey: string; kind: "field_added" | "field_removed" | "field_retyped" | "object_removed"; remote: string; summary: string; key?: string; fieldType?: string }

/** A synced type as the engine and the Run executor see it. */
export interface SyncBindingRow {
  syncTypeId: string; type: string; connector: string; connectionId: string; remote: string; state: SyncState;
  fields: FieldMapRow[]; match: string[]; createAtSource: boolean; deletes: DeleteMode; conflict: ConflictRule; polling: PollingRow; nightlyReconcile: boolean;
  lastSyncAt?: number; pending: number; conflicts: number; schemaChanges: number;
}
export interface PreviewRow { creates: number; updates: number; removes: number; skips: number; summary: string; matches?: { sure: number; unsure: number; none: number }; samples: { recordId?: string; remoteId?: string; op: string; changes: Record<string, unknown> }[] }
export interface OutboxRow { outboxId: string; syncTypeId: string; recordId: string; op: "create" | "update" | "delete"; fields: string[]; state: OutboxState; attempts: number; idempotencyKey: string; error?: string; at: number }
export interface LogRow { at: number; kind: "pull" | "push" | "conflict" | "error" | "schema"; summary: string; runId?: string; traceId?: string }
export interface DiscoveredObject { remote: string; title: string; fields: { remote: string; type: string; proposedKey: string; proposedType: string; sensitive: boolean }[] }

/** What the sync engine (modules/sources) offers the handlers. The host wires it; every method gets the binding it works on. */
export interface SyncEngine {
  preview(ctx: ConnectorsCtx, b: SyncBindingRow, o: { direction?: "pull" | "push" | "both" }): Promise<PreviewRow>;
  confirmDeletes(ctx: ConnectorsCtx, b: SyncBindingRow, decision: "mark_removed" | "keep"): Promise<number>;
  resolveConflict(ctx: ConnectorsCtx, b: SyncBindingRow, conflictId: string, resolution: "ours" | "theirs" | "value", value?: unknown): Promise<{ recordId: string }>;
  replayConflict(ctx: ConnectorsCtx, b: SyncBindingRow, conflictId: string): Promise<{ rule: ConflictRule; value: unknown }[]>;
  undoPush(ctx: ConnectorsCtx, b: SyncBindingRow, outboxId: string): Promise<{ undone: boolean; reason?: string }>;
  push(ctx: ConnectorsCtx, b: SyncBindingRow, outboxId: string): Promise<{ state: "sent" | "failed"; error?: string }>;
}
export type SyncDeps = ConnectorsDeps & { engine?: SyncEngine };

export interface BindingIn {
  type: string; connectionId: string; remote: string; fields: FieldMapRow[]; match: string[]; createAtSource?: boolean; deletes?: DeleteMode; conflict?: ConflictRule; polling?: PollingRow; nightlyReconcile?: boolean;
}

export interface SyncHandlers {
  "sync_types.list"(ctx: ConnectorsCtx, input: { connector?: string; cursor?: string; limit?: number }): Promise<{ syncedTypes: SyncBindingRow[]; next?: string; total?: number }>;
  "sync_types.get"(ctx: ConnectorsCtx, input: { type: string }): Promise<{ syncedType: SyncBindingRow }>;
  "sync_types.discover"(ctx: ConnectorsCtx, input: { connectionId: string; remote?: string }): Promise<{ objects: DiscoveredObject[] }>;
  "sync_types.create"(ctx: ConnectorsCtx, input: BindingIn): Promise<{ syncedType: SyncBindingRow }>;
  "sync_types.update"(ctx: ConnectorsCtx, input: { type: string; fields?: FieldMapRow[]; match?: string[]; createAtSource?: boolean; deletes?: DeleteMode; conflict?: ConflictRule; polling?: PollingRow; nightlyReconcile?: boolean }): Promise<{ syncedType: SyncBindingRow }>;
  "sync_types.preview"(ctx: ConnectorsCtx, input: { type: string; direction?: "pull" | "push" | "both" }): Promise<PreviewRow>;
  "sync_types.pause"(ctx: ConnectorsCtx, input: { type: string }): Promise<{ ok: boolean }>;
  "sync_types.resume"(ctx: ConnectorsCtx, input: { type: string }): Promise<{ ok: boolean }>;
  "sync_types.log"(ctx: ConnectorsCtx, input: { type: string; cursor?: string; limit?: number }): Promise<{ entries: LogRow[]; next?: string; total?: number }>;
  "sync_types.schema_changes"(ctx: ConnectorsCtx, input: { type: string }): Promise<{ changes: Omit<SchemaChange, "key" | "fieldType">[] }>;
  "sync_types.review_schema"(ctx: ConnectorsCtx, input: { type: string; accept: string[]; ignore: string[] }): Promise<{ accepted: number; ignored: number }>;
  "sync_types.confirm_deletes"(ctx: ConnectorsCtx, input: { type: string; decision: "mark_removed" | "keep" }): Promise<{ removed: number }>;
  "sync_types.make_native"(ctx: ConnectorsCtx, input: { type: string }): Promise<{ ok: boolean }>;
  "sync_types.resolve_conflict"(ctx: ConnectorsCtx, input: { conflictId: string; resolution: "ours" | "theirs" | "value"; value?: unknown }): Promise<{ recordId: string }>;
  "sync_types.replay_conflict"(ctx: ConnectorsCtx, input: { conflictId: string }): Promise<{ results: { rule: ConflictRule; value: unknown }[] }>;
  "sync_types.undo_push"(ctx: ConnectorsCtx, input: { outboxId: string }): Promise<{ ok: boolean }>;
  "connectors.sync_now"(ctx: ConnectorsCtx, input: { syncTypeId?: string; type?: string; connectionId?: string; mode?: SyncMode; runAutomations?: boolean }): Promise<{ runId: string }>;
  "connectors.outbox.list"(ctx: ConnectorsCtx, input: { type?: string; state?: OutboxState; cursor?: string; limit?: number }): Promise<{ items: OutboxRow[]; next?: string; total?: number }>;
  "connectors.outbox.retry"(ctx: ConnectorsCtx, input: { outboxId: string }): Promise<{ ok: boolean }>;
  "connectors.outbox.cancel"(ctx: ConnectorsCtx, input: { outboxId: string }): Promise<{ ok: boolean }>;
  "connectors.push"(ctx: ConnectorsCtx, input: { outboxId: string }): Promise<{ state: "sent" | "failed"; error?: string }>;
}

// ---- tables ----

const SYNC_SQL = `
CREATE TABLE IF NOT EXISTS cn_synced_types (
  sync_type_id TEXT PRIMARY KEY, type TEXT NOT NULL UNIQUE, connector TEXT NOT NULL, connection_id TEXT NOT NULL, remote TEXT NOT NULL, fields TEXT NOT NULL, match TEXT NOT NULL DEFAULT '[]',
  create_at_source INTEGER NOT NULL DEFAULT 0, deletes TEXT NOT NULL DEFAULT 'off', conflict TEXT NOT NULL DEFAULT 'newest', polling TEXT NOT NULL, nightly INTEGER NOT NULL DEFAULT 1,
  paused INTEGER NOT NULL DEFAULT 0, schema_changes TEXT NOT NULL DEFAULT '[]', created_by TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS cn_synced_types_connection ON cn_synced_types (connection_id);
-- What a sync_now asked for, found by the Run executor through the run id.
CREATE TABLE IF NOT EXISTS cn_sync_requests (run_id TEXT PRIMARY KEY, sync_types TEXT NOT NULL, mode TEXT NOT NULL, run_automations INTEGER NOT NULL DEFAULT 0, requested_by TEXT, at INTEGER NOT NULL);
`;
const ready = new WeakSet<object>();
export function ensureSyncTables(tx: Tx): void {
  if (ready.has(tx)) return;
  ensureTables(tx);
  tx.exec(SYNC_SQL);
  ready.add(tx);
}

interface SyncDb {
  sync_type_id: string; type: string; connector: string; connection_id: string; remote: string; fields: string; match: string; create_at_source: number; deletes: DeleteMode; conflict: ConflictRule;
  polling: string; nightly: number; paused: number; schema_changes: string; created_by: string | null; created_at: number; updated_at: number;
}
interface OutboxDb {
  outbox_id: string; sync_type: string; local_id: string; op: "create" | "update" | "remove"; fields: string; status: string; attempts: number; error: string | null; idem_key: string; created_at: number;
}
interface ConflictDb { conflict_id: string; sync_type: string; status: string }
interface LogDb { at: number; kind: LogRow["kind"]; summary: string; run_id: string | null; trace_id: string | null }

export const DEFAULT_POLLING: PollingRow = { activeSec: 60, idleSec: 300, dormantSec: 3600 };
const FIELD_KEY = /^[a-z][a-z0-9_]*$/;
const DIRS: readonly Dir[] = ["pull", "push", "both", "off"];
const DELETES: readonly DeleteMode[] = ["off", "soft", "travel"];
const RULES: readonly ConflictRule[] = ["newest", "source", "vyre", "ask"];
const OUTBOX_STATES: readonly OutboxState[] = ["pending", "sent", "failed", "canceled", "undone"];
const parse = <T>(s: string): T => JSON.parse(s) as T;

/** The remote field type to the record field type a new column gets. */
export function proposedType(remoteType: string): string {
  const r = remoteType.toLowerCase();
  if (/^(int|integer|number|float|double|decimal|numeric|long|bigint)$/.test(r)) return "number";
  if (/^(bool|boolean|checkbox)$/.test(r)) return "checkbox";
  if (/^(date|datetime|timestamp|time)$/.test(r)) return "datetime";
  if (r === "email") return "email";
  if (/^(phone|phone_number|tel)$/.test(r)) return "phone";
  if (r === "url" || r === "uri") return "url";
  if (/^(enum|select|picklist|choice)$/.test(r)) return "choice";
  if (/^(textarea|longtext|html|richtext)$/.test(r)) return "longtext";
  return "text";
}
/** A remote field name as a record field key: lower snake case, starting with a letter. */
export function proposedKey(remote: string): string {
  const k = remote.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return /^[a-z]/.test(k) ? k : `f_${k}`;
}
const SENSITIVE = /(ssn|social_security|password|passwd|secret|token|tax_?id|birth|dob|salary|iban|account_number|card)/i;

export function createSyncHandlers(deps: SyncDeps): SyncHandlers {
  const { tx } = deps;
  const prep = (): void => { ensureSyncTables(tx); seedBuiltins(deps); };
  const actorOf = (ctx: ConnectorsCtx): string => ctx.actor ?? "system";
  const has = (table: string): boolean => tx.get("SELECT 1 AS x FROM sqlite_master WHERE type = 'table' AND name = ?", table) !== undefined;

  const count = (sql: string, ...args: unknown[]): number => tx.get<{ n: number }>(sql, ...args)?.n ?? 0;
  const pendingOf = (id: string): number => (has("sy_outbox") ? count("SELECT count(*) AS n FROM sy_outbox WHERE sync_type = ? AND status IN ('pending', 'failed')", id) : 0);
  const conflictsOf = (id: string): number => (has("sy_conflicts") ? count("SELECT count(*) AS n FROM sy_conflicts WHERE sync_type = ? AND status = 'open'", id) : 0);
  const lastRunOf = (id: string): number | undefined => (has("sy_state") ? tx.get<{ t: number | null }>("SELECT last_run_at AS t FROM sy_state WHERE sync_type = ?", id)?.t ?? undefined : undefined);

  const connRow = (id: string): ConnectionDb | undefined => tx.get<ConnectionDb>("SELECT * FROM cn_connections WHERE connection_id = ?", id);
  const visible = (ctx: ConnectorsCtx, c: ConnectionDb): boolean => c.owner_kind === "space" || c.owner_id === actorOf(ctx);
  const needConn = (ctx: ConnectorsCtx, id: string): ConnectionDb => {
    const c = connRow(id);
    if (!c || !visible(ctx, c)) return refuse(ctx, "validation.not_found", "There is no such connection.");
    return c;
  };
  const defOf = (ctx: ConnectorsCtx, key: string): ConnectorDef => {
    const c = tx.get<{ def: string }>("SELECT def FROM cn_connectors WHERE key = ?", key);
    if (!c) return refuse(ctx, "validation.not_found", `There is no connector ${key}.`);
    return parse<ConnectorDef>(c.def);
  };

  const rowOf = (r: SyncDb): SyncBindingRow => {
    const changes = parse<SchemaChange[]>(r.schema_changes).length;
    const conn = connRow(r.connection_id);
    const last = lastRunOf(r.sync_type_id);
    const state: SyncState = r.paused ? "paused" : changes > 0 ? "needs_review" : conn && (conn.state === "failing" || conn.state === "needs_reconnect") ? "error" : last !== undefined ? "syncing" : "initial";
    return {
      syncTypeId: r.sync_type_id, type: r.type, connector: r.connector, connectionId: r.connection_id, remote: r.remote, state,
      fields: parse<FieldMapRow[]>(r.fields), match: parse<string[]>(r.match), createAtSource: r.create_at_source === 1, deletes: r.deletes, conflict: r.conflict,
      polling: parse<PollingRow>(r.polling), nightlyReconcile: r.nightly === 1, ...(last !== undefined ? { lastSyncAt: last } : {}),
      pending: pendingOf(r.sync_type_id), conflicts: conflictsOf(r.sync_type_id), schemaChanges: changes,
    };
  };
  const dbByType = (ctx: ConnectorsCtx, type: string): SyncDb => {
    prep();
    const r = tx.get<SyncDb>("SELECT * FROM cn_synced_types WHERE type = ?", type);
    if (!r) return refuse(ctx, "validation.not_found", `${type} is not a synced type.`);
    const c = connRow(r.connection_id);
    if (c && !visible(ctx, c)) return refuse(ctx, "validation.not_found", `${type} is not a synced type.`);
    return r;
  };
  const dbById = (ctx: ConnectorsCtx, id: string): SyncDb => {
    const r = tx.get<SyncDb>("SELECT * FROM cn_synced_types WHERE sync_type_id = ?", id);
    if (!r) return refuse(ctx, "validation.not_found", "That sync binding no longer exists.");
    return r;
  };
  const engineOf = (ctx: ConnectorsCtx): SyncEngine => deps.engine ?? refuse(ctx, "internal.unavailable", "The sync engine is not available.");

  // ---- validation of a mapping ----
  const checkFields = (ctx: ConnectorsCtx, fields: FieldMapRow[], match: string[]): void => {
    if (!fields.length) refuse(ctx, "validation.bad_input", "Map at least one field.");
    const keys = new Set<string>();
    const remotes = new Set<string>();
    for (const f of fields) {
      if (!FIELD_KEY.test(f.key)) refuse(ctx, "validation.bad_input", `${f.key} is not a field key: lowercase letters, digits and underscores, starting with a letter.`);
      if (!f.remote.trim()) refuse(ctx, "validation.bad_input", `${f.key} needs the name of the field in the app.`);
      if (!DIRS.includes(f.dir)) refuse(ctx, "validation.bad_input", `${f.dir} is not a direction: pull, push, both or off.`);
      if (keys.has(f.key)) refuse(ctx, "validation.bad_input", `${f.key} is mapped twice.`);
      if (remotes.has(f.remote)) refuse(ctx, "validation.bad_input", `${f.remote} is mapped twice.`);
      keys.add(f.key);
      remotes.add(f.remote);
    }
    for (const m of match) if (!keys.has(m)) refuse(ctx, "validation.bad_input", `The match rule uses ${m}, which is not a mapped field.`);
    if (new Set(match).size !== match.length) refuse(ctx, "validation.bad_input", "The match rule names a field twice.");
  };
  const checkRules = (ctx: ConnectorsCtx, o: { deletes?: DeleteMode; conflict?: ConflictRule; polling?: PollingRow }): void => {
    if (o.deletes !== undefined && !DELETES.includes(o.deletes)) refuse(ctx, "validation.bad_input", `${o.deletes} is not a delete rule: off, soft or travel.`);
    if (o.conflict !== undefined && !RULES.includes(o.conflict)) refuse(ctx, "validation.bad_input", `${o.conflict} is not a conflict rule: newest, source, vyre or ask.`);
    if (o.polling && (o.polling.activeSec < 30 || o.polling.idleSec < 60 || o.polling.dormantSec < 300)) refuse(ctx, "validation.bad_input", "Polling cannot be faster than 30 seconds active, 60 idle and 300 dormant.");
  };

  /** Make or extend the local record type through schema.apply. Existing columns are left alone. */
  const shapeType = async (ctx: ConnectorsCtx, type: string, fields: FieldMapRow[], types: Map<string, string>, idem: string): Promise<void> => {
    const described = (await ctx.call("schema.describe", { type }).catch(() => ({ types: [] }))) as { types?: { key: string; fields: { key: string }[] }[] };
    const existing = described.types?.find((t) => t.key === type);
    const wanted = fields.filter((f) => f.dir !== "off");
    if (!existing) {
      const defs = wanted.map((f) => ({ key: f.key, type: types.get(f.key) ?? "text", title: f.key.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()) }));
      await ctx.call("schema.apply", {
        idempotencyKey: `${idem}:type.create`,
        ops: [{ op: "type.create", type, def: { title: type.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()), icon: "table", label: "internal", ...(defs.length ? { titleField: (defs.find((d) => d.type === "text") ?? defs[0]!).key, fields: defs } : {}) } }],
        reason: "Bind to a synced type",
      });
      return;
    }
    const have = new Set(existing.fields.map((f) => f.key));
    const ops = wanted.filter((f) => !have.has(f.key)).map((f) => ({ op: "field.add", type, field: f.key, def: { type: types.get(f.key) ?? "text" } }));
    if (ops.length) await ctx.call("schema.apply", { idempotencyKey: `${idem}:field.add`, ops, reason: "Fields for a synced type" });
  };

  const usable = (ctx: ConnectorsCtx, c: ConnectionDb | undefined, what: string): void => {
    if (!c) refuse(ctx, "validation.precondition_failed", `The connection for ${what} was deleted: bind it to another connection first.`);
    if (c!.state === "paused") refuse(ctx, "validation.precondition_failed", `The connection is paused${c!.paused_by ? ` by ${c!.paused_by}` : ""}: resume it first.`);
    if (c!.state === "pending") refuse(ctx, "validation.precondition_failed", "The connection is still pending: finish connecting it first.");
    if (c!.state === "needs_reconnect") refuse(ctx, "provider.auth_failed", "The app rejected the sign-in: reconnect the connection.");
  };

  const outboxRow = (r: OutboxDb): OutboxRow => ({
    outboxId: r.outbox_id, syncTypeId: r.sync_type, recordId: r.local_id, op: r.op === "remove" ? "delete" : r.op, fields: parse<string[]>(r.fields),
    state: r.status === "done" ? "sent" : (r.status as OutboxState), attempts: r.attempts, idempotencyKey: r.idem_key, ...(r.error ? { error: r.error } : {}), at: r.created_at,
  });
  const needOutbox = (ctx: ConnectorsCtx, id: string): { row: OutboxDb; binding: SyncDb } => {
    prep();
    const row = has("sy_outbox") ? tx.get<OutboxDb>("SELECT * FROM sy_outbox WHERE outbox_id = ?", id) : undefined;
    const binding = row ? tx.get<SyncDb>("SELECT * FROM cn_synced_types WHERE sync_type_id = ?", row.sync_type) : undefined;
    if (!row || !binding) return refuse(ctx, "validation.not_found", "There is no such push.");
    const c = connRow(binding.connection_id);
    if (c && !visible(ctx, c)) return refuse(ctx, "validation.not_found", "There is no such push.");
    return { row, binding };
  };
  const needConflict = (ctx: ConnectorsCtx, id: string): { c: ConflictDb; binding: SyncDb } => {
    prep();
    const c = has("sy_conflicts") ? tx.get<ConflictDb>("SELECT conflict_id, sync_type, status FROM sy_conflicts WHERE conflict_id = ?", id) : undefined;
    const binding = c ? tx.get<SyncDb>("SELECT * FROM cn_synced_types WHERE sync_type_id = ?", c.sync_type) : undefined;
    if (!c || !binding) return refuse(ctx, "validation.not_found", "There is no such conflict.");
    return { c, binding };
  };

  return {
    "sync_types.list": async (ctx, input) => {
      prep();
      const rows = tx.all<SyncDb>(`SELECT * FROM cn_synced_types ${input.connector !== undefined ? "WHERE connector = ?" : ""} ORDER BY created_at, rowid`, ...(input.connector !== undefined ? [input.connector] : []))
        .filter((r) => { const c = connRow(r.connection_id); return !c || visible(ctx, c); });
      const { start, limit } = PAGE(input);
      return { syncedTypes: rows.slice(start, start + limit).map(rowOf), ...(start + limit < rows.length ? { next: String(start + limit) } : {}), total: rows.length };
    },

    "sync_types.get": async (ctx, input) => ({ syncedType: rowOf(dbByType(ctx, input.type)) }),

    "sync_types.discover": async (ctx, input) => {
      prep();
      const conn = needConn(ctx, input.connectionId);
      const def = defOf(ctx, conn.connector);
      if (!def.actions.some((a) => a.name === "discover")) refuse(ctx, "validation.unsupported", `${def.title} cannot list its objects: it has no discover action.`);
      const res = await executeAction(deps, ctx, def, "discover", { connection: conn, input: input.remote !== undefined ? { remote: input.remote } : {}, actor: actorOf(ctx) });
      const raw = Array.isArray(res.output) ? res.output : [];
      const objects: DiscoveredObject[] = [];
      for (const o of raw as { remote?: unknown; title?: unknown; fields?: unknown }[]) {
        if (typeof o.remote !== "string") continue;
        if (input.remote !== undefined && o.remote !== input.remote) continue;
        const fields = (Array.isArray(o.fields) ? o.fields : []) as { remote?: unknown; type?: unknown; sensitive?: unknown }[];
        objects.push({
          remote: o.remote, title: typeof o.title === "string" ? o.title : o.remote,
          fields: fields.filter((f) => typeof f.remote === "string").map((f) => ({
            remote: f.remote as string, type: typeof f.type === "string" ? f.type : "string", proposedKey: proposedKey(f.remote as string), proposedType: proposedType(typeof f.type === "string" ? f.type : "string"),
            sensitive: f.sensitive === true || SENSITIVE.test(f.remote as string),
          })),
        });
      }
      return { objects };
    },

    "sync_types.create": async (ctx, input) => {
      prep();
      const conn = needConn(ctx, input.connectionId);
      const def = defOf(ctx, conn.connector);
      usable(ctx, conn, def.title);
      if (def.syncedTypes?.length && !def.syncedTypes.includes(input.remote)) refuse(ctx, "validation.bad_input", `${def.title} has no synced object ${input.remote}: it offers ${def.syncedTypes.join(", ")}.`);
      if (!input.remote.trim()) refuse(ctx, "validation.bad_input", "Name the object in the app.");
      checkFields(ctx, input.fields, input.match);
      checkRules(ctx, input);
      if (tx.get("SELECT 1 AS x FROM cn_synced_types WHERE type = ?", input.type)) refuse(ctx, "validation.duplicate", `${input.type} is already a synced type.`);
      // The record type and its columns first: when schema.apply refuses, nothing is bound.
      const types = new Map<string, string>();
      await shapeType(ctx, input.type, input.fields, types, `sync_types.create:${input.idempotencyKey}`);
      const now = nowOf(deps);
      const id = mintShort("syt", now);
      tx.run(
        "INSERT INTO cn_synced_types (sync_type_id, type, connector, connection_id, remote, fields, match, create_at_source, deletes, conflict, polling, nightly, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        id, input.type, conn.connector, conn.connection_id, input.remote, JSON.stringify(input.fields), JSON.stringify(input.match), input.createAtSource ? 1 : 0, input.deletes ?? "off", input.conflict ?? "newest",
        JSON.stringify(input.polling ?? DEFAULT_POLLING), input.nightlyReconcile === false ? 0 : 1, actorOf(ctx), now, now,
      );
      ctx.emit("sync.type_bound", `entity/${id}`, { syncTypeId: id, type: input.type, connector: conn.connector });
      return { syncedType: rowOf(dbById(ctx, id)) };
    },

    "sync_types.update": async (ctx, input) => {
      const r = dbByType(ctx, input.type);
      const cur = rowOf(r);
      const fields = input.fields ?? cur.fields;
      const match = input.match ?? cur.match;
      if (input.fields !== undefined || input.match !== undefined) checkFields(ctx, fields, match);
      checkRules(ctx, input);
      const added = fields.filter((f) => f.dir !== "off" && !cur.fields.some((c) => c.key === f.key));
      if (added.length) await shapeType(ctx, r.type, added, new Map(), `sync_types.update:${r.type}:${added.map((f) => f.key).sort().join(",")}`);
      const changed: string[] = [];
      const note = (k: string, was: unknown, now: unknown): void => { if (JSON.stringify(was) !== JSON.stringify(now)) changed.push(k); };
      note("fields", cur.fields, fields); note("match", cur.match, match); note("createAtSource", cur.createAtSource, input.createAtSource ?? cur.createAtSource);
      note("deletes", cur.deletes, input.deletes ?? cur.deletes); note("conflict", cur.conflict, input.conflict ?? cur.conflict); note("polling", cur.polling, input.polling ?? cur.polling);
      note("nightlyReconcile", cur.nightlyReconcile, input.nightlyReconcile ?? cur.nightlyReconcile);
      tx.run(
        "UPDATE cn_synced_types SET fields = ?, match = ?, create_at_source = ?, deletes = ?, conflict = ?, polling = ?, nightly = ?, updated_at = ? WHERE sync_type_id = ?",
        JSON.stringify(fields), JSON.stringify(match), (input.createAtSource ?? cur.createAtSource) ? 1 : 0, input.deletes ?? cur.deletes, input.conflict ?? cur.conflict,
        JSON.stringify(input.polling ?? cur.polling), (input.nightlyReconcile ?? cur.nightlyReconcile) ? 1 : 0, nowOf(deps), r.sync_type_id,
      );
      if (changed.length) ctx.emit("sync.type_updated", `entity/${r.sync_type_id}`, { syncTypeId: r.sync_type_id, fields: changed });
      return { syncedType: rowOf(dbById(ctx, r.sync_type_id)) };
    },

    "sync_types.preview": async (ctx, input) => {
      const r = dbByType(ctx, input.type);
      const engine = engineOf(ctx);
      return engine.preview(ctx, rowOf(r), input.direction !== undefined ? { direction: input.direction } : {});
    },

    "sync_types.pause": async (ctx, input) => {
      const r = dbByType(ctx, input.type);
      if (r.paused) return { ok: true };
      tx.run("UPDATE cn_synced_types SET paused = 1, updated_at = ? WHERE sync_type_id = ?", nowOf(deps), r.sync_type_id);
      ctx.emit("sync.type_paused", `entity/${r.sync_type_id}`, { syncTypeId: r.sync_type_id });
      return { ok: true };
    },

    "sync_types.resume": async (ctx, input) => {
      const r = dbByType(ctx, input.type);
      if (!r.paused) return { ok: true };
      tx.run("UPDATE cn_synced_types SET paused = 0, updated_at = ? WHERE sync_type_id = ?", nowOf(deps), r.sync_type_id);
      ctx.emit("sync.type_resumed", `entity/${r.sync_type_id}`, { syncTypeId: r.sync_type_id });
      return { ok: true };
    },

    "sync_types.log": async (ctx, input) => {
      const r = dbByType(ctx, input.type);
      if (!has("sy_log")) return { entries: [], total: 0 };
      const total = count("SELECT count(*) AS n FROM sy_log WHERE sync_type = ?", r.sync_type_id);
      const { start, limit } = PAGE(input);
      const rows = tx.all<LogDb>("SELECT at, kind, summary, run_id, trace_id FROM sy_log WHERE sync_type = ? ORDER BY at DESC, id DESC LIMIT ? OFFSET ?", r.sync_type_id, limit, start);
      return {
        entries: rows.map((l) => ({ at: l.at, kind: l.kind, summary: l.summary, ...(l.run_id ? { runId: l.run_id } : {}), ...(l.trace_id ? { traceId: l.trace_id } : {}) })),
        ...(start + limit < total ? { next: String(start + limit) } : {}), total,
      };
    },

    "sync_types.schema_changes": async (ctx, input) => {
      const r = dbByType(ctx, input.type);
      return { changes: parse<SchemaChange[]>(r.schema_changes).map((c) => ({ changeKey: c.changeKey, kind: c.kind, remote: c.remote, summary: c.summary })) };
    },

    "sync_types.review_schema": async (ctx, input) => {
      const r = dbByType(ctx, input.type);
      const pending = parse<SchemaChange[]>(r.schema_changes);
      const known = new Set(pending.map((c) => c.changeKey));
      for (const k of [...input.accept, ...input.ignore]) if (!known.has(k)) refuse(ctx, "validation.bad_input", `There is no waiting change ${k}.`);
      if (input.accept.some((k) => input.ignore.includes(k))) refuse(ctx, "validation.bad_input", "A change cannot be both accepted and ignored.");
      const fields = parse<FieldMapRow[]>(r.fields);
      const ops: Record<string, unknown>[] = [];
      let paused = r.paused === 1;
      for (const c of pending.filter((p) => input.accept.includes(p.changeKey))) {
        if (c.kind === "field_added") {
          const key = c.key ?? proposedKey(c.remote);
          if (!fields.some((f) => f.remote === c.remote)) {
            if (fields.some((f) => f.key === key)) refuse(ctx, "validation.duplicate", `${key} is already a field here: map ${c.remote} by hand.`);
            fields.push({ key, remote: c.remote, dir: "pull" });
            ops.push({ op: "field.add", type: r.type, field: key, def: { type: c.fieldType ?? "text" } });
          }
        } else if (c.kind === "field_removed") {
          for (const f of fields) if (f.remote === c.remote) f.dir = "off";
        } else if (c.kind === "field_retyped") {
          const f = fields.find((x) => x.remote === c.remote);
          if (f && c.fieldType) ops.push({ op: "field.retype", type: r.type, field: f.key, toType: c.fieldType });
        } else if (c.kind === "object_removed") paused = true;
      }
      if (ops.length) await ctx.call("schema.apply", { idempotencyKey: `sync_types.review_schema:${r.type}:${[...input.accept].sort().join(",")}`, ops, reason: "Accepted changes to the app's fields" });
      const left = pending.filter((p) => !input.accept.includes(p.changeKey) && !input.ignore.includes(p.changeKey));
      tx.run("UPDATE cn_synced_types SET fields = ?, schema_changes = ?, paused = ?, updated_at = ? WHERE sync_type_id = ?", JSON.stringify(fields), JSON.stringify(left), paused ? 1 : 0, nowOf(deps), r.sync_type_id);
      if (input.accept.length) ctx.emit("sync.type_updated", `entity/${r.sync_type_id}`, { syncTypeId: r.sync_type_id, fields: ["fields"] });
      return { accepted: input.accept.length, ignored: input.ignore.length };
    },

    "sync_types.confirm_deletes": async (ctx, input) => {
      const r = dbByType(ctx, input.type);
      if (input.decision !== "mark_removed" && input.decision !== "keep") refuse(ctx, "validation.bad_input", "Decide mark_removed or keep.");
      const waiting = has("sy_state") ? tx.get<{ p: string | null }>("SELECT pending_deletes AS p FROM sy_state WHERE sync_type = ?", r.sync_type_id)?.p : null;
      if (!waiting) refuse(ctx, "validation.precondition_failed", "Nothing is waiting for a decision about deleted records.");
      const removed = await engineOf(ctx).confirmDeletes(ctx, rowOf(r), input.decision);
      return { removed };
    },

    "sync_types.make_native": async (ctx, input) => {
      const r = dbByType(ctx, input.type);
      // Pushes that never left stay as local edits, marked not synced. Conflicts nobody settled are closed: there is no other side any more.
      if (has("sy_outbox")) tx.run("UPDATE sy_outbox SET status = 'canceled' WHERE sync_type = ? AND status IN ('pending', 'failed')", r.sync_type_id);
      if (has("sy_conflicts")) tx.run("UPDATE sy_conflicts SET status = 'closed' WHERE sync_type = ? AND status = 'open'", r.sync_type_id);
      // The links (record id to remote id) stay in the engine's tables: the ids, history and attribution of every record are kept.
      tx.run("DELETE FROM cn_synced_types WHERE sync_type_id = ?", r.sync_type_id);
      ctx.emit("sync.type_native", `record_type/${r.type}`, { syncTypeId: r.sync_type_id, type: r.type });
      return { ok: true };
    },

    "sync_types.resolve_conflict": async (ctx, input) => {
      const { c, binding } = needConflict(ctx, input.conflictId);
      if (c.status !== "open") refuse(ctx, "validation.precondition_failed", "This conflict was already settled.");
      if (input.resolution === "value" && input.value === undefined) refuse(ctx, "validation.bad_input", "Enter the value to keep.");
      return engineOf(ctx).resolveConflict(ctx, rowOf(binding), input.conflictId, input.resolution, input.value);
    },

    "sync_types.replay_conflict": async (ctx, input) => {
      const { binding } = needConflict(ctx, input.conflictId);
      return { results: await engineOf(ctx).replayConflict(ctx, rowOf(binding), input.conflictId) };
    },

    "sync_types.undo_push": async (ctx, input) => {
      const { row, binding } = needOutbox(ctx, input.outboxId);
      if (row.status === "undone") refuse(ctx, "validation.precondition_failed", "This push was already undone.");
      if (row.status !== "done") refuse(ctx, "validation.precondition_failed", "This push did not happen, so there is nothing to undo.");
      const out = await engineOf(ctx).undoPush(ctx, rowOf(binding), input.outboxId);
      if (!out.undone) refuse(ctx, "validation.precondition_failed", out.reason ?? "The push could not be undone.");
      return { ok: true };
    },

    "connectors.sync_now": async (ctx, input) => {
      prep();
      const given = [input.syncTypeId, input.type, input.connectionId].filter((x) => x !== undefined);
      if (given.length !== 1) refuse(ctx, "validation.bad_input", "Name one thing to sync: a synced type, a record type or a connection.");
      const mode = input.mode ?? "incremental";
      if (!(["incremental", "reconcile", "backfill", "dry_run"] as const).includes(mode)) refuse(ctx, "validation.bad_input", `${mode} is not a sync mode.`);
      let rows: SyncDb[];
      if (input.syncTypeId !== undefined) rows = [dbById(ctx, input.syncTypeId)];
      else if (input.type !== undefined) rows = [dbByType(ctx, input.type)];
      else {
        const conn = needConn(ctx, input.connectionId!);
        rows = tx.all<SyncDb>("SELECT * FROM cn_synced_types WHERE connection_id = ? ORDER BY created_at, rowid", conn.connection_id);
        if (!rows.length) refuse(ctx, "validation.not_found", "No synced type uses this connection.");
      }
      for (const r of rows) {
        const conn = connRow(r.connection_id);
        if (conn && !visible(ctx, conn)) refuse(ctx, "validation.not_found", "There is no such connection.");
        usable(ctx, conn, r.type);
        if (r.paused && mode !== "dry_run") refuse(ctx, "validation.precondition_failed", `Sync of ${r.type} is paused: resume it first.`);
      }
      const one = rows.length === 1 ? rows[0]! : undefined;
      const started = (await ctx.call("runs.start", {
        idempotencyKey: `connectors.sync_now:${input.idempotencyKey}`,
        kind: "connector_sync", name: one ? `Sync ${one.type}` : `Sync ${rows.length} types`, owner: actorOf(ctx),
        subject: one ? { type: "record_type", id: one.type } : { type: "connection", id: rows[0]!.connection_id },
      })) as { runId: string };
      tx.run("INSERT OR REPLACE INTO cn_sync_requests (run_id, sync_types, mode, run_automations, requested_by, at) VALUES (?, ?, ?, ?, ?, ?)",
        started.runId, JSON.stringify(rows.map((r) => r.sync_type_id)), mode, input.runAutomations ? 1 : 0, actorOf(ctx), nowOf(deps));
      return { runId: started.runId };
    },

    "connectors.outbox.list": async (ctx, input) => {
      prep();
      if (input.state !== undefined && !OUTBOX_STATES.includes(input.state)) refuse(ctx, "validation.bad_input", `${input.state} is not a push state.`);
      if (!has("sy_outbox")) return { items: [], total: 0 };
      const where: string[] = [];
      const args: unknown[] = [];
      if (input.type !== undefined) { where.push("o.sync_type = ?"); args.push(dbByType(ctx, input.type).sync_type_id); }
      if (input.state !== undefined) { where.push(input.state === "sent" ? "o.status = 'done'" : "o.status = ?"); if (input.state !== "sent") args.push(input.state); }
      const rows = tx.all<OutboxDb & { connection_id: string }>(
        `SELECT o.*, s.connection_id AS connection_id FROM sy_outbox o JOIN cn_synced_types s ON s.sync_type_id = o.sync_type ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY o.created_at DESC, o.rowid DESC`, ...args,
      ).filter((r) => { const c = connRow(r.connection_id); return !c || visible(ctx, c); });
      const { start, limit } = PAGE(input);
      return { items: rows.slice(start, start + limit).map(outboxRow), ...(start + limit < rows.length ? { next: String(start + limit) } : {}), total: rows.length };
    },

    "connectors.outbox.retry": async (ctx, input) => {
      const { row, binding } = needOutbox(ctx, input.outboxId);
      if (row.status === "pending") return { ok: true };
      if (row.status !== "failed") refuse(ctx, "validation.precondition_failed", "Only a push that failed can be retried.");
      tx.run("UPDATE sy_outbox SET status = 'pending', attempts = 0, error = NULL WHERE outbox_id = ?", row.outbox_id);
      // Retry now when the engine is wired; otherwise the next pass picks it up.
      if (deps.engine) await deps.engine.push(ctx, rowOf(binding), row.outbox_id);
      return { ok: true };
    },

    "connectors.outbox.cancel": async (ctx, input) => {
      const { row } = needOutbox(ctx, input.outboxId);
      if (row.status === "canceled") return { ok: true };
      if (row.status !== "pending" && row.status !== "failed") refuse(ctx, "validation.precondition_failed", "Only a push that has not gone out can be canceled.");
      tx.run("UPDATE sy_outbox SET status = 'canceled' WHERE outbox_id = ?", row.outbox_id);
      return { ok: true };
    },

    "connectors.push": async (ctx, input) => {
      const { row, binding } = needOutbox(ctx, input.outboxId);
      if (row.status === "done") return { state: "sent" as const };
      if (row.status === "canceled" || row.status === "undone") refuse(ctx, "validation.precondition_failed", `This push was ${row.status}.`);
      const b = rowOf(binding);
      const conn = connRow(binding.connection_id);
      usable(ctx, conn, b.type);
      return engineOf(ctx).push(ctx, b, row.outbox_id);
    },
  };
}

/** For the engine's host: record that the app's schema changed, so the type shows "N changes to review". Changes already waiting (same key) are not doubled. */
export function noteSchemaChanges(deps: ConnectorsDeps, ctx: Pick<ConnectorsCtx, "emit">, type: string, changes: SchemaChange[]): number {
  ensureSyncTables(deps.tx);
  const r = deps.tx.get<SyncDb>("SELECT * FROM cn_synced_types WHERE type = ?", type);
  if (!r) return 0;
  const waiting = parse<SchemaChange[]>(r.schema_changes);
  const fresh = changes.filter((c) => !waiting.some((w) => w.changeKey === c.changeKey));
  if (!fresh.length) return waiting.length;
  const all = [...waiting, ...fresh];
  deps.tx.run("UPDATE cn_synced_types SET schema_changes = ?, updated_at = ? WHERE sync_type_id = ?", JSON.stringify(all), nowOf(deps), r.sync_type_id);
  ctx.emit("sync.schema_changed", `entity/${r.sync_type_id}`, { syncTypeId: r.sync_type_id, type, changes: all.length });
  return all.length;
}

/** For the Run executor: what a sync_now asked for. */
export function syncRequest(deps: Pick<ConnectorsDeps, "tx">, runId: string): { syncTypeIds: string[]; mode: SyncMode; runAutomations: boolean } | undefined {
  ensureSyncTables(deps.tx);
  const r = deps.tx.get<{ sync_types: string; mode: SyncMode; run_automations: number }>("SELECT sync_types, mode, run_automations FROM cn_sync_requests WHERE run_id = ?", runId);
  return r ? { syncTypeIds: parse<string[]>(r.sync_types), mode: r.mode, runAutomations: r.run_automations === 1 } : undefined;
}
