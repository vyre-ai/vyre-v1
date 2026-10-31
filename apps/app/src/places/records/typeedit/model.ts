// Editing record types and fields in place (Records): the pure part. A person types a name; the key is made from it. Every change is one or more schema ops, previewed with schema.diff and
// then applied with schema.apply on exactly that preview, the same two steps the Console's schema builder takes. No React here; the hook and the sheets are in the files beside this one.
import type { CapMap } from "../../../../../../generated/types.ts";
import type { MenuEntry } from "../../../../../../ui/src/Menu/index.tsx";

export type SchemaOp = CapMap["schema.diff"]["in"]["ops"][number];
export type DiffOut = CapMap["schema.diff"]["out"];
export type FieldTypeInfo = CapMap["schema.field_types"]["out"]["fieldTypes"][number];
export type TypeDetail = CapMap["schema.types.get"]["out"]["type"];
export type FieldDef = TypeDetail["fields"][number];
export type Call = (cap: string, input: unknown) => Promise<unknown>;

/** The permission the Console asks for schema changes (console/shell/nav.ts: the Schema page). */
export const SCHEMA_PERM = "schema.manage";
/** The Console page key that holds it, as console.nav lists it. */
export const SCHEMA_PAGE = "console.schema";
export const TRASH_DAYS = 30;

// ---------------------------------------------------------------- names

/** A type or field key from a name: lowercase letters, digits and single underscores, starting with a letter. */
export function slugOf(name: string, prefix = "t"): string {
  const base = name.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  const key = /^[a-z]/.test(base) ? base : base === "" ? "" : `${prefix}_${base}`;
  return key.slice(0, 40).replace(/_+$/, "");
}

/** The key not yet taken: the slug, then slug_2, slug_3. */
export function freeKey(slug: string, taken: readonly string[]): string {
  if (slug === "") return "";
  if (!taken.includes(slug)) return slug;
  for (let n = 2; ; n++) if (!taken.includes(`${slug}_${n}`)) return `${slug}_${n}`;
}

/** The plural of a singular name, in the plain cases; the person can edit it. */
export function pluralOf(name: string): string {
  const w = name.trim();
  if (w === "") return "";
  const lower = w.toLowerCase();
  if (/(s|x|z|ch|sh)$/.test(lower)) return `${w}es`;
  if (/[^aeiou]y$/.test(lower)) return `${w.slice(0, -1)}ies`;
  return `${w}s`;
}

export const TYPE_ICONS: readonly string[] = ["table", "people", "building", "folder", "project", "calendar", "globe", "invoice", "task", "message"];

// ---------------------------------------------------------------- ops

export function createTypeOps(o: { name: string; plural: string; icon: string; takenKeys: readonly string[] }): { key: string; ops: SchemaOp[] } {
  const name = o.name.trim();
  const key = freeKey(slugOf(name), o.takenKeys);
  return { key, ops: [{ op: "type.create", type: key, def: { title: name, plural: o.plural.trim() || pluralOf(name), icon: o.icon, label: "internal", titleField: "name", fields: [{ key: "name", type: "text", title: "Name", required: true }] } }] };
}

export function renameTypeOps(type: string, name: string, plural: string): SchemaOp[] {
  return [{ op: "type.update", type, def: { title: name.trim(), plural: plural.trim() || pluralOf(name) } }];
}

export const dropTypeOps = (type: string): SchemaOp[] => [{ op: "type.drop", type }];

/** Options a new field of these types needs before the backend accepts it. */
function startOptions(type: string): Record<string, unknown> | undefined {
  if (type === "choice" || type === "multichoice") return { choices: [{ key: "option_1", title: "Option 1" }, { key: "option_2", title: "Option 2" }] };
  if (type === "status") return { stages: [{ key: "todo", title: "To do" }, { key: "doing", title: "Doing" }, { key: "done", title: "Done" }] };
  return undefined;
}

export function addFieldOps(o: { type: string; name: string; fieldType: string; required: boolean; takenKeys: readonly string[] }): { key: string; ops: SchemaOp[] } {
  const title = o.name.trim();
  const key = freeKey(slugOf(title, "f"), o.takenKeys);
  const options = startOptions(o.fieldType);
  return { key, ops: [{ op: "field.add", type: o.type, field: key, def: { title, type: o.fieldType, required: o.required, ...(options ? { options } : {}) } }] };
}

/** Rename shows a new name; the key stays, so nothing that reads the field breaks. */
export const renameFieldOps = (type: string, field: string, name: string): SchemaOp[] => [{ op: "field.update", type, field, def: { title: name.trim() } }];
export const retypeFieldOps = (type: string, field: string, toType: string): SchemaOp[] => [{ op: "field.retype", type, field, toType }];
export const dropFieldOps = (type: string, field: string): SchemaOp[] => [{ op: "field.drop", type, field }];
export const requiredOps = (type: string, field: string, required: boolean): SchemaOp[] => [{ op: "field.update", type, field, def: { required } }];

export function moveFieldOps(type: string, order: readonly string[], field: string, by: -1 | 1): SchemaOp[] | null {
  const at = order.indexOf(field), to = at + by;
  if (at < 0 || to < 0 || to >= order.length) return null;
  const next = [...order];
  next.splice(at, 1);
  next.splice(to, 0, field);
  return [{ op: "field.reorder", type, order: next }];
}

// ---------------------------------------------------------------- rules the backend keeps (modules/schema/handlers/apply.ts), said before a press

const NO_RETYPE_FROM = new Set(["relation", "sealed", "files", "signature", "button", "lookup", "rollup", "formula", "autonumber", "created_time", "created_by", "modified_time", "modified_by"]);
const NO_RETYPE_TO = new Set([...NO_RETYPE_FROM, "ai"]);
/** Types a person can start a new field with (the others need setup the Console keeps). */
export const ADDABLE = ["text", "longtext", "number", "money", "datetime", "duration", "checkbox", "rating", "person", "email", "phone", "url", "address", "choice", "multichoice", "status", "files"] as const;

export function addableTypes(all: readonly FieldTypeInfo[]): FieldTypeInfo[] {
  return ADDABLE.flatMap((k) => all.find((t) => t.key === k) ?? []);
}

/** Why this field cannot change type at all, or null. */
export function retypeBlocked(type: Pick<TypeDetail, "system">, field: Pick<FieldDef, "type">, titleField: string, key: string): string | null {
  if (type.system) return "Built in fields keep their type";
  if (key === titleField) return "The title field keeps its type";
  if (NO_RETYPE_FROM.has(field.type)) return "This kind of field cannot change type";
  return null;
}

/** Why this type is not a choice for the field, or null. */
export function retypeTarget(from: string, to: string): string | null {
  if (from === to) return "Already this type";
  if (NO_RETYPE_TO.has(to)) return "Fields cannot change to this type";
  return null;
}

export function fieldDeleteBlocked(type: Pick<TypeDetail, "system" | "titleField" | "summaryField" | "statusField" | "ownerField">, field: Pick<FieldDef, "key" | "type">): string | null {
  if (type.system) return "Built in fields cannot be deleted";
  if (field.type === "relation") return "Links are removed in the Console";
  if ([type.titleField, type.summaryField, type.statusField, type.ownerField].includes(field.key)) return "This field names the record, so it stays";
  return null;
}

export function typeDeleteBlocked(t: { system: boolean; syncedFrom?: string | undefined }): string | null {
  if (t.system) return "Built in record types cannot be deleted";
  if (t.syncedFrom) return "Synced record types are deleted by removing the sync";
  return null;
}

// ---------------------------------------------------------------- preview then apply

let counter = 0;
const attempt = (): string => `rec-schema-${Date.now().toString(36)}-${(counter++).toString(36)}`;

/** The exact apply for a preview: the same token, the same ops, every destructive item confirmed. */
export function applyInput(preview: DiffOut, ops: readonly SchemaOp[]): CapMap["schema.apply"]["in"] {
  return { ops: [...ops], previewToken: preview.previewToken, confirm: preview.items.filter((i) => i.destructive).map((i) => i.itemKey), reason: "Records", idempotencyKey: attempt() };
}

export interface Staged {
  ops: SchemaOp[];
  preview: DiffOut;
  destructive: boolean;
  /** Values or records the change touches (the largest figure among its items, from schema.diff). */
  rows: number;
}

const msg = (e: unknown): string => (e instanceof Error && e.message ? e.message : "The change did not go through");

/** Step one: ask what the change would do. Refused when the backend lists problems. */
export async function stageChange(call: Call, ops: readonly SchemaOp[]): Promise<{ ok: true; staged: Staged } | { ok: false; error: string }> {
  try {
    const preview = await call("schema.diff", { ops: [...ops] }) as DiffOut;
    if (preview.problems.length > 0) return { ok: false, error: preview.problems[0]!.message };
    return { ok: true, staged: { ops: [...ops], preview, destructive: preview.destructive > 0, rows: preview.items.reduce((n, i) => Math.max(n, i.affectedRows), 0) } };
  } catch (e) { return { ok: false, error: msg(e) }; }
}

/** Step two: apply exactly the previewed change. */
export async function commitChange(call: Call, staged: Staged): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await call("schema.apply", applyInput(staged.preview, staged.ops));
    return { ok: true };
  } catch (e) { return { ok: false, error: msg(e) }; }
}

export const valuesWord = (n: number): string => `${n} ${n === 1 ? "value" : "values"}`;

/** The one confirm line before a destructive change, with the count schema.diff gave. */
export function confirmLine(kind: "field.drop" | "field.retype" | "type.drop", name: string, rows: number): string {
  if (kind === "type.drop") return `Delete ${name}? ${rows} ${rows === 1 ? "record goes" : "records go"} to Trash for ${TRASH_DAYS} days.`;
  if (kind === "field.drop") return `Delete ${name}? ${valuesWord(rows)} go to Trash for ${TRASH_DAYS} days, and you can restore the field until then.`;
  return `Change the type of ${name}? ${valuesWord(rows)} will be converted, and any that cannot be are cleared.`;
}

// ---------------------------------------------------------------- menus

/** The "..." menu of a row in Record types. A type that cannot be deleted shows the item off, with the reason on hover. */
export function typeRowMenu(t: { system: boolean; syncedFrom?: string | undefined }, on: { rename(): void; remove(): void }): MenuEntry[] {
  const why = typeDeleteBlocked(t);
  return [
    { label: "Rename", onSelect: on.rename },
    { label: "Delete record type", danger: true, ...(why ? { disabled: true, reason: why } : { onSelect: on.remove }) },
  ];
}

/** What a column header's menu adds for editing a field. Nothing without the permission. */
export function fieldMenuEntries(canEdit: boolean, type: Pick<TypeDetail, "system" | "titleField" | "summaryField" | "statusField" | "ownerField">, f: Pick<FieldDef, "key" | "type">, open: (mode: "rename" | "type" | "delete") => void): MenuEntry[] {
  if (!canEdit) return [];
  const del = fieldDeleteBlocked(type, f);
  const ret = retypeBlocked(type, f, type.titleField, f.key);
  return [
    { separator: true },
    { label: "Rename field", onSelect: () => open("rename") },
    { label: "Change type", ...(ret ? { disabled: true, reason: ret } : { onSelect: () => open("type") }) },
    { label: "Delete field", danger: true, ...(del ? { disabled: true, reason: del } : { onSelect: () => open("delete") }) },
  ];
}
