// The connectors sync engine (packet P-H_09). The connectors module (modules/connectors) takes a `SyncEngine` through `setSyncEngine`; the engine itself is the library in modules/sources
// (runSync, flushOutbox, undoPush, confirmDeletes, resolveConflict), one engine over any two Stores. Modules are leaves (boundary B1) and host never imports a module, so the daemon
// takes the sources module's exports as `core` and builds the adapter here: the Space store on one side and, on the other, a Store made of one connection's actions.
//
// The remote Store. A connector exposes a synced object through its actions, by name: `list_<remote>` (and `list_<remote>_after` with `{ after }` for the next page), `create_<one>` and
// `update_<one>` taking `{ properties }` (and `{ id, properties }`), `delete_<one>` taking `{ id }`, where <one> is the object name without its trailing "s" (HubSpot: list_contacts,
// create_contact). A list answer is either `{ results: [{ id, properties, archived? }], paging: { next: { after } } }` (HubSpot's shape) or `{ rows: [{ id, data }], next }`. Every call goes
// through the capability API (`connectors.run`), so the Vault, the egress list, the rate limit and the audit apply as for any other call. Remote records carry no version, so a write
// never fails on one. A row the app marks archived reads as removed.
import { sha256Hex } from "../../../kernel/src/log/hash.ts";
import type { Tx } from "../../../kernel/src/store/projection.ts";
import { StoreError } from "../../../kernel/src/store/types.ts";
import type { Page, QuerySpec, Store, StoredRecord } from "../../../kernel/src/store/types.ts";

// ---- what the engine takes from the connectors module (structural copies; the module's own types are not importable here)

export interface BindingRow {
  syncTypeId: string; type: string; connector: string; connectionId: string; remote: string;
  fields: { key: string; remote: string; dir: "pull" | "push" | "both" | "off"; transform?: string }[];
  match: string[]; createAtSource: boolean; deletes: "off" | "soft" | "travel"; conflict: "newest" | "source" | "vyre" | "ask";
}
export interface EngineCtx { trace: { traceId: string }; call(cap: string, input: unknown): Promise<unknown>; emit(name: string, subject: string, payload: Record<string, unknown>): unknown }
export interface PreviewOut { creates: number; updates: number; removes: number; skips: number; summary: string; matches?: { sure: number; unsure: number; none: number }; samples: { recordId?: string; remoteId?: string; op: string; changes: Record<string, unknown> }[] }
export interface SyncEngineLike {
  preview(ctx: EngineCtx, b: BindingRow, o: { direction?: "pull" | "push" | "both" }): Promise<PreviewOut>;
  confirmDeletes(ctx: EngineCtx, b: BindingRow, decision: "mark_removed" | "keep"): Promise<number>;
  resolveConflict(ctx: EngineCtx, b: BindingRow, conflictId: string, resolution: "ours" | "theirs" | "value", value?: unknown): Promise<{ recordId: string }>;
  replayConflict(ctx: EngineCtx, b: BindingRow, conflictId: string): Promise<{ rule: BindingRow["conflict"]; value: unknown }[]>;
  undoPush(ctx: EngineCtx, b: BindingRow, outboxId: string): Promise<{ undone: boolean; reason?: string }>;
  push(ctx: EngineCtx, b: BindingRow, outboxId: string): Promise<{ state: "sent" | "failed"; error?: string }>;
}

/** The sources module's engine functions, as the daemon finds them in its exports. */
export interface SyncDepsLike { local: Store; remote: Store; tx: Tx; now?: () => number; emit?: (name: string, subject: string, payload: Record<string, unknown>) => unknown }
export interface SyncBindingLike {
  syncTypeId: string; type: string; remote: string; connector: string; label?: string;
  fields: { local: string; remote: string; direction: "pull" | "push" | "both" | "off"; transform?: string }[];
  match: string[]; createAtSource: boolean; deletes: boolean; conflict: BindingRow["conflict"];
}
export interface SyncReportLike {
  local: { created: number; updated: number }; remote: { created: number; updated: number; removed: number };
  matched: number; ambiguous: number; conflicts: number; askedConflicts: number; removedAtSource: number; pausedDeletes: boolean; summary: string;
}
export interface SyncCore {
  runSync(d: SyncDepsLike, b: SyncBindingLike, o?: { mode?: "pull" | "push" | "both"; dryRun?: boolean; runAutomations?: boolean; traceId?: string }): Promise<SyncReportLike>;
  flushOutbox(d: SyncDepsLike, b: SyncBindingLike): Promise<number>;
  retryPush(d: SyncDepsLike, outboxId: string): boolean;
  undoPush(d: SyncDepsLike, b: SyncBindingLike, outboxId: string): Promise<{ undone: boolean; reason?: string }>;
  confirmDeletes(d: SyncDepsLike, b: SyncBindingLike, decision: "mark_removed" | "keep"): number;
  resolveConflict(d: SyncDepsLike, b: SyncBindingLike, conflictId: string, resolution: "ours" | "theirs" | "value", value?: unknown): Promise<{ recordId: string }>;
}

/** Reads the engine core out of a module namespace, or says what is missing. */
export function coreOf(ns: Record<string, unknown> | undefined): SyncCore {
  if (!ns) throw new Error("The sources module is not available, so there is no sync engine to build.");
  for (const n of ["runSync", "flushOutbox", "retryPush", "undoPush", "confirmDeletes", "resolveConflict"]) {
    if (typeof ns[n] !== "function") throw new Error(`The sources module does not export ${n}, so there is no sync engine to build.`);
  }
  return ns as unknown as SyncCore;
}

/** The Space store, opened when first needed (after boot, once every module has named its projections). */
export interface LocalSide { open(): { store: Store; tx: Tx } }

// ---- the remote Store over one connection

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const oneOf = (remote: string): string => (remote.endsWith("s") && remote.length > 1 ? remote.slice(0, -1) : remote);
const canon = (v: unknown): string => JSON.stringify(v, (_k, x) => (isObj(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : 1))) : x));

interface RemoteRow { id: string; data: Record<string, unknown>; archived: boolean; updatedAt: number }

/** One page out of a list answer, in either shape. */
export function readRows(output: unknown): { rows: RemoteRow[]; next?: string } {
  if (!isObj(output)) throw new Error("The app did not answer with a list.");
  const list = Array.isArray(output["results"]) ? output["results"] : Array.isArray(output["rows"]) ? output["rows"] : null;
  if (!list) throw new Error("The app did not answer with a list of results.");
  const rows = list.map((r, i): RemoteRow => {
    if (!isObj(r) || (typeof r["id"] !== "string" && typeof r["id"] !== "number")) throw new Error(`Result ${i} has no id.`);
    const data = isObj(r["properties"]) ? r["properties"] : isObj(r["data"]) ? r["data"] : null;
    if (!data) throw new Error(`Result ${i} has no properties.`);
    const stamp = r["updatedAt"] ?? data["hs_lastmodifieddate"];
    const at = typeof stamp === "string" ? Date.parse(stamp) : typeof stamp === "number" ? stamp : 0;
    return { id: String(r["id"]), data: { ...data }, archived: r["archived"] === true, updatedAt: Number.isFinite(at) ? at : 0 };
  });
  const paging = output["paging"];
  const after = isObj(paging) && isObj(paging["next"]) ? paging["next"]["after"] : output["next"];
  return { rows, ...(typeof after === "string" && after !== "" ? { next: after } : {}) };
}

export function remoteStore(ctx: Pick<EngineCtx, "call">, b: Pick<BindingRow, "connector" | "connectionId" | "remote">): Store & { updatedAtOf(id: string): number } {
  const one = oneOf(b.remote);
  const stamps = new Map<string, number>();
  const run = async (action: string, input: unknown): Promise<unknown> => {
    const out = (await ctx.call("connectors.run", {
      key: b.connector, action, connectionId: b.connectionId, input, idempotencyKey: `sync:${sha256Hex(`${b.connectionId}|${action}|${canon(input)}`).slice(0, 32)}`,
    })) as { output?: unknown };
    return out.output;
  };
  const toRecord = (r: RemoteRow, version = 1): StoredRecord => ({
    type: b.remote, id: r.id, version, data: r.data as StoredRecord["data"], created_at: r.updatedAt, updated_at: r.updatedAt,
    ...(r.archived ? { deleted_at: r.updatedAt || 1 } : {}),
  });
  async function all(): Promise<RemoteRow[]> {
    const out: RemoteRow[] = [];
    let after: string | undefined;
    do {
      const page = readRows(await run(after === undefined ? `list_${b.remote}` : `list_${b.remote}_after`, after === undefined ? {} : { after }));
      out.push(...page.rows);
      after = page.next;
    } while (after !== undefined && out.length < 100_000);
    for (const r of out) stamps.set(r.id, r.updatedAt);
    return out;
  }
  const unsupported = (what: string) => (): never => { throw new StoreError("unsupported", `A connection does not support ${what}.`); };
  const store: Partial<Store> = {
    async query(_type: string, spec: QuerySpec): Promise<Page<StoredRecord>> {
      const rows = (await all()).filter((r) => spec.include_deleted === true || !r.archived).map((r) => toRecord(r));
      return { rows };
    },
    async get(_type: string, id: string, opts?: { include_deleted?: boolean }): Promise<StoredRecord | null> {
      const r = (await all()).find((x) => x.id === id);
      if (!r || (r.archived && opts?.include_deleted !== true)) return null;
      return toRecord(r);
    },
    async create(_type: string, _id: string, data): Promise<StoredRecord> {
      const out = await run(`create_${one}`, { properties: data });
      const id = isObj(out) && (typeof out["id"] === "string" || typeof out["id"] === "number") ? String(out["id"]) : "";
      if (!id) throw new StoreError("unavailable", `The app did not return an id for the new ${one}.`);
      return { type: b.remote, id, version: 1, data, created_at: 0, updated_at: 0 };
    },
    async update(_type: string, id: string, patch): Promise<StoredRecord> {
      await run(`update_${one}`, { id, properties: patch });
      return { type: b.remote, id, version: 1, data: patch, created_at: 0, updated_at: 0 };
    },
    async remove(_type: string, id: string): Promise<StoredRecord> {
      await run(`delete_${one}`, { id });
      return { type: b.remote, id, version: 1, data: {}, created_at: 0, updated_at: 0, deleted_at: 1 };
    },
    restore: unsupported("restoring a record") as never,
    types: async () => [],
    describe: async () => null,
    define: unsupported("changing types") as never,
    aggregate: unsupported("aggregates") as never,
    search: unsupported("search") as never,
    changes: unsupported("a change feed") as never,
    export: unsupported("export") as never,
    health: async () => ({ ok: true, checked_at: 0 }),
    version: async () => ({ store: "connection", version: "1" }),
    features: () => ({ aggregate: false, search: false, changes: false, cursor_paging: true as const }),
  };
  return Object.assign(store as Store, { updatedAtOf: (id: string) => stamps.get(id) ?? 0 });
}

// ---- the engine

const bindingOf = (b: BindingRow): SyncBindingLike => ({
  syncTypeId: b.syncTypeId, type: b.type, remote: b.remote, connector: b.connector, label: b.connector,
  fields: b.fields.map((f) => ({ local: f.key, remote: f.remote, direction: f.dir, ...(f.transform !== undefined ? { transform: f.transform } : {}) })),
  match: b.match, createAtSource: b.createAtSource, deletes: b.deletes !== "off", conflict: b.conflict,
});

export function createSyncEngine(o: { core: SyncCore; local: LocalSide; now?: () => number }): SyncEngineLike {
  const depsOf = (ctx: EngineCtx, b: BindingRow): { deps: SyncDepsLike; remote: ReturnType<typeof remoteStore>; tx: Tx; local: Store } => {
    const { store, tx } = o.local.open();
    const remote = remoteStore(ctx, b);
    return { deps: { local: store, remote, tx, ...(o.now ? { now: o.now } : {}), emit: (n, s, p) => ctx.emit(n, s, p) }, remote, tx, local: store };
  };
  return {
    async preview(ctx, b, opts) {
      const { deps } = depsOf(ctx, b);
      const r = await o.core.runSync(deps, bindingOf(b), { mode: opts.direction ?? "both", dryRun: true, traceId: ctx.trace.traceId });
      return {
        creates: r.local.created + r.remote.created, updates: r.local.updated + r.remote.updated, removes: r.remote.removed + r.removedAtSource, skips: r.conflicts,
        summary: r.summary, matches: { sure: r.matched, unsure: r.ambiguous, none: 0 }, samples: [],
      };
    },
    async confirmDeletes(ctx, b, decision) {
      return o.core.confirmDeletes(depsOf(ctx, b).deps, bindingOf(b), decision);
    },
    async resolveConflict(ctx, b, conflictId, resolution, value) {
      return o.core.resolveConflict(depsOf(ctx, b).deps, bindingOf(b), conflictId, resolution, value);
    },
    async replayConflict(ctx, b, conflictId) {
      const { tx, local, remote } = depsOf(ctx, b);
      const c = tx.get<{ local_id: string; field: string; ours: string | null; theirs: string | null }>("SELECT local_id, field, ours, theirs FROM sy_conflicts WHERE conflict_id = ? AND sync_type = ?", conflictId, b.syncTypeId);
      if (!c) throw new StoreError("not_found", "no conflict with that id");
      const ours: unknown = JSON.parse(c.ours ?? "null");
      const theirs: unknown = JSON.parse(c.theirs ?? "null");
      const rec = await local.get(b.type, c.local_id);
      const link = tx.get<{ remote_id: string }>("SELECT remote_id FROM sy_links WHERE sync_type = ? AND local_id = ?", b.syncTypeId, c.local_id);
      if (link) await remote.get(b.remote, link.remote_id);   // reads the app once, so the newest rule compares real times
      const theirAt = link ? remote.updatedAtOf(link.remote_id) : 0;
      const newest = (rec?.updated_at ?? 0) >= theirAt ? ours : theirs;
      return [
        { rule: "newest", value: newest }, { rule: "source", value: theirs }, { rule: "vyre", value: ours }, { rule: "ask", value: null },
      ];
    },
    async undoPush(ctx, b, outboxId) {
      return o.core.undoPush(depsOf(ctx, b).deps, bindingOf(b), outboxId);
    },
    async push(ctx, b, outboxId) {
      const { deps, tx } = depsOf(ctx, b);
      o.core.retryPush(deps, outboxId);   // a failed row goes back to pending; a pending one is untouched
      await o.core.flushOutbox(deps, bindingOf(b));
      const row = tx.get<{ status: string; error: string | null }>("SELECT status, error FROM sy_outbox WHERE outbox_id = ? AND sync_type = ?", outboxId, b.syncTypeId);
      if (row?.status === "done") return { state: "sent" };
      return { state: "failed", ...(row?.error ? { error: row.error } : {}) };
    },
  };
}
