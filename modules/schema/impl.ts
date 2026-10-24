// @reads /modules/schema/migrations/0001_schema.sql
// Schema module (lane L3). The host loads these handlers once the manifest status is live (ARCH 12.4).
// A schema handle works over a RecordStore: types live in the store (rs_types, rt_<type>), full definitions in sc_types. Standalone (tests, the loader entry below) it opens
// its own kernel store; the host passes the Space's shared store and tx when it builds the handle.
import { readFileSync } from "node:fs";
import { openRecordStore } from "../../kernel/src/store/records.ts";
import type { ProjectionHost, Tx } from "../../kernel/src/store/projection.ts";
import type { Store } from "../../kernel/src/store/types.ts";
import { createSchemaHandlers, applyOps, planOps } from "./handlers/index.ts";
import type { SchemaHandlers, SchemaOp } from "./handlers/index.ts";
import { allDefs, ensureTables, refuse, seedManifestTypes } from "./projections.ts";
import type { FieldDefT, FieldTypeRow, Registry, SchemaCtx, SchemaDeps, SeedType, ViewKindRow } from "./projections.ts";

/** The registry the contract generator wrote (field types, view kinds, record types the manifests declare). */
export function loadRegistry(path: URL = new URL("../../generated/registry.json", import.meta.url)): Registry {
  const raw = JSON.parse(readFileSync(path, "utf8")) as { fieldTypes: FieldTypeRow[]; viewKinds: ViewKindRow[]; recordTypes: (SeedType & { module?: string })[] };
  return {
    fieldTypes: raw.fieldTypes,
    viewKinds: raw.viewKinds,
    recordTypes: raw.recordTypes.map(({ module: _m, ...t }) => { void _m; return { ...t, fields: t.fields as FieldDefT[] }; }),
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
}

export function openSchema(o: {
  path?: string; space?: string; store?: Store; tx?: Tx; registry?: Registry; now?: () => number;
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
    ...(o.now ? { now: o.now } : {}), ...(o.readFile ? { readFile: o.readFile } : {}), ...(o.publicBase ? { publicBase: o.publicBase } : {}),
  };
  ensureTables(tx);
  return { deps, store, tx, ...(host ? { host } : {}), handlers: createSchemaHandlers(deps), ready: () => seedManifestTypes(deps) };
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
const live = (): SchemaHandle => (shared ??= openSchema());

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
