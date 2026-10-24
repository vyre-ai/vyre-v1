// schema module state and shared helpers: the table DDL (migrations/0001_schema.sql), the definition store over sc_types, the mapping between a RecordTypeDef
// (ARCH 4.3) and the kernel Store's TypeDef, and the manifest seed. The RecordStore holds rows and the type tables; sc_types holds the full definitions.
// A type that exists in the store but not in sc_types (made through the store directly) is described by reading its TypeDef back (fromStoreType).
// @reads /modules/schema/migrations/0001_schema.sql
import { readFileSync } from "node:fs";
import { mintUuid } from "../../lib/ids.ts";
import { fail } from "../../host/src/routes/errors.ts";
import type { Tx } from "../../kernel/src/store/projection.ts";
import type { FieldDef, Store, TypeDef } from "../../kernel/src/store/types.ts";

export type Label = "public" | "internal" | "confidential" | "restricted";
export const LABELS: readonly Label[] = ["public", "internal", "confidential", "restricted"];
export const TYPE_KEY = /^[a-z][a-z0-9_]{0,62}$/;
export const FIELD_KEY = /^[a-z][a-z0-9_]*$/;
/** Days a dropped field or type stays in Trash. */
export const TRASH_DAYS = 30;
export const DAY = 86_400_000;

export interface FieldDefT {
  key: string;
  type: string;
  title: string;
  label?: Label;
  required?: boolean;
  unique?: boolean;
  default?: unknown;
  validate?: { expr: string; message: string };
  lockAfter?: "approval";
  merge?: "lww" | "assistant" | "text-crdt" | "append";
  writeOnlyBy?: string[];
  options?: Record<string, unknown>;
}

export interface TypeDefT {
  key: string;
  title: string;
  plural: string;
  icon: string;
  label: Label;
  system?: boolean;
  template?: "project";
  group?: string;
  titleField: string;
  summaryField?: string;
  statusField?: string;
  ownerField?: string;
  workspace?: boolean;
  scope?: string;
  syncedFrom?: string;
  attribution?: boolean;
  retention?: string;
  fields: FieldDefT[];
  version: number;
}

/** A minimal JSON schema as the registry carries it for field options. */
export interface SchemaLite { type?: string; properties?: Record<string, SchemaLite>; required?: string[]; enum?: unknown[]; pattern?: string; items?: SchemaLite }

export interface FieldTypeRow {
  key: string;
  title: string;
  filterOps: string[];
  sortable: boolean;
  groupable: boolean;
  sealed?: boolean;
  options?: SchemaLite;
  storage?: { derived?: string; columns?: { suffix: string; sql: string }[] };
  merge?: string;
}
export interface ViewKindRow { key: string; title: string; needs?: { fieldType: string; as: string }[] }
export interface SeedType extends Omit<TypeDefT, "version" | "label" | "fields"> { label?: Label; fields: FieldDefT[] }
export interface Registry { fieldTypes: FieldTypeRow[]; viewKinds: ViewKindRow[]; recordTypes: SeedType[] }

export interface SchemaDeps {
  store: Store;
  tx: Tx;
  registry: Registry;
  now?: () => number;
  /** The text of a file for schema.infer (a CSV, or a sheet already turned into CSV by the files module). */
  readFile?: (fileId: string, sheet?: string) => Promise<string>;
  /** Prefix of external view links (the Space's public address). Without it a link is the path alone. */
  publicBase?: string;
}

export interface SchemaCtx {
  trace: { traceId: string };
  emit(name: string, subject: string, payload: Record<string, unknown>): unknown;
  /** Who is acting (usr_, agt_ ...). */
  actor?: string;
}

export type ErrCode = Parameters<typeof fail>[0];

/** Throw the catalogue error for a refused call. */
export function refuse(ctx: Pick<SchemaCtx, "trace">, code: ErrCode, message: string, details?: Record<string, unknown>): never {
  throw fail(code, ctx.trace.traceId, { message, ...(details ? { details } : {}) });
}

export const nowOf = (deps: Pick<SchemaDeps, "now">): number => (deps.now ?? Date.now)();

/** `sch_...` and `viw_...` ids: lowercase alphanumerics only (the id schema). */
export const mintShort = (prefix: string, now: number): string => `${prefix}_${mintUuid(now).replaceAll("-", "")}`;

// ---- tables ----

const ready = new WeakSet<object>();
export function ensureTables(tx: Tx): void {
  if (ready.has(tx)) return;
  tx.exec(readFileSync(new URL("./migrations/0001_schema.sql", import.meta.url), "utf8"));
  ready.add(tx);
}

export function rowCount(tx: Tx, type: string): number {
  if (!TYPE_KEY.test(type)) return 0;
  try { return tx.get<{ n: number }>(`SELECT count(*) AS n FROM rt_${type} WHERE deleted_at IS NULL`)?.n ?? 0; } catch { return 0; }
}

// ---- mapping to the Store ----

/** The kernel store's value kind for each field type (kernel/src/store/values.ts). Derived types are never written; they keep a harmless kind. */
const STORE_KIND: Record<string, string> = {
  text: "text", longtext: "rich_text", number: "number", money: "money", datetime: "datetime", duration: "number", choice: "choice", multichoice: "multi_choice",
  status: "stage", checkbox: "boolean", rating: "rating", person: "text", email: "text", phone: "text", url: "url", address: "address", relation: "link",
  sealed: "sealed", ai: "rich_text", files: "urls", signature: "address", autonumber: "number", created_time: "datetime", modified_time: "datetime",
  created_by: "text", modified_by: "text", formula: "text", lookup: "text", rollup: "text", button: "text",
};
const FROM_STORE: Record<string, string> = {
  text: "text", rich_text: "longtext", number: "number", money: "money", boolean: "checkbox", date: "datetime", datetime: "datetime", choice: "choice",
  multi_choice: "multichoice", rating: "rating", url: "url", link: "relation", actor: "person", file: "files", address: "address", phones: "phone",
  emails: "email", urls: "url", sealed: "sealed", stage: "status",
};

export const isDerived = (reg: Registry, type: string): boolean => {
  const ft = reg.fieldTypes.find((f) => f.key === type);
  return ft?.storage?.derived !== undefined;
};

function choiceKeys(o: Record<string, unknown> | undefined, list: "choices" | "stages"): string[] {
  const v = o?.[list];
  if (!Array.isArray(v)) return [];
  return v.flatMap((x) => (x && typeof x === "object" && typeof (x as { key?: unknown }).key === "string" ? [(x as { key: string }).key] : typeof x === "string" ? [x] : []));
}

export function toStoreField(reg: Registry, f: FieldDefT): FieldDef {
  const out: FieldDef = { name: f.key, kind: STORE_KIND[f.type] ?? "text", label: f.title, ftype: f.type };
  if (f.required) out.required = true;
  if (f.unique) out.unique = true;
  if (f.merge) out["merge"] = f.merge;
  if (f.lockAfter) out["lockAfter"] = f.lockAfter;
  if (f.label) out["sensitivity"] = f.label;
  if (f.type === "choice" || f.type === "multichoice") { const k = choiceKeys(f.options, "choices"); if (k.length) out.options = k; }
  if (f.type === "status") { const k = choiceKeys(f.options, "stages"); if (k.length) out.options = k; }
  if (f.type === "relation") {
    const target = f.options?.["target"];
    if (typeof target === "string") out.to = target;
    out.many = true;
    const inv = f.options?.["inverse"];
    if (typeof inv === "string") out["inverse"] = { name: inv };
  }
  if (isDerived(reg, f.type)) out["derived"] = true;
  return out;
}

/** Keys this module owns on a store field; anything else on the store's own field (write_once, protected, seal ...) is kept when a type is redefined. */
const MANAGED = ["name", "kind", "label", "ftype", "required", "unique", "merge", "lockAfter", "sensitivity", "options", "to", "many", "inverse", "derived"];

export function toStoreType(reg: Registry, d: TypeDefT, prior?: TypeDef): TypeDef {
  const fields = d.fields.map((f) => {
    const mapped = toStoreField(reg, f);
    const was = prior?.fields.find((x) => x.name === f.key);
    if (!was) return mapped;
    const kept = Object.fromEntries(Object.entries(was).filter(([k]) => !MANAGED.includes(k)));
    return { ...kept, ...mapped } as FieldDef;
  });
  const extras = prior ? Object.fromEntries(Object.entries(prior).filter(([k]) => !["name", "label", "fields"].includes(k))) : {};
  return { ...extras, name: d.key, label: d.title, fields } as TypeDef;
}

const titleCase = (s: string): string => s.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

/** A type made directly in the store, described in the schema's own terms. */
export function fromStoreType(td: TypeDef): TypeDefT {
  const fields: FieldDefT[] = td.fields.map((f) => {
    const type = typeof f["ftype"] === "string" ? (f["ftype"] as string) : (FROM_STORE[f.kind] ?? "text");
    const out: FieldDefT = { key: f.name, type, title: f.label ?? titleCase(f.name) };
    if (f.required) out.required = true;
    if (f.unique) out.unique = true;
    const m = f["merge"];
    if (m === "lww" || m === "assistant" || m === "text-crdt" || m === "append") out.merge = m;
    if (Array.isArray(f.options)) {
      const items = f.options.map((k) => ({ key: k, title: titleCase(String(k)) }));
      out.options = type === "status" ? { stages: items } : { choices: items };
    }
    if (type === "relation" && typeof f.to === "string") out.options = { target: f.to };
    return out;
  });
  const title = td.label ?? titleCase(td.name);
  const first = fields.find((f) => f.type === "text") ?? fields[0];
  return { key: td.name, title, plural: `${title}s`, icon: "table", label: "internal", titleField: first?.key ?? "", fields, version: 0 };
}

// ---- definitions ----

interface MetaRow { def: string; version: number; system: number }

/** Every type: the definitions in sc_types, then types only the store knows. Keyed by type, in store order. */
export async function allDefs(deps: SchemaDeps): Promise<Map<string, TypeDefT>> {
  ensureTables(deps.tx);
  const out = new Map<string, TypeDefT>();
  for (const td of await deps.store.types()) {
    const m = deps.tx.get<MetaRow>("SELECT def, version, system FROM sc_types WHERE type = ?", td.name);
    if (m) {
      const d = JSON.parse(m.def) as TypeDefT;
      out.set(td.name, { ...d, key: td.name, version: m.version, ...(m.system ? { system: true } : {}) });
    } else out.set(td.name, fromStoreType(td));
  }
  return out;
}

export function saveDef(deps: SchemaDeps, d: TypeDefT, version: number): void {
  const now = nowOf(deps);
  const { version: _v, ...rest } = d;
  void _v;
  deps.tx.run(
    "INSERT INTO sc_types (type, def, version, system, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(type) DO UPDATE SET def = excluded.def, version = excluded.version, system = excluded.system, updated_at = excluded.updated_at",
    d.key, JSON.stringify(rest), version, d.system ? 1 : 0, now, now,
  );
}

export const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
export const cloneDefs = (m: Map<string, TypeDefT>): Map<string, TypeDefT> => new Map([...m].map(([k, v]) => [k, clone(v)]));

/** Put the types the manifests declare into the store and sc_types (once per open; idempotent). Types the store already has under that name are adopted. */
const seeded = new WeakSet<object>();
export async function seedManifestTypes(deps: SchemaDeps): Promise<void> {
  if (seeded.has(deps.tx)) return;
  ensureTables(deps.tx);
  const have = new Set((await deps.store.types()).map((t) => t.name));
  const add: TypeDef[] = [];
  const fresh: TypeDefT[] = [];
  for (const s of deps.registry.recordTypes) {
    if (deps.tx.get("SELECT 1 AS x FROM sc_types WHERE type = ?", s.key)) continue;
    const d: TypeDefT = { ...clone(s), label: s.label ?? "internal", version: 1 };
    fresh.push(d);
    if (!have.has(s.key)) add.push(toStoreType(deps.registry, d));
  }
  if (add.length) await deps.store.define({ add_types: add });
  for (const d of fresh) saveDef(deps, d, 1);
  seeded.add(deps.tx);
}

// ---- option schemas ----

/** The first problem of `value` against a minimal JSON schema (type, properties, required, enum, pattern, items), or null. */
export function checkLite(schema: SchemaLite | undefined, value: unknown, path = "options"): string | null {
  if (!schema) return null;
  const kind = (v: unknown): string => (v === null ? "null" : Array.isArray(v) ? "array" : typeof v);
  if (schema.type) {
    const k = kind(value);
    const ok = schema.type === "integer" ? Number.isInteger(value) : schema.type === k;
    if (!ok) return `${path} must be ${schema.type === "object" ? "an object" : `a ${schema.type}`}`;
  }
  if (schema.enum && !schema.enum.includes(value)) return `${path} must be one of ${schema.enum.map(String).join(", ")}`;
  if (schema.pattern && typeof value === "string" && !new RegExp(schema.pattern).test(value)) return `${path} is not in the expected form`;
  if (schema.type === "object" && value && typeof value === "object") {
    const o = value as Record<string, unknown>;
    for (const r of schema.required ?? []) if (o[r] === undefined) return `${path}.${r} is required`;
    for (const [k, s] of Object.entries(schema.properties ?? {})) if (o[k] !== undefined) { const e = checkLite(s, o[k], `${path}.${k}`); if (e) return e; }
  }
  if (schema.type === "array" && Array.isArray(value) && schema.items) {
    for (let i = 0; i < value.length; i++) { const e = checkLite(schema.items, value[i], `${path}[${i}]`); if (e) return e; }
  }
  return null;
}
