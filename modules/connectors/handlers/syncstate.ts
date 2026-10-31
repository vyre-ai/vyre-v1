// What a person sees of a synced type: where one record came from and how each field is doing (sync_types.record_state), the earlier values a newest-wins settlement replaced and the
// button that puts one back (sync_types.field_history, sync_types.restore_field), the Sync page of a type (sync_types.status), and Remove (sync_specs.remove: keep the records as plain
// records, or remove them with the type). Reads only the engine's own tables and the spec the type was made from; every record write goes through records.update.
// @reads /modules/sources/migrations/0001_sources.sql
// @reads /modules/records/migrations/0001_init.sql
import { parseHlc } from "../../../lib/hlc.ts";
import { ensureTables, nowOf, refuse, seedBuiltins } from "../projections.ts";
import type { ConnectorDef, ConnectorsCtx } from "../projections.ts";
import { compileSpec, parseSpec } from "../syncspec.ts";
import { createRuntimeHandlers } from "./runtime.ts";
import { createSyncHandlers, ensureSyncTables } from "./sync.ts";
import type { FieldMapRow, PollingRow, SyncDeps } from "./sync.ts";

export type FieldState = "synced" | "saving" | "failed" | "local";
export interface RecordFieldState { key: string; dir: "pull" | "push" | "both" | "off"; state: FieldState; at?: number; error?: string; outboxId?: string; history: number }
export interface RecordState {
  synced: boolean; app?: { key: string; title: string; domain?: string }; remoteId?: string; openUrl?: string; state: FieldState; lastSyncAt?: number; fields: RecordFieldState[];
}
export interface HistoryEntry { historyId: string; value: unknown; at?: number; replacedBy: "app" | "you" | "push"; /** The person a push was sent for (a push entry only). */ by?: string; actor: string }
export interface TypeStatus {
  type: string; account?: string; accounts?: { account: string; state: string; records: number; estimate?: number; pending: number }[]; app: { key: string; title: string; domain?: string }; state: "initial" | "syncing" | "paused" | "needs_review" | "error"; paused: boolean; deletes: "off" | "soft" | "travel"; conflict: string;
  polling: PollingRow; records: number; estimate?: number; filter?: string; canBackfill: boolean; lastRun?: { at: number; summary: string };
  pending: number; failedPushes: number; conflicts: number; schemaChanges: number; failures: { at: number; summary: string }[]; sentToday: number; nextPollAt?: number; spec: boolean;
}

export interface StateHandlers {
  "sync_types.record_state"(ctx: ConnectorsCtx, input: { type: string; recordId: string }): Promise<RecordState>;
  "sync_types.field_history"(ctx: ConnectorsCtx, input: { type: string; recordId: string; field: string }): Promise<{ entries: HistoryEntry[] }>;
  "sync_types.restore_field"(ctx: ConnectorsCtx, input: { type: string; recordId: string; field: string; historyId: string }): Promise<{ ok: boolean; runId?: string }>;
  "sync_types.status"(ctx: ConnectorsCtx, input: { type: string; account?: string }): Promise<TypeStatus>;
  "sync_specs.remove"(ctx: ConnectorsCtx, input: { type: string; account?: string; records: "keep" | "remove" }): Promise<{ detached: string[]; removed: string[] }>;
}

interface Db {
  sync_type_id: string; type: string; connector: string; connection_id: string; remote: string; fields: string; paused: number; deletes: "off" | "soft" | "travel"; conflict: string; polling: string; schema_changes: string;
}
interface OutboxDb { outbox_id: string; fields: string; status: string; error: string | null; created_at: number; done_at: number | null }
const parse = <T>(s: string): T => JSON.parse(s) as T;
const DAY = 86_400_000;

export function createStateHandlers(deps: SyncDeps): StateHandlers {
  const { tx } = deps;
  const sync = createSyncHandlers(deps);
  const runtime = createRuntimeHandlers(deps);
  const prep = (): void => { ensureTables(tx); ensureSyncTables(tx); seedBuiltins(deps); };
  const has = (table: string): boolean => tx.get("SELECT 1 AS x FROM sqlite_master WHERE type = 'table' AND name = ?", table) !== undefined;
  const bindingsOf = (type: string, account?: string): Db[] => (prep(), account !== undefined ? tx.all<Db>("SELECT * FROM cn_synced_types WHERE type = ? AND account = ?", type, account) : tx.all<Db>("SELECT * FROM cn_synced_types WHERE type = ? ORDER BY created_at, rowid", type));
  const bindingOf = (type: string, account?: string): Db | undefined => bindingsOf(type, account)[0];
  /** The binding a record belongs to: the one that has a link for it (a type can read several accounts). */
  const bindingForRecord = (type: string, recordId: string): Db | undefined => {
    const all = bindingsOf(type);
    if (all.length < 2 || !has("sy_links")) return all[0];
    return all.find((b) => tx.get("SELECT 1 AS x FROM sy_links WHERE sync_type = ? AND local_id = ?", b.sync_type_id, recordId) !== undefined) ?? all[0];
  };
  const need = (ctx: ConnectorsCtx, type: string, account?: string): Db => bindingOf(type, account) ?? refuse(ctx, "validation.not_found", `${type} is not a synced type.`);
  const appOf = (key: string): { key: string; title: string; domain?: string } => {
    const c = tx.get<{ title: string; def: string }>("SELECT title, def FROM cn_connectors WHERE key = ?", key);
    const domain = c ? parse<ConnectorDef>(c.def).domains[0] : undefined;
    return { key, title: c?.title ?? key, ...(domain ? { domain } : {}) };
  };
  const specOf = (connector: string) => {
    const row = tx.get<{ spec: string }>("SELECT spec FROM cn_sync_specs WHERE connector = ?", connector);
    return row ? parseSpec(JSON.parse(row.spec)).spec : undefined;
  };
  const keptHistory = (type: string, id: string, field?: string): { hid: number; value: string | null; hlc: string; actor: string }[] =>
    has("records_field_history")
      ? tx.all<{ hid: number; value: string | null; hlc: string; actor: string }>(
        `SELECT rowid AS hid, value, hlc, actor FROM records_field_history WHERE type = ? AND id = ?${field !== undefined ? " AND field = ?" : ""} AND (actor LIKE 'sync:%' OR actor LIKE 'source:%' OR actor LIKE 'push:%') ORDER BY rowid DESC`,
        ...[type, id, ...(field !== undefined ? [field] : [])],
      )
      : [];

  const statusOf = async (ctx: ConnectorsCtx, b: Db): Promise<TypeStatus> => {
    const row = (await sync["sync_types.get"](ctx, { type: b.type, account: b.account })).syncedType;
    const spec = specOf(b.connector);
    const object = spec?.objects.find((o) => o.remote === b.remote);
    const records = has("sy_links") ? (tx.get<{ n: number }>("SELECT count(*) AS n FROM sy_links WHERE sync_type = ? AND (removed_at IS NULL OR removed_at = 0)", b.sync_type_id)?.n ?? 0) : 0;
    const logs = has("sy_log") ? tx.all<{ at: number; kind: string; summary: string; run_id: string | null }>("SELECT at, kind, summary, run_id FROM sy_log WHERE sync_type = ? ORDER BY rowid DESC LIMIT 40", b.sync_type_id) : [];
    const newestRun = logs.find((l) => l.kind === "pull" || l.kind === "push");
    const lastRun = newestRun ? { at: newestRun.at, summary: logs.filter((l) => l.run_id === newestRun.run_id && (l.kind === "pull" || l.kind === "push")).map((l) => l.summary).reverse().join(" ") } : undefined;
    const outbox = has("sy_outbox") ? tx.get<{ failed: number; sent: number }>("SELECT sum(status = 'failed') AS failed, sum(status = 'done' AND done_at > ?) AS sent FROM sy_outbox WHERE sync_type = ?", nowOf(deps) - DAY, b.sync_type_id) : undefined;
    const poll = tx.get<{ at: number }>("SELECT at FROM cn_sync_poll WHERE sync_type_id = ?", b.sync_type_id);
    const filtered = spec !== undefined && spec.plan.backfill === "later" && object?.list.filter !== undefined;
    return {
      type: b.type, ...(b.account ? { account: b.account } : {}), app: appOf(b.connector), state: row.state, paused: b.paused === 1, deletes: b.deletes, conflict: b.conflict, polling: parse<PollingRow>(b.polling),
      records, ...(object?.count !== undefined ? { estimate: object.count } : {}), ...(filtered ? { filter: spec!.plan.firstPull.words } : {}), canBackfill: filtered,
      ...(lastRun ? { lastRun } : {}), pending: row.pending, failedPushes: outbox?.failed ?? 0, conflicts: row.conflicts, schemaChanges: row.schemaChanges,
      failures: logs.filter((l) => l.kind === "error").slice(0, 5).map((l) => ({ at: l.at, summary: l.summary })), sentToday: outbox?.sent ?? 0, ...(poll ? { nextPollAt: poll.at } : {}), spec: spec !== undefined,
    };
  };

  return {
    "sync_types.record_state": async (_ctx, input) => {
      const b = bindingForRecord(input.type, input.recordId);
      if (!b) return { synced: false, state: "local", fields: [] };
      const app = appOf(b.connector);
      const link = has("sy_links") ? tx.get<{ remote_id: string }>("SELECT remote_id FROM sy_links WHERE sync_type = ? AND local_id = ?", b.sync_type_id, input.recordId) : undefined;
      const outbox = has("sy_outbox")
        ? tx.all<OutboxDb>("SELECT outbox_id, fields, status, error, created_at, done_at FROM sy_outbox WHERE sync_type = ? AND local_id = ? AND status IN ('pending', 'failed', 'done') ORDER BY created_at DESC, rowid DESC LIMIT 30", b.sync_type_id, input.recordId)
        : [];
      const lost = new Map<string, number>();
      for (const h of keptHistory(input.type, input.recordId)) { const f = tx.get<{ field: string }>("SELECT field FROM records_field_history WHERE rowid = ?", h.hid)?.field; if (f) lost.set(f, (lost.get(f) ?? 0) + 1); }
      const fields: RecordFieldState[] = parse<FieldMapRow[]>(b.fields).filter((f) => f.dir !== "off").map((f) => {
        const hit = outbox.find((o) => parse<string[]>(o.fields).includes(f.key));
        const state: FieldState = hit ? (hit.status === "pending" ? "saving" : hit.status === "failed" ? "failed" : "synced") : link ? "synced" : "local";
        return {
          key: f.key, dir: f.dir, state, history: lost.get(f.key) ?? 0,
          ...(hit && hit.status === "done" && hit.done_at !== null ? { at: hit.done_at } : {}), ...(hit?.status === "failed" && hit.error ? { error: hit.error } : {}), ...(hit && hit.status !== "done" ? { outboxId: hit.outbox_id } : {}),
        };
      });
      const state: FieldState = fields.some((f) => f.state === "failed") ? "failed" : fields.some((f) => f.state === "saving") ? "saving" : link ? "synced" : "local";
      const spec = specOf(b.connector);
      const url = spec?.objects.find((o) => o.remote === b.remote)?.openUrl;
      const last = has("sy_state") ? tx.get<{ t: number | null }>("SELECT last_run_at AS t FROM sy_state WHERE sync_type = ?", b.sync_type_id)?.t : undefined;
      return {
        synced: true, app, state, fields, ...(link ? { remoteId: link.remote_id } : {}), ...(link && url ? { openUrl: url.replaceAll("{id}", encodeURIComponent(link.remote_id)) } : {}), ...(last ? { lastSyncAt: last } : {}),
      };
    },

    "sync_types.field_history": async (_ctx, input) => {
      prep();
      const entries = keptHistory(input.type, input.recordId, input.field).map((h): HistoryEntry => {
        let value: unknown = null;
        try { value = h.value === null ? null : (JSON.parse(h.value) as unknown); } catch { value = h.value; }
        const ms = parseHlc(h.hlc)?.ms;
        const push = h.actor.startsWith("push:");
        return { historyId: String(h.hid), value, replacedBy: push ? "push" : h.actor.startsWith("sync:") ? "app" : "you", actor: h.actor, ...(push && h.actor.length > 5 ? { by: h.actor.slice(5) } : {}), ...(ms ? { at: ms } : {}) };
      });
      return { entries };
    },

    "sync_types.restore_field": async (ctx, input) => {
      const b = need(ctx, input.type);
      const row = has("records_field_history") ? tx.get<{ value: string | null }>("SELECT value FROM records_field_history WHERE rowid = ? AND type = ? AND id = ? AND field = ? AND (actor LIKE 'sync:%' OR actor LIKE 'source:%' OR actor LIKE 'push:%')", Number(input.historyId), input.type, input.recordId, input.field) : undefined;
      if (!row) return refuse(ctx, "validation.not_found", "That earlier value is no longer in the history.");
      if (!parse<FieldMapRow[]>(b.fields).some((f) => f.key === input.field)) return refuse(ctx, "validation.bad_input", `${input.field} is not a synced field.`);
      const value: unknown = row.value === null ? null : JSON.parse(row.value);
      // an ordinary edit by this person: it is newer than the app's value, so the next pass sends it
      await ctx.call("records.update", { type: input.type, recordId: input.recordId, patch: { [input.field]: value } });
      const started = await sync["connectors.sync_now"](ctx, { type: input.type, mode: "incremental", idempotencyKey: `restore:${input.historyId}` } as Parameters<typeof sync["connectors.sync_now"]>[1]).catch(() => undefined);
      return { ok: true, ...(started ? { runId: started.runId } : {}) };
    },

    "sync_types.status": async (ctx, input) => {
      const all = bindingsOf(input.type, input.account);
      if (!all.length) return refuse(ctx, "validation.not_found", `${input.type} is not a synced type.`);
      const each = await Promise.all(all.map((b) => statusOf(ctx, b)));
      if (each.length === 1) return each[0]!;
      // several accounts of one app in one type: the page shows the sum, and each account's own line
      const first = each[0]!;
      const sum = (f: (t: TypeStatus) => number): number => each.reduce((n, t) => n + f(t), 0);
      const estimate = each.every((t) => t.estimate !== undefined) ? sum((t) => t.estimate!) : undefined;
      return {
        ...first, state: each.find((t) => t.state === "error")?.state ?? each.find((t) => t.state === "needs_review")?.state ?? (each.every((t) => t.paused) ? "paused" : first.state), paused: each.every((t) => t.paused),
        records: sum((t) => t.records), ...(estimate !== undefined ? { estimate } : { estimate: undefined }), canBackfill: each.some((t) => t.canBackfill),
        pending: sum((t) => t.pending), failedPushes: sum((t) => t.failedPushes), conflicts: sum((t) => t.conflicts), schemaChanges: sum((t) => t.schemaChanges), sentToday: sum((t) => t.sentToday),
        failures: each.flatMap((t) => t.failures).sort((x, y) => y.at - x.at).slice(0, 5),
        accounts: each.map((t, i) => ({ account: all[i]!.account, state: t.state, records: t.records, ...(t.estimate !== undefined ? { estimate: t.estimate } : {}), pending: t.pending })),
      };
    },

    "sync_specs.remove": async (ctx, input) => {
      prep();
      const b = need(ctx, input.type, input.account);
      const connector = b.connector;
      const spec = specOf(connector);
      if (!spec) return refuse(ctx, "validation.not_found", `${input.type} was not brought in from a sync spec.`);
      const compiled = compileSpec(spec);
      const types = tx.all<{ type: string }>("SELECT type FROM cn_sync_spec_types WHERE connector = ? ORDER BY rowid", connector).map((r) => r.type);
      // the records this account brought in, found through its links, before the links are let go of
      const own = new Map<string, string[]>();
      for (const type of types) {
        const bound = tx.get<{ sync_type_id: string }>("SELECT sync_type_id FROM cn_synced_types WHERE type = ? AND connector = ?", type, connector);
        own.set(type, bound && has("sy_links") ? tx.all<{ local_id: string }>("SELECT local_id FROM sy_links WHERE sync_type = ?", bound.sync_type_id).map((r) => r.local_id) : []);
      }
      // detach every type of this app first: the records, their ids and their history stay as ordinary records
      const detached: string[] = [];
      for (const type of types) {
        const bound = tx.get<{ account: string }>("SELECT account FROM cn_synced_types WHERE type = ? AND connector = ?", type, connector);
        if (bound) { await sync["sync_types.make_native"](ctx, { type, account: bound.account }); detached.push(type); }
      }
      const removed: string[] = [];
      const shared = (type: string): boolean => (tx.get<{ n: number }>("SELECT count(*) AS n FROM cn_synced_types WHERE type = ?", type)?.n ?? 0) > 0;
      if (input.records === "remove" && types.some(shared)) {
        // another account still reads into these types: only the records this account brought in go (to Trash), the types stay
        for (const [type, ids] of own) for (const recordId of ids) await ctx.call("records.delete", { type, recordId }).catch(() => undefined);
        removed.push(...types.filter((t) => (own.get(t) ?? []).length > 0));
      } else if (input.records === "remove") {
        // relations first (they make both ends), then the types; what the schema module will drop is listed and confirmed as one step
        const ops = [
          ...compiled.types.flatMap((t) => t.relations.map((r) => ({ op: "relation.drop", type: t.recordType, field: r.field }))),
          ...compiled.types.map((t) => ({ op: "type.drop", type: t.recordType })),
        ];
        const diff = (await ctx.call("schema.diff", { ops })) as { previewToken: string; items: { itemKey: string; destructive: boolean }[] };
        await ctx.call("schema.apply", { ops, previewToken: diff.previewToken, confirm: diff.items.filter((i) => i.destructive).map((i) => i.itemKey), idempotencyKey: `sync_specs.remove:${connector}:${input.type}`, reason: `Remove ${spec.app.name} from Records` });
        removed.push(...compiled.types.map((t) => t.recordType));
      }
      await runtime["connectors.remove"](ctx, { key: connector });
      tx.run("DELETE FROM cn_sync_specs WHERE connector = ?", connector);
      tx.run("DELETE FROM cn_sync_spec_types WHERE connector = ?", connector);
      return { detached, removed };
    },
  };
}
