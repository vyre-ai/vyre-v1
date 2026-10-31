// Editing record types and fields in place (Records): the pure part. A person types a name; the key is made from it. Every change is one or more schema ops, previewed with schema.diff and
// then applied with schema.apply on exactly that preview, the same two steps the Console's schema builder takes. No React here; the hook and the sheets are in the files beside this one.
import type { CapMap } from "../../../../../../generated/types.ts";
import { worthShowing } from "../sidebar/model.ts";
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

/** What a person reads when a record call is refused: the server's words for an unknown type are for logs, so they become what to do. Anything else passes through. */
export function plainError(message: string | undefined, what = "record"): string {
  const m = (message ?? "").trim();
  if (m === "") return `Could not create the ${what}. Try again.`;
  if (/^no type\b|unknown_type|unknown type/i.test(m)) return "This record type is not ready on this device yet. Close and reopen Records, then try again.";
  if (/^no (field|site table)\b/i.test(m)) return "This record type changed. Close and reopen Records, then try again.";
  return m;
}

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

const IRREGULAR: ReadonlyArray<readonly [string, string]> = [["person", "people"], ["man", "men"], ["woman", "women"], ["child", "children"], ["foot", "feet"], ["tooth", "teeth"], ["mouse", "mice"], ["life", "lives"], ["knife", "knives"], ["wife", "wives"], ["leaf", "leaves"], ["half", "halves"], ["shelf", "shelves"], ["datum", "data"]];
/** Words that read the same in both numbers. */
const SAME = new Set(["staff", "equipment", "information", "series", "species", "news", "sheep", "fish", "data", "feedback", "software", "hardware", "research", "inventory"]);
/** Singular words that end in s: they are not plurals. */
const SINGULAR_S = new Set(["status", "bus", "gas", "business", "address", "class", "process", "access", "campus", "bonus", "virus", "census", "canvas", "atlas", "alias", "analysis", "basis", "crisis", "thesis", "diagnosis", "lens", "chaos", "focus"]);

/** Words whose singular ends in ie, so their plural is not -ies from -y. */
const IE_WORDS = new Set(["movie", "cookie", "pie", "tie", "zombie", "rookie", "prairie", "calorie", "genie", "selfie", "hoodie", "goalie", "birdie", "brownie", "smoothie", "newbie"]);
const lastWord = (w: string): { head: string; word: string } => { const i = w.search(/\S+$/); return { head: w.slice(0, i), word: w.slice(i) }; };
/** Keep the capitals of the typed word on the word made from it ("Person" gives "People", "COMPANY" gives "COMPANIES"). */
const withCase = (typed: string, made: string): string => (typed === typed.toUpperCase() && typed.length > 1 ? made.toUpperCase() : /^[A-Z]/.test(typed) ? made.charAt(0).toUpperCase() + made.slice(1) : made);

/** Is this name already a plural (Deals, Companies, People)? Judged by its last word. */
export function isPlural(name: string): boolean {
  const w = lastWord(name.trim()).word.toLowerCase();
  if (w === "") return false;
  if (SAME.has(w) || SINGULAR_S.has(w)) return false;
  if (IRREGULAR.some(([, p]) => p === w)) return true;
  if (/(ss|us|is)$/.test(w) || !w.endsWith("s")) return false;
  return true;
}

/** The plural of a name: a name that is already plural stays as it is, then the common English rules. The person can edit it. */
export function pluralOf(name: string): string {
  const full = name.trim();
  if (full === "") return "";
  if (isPlural(full)) return full;
  const { head, word } = lastWord(full);
  const lower = word.toLowerCase();
  if (SAME.has(lower)) return full;
  const irregular = IRREGULAR.find(([s]) => s === lower);
  if (irregular) return head + withCase(word, irregular[1]);
  if (/(s|x|z|ch|sh)$/.test(lower)) return `${full}es`;
  if (/[^aeiou]y$/.test(lower)) return `${head}${word.slice(0, -1)}ies`;
  return `${full}s`;
}

/** The singular of a plural name: Deals gives Deal, Companies gives Company, People gives Person, Statuses gives Status. A name that is not plural comes back as it is. */
export function singularOf(name: string): string {
  const full = name.trim();
  if (full === "" || !isPlural(full)) return full;
  const { head, word } = lastWord(full);
  const lower = word.toLowerCase();
  const irregular = IRREGULAR.find(([, p]) => p === lower);
  if (irregular) return head + withCase(word, irregular[0]);
  let one = word;
  if (IE_WORDS.has(lower.slice(0, -1))) one = word.slice(0, -1);
  else if (/[^aeiou]ies$/.test(lower)) one = `${word.slice(0, -3)}y`;
  else if (/(ss|x|z|ch|sh)es$/.test(lower)) one = word.slice(0, -2);
  else if (/uses$/.test(lower) && lower !== "uses" && !/(cause|house|mouse|clause|pause|excuse|abuse|refuse|fuse|muse)s$/.test(lower)) one = word.slice(0, -2);
  else if (/s$/.test(lower)) one = word.slice(0, -1);
  return head + one;
}

/** What a name makes: the singular title and the plural, whichever of the two the person typed. */
export function namesOf(name: string, pluralTyped?: string): { title: string; plural: string } {
  const typed = name.trim();
  const title = singularOf(typed);
  const plural = (pluralTyped ?? "").trim() || (isPlural(typed) ? typed : pluralOf(typed));
  return { title, plural };
}

export const TYPE_ICONS: readonly string[] = ["table", "people", "building", "folder", "project", "calendar", "globe", "invoice", "task", "message"];

// ---------------------------------------------------------------- ops

/** The one-tap fields of the New record type sheet: a key, the name it gets, the field type it makes. */
export const STARTER_FIELDS: readonly { key: string; title: string; type: string }[] = [
  { key: "email", title: "Email", type: "email" },
  { key: "phone", title: "Phone", type: "phone" },
  { key: "date", title: "Date", type: "datetime" },
  { key: "due_date", title: "Due date", type: "datetime" },
  { key: "close_date", title: "Close date", type: "datetime" },
  { key: "amount", title: "Amount", type: "money" },
  { key: "number", title: "Number", type: "number" },
  { key: "stage", title: "Stage", type: "status" },
  { key: "status", title: "Status", type: "status" },
  { key: "choice", title: "Choice", type: "choice" },
  { key: "multichoice", title: "Multi choice", type: "multichoice" },
  { key: "checkbox", title: "Checkbox", type: "checkbox" },
  { key: "owner", title: "Owner", type: "person" },
  { key: "files", title: "Files", type: "files" },
  { key: "url", title: "URL", type: "url" },
  { key: "notes", title: "Notes", type: "longtext" },
  { key: "rating", title: "Rating", type: "rating" },
];

/** The chips shown at once; the rest are one More away, found by typing. */
export const STARTER_SHOWN: readonly string[] = ["email", "phone", "date", "amount", "stage", "owner", "notes"];

/** What a record type is for, read from its name, so the fields it usually needs are picked before the person asks: Deals get Amount, Stage, Owner, Close date and a link to Contacts. */
const PURPOSES: ReadonlyArray<{ match: RegExp; starters: readonly string[]; connect?: readonly string[] }> = [
  { match: /\b(deal|opportunit|sale|pipeline|prospect)/i, starters: ["amount", "stage", "owner", "close_date"], connect: ["contact"] },
  { match: /\b(compan|organi[sz]ation|firm|business|account|vendor|supplier)/i, starters: ["email", "phone", "url", "owner"] },
  { match: /\b(person|people|contact|lead|client|customer|candidate|member|patient)/i, starters: ["email", "phone", "owner"] },
  { match: /\b(task|to-?do|ticket|issue|bug|request)/i, starters: ["status", "owner", "due_date"] },
  { match: /\b(project|matter|case|engagement)/i, starters: ["stage", "owner", "due_date"], connect: ["contact"] },
  { match: /\b(invoice|payment|expense|quote|order|bill)/i, starters: ["amount", "due_date", "status"] },
  { match: /\b(event|meeting|appointment|booking|interview|call)/i, starters: ["date", "owner"] },
  { match: /\b(document|contract|file|report)/i, starters: ["files", "status", "owner"] },
];

export function suggestStarters(name: string): { starters: string[]; connect: string[] } {
  const hit = PURPOSES.find((p) => p.match.test(name.trim()));
  return hit ? { starters: [...hit.starters], connect: [...(hit.connect ?? [])] } : { starters: [], connect: [] };
}

/** The chips to draw: the ones always shown, then any picked that are not (a purpose can pick Close date), in the order of the list. */
export function shownStarters(picked: readonly string[]): typeof STARTER_FIELDS {
  return STARTER_FIELDS.filter((f) => STARTER_SHOWN.includes(f.key) || picked.includes(f.key));
}

/** The chips behind More, narrowed by what was typed (title or type). */
export function moreStarters(picked: readonly string[], query: string): typeof STARTER_FIELDS {
  const q = query.trim().toLowerCase();
  return shownStarters(picked).length === STARTER_FIELDS.length ? [] : STARTER_FIELDS.filter((f) => !shownStarters(picked).includes(f) && (q === "" || f.title.toLowerCase().includes(q) || f.type.includes(q)));
}

/** A type the new one can be connected to: shown as "Contacts". */
export interface ConnectType { key: string; title: string; plural: string }

/** The types a new type can be connected to: the ones the person sees, Contacts first, never the built in agent or a site's table. */
export function connectChoices<T extends ConnectType & { system?: boolean; scope?: string | undefined }>(types: readonly T[], show: (t: T) => boolean): ConnectType[] {
  return types
    .filter((t) => t.key !== "agent" && !t.scope?.startsWith("site") && show(t))
    .map((t) => ({ key: t.key, title: t.title, plural: t.plural }))
    .sort((a, b) => Number(b.key === "contact") - Number(a.key === "contact") || a.plural.localeCompare(b.plural));
}

export function createTypeOps(o: { name: string; plural: string; icon: string; takenKeys: readonly string[]; starters?: readonly string[]; connect?: readonly ConnectType[] }): { key: string; ops: SchemaOp[] } {
  const typed = o.name.trim();
  const { title: name, plural } = namesOf(typed, o.plural);
  const key = freeKey(slugOf(name), o.takenKeys);
  const ops: SchemaOp[] = [{ op: "type.create", type: key, def: { title: name, plural, icon: o.icon, label: "internal", titleField: "name", fields: [{ key: "name", type: "text", title: "Name", required: true }] } }];
  const used = ["name"];
  for (const k of o.starters ?? []) {
    const f = STARTER_FIELDS.find((x) => x.key === k);
    if (!f) continue;
    const add = addFieldOps({ type: key, name: f.title, fieldType: f.type, required: false, takenKeys: used });
    used.push(add.key);
    ops.push(...add.ops);
  }
  // A link is a pair of fields: one on this type (Contact) and one on the other (Clients). relation.add makes both ends, so a field.add of type relation is not used.
  for (const c of o.connect ?? []) {
    const near = freeKey(slugOf(c.title, "f"), used);
    used.push(near);
    ops.push({ op: "relation.add", type: key, field: near, def: { to: c.key, inverse: slugOf(plural, "f") || `${key}_links`, title: c.title, inverseTitle: plural } });
  }
  return { key, ops };
}

export function renameTypeOps(type: string, name: string, plural: string): SchemaOp[] {
  const n = namesOf(name, plural);
  return [{ op: "type.update", type, def: { title: n.title, plural: n.plural } }];
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

/** A link from this type to another: a pair of fields (one here, one on the other type) that relation.add makes together. `farKeys` are the field keys the other type already has. */
export function linkFieldOps(o: { type: string; plural: string; name: string; to: ConnectType; takenKeys: readonly string[]; farKeys: readonly string[] }): { key: string; ops: SchemaOp[] } {
  const title = o.name.trim() || o.to.title;
  const key = freeKey(slugOf(title, "f"), o.takenKeys);
  const back = freeKey(slugOf(o.plural, "f") || `${o.type}_links`, [...o.farKeys, ...(o.to.key === o.type ? [...o.takenKeys, key] : [])]);
  return { key, ops: [{ op: "relation.add", type: o.type, field: key, def: { to: o.to.key, inverse: back, title, inverseTitle: o.plural } }] };
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

/** The words the chips use for a field type, the same as the Start with chips; a type not named here keeps the server's title. */
const TITLES: Record<string, string> = { longtext: "Long text", datetime: "Date and time", url: "URL", multichoice: "Multi choice", duration: "Duration", checkbox: "Checkbox" };
export const fieldTypeTitle = (key: string, fallback: string): string => TITLES[key] ?? fallback;

export function addableTypes(all: readonly FieldTypeInfo[]): FieldTypeInfo[] {
  return ADDABLE.flatMap((k) => { const t = all.find((x) => x.key === k); return t ? [{ ...t, title: fieldTypeTitle(t.key, t.title) }] : []; });
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

const msg = (e: unknown): string => plainError(e instanceof Error && e.message ? e.message : undefined, "change");

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
export function typeRowMenu(t: { system: boolean; syncedFrom?: string | undefined }, on: { rename(): void; fields(): void; remove(): void }): MenuEntry[] {
  const why = typeDeleteBlocked(t);
  return [
    { label: "Rename", onSelect: on.rename },
    { label: "Edit fields", onSelect: on.fields },
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

// ---------------------------------------------------------------- the Record types page: grouping

export interface ListedType { key: string; title: string; plural: string; icon: string; system: boolean; rowCount: number; fieldCount: number; syncedFrom?: string | undefined; group?: string | undefined; scope?: string | undefined }
export interface TypeSection<T extends ListedType = ListedType> { key: string; label: string; items: T[] }

const PEOPLE = new Set(["client", "contact", "company", "person", "lead", "agent"]);
export const SECTION_ORDER = ["People", "Work", "Journeys", "Sites", "Connected", "Built in"] as const;

/** Which section of the page a type sits in. */
export function sectionOf(t: ListedType): (typeof SECTION_ORDER)[number] {
  if (t.syncedFrom) return "Connected";
  if (t.scope?.startsWith("site") || t.group?.toLowerCase() === "sites") return "Sites";
  const g = t.group?.toLowerCase();
  if (g === "journeys" || g === "journey") return "Journeys";
  if (PEOPLE.has(t.key)) return "People";
  if (t.system && (t.group === undefined || t.group === "")) return "Built in";
  return "Work";
}

/** The page's sections in order, internal types left out until they hold records. Empty sections are not drawn. */
export function typeSections<T extends ListedType>(types: readonly T[]): TypeSection<T>[] {
  const by = new Map<string, T[]>();
  for (const t of types) {
    if (!worthShowing(t)) continue;
    const k = sectionOf(t);
    by.set(k, [...(by.get(k) ?? []), t]);
  }
  return SECTION_ORDER.flatMap((k) => { const items = by.get(k); return items ? [{ key: k, label: k === "Connected" ? connectedLabel(items) : k, items: items.slice().sort((a, b) => a.plural.localeCompare(b.plural)) }] : []; });
}

function connectedLabel(items: readonly ListedType[]): string {
  const apps = [...new Set(items.map((i) => i.syncedFrom).filter((x): x is string => !!x))];
  return apps.length === 1 ? `Connected (${apps[0] === "github" ? "GitHub" : apps[0]![0]!.toUpperCase() + apps[0]!.slice(1)})` : "Connected";
}

/** The first few field names of a type, the title field left out: "Email, Phone, Company". */
export function fieldLine(fields: readonly { key: string; title: string }[], titleField: string, n = 3): string {
  return fields.filter((f) => f.key !== titleField).slice(0, n).map((f) => f.title).join(", ");
}
