// schema write side (spec 2.9): diff, apply, set_label, infer, restore_field, saved views, record page layout and gap-check rules.
// One planner turns a list of ops into a diff (additive items go straight through, destructive items need their itemKey in confirm), and apply runs exactly that plan:
//   1. define a bridge type (final fields plus the fields being dropped or renamed), 2. move the data row by row through the RecordStore (one update per row, events as usual),
//   3. write a copy of every dropped or retyped value to Trash for 30 days, 4. define the final type, 5. save the definitions, log the change, emit events.
import { canonical } from "../../../lib/canonical.ts";
import { parseExpr, exprNames } from "../../../lib/expr/expr.ts";
import { sha256Hex } from "../../../kernel/src/log/hash.ts";
import type { StoredRecord, TypeDef } from "../../../kernel/src/store/types.ts";
import { DAY, FIELD_KEY, LABELS, TRASH_DAYS, TYPE_KEY, allDefs, checkLite, clone, cloneDefs, ensureTables, isDerived, mintShort, nowOf, refuse, rowCount, saveDef, seedManifestTypes, toStoreType } from "../projections.ts";
import type { FieldDefT, Label, SchemaCtx, SchemaDeps, TypeDefT } from "../projections.ts";
import { viewRowOf } from "./describe.ts";
import type { GapRule, LayoutSection, ViewRow } from "./describe.ts";

export type OpName = "type.create" | "type.update" | "type.drop" | "field.add" | "field.update" | "field.retype" | "field.rename" | "field.drop" | "field.reorder" | "relation.add" | "relation.drop";
export interface SchemaOp { op: OpName; type: string; field?: string; def?: Record<string, unknown>; newKey?: string; toType?: string; order?: string[] }
export interface DiffItem { itemKey: string; op: string; type: string; field?: string; summary: string; destructive: boolean; affectedRows: number; copiedToTrash: boolean }
export interface DiffProblem { itemKey: string; message: string }

export interface ApplyHandlers {
  "schema.diff"(ctx: SchemaCtx, input: { ops: SchemaOp[] }): Promise<{ previewToken: string; items: DiffItem[]; additive: number; destructive: number; problems: DiffProblem[] }>;
  "schema.apply"(ctx: SchemaCtx, input: { ops: SchemaOp[]; previewToken?: string; confirm?: string[]; reason?: string }): Promise<{ changeId: string; applied: number; items: DiffItem[] }>;
  "schema.set_label"(ctx: SchemaCtx, input: { type: string; field?: string; label: Label }): Promise<{ ok: boolean }>;
  "schema.infer"(ctx: SchemaCtx, input: { text?: string; fileId?: string; name?: string; sheet?: string }): Promise<{ ops: SchemaOp[]; columns: { column: string; field: string; type: string; sample: string[] }[]; rowCount: number }>;
  "schema.restore_field"(ctx: SchemaCtx, input: { type: string; field: string }): Promise<{ ok: boolean }>;
  "views.save"(ctx: SchemaCtx, input: { type: string; viewId?: string; kind: string; title: string; filter?: unknown; sort?: unknown; group?: string; hidden?: string[]; colorRules?: unknown; config?: Record<string, unknown> }): Promise<{ view: ViewRow }>;
  "views.publish"(ctx: SchemaCtx, input: { viewId: string; shared: boolean }): Promise<{ view: ViewRow }>;
  "views.delete"(ctx: SchemaCtx, input: { viewId: string }): Promise<{ deleted: boolean }>;
  "views.share_external"(ctx: SchemaCtx, input: { viewId: string; expiresAt?: number }): Promise<{ url: string; expiresAt?: number }>;
  "schema.layout.set"(ctx: SchemaCtx, input: { type: string; sections: LayoutSection[] }): Promise<{ sections: LayoutSection[] }>;
  "schema.gap_rules.set"(ctx: SchemaCtx, input: { type: string; rule: GapRule }): Promise<{ rule: GapRule }>;
}

// ---- conversion of values for field.retype ----

const TEXTUAL = new Set(["text", "longtext", "ai", "email", "phone", "person"]);
const NO_RETYPE_FROM = new Set(["relation", "sealed", "files", "signature", "button", "lookup", "rollup", "formula", "autonumber", "created_time", "created_by", "modified_time", "modified_by"]);
const NO_RETYPE_TO = new Set(["relation", "sealed", "files", "signature", "button", "lookup", "rollup", "formula", "autonumber", "created_time", "created_by", "modified_time", "modified_by", "ai"]);
const ISO = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?)?$/;

const asText = (v: unknown): string => {
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) return v.map(asText).join(", ");
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    if (typeof o["amount"] === "number") return `${o["amount"]} ${String(o["currency"] ?? "")}`.trim();
    return canonical(v);
  }
  return String(v);
};

const choicesOf = (f: FieldDefT): string[] => {
  const list = f.type === "status" ? f.options?.["stages"] : f.options?.["choices"];
  return Array.isArray(list) ? list.flatMap((x) => (x && typeof x === "object" && typeof (x as { key?: unknown }).key === "string" ? [(x as { key: string }).key] : [])) : [];
};

/** The value in the new field type, or ok:false when it cannot be carried over (the old value stays in Trash). */
export function convertValue(from: FieldDefT, to: FieldDefT, v: unknown): { ok: boolean; value?: unknown } {
  if (v === null || v === undefined) return { ok: true, value: null };
  const num = (x: unknown): number | null => {
    if (typeof x === "number" && Number.isFinite(x)) return x;
    if (typeof x === "boolean") return x ? 1 : 0;
    if (x && typeof x === "object" && typeof (x as { amount?: unknown }).amount === "number") return (x as { amount: number }).amount;
    if (typeof x === "string") { const n = Number(x.replace(/[,\s$€£]/g, "")); return x.trim() !== "" && Number.isFinite(n) ? n : null; }
    return null;
  };
  switch (to.type) {
    case "text": case "longtext": case "email": case "phone": case "person": return { ok: true, value: asText(v) };
    case "url": { const s = asText(v); return /^https?:\/\//.test(s) ? { ok: true, value: s } : { ok: false }; }
    case "number": case "duration": { const n = num(v); return n === null ? { ok: false } : { ok: true, value: n }; }
    case "rating": { const n = num(v); return n !== null && Number.isInteger(n) && n >= 1 && n <= 5 ? { ok: true, value: n } : { ok: false }; }
    case "money": {
      const n = num(v);
      if (n === null) return { ok: false };
      if (v && typeof v === "object" && typeof (v as { currency?: unknown }).currency === "string") return { ok: true, value: v };
      const cur = to.options?.["currency"];
      return { ok: true, value: { amount: n, currency: typeof cur === "string" && /^[A-Z]{3}$/.test(cur) ? cur : "USD" } };
    }
    case "checkbox": {
      if (typeof v === "boolean") return { ok: true, value: v };
      const s = asText(v).trim().toLowerCase();
      if (["true", "yes", "y", "1"].includes(s)) return { ok: true, value: true };
      if (["false", "no", "n", "0"].includes(s)) return { ok: true, value: false };
      return { ok: false };
    }
    case "datetime": {
      if (typeof v === "string" && ISO.test(v)) return { ok: true, value: v };
      if (typeof v === "number" && Number.isFinite(v)) return { ok: true, value: new Date(v).toISOString() };
      return { ok: false };
    }
    case "choice": case "status": {
      const options = choicesOf(to);
      const first = Array.isArray(v) ? (v.length === 1 ? asText(v[0]) : "") : asText(v);
      const hit = options.find((o) => o.toLowerCase() === first.toLowerCase());
      return hit !== undefined ? { ok: true, value: hit } : { ok: false };
    }
    case "multichoice": {
      const options = choicesOf(to);
      const parts = Array.isArray(v) ? v.map(asText) : asText(v).split(",").map((x) => x.trim()).filter(Boolean);
      const mapped = parts.map((p) => options.find((o) => o.toLowerCase() === p.toLowerCase()));
      return mapped.every((m) => m !== undefined) ? { ok: true, value: mapped } : { ok: false };
    }
    case "address": {
      if (v && typeof v === "object" && !Array.isArray(v) && Object.values(v).every((x) => typeof x === "string")) return { ok: true, value: v };
      return typeof v === "string" && from.type !== "address" ? { ok: true, value: { line1: v } } : { ok: false };
    }
    default: return { ok: false };
  }
}

// ---- the planner ----

class Problem extends Error {
  dup: boolean;
  constructor(message: string, dup = false) { super(message); this.dup = dup; }
}
const no = (message: string): never => { throw new Problem(message); };

type Effect =
  | { k: "drop"; type: string; field: string; def: FieldDefT }
  | { k: "rename"; type: string; from: string; to: string }
  | { k: "retype"; type: string; field: string; from: FieldDefT; to: FieldDefT }
  | { k: "dropType"; type: string; def: TypeDefT };

interface Plan {
  items: DiffItem[];
  problems: (DiffProblem & { dup: boolean })[];
  before: Map<string, TypeDefT>;
  next: Map<string, TypeDefT>;
  effects: Effect[];
  touched: Set<string>;
  created: Set<string>;
  dropped: Set<string>;
  labelChanges: { type: string; field?: string; from: Label; to: Label }[];
  lost: number;
}

const titleCase = (s: string): string => s.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
const keyOf = (op: SchemaOp): string => `${op.op}:${op.type}${op.field !== undefined ? `.${op.field}` : ""}`;

function countValues(deps: SchemaDeps, type: string, field: string): number {
  if (!TYPE_KEY.test(type)) return 0;
  try {
    return deps.tx.get<{ n: number }>(`SELECT count(*) AS n FROM rt_${type} WHERE deleted_at IS NULL AND json_extract(data, ?) IS NOT NULL`, `$."${field}"`)?.n ?? 0;
  } catch { return 0; }
}

function hasDuplicates(deps: SchemaDeps, type: string, field: string): boolean {
  if (!TYPE_KEY.test(type)) return false;
  try {
    return deps.tx.get(`SELECT 1 AS x FROM (SELECT json_extract(data, ?) AS v FROM rt_${type} WHERE deleted_at IS NULL) WHERE v IS NOT NULL GROUP BY v HAVING count(*) > 1 LIMIT 1`, `$."${field}"`) !== undefined;
  } catch { return false; }
}

export function heldRows(deps: SchemaDeps, type: string): number {
  try { return deps.tx.get<{ n: number }>("SELECT count(*) AS n FROM records_row_meta WHERE type = ? AND holds > 0", type)?.n ?? 0; } catch { return 0; }
}

/** Fields a manifest declared on a system type: they stay (title and label may change). */
function manifestField(deps: SchemaDeps, d: TypeDefT, field: string): boolean {
  return d.system === true && (deps.registry.recordTypes.find((s) => s.key === d.key)?.fields ?? []).some((f) => f.key === field);
}

function dependents(st: Map<string, TypeDefT>, type: string, field: string): string[] {
  const out: string[] = [];
  for (const d of st.values()) {
    for (const g of d.fields) {
      if (d.key === type && g.key === field) continue;
      const o = g.options ?? {};
      if ((g.type === "lookup" || g.type === "rollup") && d.key === type && o["via"] === field) out.push(`${d.key}.${g.key}`);
      if ((g.type === "lookup" || g.type === "rollup") && o["field"] === field) {
        const via = d.fields.find((x) => x.key === o["via"]);
        if (via?.options?.["target"] === type) out.push(`${d.key}.${g.key}`);
      }
      if (g.type === "formula" && d.key === type && typeof o["expr"] === "string") {
        try { if (exprNames(parseExpr(o["expr"])).has(field)) out.push(`${d.key}.${g.key}`); } catch { /* an unparsable formula depends on nothing */ }
      }
    }
  }
  return out;
}

function checkField(deps: SchemaDeps, st: Map<string, TypeDefT>, t: TypeDefT, f: FieldDefT): void {
  if (!FIELD_KEY.test(f.key) || f.key.length > 63) no(`${f.key || "(empty)"} is not a field key: lowercase letters, digits and underscores, starting with a letter`);
  if (typeof f.title !== "string" || !f.title.trim()) no(`field ${f.key} needs a title`);
  const ft = deps.registry.fieldTypes.find((x) => x.key === f.type);
  if (!ft) return no(`field ${f.key}: ${String(f.type)} is not a field type`);
  if (f.label !== undefined && !LABELS.includes(f.label)) no(`field ${f.key}: ${String(f.label)} is not a sensitivity label`);
  if (f.merge !== undefined && !["lww", "assistant", "text-crdt", "append"].includes(f.merge)) no(`field ${f.key}: unknown merge rule ${String(f.merge)}`);
  const optErr = checkLite(ft.options, f.options ?? (ft.options?.required?.length ? undefined : {}), `field ${f.key} options`);
  if (optErr) no(optErr);
  if (isDerived(deps.registry, f.type) && (f.required || f.unique)) no(`field ${f.key}: a ${f.type} field is computed, so it cannot be required or unique`);
  if (f.type === "sealed" && f.unique) no(`field ${f.key}: a sealed field cannot be unique`);
  const o = f.options ?? {};
  const own = new Set(t.fields.map((x) => x.key));
  switch (f.type) {
    case "relation": {
      const target = o["target"];
      if (typeof target !== "string" || !st.has(target)) no(`field ${f.key}: relation target ${String(target)} is not a record type`);
      break;
    }
    case "lookup": case "rollup": {
      const via = t.fields.find((x) => x.key === o["via"]);
      if (!via || via.type !== "relation") no(`field ${f.key}: via must name a relation field of ${t.key}`);
      const target = st.get(String(via!.options?.["target"]));
      if (!target || !target.fields.some((x) => x.key === o["field"])) no(`field ${f.key}: ${String(o["field"])} is not a field of ${String(via!.options?.["target"])}`);
      break;
    }
    case "formula": {
      let names: Set<string>;
      try { names = exprNames(parseExpr(String(o["expr"]))); } catch (e) { return no(`field ${f.key}: the formula does not parse (${e instanceof Error ? e.message : "error"})`); }
      for (const n of names) if (!own.has(n) || n === f.key) no(`field ${f.key}: the formula reads ${n}, which is not another field of ${t.key}`);
      break;
    }
    case "choice": case "multichoice": case "status": {
      const list = f.type === "status" ? o["stages"] : o["choices"];
      if (f.type === "status" && (!Array.isArray(list) || list.length === 0)) no(`field ${f.key}: a status needs at least one stage`);
      if (Array.isArray(list)) {
        const keys = list.map((x) => (x as { key?: unknown }).key);
        if (keys.some((k) => typeof k !== "string" || !k) || new Set(keys).size !== keys.length) no(`field ${f.key}: choices need distinct keys`);
        if (typeof f.default === "string" && list.length && !keys.includes(f.default)) no(`field ${f.key}: the default ${f.default} is not one of its choices`);
      }
      break;
    }
    default: break;
  }
  if (f.validate) {
    try { parseExpr(f.validate.expr); } catch (e) { no(`field ${f.key}: the validation does not parse (${e instanceof Error ? e.message : "error"})`); }
    if (typeof f.validate.message !== "string" || !f.validate.message) no(`field ${f.key}: the validation needs a message`);
  }
}

function checkType(st: Map<string, TypeDefT>, t: TypeDefT): void {
  const keys = new Set(t.fields.map((f) => f.key));
  if (keys.size !== t.fields.length) no(`${t.key} names a field twice`);
  if (!keys.has(t.titleField)) no(`${t.key}: title field ${t.titleField} is not a field`);
  const title = t.fields.find((f) => f.key === t.titleField);
  if (title && !["text", "longtext", "formula", "autonumber"].includes(title.type)) no(`${t.key}: the title field must be text`);
  for (const [name, v] of [["summaryField", t.summaryField], ["statusField", t.statusField], ["ownerField", t.ownerField]] as const) {
    if (v !== undefined && !keys.has(v)) no(`${t.key}: ${name} ${v} is not a field`);
  }
  if (t.statusField && !["status", "choice"].includes(t.fields.find((f) => f.key === t.statusField)?.type ?? "")) no(`${t.key}: the status field must be a status or choice`);
  for (const f of t.fields) if (f.type === "relation" && !st.has(String(f.options?.["target"]))) no(`${t.key}.${f.key}: relation target ${String(f.options?.["target"])} no longer exists`);
}

const TYPE_PATCH = ["title", "plural", "icon", "label", "group", "titleField", "summaryField", "statusField", "ownerField", "retention", "attribution"] as const;
const FIELD_PATCH = ["title", "label", "required", "unique", "default", "validate", "lockAfter", "merge", "writeOnlyBy", "options"] as const;
const RESERVED = new Set(["id"]);

export async function planOps(deps: SchemaDeps, ops: SchemaOp[]): Promise<Plan> {
  await seedManifestTypes(deps);
  const before = await allDefs(deps);
  const st = cloneDefs(before);
  const plan: Plan = { items: [], problems: [], before, next: st, effects: [], touched: new Set(), created: new Set(), dropped: new Set(), labelChanges: [], lost: 0 };
  const add = (op: SchemaOp, summary: string, o: { destructive?: boolean; rows?: number; field?: string } = {}): void => {
    plan.items.push({
      itemKey: keyOf({ ...op, ...(o.field !== undefined ? { field: o.field } : {}) }), op: op.op, type: op.type, ...((o.field ?? op.field) !== undefined ? { field: o.field ?? op.field! } : {}),
      summary, destructive: o.destructive === true, affectedRows: o.rows ?? 0, copiedToTrash: o.destructive === true,
    });
  };
  const needType = (key: string): TypeDefT => st.get(key) ?? no(`There is no record type ${key}`);
  const needField = (t: TypeDefT, key: string | undefined): FieldDefT => (key === undefined ? no("name the field") : t.fields.find((f) => f.key === key) ?? no(`${t.key} has no field ${key}`));

  for (const op of ops) {
    try {
      switch (op.op) {
        case "type.create": {
          const d = op.def ?? {};
          if (!TYPE_KEY.test(op.type) || op.type.includes("__")) no(`${op.type} is not a type key: lowercase letters, digits and single underscores, starting with a letter`);
          if (st.has(op.type)) throw new Problem(`Record type ${op.type} already exists`, true);
          if (d["system"] !== undefined || d["template"] !== undefined || d["syncedFrom"] !== undefined) no("system, template and synced types come from their modules, not from schema.apply");
          const fields = Array.isArray(d["fields"]) ? (clone(d["fields"]) as FieldDefT[]) : [];
          if (!fields.length) fields.push({ key: "name", type: "text", title: "Name", required: true });
          const title = typeof d["title"] === "string" && d["title"] ? d["title"] : titleCase(op.type);
          const t: TypeDefT = {
            key: op.type, title, plural: typeof d["plural"] === "string" && d["plural"] ? d["plural"] : `${title}s`, icon: typeof d["icon"] === "string" && d["icon"] ? d["icon"] : "table",
            label: (d["label"] as Label | undefined) ?? "internal", titleField: typeof d["titleField"] === "string" ? d["titleField"] : (fields.find((f) => f.type === "text")?.key ?? fields[0]!.key), fields, version: 0,
          };
          for (const k of ["group", "summaryField", "statusField", "ownerField", "retention", "scope"] as const) if (typeof d[k] === "string") t[k] = d[k] as string;
          if (typeof d["attribution"] === "boolean") t.attribution = d["attribution"];
          if (typeof d["workspace"] === "boolean") t.workspace = d["workspace"];
          if (!LABELS.includes(t.label)) no(`${String(t.label)} is not a sensitivity label`);
          st.set(t.key, t);
          for (const f of t.fields) checkField(deps, st, t, f);
          checkType(st, t);
          plan.created.add(t.key);
          plan.touched.add(t.key);
          add(op, `Create record type ${t.title} with ${t.fields.length} field${t.fields.length === 1 ? "" : "s"}`);
          break;
        }
        case "type.update": {
          const t = needType(op.type);
          const patch = op.def ?? {};
          const touched: string[] = [];
          for (const k of Object.keys(patch)) {
            if (!(TYPE_PATCH as readonly string[]).includes(k)) no(`${k} cannot be changed with type.update`);
            if (t.system && !["title", "plural", "icon", "group", "label"].includes(k)) no(`${t.key} is a system type: only its name, icon, group and label can change`);
            const prev = (t as unknown as Record<string, unknown>)[k];
            const v = patch[k];
            if (v === null || v === undefined) delete (t as unknown as Record<string, unknown>)[k];
            else (t as unknown as Record<string, unknown>)[k] = v;
            if (canonical(prev ?? null) !== canonical(v ?? null)) touched.push(k);
            if (k === "label" && prev !== v) plan.labelChanges.push({ type: t.key, from: prev as Label, to: v as Label });
          }
          if (t.label && !LABELS.includes(t.label)) no(`${String(t.label)} is not a sensitivity label`);
          checkType(st, t);
          plan.touched.add(t.key);
          add(op, touched.length ? `Change ${t.title}: ${touched.join(", ")}` : `No change to ${t.title}`);
          break;
        }
        case "type.drop": {
          const t = needType(op.type);
          if (t.system) no(`${t.key} is a system type and cannot be dropped`);
          for (const d of st.values()) for (const f of d.fields) if (d.key !== t.key && f.type === "relation" && f.options?.["target"] === t.key) no(`${d.key}.${f.key} is a relation to ${t.key}: drop the relation first`);
          const rows = rowCount(deps.tx, t.key);
          plan.effects.push({ k: "dropType", type: t.key, def: clone(plan.before.get(t.key) ?? t) });
          st.delete(t.key);
          plan.dropped.add(t.key);
          plan.touched.add(t.key);
          add(op, `Drop record type ${t.title} (${rows} record${rows === 1 ? "" : "s"} go to Trash for ${TRASH_DAYS} days)`, { destructive: true, rows });
          break;
        }
        case "field.add": {
          const t = needType(op.type);
          const f = { ...(clone(op.def ?? {}) as Partial<FieldDefT>), key: op.field ?? (op.def?.["key"] as string | undefined) ?? "" } as FieldDefT;
          if (RESERVED.has(f.key)) no(`${f.key} is reserved`);
          if (t.fields.some((x) => x.key === f.key)) throw new Problem(`${t.key} already has a field ${f.key}`, true);
          if (f.type === "relation") no("Use relation.add to make a relation: it creates both ends");
          if (!f.title) f.title = titleCase(f.key);
          t.fields.push(f);
          checkField(deps, st, t, f);
          if (f.unique && hasDuplicates(deps, t.key, f.key)) no(`${f.key} cannot be unique`);
          plan.touched.add(t.key);
          add(op, `Add field ${f.title} (${f.type}) to ${t.title}`, { field: f.key });
          break;
        }
        case "field.update": {
          const t = needType(op.type);
          const f = needField(t, op.field);
          const patch = op.def ?? {};
          const was = { ...f };
          for (const k of Object.keys(patch)) {
            if (!(FIELD_PATCH as readonly string[]).includes(k)) no(`${k} cannot be changed with field.update: use field.retype or field.rename`);
            if (manifestField(deps, t, f.key) && !["title", "label"].includes(k)) no(`${f.key} is part of the ${t.key} system type: only its title and label can change`);
            const v = patch[k];
            if (v === null || v === undefined) delete (f as unknown as Record<string, unknown>)[k];
            else (f as unknown as Record<string, unknown>)[k] = v;
          }
          checkField(deps, st, t, f);
          if (f.unique && !was.unique && hasDuplicates(deps, t.key, f.key)) no(`${f.key} has duplicate values, so it cannot be made unique`);
          if (f.label !== was.label) plan.labelChanges.push({ type: t.key, field: f.key, from: was.label ?? t.label, to: f.label ?? t.label });
          plan.touched.add(t.key);
          add(op, `Change field ${f.title} of ${t.title}: ${Object.keys(patch).join(", ") || "nothing"}`);
          break;
        }
        case "field.retype": {
          const t = needType(op.type);
          const f = needField(t, op.field);
          const toType = op.toType ?? no("field.retype needs toType");
          if (toType === f.type) no(`${f.key} is already ${toType}`);
          if (manifestField(deps, t, f.key)) no(`${f.key} is part of the ${t.key} system type and cannot be retyped`);
          if (NO_RETYPE_FROM.has(f.type)) no(`a ${f.type} field cannot be retyped`);
          if (NO_RETYPE_TO.has(toType)) no(`a field cannot be retyped to ${toType}`);
          if (dependents(st, t.key, f.key).length) no(`${f.key} is used by ${dependents(st, t.key, f.key).join(", ")}`);
          const from = clone(f);
          const to: FieldDefT = { ...clone(f), type: toType };
          delete to.options;
          if (op.def?.["options"]) to.options = op.def["options"] as Record<string, unknown>;
          else if ((from.type === "choice" || from.type === "multichoice") && (toType === "choice" || toType === "multichoice")) to.options = clone(from.options ?? {});
          if (typeof op.def?.["title"] === "string") to.title = op.def["title"];
          delete to.default;
          Object.assign(f, to);
          checkField(deps, st, t, f);
          if (f.unique && hasDuplicates(deps, t.key, f.key)) no(`${f.key} has duplicate values`);
          const rows = countValues(deps, t.key, f.key);
          let lost = 0;
          if (rows) {
            let cursor: string | undefined;
            do {
              const page = await deps.store.query(t.key, { page: { limit: 500, ...(cursor ? { cursor } : {}) } });
              for (const r of page.rows) { const v = r.data[f.key]; if (v !== undefined && v !== null && !convertValue(from, to, v).ok) lost++; }
              cursor = page.next_cursor;
            } while (cursor);
          }
          plan.lost += lost;
          plan.effects.push({ k: "retype", type: t.key, field: f.key, from, to });
          plan.touched.add(t.key);
          add(op, `Change ${f.title} of ${t.title} from ${from.type} to ${toType}${lost ? ` (${lost} value${lost === 1 ? "" : "s"} cannot convert and are cleared)` : ""}`, { destructive: true, rows });
          break;
        }
        case "field.rename": {
          const t = needType(op.type);
          const f = needField(t, op.field);
          const nk = op.newKey ?? no("field.rename needs newKey");
          if (!FIELD_KEY.test(nk) || RESERVED.has(nk)) no(`${nk} is not a field key`);
          if (t.fields.some((x) => x.key === nk)) throw new Problem(`${t.key} already has a field ${nk}`, true);
          if (manifestField(deps, t, f.key)) no(`${f.key} is part of the ${t.key} system type and cannot be renamed`);
          if (dependents(st, t.key, f.key).length) no(`${f.key} is used by ${dependents(st, t.key, f.key).join(", ")}: change those first`);
          const old = f.key;
          f.key = nk;
          for (const k of ["titleField", "summaryField", "statusField", "ownerField"] as const) if (t[k] === old) t[k] = nk;
          if (f.type === "relation") {
            const target = st.get(String(f.options?.["target"]));
            const inv = f.options?.["inverse"];
            const back = target?.fields.find((x) => x.key === inv);
            if (back?.options) back.options["inverse"] = nk;
            if (target) plan.touched.add(target.key);
          }
          plan.effects.push({ k: "rename", type: t.key, from: old, to: nk });
          plan.touched.add(t.key);
          add(op, `Rename field ${old} of ${t.title} to ${nk}`);
          break;
        }
        case "field.drop": {
          const t = needType(op.type);
          const f = needField(t, op.field);
          if (f.type === "relation") no(`${f.key} is a relation: use relation.drop`);
          if (manifestField(deps, t, f.key)) no(`${f.key} is part of the ${t.key} system type and cannot be dropped`);
          if ([t.titleField, t.summaryField, t.statusField, t.ownerField].includes(f.key)) no(`${f.key} is the title, summary, status or owner field of ${t.key}: pick another first`);
          const deps2 = dependents(st, t.key, f.key);
          if (deps2.length) no(`${f.key} is used by ${deps2.join(", ")}`);
          const rows = countValues(deps, t.key, f.key);
          plan.effects.push({ k: "drop", type: t.key, field: f.key, def: clone(f) });
          t.fields = t.fields.filter((x) => x.key !== f.key);
          plan.touched.add(t.key);
          add(op, `Drop field ${f.title} from ${t.title} (${rows} value${rows === 1 ? "" : "s"} go to Trash for ${TRASH_DAYS} days)`, { destructive: true, rows });
          break;
        }
        case "field.reorder": {
          const t = needType(op.type);
          const order = op.order ?? no("field.reorder needs order");
          if (order.length !== t.fields.length || new Set(order).size !== order.length || !t.fields.every((f) => order.includes(f.key))) no(`order must list every field of ${t.key} exactly once`);
          t.fields = order.map((k) => t.fields.find((f) => f.key === k)!);
          plan.touched.add(t.key);
          add(op, `Reorder the fields of ${t.title}`);
          break;
        }
        case "relation.add": {
          const t = needType(op.type);
          const key = op.field ?? no("relation.add needs the field key");
          const d = op.def ?? {};
          const to = needType(String(d["to"] ?? no("relation.add needs def.to")));
          const inverse = typeof d["inverse"] === "string" ? d["inverse"] : undefined;
          if (!inverse) no("relation.add needs def.inverse: the field on the other record type");
          if (t.fields.some((x) => x.key === key)) throw new Problem(`${t.key} already has a field ${key}`, true);
          if (to.fields.some((x) => x.key === inverse) || (to.key === t.key && inverse === key)) throw new Problem(`${to.key} already has a field ${inverse}`, true);
          const near: FieldDefT = { key, type: "relation", title: typeof d["title"] === "string" ? d["title"] : titleCase(key), options: { target: to.key, inverse } };
          const far: FieldDefT = { key: inverse!, type: "relation", title: typeof d["inverseTitle"] === "string" ? d["inverseTitle"] : titleCase(inverse!), options: { target: t.key, inverse: key } };
          if (typeof d["label"] === "string") near.label = d["label"] as Label;
          t.fields.push(near);
          to.fields.push(far);
          checkField(deps, st, t, near);
          checkField(deps, st, to, far);
          plan.touched.add(t.key);
          plan.touched.add(to.key);
          add(op, `Relate ${t.title} to ${to.title} through ${key} and ${inverse}`);
          break;
        }
        case "relation.drop": {
          const t = needType(op.type);
          const f = needField(t, op.field);
          if (f.type !== "relation") no(`${f.key} is not a relation`);
          if (manifestField(deps, t, f.key)) no(`${f.key} is part of the ${t.key} system type and cannot be dropped`);
          const to = st.get(String(f.options?.["target"]));
          const back = to?.fields.find((x) => x.key === f.options?.["inverse"] && x.type === "relation" && x.options?.["target"] === t.key);
          let rows = countValues(deps, t.key, f.key);
          plan.effects.push({ k: "drop", type: t.key, field: f.key, def: clone(f) });
          t.fields = t.fields.filter((x) => x.key !== f.key);
          if (to && back) {
            if (manifestField(deps, to, back.key)) no(`${back.key} is part of the ${to.key} system type and cannot be dropped`);
            rows += countValues(deps, to.key, back.key);
            plan.effects.push({ k: "drop", type: to.key, field: back.key, def: clone(back) });
            to.fields = to.fields.filter((x) => x.key !== back.key);
            plan.touched.add(to.key);
          }
          for (const x of [t, ...(to && to !== t ? [to] : [])]) if ([x.titleField, x.summaryField, x.statusField, x.ownerField].some((k) => k !== undefined && !x.fields.some((y) => y.key === k))) no(`a relation end is the title, summary, status or owner field of ${x.key}`);
          plan.touched.add(t.key);
          add(op, `Drop the relation ${f.title} of ${t.title}${back ? ` and ${back.key} on ${to!.title}` : ""} (${rows} link${rows === 1 ? "" : "s"} go to Trash)`, { destructive: true, rows });
          break;
        }
        default: no(`${String((op as { op?: unknown }).op)} is not a schema operation`);
      }
    } catch (e) {
      if (!(e instanceof Problem)) throw e;
      plan.problems.push({ itemKey: keyOf(op), message: e.message, dup: e.dup });
    }
  }
  if (!plan.problems.length) {
    for (const k of plan.touched) {
      const t = st.get(k);
      if (!t) continue;
      try { checkType(st, t); } catch (e) { if (!(e instanceof Problem)) throw e; plan.problems.push({ itemKey: `type:${k}`, message: e.message, dup: false }); }
    }
  }
  return plan;
}

function tokenOf(plan: Plan, ops: SchemaOp[]): string {
  const versions: Record<string, number> = {};
  for (const k of new Set([...plan.touched, ...ops.map((o) => o.type)])) versions[k] = plan.before.get(k)?.version ?? 0;
  return sha256Hex(canonical({ ops, versions })).slice(0, 32);
}

// ---- execution ----

async function eachRow(deps: SchemaDeps, type: string, fn: (r: StoredRecord) => Promise<void>): Promise<void> {
  let cursor: string | undefined;
  do {
    const page = await deps.store.query(type, { page: { limit: 500, ...(cursor ? { cursor } : {}) } });
    for (const r of page.rows) await fn(r);
    cursor = page.next_cursor;
  } while (cursor);
}

const relaxed = (f: FieldDefT): FieldDefT => { const c = clone(f); delete c.required; delete c.unique; return c; };

/** The type as the store sees it while data moves: the final fields plus every field still to be emptied, renamed away from or retyped. */
function bridgeOf(deps: SchemaDeps, plan: Plan, type: string, prior: Map<string, TypeDef>): TypeDef {
  const final = plan.next.get(type)!;
  const t = clone(final);
  for (const e of plan.effects) {
    if (e.type !== type) continue;
    if (e.k === "drop") t.fields.push(relaxed(e.def));
    if (e.k === "rename") { const nf = t.fields.find((f) => f.key === e.to); if (nf) t.fields.push({ ...relaxed(nf), key: e.from }); }
  }
  return toStoreType(deps.registry, t, prior.get(type));
}

function repairDependents(deps: SchemaDeps, e: Effect): void {
  const { tx } = deps;
  if (e.k === "dropType") {
    tx.run("DELETE FROM sc_layout WHERE type = ?", e.type);
    tx.run("DELETE FROM sc_gap_rules WHERE type = ?", e.type);
    tx.run("DELETE FROM sc_view_links WHERE view_id IN (SELECT view_id FROM sc_views WHERE type = ?)", e.type);
    tx.run("DELETE FROM sc_views WHERE type = ?", e.type);
    return;
  }
  if (e.k === "retype") return;
  const to = e.k === "rename" ? e.to : null;
  const field = e.k === "rename" ? e.from : e.field;
  const lay = tx.get<{ sections: string }>("SELECT sections FROM sc_layout WHERE type = ?", e.type);
  if (lay) {
    const sections = (JSON.parse(lay.sections) as LayoutSection[]).map((s) => ({ ...s, fields: s.fields.flatMap((f) => (f !== field ? [f] : to ? [to] : [])) }));
    tx.run("UPDATE sc_layout SET sections = ? WHERE type = ?", JSON.stringify(sections), e.type);
  }
  for (const r of tx.all<{ rule_id: string; rule: string }>("SELECT rule_id, rule FROM sc_gap_rules WHERE type = ?", e.type)) {
    const rule = JSON.parse(r.rule) as GapRule;
    if (rule.field !== field) continue;
    if (to) tx.run("UPDATE sc_gap_rules SET rule = ? WHERE type = ? AND rule_id = ?", JSON.stringify({ ...rule, field: to }), e.type, r.rule_id);
    else tx.run("DELETE FROM sc_gap_rules WHERE type = ? AND rule_id = ?", e.type, r.rule_id);
  }
  for (const r of tx.all<{ view_id: string; spec: string }>("SELECT view_id, spec FROM sc_views WHERE type = ?", e.type)) {
    const spec = JSON.parse(r.spec) as Partial<ViewRow>;
    let hit = false;
    if (spec.hidden?.includes(field)) { spec.hidden = spec.hidden.flatMap((f) => (f !== field ? [f] : to ? [to] : [])); hit = true; }
    if (spec.group === field) { if (to) spec.group = to; else delete spec.group; hit = true; }
    if (spec.config) for (const [k, v] of Object.entries(spec.config)) if (v === field) { if (to) spec.config[k] = to; else delete spec.config[k]; hit = true; }
    if (hit) tx.run("UPDATE sc_views SET spec = ? WHERE view_id = ?", JSON.stringify(spec), r.view_id);
  }
}

interface ApplyOpts { reason?: string; confirm?: string[]; previewToken?: string; skipConfirm?: boolean; extraEvents?: boolean }

async function execute(deps: SchemaDeps, ctx: SchemaCtx, ops: SchemaOp[], o: ApplyOpts): Promise<{ changeId: string; applied: number; items: DiffItem[] }> {
  const plan = await planOps(deps, ops);
  const dup = plan.problems.find((p) => p.dup);
  if (dup) refuse(ctx, "validation.duplicate", dup.message, { problems: plan.problems.map(({ itemKey, message }) => ({ itemKey, message })) });
  if (plan.problems.length) refuse(ctx, "validation.precondition_failed", plan.problems[0]!.message, { problems: plan.problems.map(({ itemKey, message }) => ({ itemKey, message })) });
  if (o.previewToken !== undefined && o.previewToken !== tokenOf(plan, ops)) {
    refuse(ctx, "validation.precondition_failed", "The schema changed since this preview was made: preview the changes again.", { reason: "stale_preview" });
  }
  const destructive = plan.items.filter((i) => i.destructive);
  if (!o.skipConfirm) {
    const missing = destructive.filter((i) => !(o.confirm ?? []).includes(i.itemKey)).map((i) => i.itemKey);
    if (missing.length) refuse(ctx, "validation.precondition_failed", `Confirm the destructive changes first: ${missing.join(", ")}`, { unconfirmed: missing });
  }
  for (const e of plan.effects) {
    const t = e.type;
    if ((e.k === "dropType" || e.k === "drop") && heldRows(deps, t) > 0) refuse(ctx, "permission.on_hold", `${t} has records on hold, so nothing can be dropped from it.`);
  }

  const now = nowOf(deps);
  const changeId = mintShort("sch", now);
  const { store, tx } = deps;
  const touchedLive = [...plan.touched].filter((k) => !plan.created.has(k) && !plan.dropped.has(k));
  const moved = touchedLive.filter((k) => plan.effects.some((e) => e.type === k && e.k !== "dropType"));

  // 1. bridge types, 2. move the data
  const prior = new Map((await store.types()).map((t) => [t.name, t]));
  if (moved.length) await store.define({ change_types: moved.map((k) => bridgeOf(deps, plan, k, prior)) });
  const trash: { type: string; field: string | null; rows: number; payload: unknown }[] = [];
  for (const k of moved) {
    const effs = plan.effects.filter((e) => e.type === k);
    const kept = new Map<number, Record<string, unknown>>();
    effs.forEach((_e, i) => kept.set(i, {}));
    await eachRow(deps, k, async (r) => {
      const patch: Record<string, unknown> = {};
      effs.forEach((e, i) => {
        if (e.k === "drop" || e.k === "retype") {
          const v = r.data[e.field];
          if (v === undefined || v === null) return;
          kept.get(i)![r.id] = v;
          if (e.k === "drop") patch[e.field] = null;
          else { const c = convertValue(e.from, e.to, v); patch[e.field] = c.ok ? c.value : null; }
        } else if (e.k === "rename") {
          const v = r.data[e.from];
          if (v === undefined || v === null) return;
          patch[e.to] = v;
          patch[e.from] = null;
        }
      });
      if (Object.keys(patch).length) await store.update(k, r.id, patch, r.version);
    });
    effs.forEach((e, i) => {
      if (e.k === "drop" || e.k === "retype") {
        const values = kept.get(i)!;
        trash.push({ type: k, field: e.field, rows: Object.keys(values).length, payload: { kind: e.k === "drop" ? "drop" : "retype", def: e.k === "drop" ? e.def : e.from, values } });
      }
    });
  }
  for (const e of plan.effects) {
    if (e.k !== "dropType") continue;
    const rows: { id: string; data: unknown }[] = [];
    await eachRow(deps, e.type, async (r) => { rows.push({ id: r.id, data: r.data }); await store.remove(e.type, r.id, r.version); });
    trash.push({ type: e.type, field: null, rows: rows.length, payload: { kind: "type", def: e.def, rows } });
  }
  for (const t of trash) {
    tx.run("INSERT INTO sc_trash (change_id, type, field, dropped_at, expires_at, rows, payload) VALUES (?, ?, ?, ?, ?, ?, ?)",
      changeId, t.type, t.field, now, now + TRASH_DAYS * DAY, t.rows, JSON.stringify(t.payload));
  }

  // 3. final types, definitions, dependents
  const final = (k: string): TypeDef => toStoreType(deps.registry, plan.next.get(k)!, prior.get(k));
  await store.define({
    ...(plan.created.size ? { add_types: [...plan.created].map(final) } : {}),
    ...(touchedLive.length ? { change_types: touchedLive.map(final) } : {}),
    ...(plan.dropped.size ? { remove_types: [...plan.dropped] } : {}),
  });
  for (const k of plan.touched) {
    const t = plan.next.get(k);
    if (!t) continue;
    const version = (plan.before.get(k)?.version ?? 0) + 1;
    saveDef(deps, { ...t, version }, version);
  }
  for (const k of plan.dropped) tx.run("DELETE FROM sc_types WHERE type = ?", k);
  for (const e of plan.effects) repairDependents(deps, e);

  const summary = plan.items.map((i) => i.summary).join("; ").slice(0, 500);
  const types = [...plan.touched];
  tx.run("INSERT INTO sc_changes (change_id, at, by, summary, destructive, types, ops, reason) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    changeId, now, ctx.actor ?? "system", summary, destructive.length ? 1 : 0, JSON.stringify(types), JSON.stringify(ops), o.reason ?? null);

  // 4. events
  ctx.emit("schema.changed", `record_type/${ops[0]!.type}`, {
    changeId, type: ops[0]!.type, types, ops: ops.map((op) => ({ op: op.op, type: op.type, ...(op.field !== undefined ? { field: op.field } : {}) })), destructive: destructive.length > 0,
  });
  for (const k of plan.dropped) ctx.emit("schema.type_dropped", `record_type/${k}`, { type: k, changeId });
  for (const l of plan.labelChanges) ctx.emit("schema.label_changed", `record_type/${l.type}`, { type: l.type, ...(l.field !== undefined ? { field: l.field } : {}), from: l.from, to: l.to });
  return { changeId, applied: plan.items.length, items: plan.items };
}

// ---- infer ----

export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, "");
  const head = src.split(/\r?\n/, 1)[0] ?? "";
  const delim = [",", ";", "\t"].map((d) => ({ d, n: head.split(d).length })).sort((a, b) => b.n - a.n)[0]!.d;
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    if (quoted) {
      if (c === '"') { if (src[i + 1] === '"') { cell += '"'; i++; } else quoted = false; } else cell += c;
    } else if (c === '"' && cell === "") quoted = true;
    else if (c === delim) { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.some((x) => x !== "") || row.length > 1) rows.push(row);
      row = [];
    } else cell += c;
  }
  if (cell !== "" || row.length) { row.push(cell); if (row.some((x) => x !== "")) rows.push(row); }
  return rows;
}

const slug = (s: string, fallback: string): string => {
  let k = s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  if (!k) k = fallback;
  if (!/^[a-z]/.test(k)) k = `f_${k}`;
  return k.slice(0, 60);
};

export function inferFields(rows: string[][]): { columns: { column: string; field: string; type: string; sample: string[] }[]; fields: FieldDefT[]; rowCount: number } {
  const header = rows[0] ?? [];
  const body = rows.slice(1);
  const used = new Set<string>();
  const fields: FieldDefT[] = [];
  const columns: { column: string; field: string; type: string; sample: string[] }[] = [];
  header.forEach((name, i) => {
    let key = slug(name, `column_${i + 1}`);
    for (let n = 2; used.has(key); n++) key = `${slug(name, `column_${i + 1}`).slice(0, 56)}_${n}`;
    used.add(key);
    const vals = body.map((r) => (r[i] ?? "").trim()).filter((v) => v !== "").slice(0, 2000);
    const all = (re: RegExp): boolean => vals.length > 0 && vals.every((v) => re.test(v));
    let type = "text";
    let options: Record<string, unknown> | undefined;
    const hint = name.toLowerCase();
    if (!vals.length) type = "text";
    else if (all(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)) type = "email";
    else if (all(/^https?:\/\/\S+$/i)) type = "url";
    else if (/(phone|mobile|tel|fax)/.test(hint) && all(/^\+?[\d\s().-]{7,}$/)) type = "phone";
    else if (all(/^-?\d+(\.\d+)?$/)) type = "number";
    else if (all(/^(true|false|yes|no)$/i)) type = "checkbox";
    else if (all(/^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?)?$/)) type = "datetime";
    else if (all(/^\+?[\d\s().-]{7,}$/) && vals.every((v) => v.replace(/\D/g, "").length >= 7)) type = "phone";
    else {
      const distinct = [...new Set(vals)];
      if (vals.length >= 5 && distinct.length <= 8 && distinct.length < vals.length && vals.every((v) => v.length <= 24)) {
        type = "choice";
        options = { choices: distinct.map((v) => ({ key: slug(v, "choice"), title: v })) };
        if (new Set((options["choices"] as { key: string }[]).map((c) => c.key)).size !== distinct.length) { type = "text"; options = undefined; }
      } else if (vals.some((v) => v.length > 160 || v.includes("\n"))) type = "longtext";
    }
    const f: FieldDefT = { key, type, title: name.trim() || titleCase(key), ...(options ? { options } : {}) };
    fields.push(f);
    columns.push({ column: name, field: key, type, sample: vals.slice(0, 3) });
  });
  return { columns, fields, rowCount: body.length };
}

// ---- saved views, layout, gap rules ----

interface ViewDb { view_id: string; type: string; kind: string; title: string; shared: number; owner_id: string; spec: string; updated_at: number }

const RULE_ROUTES = ["ai_field", "agent_lookup", "task", "form"];

// ---- handlers ----

export function createApplyHandlers(deps: SchemaDeps): ApplyHandlers {
  const { tx } = deps;
  const actorOf = (ctx: SchemaCtx): string => ctx.actor ?? "system";
  const ready = async (): Promise<Map<string, TypeDefT>> => { await seedManifestTypes(deps); return allDefs(deps); };
  const needType = async (ctx: SchemaCtx, type: string): Promise<TypeDefT> => (await ready()).get(type) ?? refuse(ctx, "validation.not_found", `There is no record type ${type}.`);
  const viewRow = (ctx: SchemaCtx, viewId: string): ViewDb => {
    ensureTables(tx);
    const r = tx.get<ViewDb>("SELECT * FROM sc_views WHERE view_id = ?", viewId);
    if (!r || (r.shared !== 1 && r.owner_id !== actorOf(ctx))) refuse(ctx, "validation.not_found", "There is no such view.");
    return r!;
  };
  const logChange = (ctx: SchemaCtx, now: number, summary: string, types: string[], ops: unknown): string => {
    const changeId = mintShort("sch", now);
    tx.run("INSERT INTO sc_changes (change_id, at, by, summary, destructive, types, ops, reason) VALUES (?, ?, ?, ?, 0, ?, ?, NULL)", changeId, now, actorOf(ctx), summary, JSON.stringify(types), JSON.stringify(ops));
    return changeId;
  };

  return {
    "schema.diff": async (_ctx, input) => {
      const plan = await planOps(deps, input.ops);
      const destructive = plan.items.filter((i) => i.destructive).length;
      return {
        previewToken: tokenOf(plan, input.ops), items: plan.items, additive: plan.items.length - destructive, destructive,
        problems: plan.problems.map(({ itemKey, message }) => ({ itemKey, message })),
      };
    },

    "schema.apply": (ctx, input) => execute(deps, ctx, input.ops, {
      ...(input.reason !== undefined ? { reason: input.reason } : {}), ...(input.confirm !== undefined ? { confirm: input.confirm } : {}),
      ...(input.previewToken !== undefined ? { previewToken: input.previewToken } : {}),
    }),

    "schema.set_label": async (ctx, input) => {
      if (!LABELS.includes(input.label)) refuse(ctx, "validation.bad_input", `${String(input.label)} is not a sensitivity label.`);
      const t = await needType(ctx, input.type);
      const op: SchemaOp = input.field === undefined
        ? { op: "type.update", type: t.key, def: { label: input.label } }
        : { op: "field.update", type: t.key, field: input.field, def: { label: input.label } };
      await execute(deps, ctx, [op], { skipConfirm: true });
      return { ok: true };
    },

    "schema.infer": async (ctx, input) => {
      let text = input.text;
      if (text === undefined && input.fileId !== undefined) {
        if (!deps.readFile) refuse(ctx, "validation.unsupported", "Reading a file needs the files module: paste the CSV text instead.");
        text = await deps.readFile!(input.fileId, input.sheet);
      }
      if (text === undefined || !text.trim()) refuse(ctx, "validation.bad_input", "Give the CSV as text or a file.");
      const rows = parseCsv(text!);
      if (rows.length < 1 || rows[0]!.length < 1) refuse(ctx, "validation.bad_input", "The first row must name the columns.");
      const { columns, fields, rowCount } = inferFields(rows);
      const key = slug(input.name ?? "imported", "imported");
      const titleField = fields.find((f) => f.type === "text" && /(^|_)(name|title)($|_)/.test(f.key)) ?? fields.find((f) => f.type === "text") ?? fields[0]!;
      if (titleField.type !== "text") { titleField.type = "text"; delete titleField.options; const c = columns.find((x) => x.field === titleField.key); if (c) c.type = "text"; }
      const title = titleCase(key);
      return {
        ops: [{ op: "type.create", type: key, def: { title, plural: `${title}s`, icon: "table", label: "internal", titleField: titleField.key, fields } }],
        columns, rowCount,
      };
    },

    "schema.restore_field": async (ctx, input) => {
      ensureTables(tx);
      const now = nowOf(deps);
      const row = tx.get<{ id: number; payload: string }>(
        "SELECT id, payload FROM sc_trash WHERE type = ? AND field = ? AND restored_at IS NULL AND expires_at > ? ORDER BY id DESC LIMIT 1", input.type, input.field, now,
      );
      if (!row) refuse(ctx, "validation.not_found", `Nothing named ${input.type}.${input.field} is in Trash.`);
      const payload = JSON.parse(row!.payload) as { kind: "drop" | "retype"; def: FieldDefT; values: Record<string, unknown> };
      const defs = await ready();
      const t = defs.get(input.type) ?? refuse(ctx, "validation.not_found", `There is no record type ${input.type}.`);
      const have = t.fields.find((f) => f.key === input.field);
      if (have && payload.kind === "drop") refuse(ctx, "validation.duplicate", `${input.type} already has a field ${input.field}.`);
      if (!have && payload.kind === "retype") refuse(ctx, "validation.precondition_failed", `${input.field} no longer exists, so its old type cannot come back.`);
      const next = clone(t);
      if (have) next.fields = next.fields.map((f) => (f.key === input.field ? payload.def : f));
      else next.fields.push(payload.def);
      let err: string | null = null;
      try { const st = cloneDefs(defs); st.set(next.key, next); checkField(deps, st, next, payload.def); } catch (e) { if (e instanceof Problem) err = e.message; else throw e; }
      if (err) refuse(ctx, "validation.precondition_failed", err);
      const priorType = (await deps.store.types()).find((x) => x.name === t.key);
      await deps.store.define({ change_types: [toStoreType(deps.registry, next, priorType)] });
      for (const [id, value] of Object.entries(payload.values)) {
        const r = await deps.store.get(input.type, id);
        if (!r) continue;
        try { await deps.store.update(input.type, id, { [input.field]: value }, r.version); } catch { /* a value the type no longer accepts stays in Trash only */ }
      }
      const version = t.version + 1;
      saveDef(deps, { ...next, version }, version);
      tx.run("UPDATE sc_trash SET restored_at = ? WHERE id = ?", now, row!.id);
      const changeId = logChange(ctx, now, `Restore field ${input.field} of ${t.title} from Trash`, [t.key], [{ op: "field.restore", type: t.key, field: input.field }]);
      ctx.emit("schema.field_restored", `record_type/${t.key}`, { type: t.key, field: input.field });
      ctx.emit("schema.changed", `record_type/${t.key}`, { changeId, type: t.key, types: [t.key], ops: [{ op: "field.restore", type: t.key, field: input.field }], destructive: false });
      return { ok: true };
    },

    "views.save": async (ctx, input) => {
      ensureTables(tx);
      const t = await needType(ctx, input.type);
      const kind = deps.registry.viewKinds.find((k) => k.key === input.kind);
      if (!kind) refuse(ctx, "validation.bad_input", `${input.kind} is not a view kind.`);
      if (!input.title.trim()) refuse(ctx, "validation.bad_input", "A view needs a title.");
      const keys = new Set(t.fields.map((f) => f.key));
      const config = input.config ?? {};
      const asks = new Map<string, string[]>();
      for (const n of kind!.needs ?? []) asks.set(n.as, [...(asks.get(n.as) ?? []), n.fieldType]);
      for (const [as, types] of asks) {
        const named = config[as];
        const f = typeof named === "string" ? t.fields.find((x) => x.key === named) : undefined;
        if (!f || !types.includes(f.type)) refuse(ctx, "validation.bad_input", `A ${kind!.title} view needs config.${as} to name a ${types.join(" or ")} field of ${t.key}.`);
      }
      for (const f of input.hidden ?? []) if (!keys.has(f)) refuse(ctx, "validation.bad_input", `${t.key} has no field ${f}.`);
      if (input.group !== undefined && !keys.has(input.group)) refuse(ctx, "validation.bad_input", `${t.key} has no field ${input.group}.`);
      if (Array.isArray(input.sort)) for (const s of input.sort as { field?: unknown }[]) if (typeof s?.field !== "string" || !keys.has(s.field)) refuse(ctx, "validation.bad_input", `A sort names a field ${String(s?.field)} that ${t.key} does not have.`);
      const now = nowOf(deps);
      const spec = JSON.stringify({
        ...(input.filter !== undefined ? { filter: input.filter } : {}), ...(input.sort !== undefined ? { sort: input.sort } : {}), ...(input.group !== undefined ? { group: input.group } : {}),
        ...(input.hidden !== undefined ? { hidden: input.hidden } : {}), ...(input.colorRules !== undefined ? { colorRules: input.colorRules } : {}), ...(input.config !== undefined ? { config: input.config } : {}),
      });
      let id = input.viewId;
      let shared = 0;
      if (id !== undefined) {
        const have = tx.get<ViewDb>("SELECT * FROM sc_views WHERE view_id = ?", id);
        if (!have || (have.shared !== 1 && have.owner_id !== actorOf(ctx))) refuse(ctx, "validation.not_found", "There is no such view.");
        if (have!.owner_id !== actorOf(ctx)) refuse(ctx, "permission.no_grant", "Only the owner of a view can change it.");
        if (have!.type !== t.key) refuse(ctx, "validation.bad_input", "A view cannot move to another record type.");
        shared = have!.shared;
        tx.run("UPDATE sc_views SET kind = ?, title = ?, spec = ?, updated_at = ? WHERE view_id = ?", input.kind, input.title, spec, now, id);
      } else {
        id = mintShort("viw", now);
        tx.run("INSERT INTO sc_views (view_id, type, kind, title, shared, owner_id, spec, updated_at) VALUES (?, ?, ?, ?, 0, ?, ?, ?)", id, t.key, input.kind, input.title, actorOf(ctx), spec, now);
      }
      ctx.emit("view.saved", `record_type/${t.key}`, { viewId: id, type: t.key, shared: shared === 1 });
      return { view: viewRowOf(tx.get<ViewDb>("SELECT * FROM sc_views WHERE view_id = ?", id)!) };
    },

    "views.publish": async (ctx, input) => {
      const v = viewRow(ctx, input.viewId);
      const now = nowOf(deps);
      tx.run("UPDATE sc_views SET shared = ?, updated_at = ? WHERE view_id = ?", input.shared ? 1 : 0, now, v.view_id);
      ctx.emit("view.published", `record_type/${v.type}`, { viewId: v.view_id, type: v.type, shared: input.shared });
      return { view: viewRowOf(tx.get<ViewDb>("SELECT * FROM sc_views WHERE view_id = ?", v.view_id)!) };
    },

    "views.delete": async (ctx, input) => {
      const v = viewRow(ctx, input.viewId);
      if (v.owner_id !== actorOf(ctx)) refuse(ctx, "permission.no_grant", "Only the owner of a view can delete it.");
      tx.run("DELETE FROM sc_view_links WHERE view_id = ?", v.view_id);
      tx.run("DELETE FROM sc_views WHERE view_id = ?", v.view_id);
      ctx.emit("view.deleted", `record_type/${v.type}`, { viewId: v.view_id, type: v.type });
      return { deleted: true };
    },

    "views.share_external": async (ctx, input) => {
      const v = viewRow(ctx, input.viewId);
      const now = nowOf(deps);
      if (input.expiresAt !== undefined && input.expiresAt <= now) refuse(ctx, "validation.bad_input", "The link would already have expired.");
      const bytes = globalThis.crypto.getRandomValues(new Uint8Array(24));
      const token = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
      tx.run("INSERT INTO sc_view_links (token, view_id, created_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?)", token, v.view_id, actorOf(ctx), now, input.expiresAt ?? null);
      return { url: `${deps.publicBase ?? ""}/views/${token}`, ...(input.expiresAt !== undefined ? { expiresAt: input.expiresAt } : {}) };
    },

    "schema.layout.set": async (ctx, input) => {
      ensureTables(tx);
      const t = await needType(ctx, input.type);
      const keys = new Set(t.fields.map((f) => f.key));
      const sectionKeys = new Set<string>();
      const placed = new Set<string>();
      for (const s of input.sections) {
        if (!s.key || sectionKeys.has(s.key)) refuse(ctx, "validation.bad_input", `Section keys must be present and distinct (${s.key || "empty"}).`);
        sectionKeys.add(s.key);
        for (const f of s.fields) {
          if (!keys.has(f)) refuse(ctx, "validation.bad_input", `${t.key} has no field ${f}.`);
          if (placed.has(f)) refuse(ctx, "validation.bad_input", `${f} is in two sections.`);
          placed.add(f);
        }
      }
      const now = nowOf(deps);
      tx.run("INSERT INTO sc_layout (type, sections, updated_at) VALUES (?, ?, ?) ON CONFLICT(type) DO UPDATE SET sections = excluded.sections, updated_at = excluded.updated_at", t.key, JSON.stringify(input.sections), now);
      const changeId = logChange(ctx, now, `Set the record page layout of ${t.title}`, [t.key], [{ op: "layout.set", type: t.key }]);
      ctx.emit("schema.changed", `record_type/${t.key}`, { changeId, type: t.key, types: [t.key], ops: [{ op: "layout.set", type: t.key }], destructive: false });
      return { sections: input.sections };
    },

    "schema.gap_rules.set": async (ctx, input) => {
      ensureTables(tx);
      const t = await needType(ctx, input.type);
      const r = input.rule;
      if (!r.ruleId) refuse(ctx, "validation.bad_input", "A rule needs a ruleId.");
      if (!t.fields.some((f) => f.key === r.field)) refuse(ctx, "validation.bad_input", `${t.key} has no field ${r.field}.`);
      if (!RULE_ROUTES.includes(r.route)) refuse(ctx, "validation.bad_input", `${String(r.route)} is not a route.`);
      if (r.when === "stale" && !(r.staleAfterDays && r.staleAfterDays >= 1)) refuse(ctx, "validation.bad_input", "A stale rule needs staleAfterDays.");
      if (r.route === "agent_lookup" && !r.agentId) refuse(ctx, "validation.bad_input", "An agent lookup needs the agent.");
      if (r.route === "ai_field" && t.fields.find((f) => f.key === r.field)?.type !== "ai") refuse(ctx, "validation.bad_input", `${r.field} is not an AI field.`);
      const now = nowOf(deps);
      tx.run("INSERT INTO sc_gap_rules (type, rule_id, rule) VALUES (?, ?, ?) ON CONFLICT(type, rule_id) DO UPDATE SET rule = excluded.rule", t.key, r.ruleId, JSON.stringify(r));
      const changeId = logChange(ctx, now, `Set gap rule ${r.ruleId} of ${t.title}`, [t.key], [{ op: "gap_rule.set", type: t.key, field: r.field }]);
      ctx.emit("schema.changed", `record_type/${t.key}`, { changeId, type: t.key, types: [t.key], ops: [{ op: "gap_rule.set", type: t.key, field: r.field }], destructive: false });
      return { rule: r };
    },
  };
}

export { execute as applyOps };
