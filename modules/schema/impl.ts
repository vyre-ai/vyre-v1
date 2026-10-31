// @reads /modules/schema/migrations/0001_schema.sql
// Schema module (lane L3). The host loads these handlers once the manifest status is live (ARCH 12.4).
// A schema handle works over a RecordStore: types live in the store (rs_types, rt_<type>), full definitions in sc_types. Standalone (tests, the loader entry below) it opens
// its own kernel store; the host passes the Space's shared store and tx when it builds the handle.
import { readFileSync } from "node:fs";
import { openRecordStore } from "../../kernel/src/store/records.ts";
import type { ProjectionHost, Tx } from "../../kernel/src/store/projection.ts";
import type { Store } from "../../kernel/src/store/types.ts";
import type { SeamSetters } from "../../host/src/seams/index.ts";
import type { SpaceStoreSeam } from "../../host/src/daemon/store.ts";
import { createSchemaHandlers, applyOps, planOps } from "./handlers/index.ts";
import type { SchemaHandlers, SchemaOp } from "./handlers/index.ts";
import { finishJobs, setSchemaVault } from "./handlers/seal.ts";
import { allDefs, ensureTables, refuse, seedManifestTypes } from "./projections.ts";
import type { FieldDefT, FieldTypeRow, Registry, SchemaCtx, SchemaDeps, SeedType, ViewKindRow } from "./projections.ts";

/** The registry the contract generator wrote (field types, view kinds, record types the manifests declare). */
/**
 * The registry the schema module seeds a new Space from. A new Space starts with the neutral set of record types: the types a Kit declares (matters, commissions, client plans ...) are left out and
 * arrive when that Kit is installed (the Kit's own schema.apply step creates them). The default Kit's types stay.
 */
export function loadRegistry(path: URL = new URL("../../generated/registry.json", import.meta.url), o: { withKitTypes?: boolean } = {}): Registry {
  const raw = JSON.parse(readFileSync(path, "utf8")) as { fieldTypes: FieldTypeRow[]; viewKinds: ViewKindRow[]; recordTypes: (SeedType & { module?: string })[]; modules?: { id: string; kind?: string }[] };
  const kits = new Set((raw.modules ?? []).filter((m) => m.kind === "kit" && m.id !== "default").map((m) => m.id));
  return {
    fieldTypes: raw.fieldTypes,
    viewKinds: raw.viewKinds,
    recordTypes: raw.recordTypes.filter((t) => o.withKitTypes || t.module === undefined || !kits.has(t.module)).map(({ module: _m, ...t }) => { void _m; return { ...t, fields: t.fields as FieldDefT[] }; }),
  };
}

export interface SchemaHandle {
  deps: SchemaDeps;
  store: Store;
  tx: Tx;
  host?: ProjectionHost;
  handlers: SchemaHandlers;
  /** Make sure the manifests' record types exist (idempotent). */
  ready(): Promise<void>;
  /** Seed the manifests' record types once, now, as a write of its own; reads after it never seed (P-L3_17). The host calls it at start. */
  start(): Promise<void>;
  /** The example-kit types the start removed because the person never used them (empty until start has run). */
  pruned: string[];
}

/** The keys of the record types that only an example Kit (not the Default Kit) declares: no Space is seeded with them, and an older Space may still hold unused copies. */
export function exampleKitTypeKeys(path?: URL): Set<string> {
  const all = loadRegistry(path, { withKitTypes: true }).recordTypes.map((t) => t.key);
  const base = new Set(loadRegistry(path).recordTypes.map((t) => t.key));
  return new Set(all.filter((k) => !base.has(k)));
}

const asKeys = (json: string): string[] => { try { const v = JSON.parse(json) as unknown; return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []; } catch { return []; } };

/**
 * Removes the example-kit record types an older build seeded into every Space (client plans, commissions, matters, leads). A type goes only when the person never touched it: it was
 * seeded (version 1, never updated), has no record (a deleted one counts), no saved view, page layout, gap rule or Trash entry, and no schema change names it (a Kit that was installed
 * on purpose leaves a change and a layout). The drop is the schema module's own type.drop, so nothing is lost behind the person's back. Safe to run at every start.
 */
export async function pruneSeededKitTypes(h: SchemaHandle, candidates: Set<string>): Promise<string[]> {
  const { tx } = h;
  const touchedByChange = new Set<string>();
  for (const r of tx.all<{ types: string }>("SELECT types FROM sc_changes")) for (const k of asKeys(r.types)) touchedByChange.add(k);
  const gone: string[] = [];
  for (const row of tx.all<{ type: string; version: number; created_at: number; updated_at: number; system: number }>("SELECT type, version, created_at, updated_at, system FROM sc_types ORDER BY type")) {
    const k = row.type;
    if (!candidates.has(k) || row.system) continue;
    if (row.version !== 1 || row.updated_at !== row.created_at || touchedByChange.has(k)) continue;
    const used = (sql: string): boolean => (tx.get<{ n: number }>(sql, k)?.n ?? 0) > 0;
    if (used("SELECT count(*) AS n FROM sc_views WHERE type = ?") || used("SELECT count(*) AS n FROM sc_layout WHERE type = ?") || used("SELECT count(*) AS n FROM sc_gap_rules WHERE type = ?") || used("SELECT count(*) AS n FROM sc_trash WHERE type = ?")) continue;
    let records = 0;
    try { records = tx.get<{ n: number }>(`SELECT count(*) AS n FROM rt_${k}`)?.n ?? 0; } catch { records = 0; }
    if (records > 0) continue;
    try {
      await h.handlers["schema.apply"]({ trace: { traceId: "0".repeat(32) }, emit: () => undefined, actor: "system" }, { ops: [{ op: "type.drop", type: k }], confirm: [`type.drop:${k}`], idempotencyKey: `schema.prune.${k}`, reason: "Unused example Kit type removed" });
      gone.push(k);
    } catch { /* another type relates to it, or it is guarded: leave it */ }
  }
  return gone;
}

export function openSchema(o: {
  path?: string; space?: string; store?: Store; tx?: Tx; host?: ProjectionHost; registry?: Registry; now?: () => number;
  readFile?: SchemaDeps["readFile"]; publicBase?: string;
} = {}): SchemaHandle {
  let host: ProjectionHost | undefined;
  let store = o.store;
  let tx = o.tx;
  if (!store || !tx) {
    const opened = openRecordStore({ path: o.path ?? ":memory:", space: o.space ?? "sp_schema" });
    host = opened.host;
    store = opened.store;
    tx = opened.host.tx;
  }
  const deps: SchemaDeps = {
    store, tx, registry: o.registry ?? loadRegistry(),
    ...((o.host ?? host) ? { host: (o.host ?? host)! } : {}),
    ...(o.now ? { now: o.now } : {}), ...(o.readFile ? { readFile: o.readFile } : {}), ...(o.publicBase ? { publicBase: o.publicBase } : {}),
  };
  ensureTables(tx);
  const handle: SchemaHandle = {
    deps, store, tx, ...(host ? { host } : {}), handlers: createSchemaHandlers(deps), pruned: [],
    ready: () => seedManifestTypes(deps),
    // the prune only runs on the default registry: a handle given its own registry (tests) keeps whatever it seeded
    start: () => (deps.started ??= seedManifestTypes(deps).then(async () => { if (!o.registry) handle.pruned = await pruneSeededKitTypes(handle, exampleKitTypeKeys()); })),
  };
  return handle;
}

/**
 * Site tables (spec 2.20, ARCH 7.4): the sites module makes and changes tables scoped to one site without the person holding schema.manage. This is the controlled path:
 * every op must touch a type whose scope is that site (type.create gets the scope forced), and relations may only join types of the same site.
 */
export async function applyScoped(deps: SchemaDeps, ctx: SchemaCtx, siteId: string, ops: SchemaOp[], o: { confirm?: string[]; reason?: string } = {}): Promise<{ changeId: string; applied: number }> {
  await seedManifestTypes(deps);
  const defs = await allDefs(deps);
  const mine = new Set([...defs.values()].filter((d) => d.scope === siteId).map((d) => d.key));
  const scoped: SchemaOp[] = [];
  for (const op of ops) {
    if (op.op === "type.create") {
      scoped.push({ ...op, def: { ...(op.def ?? {}), scope: siteId } });
      mine.add(op.type);
      continue;
    }
    if (!mine.has(op.type)) refuse(ctx, "permission.no_grant", `${op.type} is not a table of this site, so changing it needs schema.manage.`);
    if (op.op === "relation.add" && !mine.has(String(op.def?.["to"]))) refuse(ctx, "permission.no_grant", "A site table can only relate to tables of the same site.");
    if (op.op === "field.add" && op.def?.["type"] === "relation") refuse(ctx, "permission.no_grant", "A site table can only relate to tables of the same site.");
    scoped.push(op);
  }
  const plan = await planOps(deps, scoped);
  for (const d of plan.next.values()) {
    if (d.scope !== siteId) continue;
    for (const f of d.fields) if (f.type === "relation" && !mine.has(String(f.options?.["target"]))) refuse(ctx, "permission.no_grant", `${d.key}.${f.key} relates to a table outside the site.`);
  }
  const { changeId, applied } = await applyOps(deps, ctx, scoped, { ...(o.confirm ? { confirm: o.confirm } : {}), ...(o.reason ? { reason: o.reason } : {}) });
  return { changeId, applied };
}

// ---- loader entry ----

type HostCtx = { trace: { traceId: string }; emit(name: string, subject: string, payload: Record<string, unknown>): unknown; principal?: { id: string } };
let shared: SchemaHandle | null = null;
let spaceSeam: SpaceStoreSeam | null = null;
/** The host hands the Space store (P-H_08, ruling 31): schema, records, sources and connectors then share one persisted store. */
export function setSchemaSpaceStore(seam: SpaceStoreSeam | null): void { spaceSeam = seam; shared = null; }
export const hostSeams: SeamSetters = { setSchemaSpaceStore, setSchemaVault };
const live = (): SchemaHandle => {
  if (!shared) {
    const s = spaceSeam?.open();
    shared = openSchema(s ? { store: s.store, tx: s.tx, host: s.host } : {});
  }
  return shared;
};

/**
 * Called by the host once at start, after the Space store is wired: seeds the manifest-declared record types in a write of their own, so no read path has to (a read can run in a
 * transaction that is rolled back, which lost the seed and left a Kit's later schema.layout.set on its declared type answering not found).
 */
export async function startSchema(): Promise<string[]> { const h = live(); await h.start(); return h.pruned; }

function adapt(name: keyof SchemaHandlers): (ctx: HostCtx, input: never) => Promise<unknown> {
  return (ctx, input) => {
    const sc: SchemaCtx = { trace: ctx.trace, emit: (n, s, p) => ctx.emit(n, s, p), ...(ctx.principal ? { actor: ctx.principal.id } : {}) };
    return (live().handlers[name] as (c: SchemaCtx, i: unknown) => Promise<unknown>)(sc, input);
  };
}

const NAMES = [
  "schema.describe", "schema.types.list", "schema.types.get", "schema.map", "schema.field_types", "schema.view_kinds", "schema.diff", "schema.apply", "schema.set_label", "schema.infer",
  "schema.changes.list", "schema.trash.list", "schema.restore_field", "views.list", "views.get", "views.save", "views.publish", "views.delete", "views.share_external",
  "schema.layout.get", "schema.layout.set", "schema.gap_rules.list", "schema.gap_rules.set", "schema.sensitivity.scan",
] as const satisfies readonly (keyof SchemaHandlers)[];

export const handlers = Object.fromEntries(NAMES.map((n) => [n, adapt(n)])) as Record<(typeof NAMES)[number], (ctx: HostCtx, input: never) => Promise<unknown>>;
export { createSchemaHandlers, planOps, applyOps };

/** After a field was sealed the old copies are cleaned (seal.ts): once the apply has committed, and at every boot in case a crash came between. */
export const consumers = {
  "schema.seal_clean": { on: ["schema.changed"], run: async (): Promise<void> => { await finishJobs(live().deps); } },
};
export const periodic = {
  "schema.seal_resume": { everyMs: 60_000, immediate: true, run: async (): Promise<number> => finishJobs(live().deps) },
};
