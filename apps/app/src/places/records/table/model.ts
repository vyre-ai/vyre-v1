// Records table model: the pure part. The columns of a type with their widths, the window of rows and columns to draw, the view (filter, sort, group, hidden fields, colour) and the
// query it compiles to, the text of a cell, and the groups. No React and no clock; every rule here is tested without a renderer.
import type { CapMap } from "../../../../../../generated/types.ts";

export type TypeDef = CapMap["schema.describe"]["out"]["types"][number];
export type FieldDef = TypeDef["fields"][number];
export type RecordRow = CapMap["records.query"]["out"]["rows"][number];
export type ViewRow = CapMap["views.list"]["out"]["views"][number];

export const ROW_H = 34;
export const HEAD_H = 32;
export const GUTTER = 56;
/** The rows the query asks for at a time; the table draws from this window and asks again as the scroll leaves it. */
export const WINDOW = 200;
/** A grouped table loads this many rows at once so the groups are whole. */
export const GROUP_LIMIT = 1000;
const OVERSCAN = 6;
/** The rows drawn beyond the screen above and below while scrolling, and the rows the scroll position is rounded to: a fast fling (120 px a frame) never outruns the drawn rows, and a render happens every few frames, not every frame. */
export const FLING_OVERSCAN = 12;
export const SCROLL_BLOCK = 8;

// ---------------------------------------------------------------- columns

const WIDTHS: Record<string, number> = {
  checkbox: 90, rating: 110, number: 110, money: 130, duration: 110, date: 130, datetime: 160, choice: 150, multichoice: 190, status: 150, person: 170, email: 220, phone: 160, url: 220,
  address: 240, longtext: 260, relation: 190, files: 120, sealed: 130, autonumber: 100, formula: 130, lookup: 170, rollup: 130, button: 110, ai: 240,
};

export function widthOf(f: FieldDef, primary: boolean): number {
  return primary ? 280 : WIDTHS[f.type] ?? 170;
}

const NUMERIC = new Set(["number", "money", "duration", "autonumber", "rollup", "formula"]);
export const isNumeric = (f: FieldDef): boolean => NUMERIC.has(f.type);

export interface Column { field: FieldDef; width: number; left: number; primary: boolean }

/** The columns in order with their left edges. The primary (title) field comes first and stays; hidden fields drop out. */
export function columnsOf(def: TypeDef, hidden: readonly string[]): Column[] {
  const primary = def.fields.find((f) => f.key === def.titleField) ?? def.fields[0];
  const rest = def.fields.filter((f) => f !== primary && !hidden.includes(f.key));
  const ordered = primary ? [primary, ...rest] : rest;
  let left = 0;
  return ordered.map((field) => {
    const isPrimary = field === primary;
    const width = widthOf(field, isPrimary);
    const c: Column = { field, width, left, primary: isPrimary };
    left += width;
    return c;
  });
}

export function totalWidth(cols: readonly Column[]): number {
  const last = cols[cols.length - 1];
  return GUTTER + (last ? last.left + last.width : 0);
}

/** The columns to draw for a horizontal scroll: the primary always, then those that meet the viewport, plus a spacer for the ones skipped on the left. */
export function columnWindow(cols: readonly Column[], scrollLeft: number, viewport: number): { from: number; to: number; pad: number } {
  const x0 = Math.max(0, scrollLeft - GUTTER), x1 = x0 + viewport + 240;
  let from = 1, to = cols.length;
  while (from < cols.length && cols[from]!.left + cols[from]!.width < x0) from++;
  while (to > from && cols[to - 1]!.left > x1) to--;
  const first = cols[from], primary = cols[0];
  return { from, to, pad: first && primary ? Math.max(0, first.left - (primary.left + primary.width)) : 0 };
}

// ---------------------------------------------------------------- rows

/** The rows to draw for a vertical scroll. */
export function rowWindow(scrollTop: number, viewport: number, total: number, overscan: number = OVERSCAN): { first: number; last: number } {
  const first = Math.max(0, Math.floor(scrollTop / ROW_H) - overscan);
  const last = Math.min(total, Math.ceil((scrollTop + viewport) / ROW_H) + overscan);
  return { first, last };
}

/** The slice the query asks for so the drawn rows are inside it: 200 rows, starting a little above the first drawn one, on a 100 row grid so small scrolls ask nothing new. */
export function queryOffset(first: number, total: number): number {
  const off = Math.max(0, Math.floor((first - 50) / 100) * 100);
  return Math.max(0, Math.min(off, Math.max(0, total - WINDOW)));
}

// ---------------------------------------------------------------- the view

export type Clause = { field: string; op: "eq" | "in" | "empty" | "notempty" | "contains"; value?: unknown };
export interface SortKey { field: string; dir: "asc" | "desc" }
export interface TableViewState {
  clauses: readonly Clause[];
  sort: readonly SortKey[];
  group: string | null;
  hidden: readonly string[];
  colour: string | null;
  find: string;
}

export const PLAIN: TableViewState = { clauses: [], sort: [], group: null, hidden: [], colour: null, find: "" };

/** The filter a query takes: the clauses and the find text, joined with and. */
export function filterOf(v: TableViewState, titleField: string): unknown {
  const all: unknown[] = v.clauses.map((c) => ({ ...c }));
  const q = v.find.trim();
  if (q) all.push({ field: titleField, op: "contains", value: q });
  return all.length === 0 ? undefined : all.length === 1 ? all[0] : { and: all };
}

export function querySpec(type: string, v: TableViewState, titleField: string, offset: number): CapMap["records.query"]["in"] {
  const filter = filterOf(v, titleField);
  return {
    type, ...(filter === undefined ? {} : { filter }), ...(v.sort.length ? { sort: v.sort.map((s) => ({ ...s })) } : {}),
    ...(v.group ? { group: v.group } : {}), offset: v.group ? 0 : offset, limit: v.group ? GROUP_LIMIT : WINDOW,
  };
}

export function countSpec(type: string, v: TableViewState, titleField: string): CapMap["records.counts"]["in"] {
  const filter = filterOf(v, titleField);
  return { type, ...(filter === undefined ? {} : { filter }) };
}

export function isEdited(v: TableViewState, base: TableViewState): boolean {
  return JSON.stringify([v.clauses, v.sort, v.group, v.hidden, v.colour]) !== JSON.stringify([base.clauses, base.sort, base.group, base.hidden, base.colour]);
}

function clausesOf(filter: unknown): Clause[] {
  if (!filter || typeof filter !== "object") return [];
  const f = filter as { and?: unknown; field?: unknown };
  if (Array.isArray(f.and)) return f.and as Clause[];
  return typeof f.field === "string" ? [filter as Clause] : [];
}

/** A saved view as table state. Filters this table cannot draw as clauses are kept as they are and applied by the capability. */
export function fromSaved(view: ViewRow | undefined): TableViewState {
  if (!view) return PLAIN;
  const cfg = view.config ?? {};
  const colour = typeof cfg["colour"] === "string" ? cfg["colour"] : null;
  return {
    clauses: clausesOf(view.filter),
    sort: Array.isArray(view.sort) ? (view.sort as SortKey[]) : [],
    group: view.group ?? null, hidden: view.hidden ?? [], colour, find: "",
  };
}

/** What a save writes: the clauses as an and-list (or the one clause), the sort, the group, the hidden fields and the colour field. */
export function toSaved(v: TableViewState): { filter?: unknown; sort?: unknown; group?: string; hidden: string[]; config: Record<string, unknown> } {
  const filter = v.clauses.length === 0 ? undefined : v.clauses.length === 1 ? { ...v.clauses[0]! } : { and: v.clauses.map((c) => ({ ...c })) };
  return { ...(filter === undefined ? {} : { filter }), ...(v.sort.length ? { sort: v.sort.map((s) => ({ ...s })) } : {}), ...(v.group ? { group: v.group } : {}), hidden: [...v.hidden], config: v.colour ? { colour: v.colour } : {} };
}

// ---------------------------------------------------------------- editing the view

/** Header click on a column: ascending, then descending, then not sorted. */
export function cycleSort(v: TableViewState, field: string): TableViewState {
  const cur = v.sort[0];
  const next: SortKey[] = !cur || cur.field !== field ? [{ field, dir: "asc" }] : cur.dir === "asc" ? [{ field, dir: "desc" }] : [];
  return { ...v, sort: next };
}

export function setSort(v: TableViewState, field: string, dir: "asc" | "desc"): TableViewState {
  return { ...v, sort: [{ field, dir }] };
}

export function toggleHidden(v: TableViewState, field: string): TableViewState {
  return { ...v, hidden: v.hidden.includes(field) ? v.hidden.filter((k) => k !== field) : [...v.hidden, field] };
}

/** A checked option of a choice-like field: one clause per field, `eq` for one value and `in` for several. */
export function toggleOption(v: TableViewState, field: string, value: unknown): TableViewState {
  const cur = v.clauses.find((c) => c.field === field && (c.op === "eq" || c.op === "in"));
  const have: unknown[] = cur ? (cur.op === "in" && Array.isArray(cur.value) ? (cur.value as unknown[]) : [cur.value]) : [];
  const next = have.includes(value) ? have.filter((x) => x !== value) : [...have, value];
  const others = v.clauses.filter((c) => c !== cur);
  if (next.length === 0) return { ...v, clauses: others };
  const clause: Clause = next.length === 1 ? { field, op: "eq", value: next[0] } : { field, op: "in", value: next };
  return { ...v, clauses: [...others, clause] };
}

export function chosen(v: TableViewState, field: string): unknown[] {
  const cur = v.clauses.find((c) => c.field === field && (c.op === "eq" || c.op === "in"));
  return !cur ? [] : cur.op === "in" && Array.isArray(cur.value) ? (cur.value as unknown[]) : [cur.value];
}

export function clearClauses(v: TableViewState): TableViewState {
  return { ...v, clauses: [], find: "" };
}

// ---------------------------------------------------------------- field options

export interface Option { key: string; title: string; color?: string }

export function optionsOf(f: FieldDef): Option[] {
  const o = f.options ?? {};
  const list = (f.type === "status" ? o["stages"] : o["choices"]) as unknown;
  if (Array.isArray(list)) return list.filter((x): x is Option => !!x && typeof x === "object" && typeof (x as Option).key === "string").map((x) => ({ key: x.key, title: x.title, ...(x.color ? { color: x.color } : {}) }));
  if (f.type === "checkbox") return [{ key: "true", title: "Checked" }, { key: "false", title: "Unchecked" }];
  return [];
}

export const hasOptions = (f: FieldDef): boolean => f.type === "choice" || f.type === "status" || f.type === "checkbox";
export const groupable = (f: FieldDef): boolean => f.type === "choice" || f.type === "status" || f.type === "checkbox" || f.type === "person";
export const sortable = (f: FieldDef): boolean => !["longtext", "multichoice", "address", "files", "button"].includes(f.type);

/** The value a clause compares: a checkbox option is a boolean. */
export function optionValue(f: FieldDef, key: string): unknown {
  return f.type === "checkbox" ? key === "true" : key;
}

export function hueOf(key: string): number {
  let h = 5381;
  for (let i = 0; i < key.length; i++) h = ((h << 5) + h + key.charCodeAt(i)) >>> 0;
  return (h % 12) * 30;
}

// ---------------------------------------------------------------- cell text

const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

export function dateText(v: unknown, withTime = false, now: number = Date.now()): string {
  const d = typeof v === "number" ? new Date(v) : typeof v === "string" ? new Date(v) : null;
  if (!d || Number.isNaN(d.getTime())) return "";
  // this year's dates are short, as the prototype writes them ("23 Oct"); another year's keep the year ("Oct 24, 2025")
  const base = d.getUTCFullYear() === new Date(now).getUTCFullYear() ? `${d.getUTCDate()} ${MONTH[d.getUTCMonth()]}` : `${MONTH[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
  if (!withTime) return base;
  const h = d.getUTCHours(), m = d.getUTCMinutes();
  return `${base}, ${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

export function moneyText(v: unknown): string {
  const amount = typeof v === "number" ? v : v && typeof v === "object" && typeof (v as { amount?: unknown }).amount === "number" ? (v as { amount: number }).amount : null;
  if (amount === null) return "";
  const cur = v && typeof v === "object" && typeof (v as { currency?: unknown }).currency === "string" ? (v as { currency: string }).currency : "USD";
  const sym = cur === "USD" ? "$" : cur === "EUR" ? "€" : cur === "GBP" ? "£" : `${cur} `;
  return `${sym}${Math.round(amount).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;
}

export function durationText(v: unknown): string {
  if (typeof v !== "number") return "";
  const h = Math.floor(v / 3600), m = Math.floor((v % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/** The text of a cell. Choice and status read their option's title; a person reads `names`; everything else reads plainly. Empty is the empty string. */
export function cellText(f: FieldDef, v: unknown, names: (id: string) => string): string {
  if (v === undefined || v === null || v === "") return "";
  switch (f.type) {
    case "money": return moneyText(v);
    case "date": return dateText(v);
    case "datetime": return dateText(v, true);
    case "duration": return durationText(v);
    case "person": return names(String(v));
    case "choice":
    case "status": return optionsOf(f).find((o) => o.key === v)?.title ?? String(v);
    case "multichoice": return Array.isArray(v) ? v.map((x) => optionsOf(f).find((o) => o.key === x)?.title ?? String(x)).join(", ") : String(v);
    case "sealed": return "••••••";
    case "files": return Array.isArray(v) ? `${v.length} file${v.length === 1 ? "" : "s"}` : "";
    case "relation": return Array.isArray(v) ? (v.length === 1 ? "1 linked" : `${v.length} linked`) : String(v);
    case "checkbox": return v === true ? "Yes" : "";
    case "address": return v && typeof v === "object" ? [(v as Record<string, unknown>)["line1"], (v as Record<string, unknown>)["city"], (v as Record<string, unknown>)["region"]].filter((x) => typeof x === "string" && x).join(", ") : String(v);
    default: return typeof v === "object" ? JSON.stringify(v) : String(v);
  }
}

// ---------------------------------------------------------------- groups

export type GroupItem = { g: true; key: string; label: string; n: number; closed: boolean } | { g: false; row: RecordRow; n: number };

/** Rows under their group headers, in the order the groups first appear; a folded group keeps its header and drops its rows. Row numbers run through the visible rows. */
export function groupItems(rows: readonly RecordRow[], f: FieldDef, folded: readonly string[], names: (id: string) => string): GroupItem[] {
  const order: string[] = [];
  const by = new Map<string, RecordRow[]>();
  for (const r of rows) {
    const k = String(r.fields[f.key] ?? "");
    if (!by.has(k)) { by.set(k, []); order.push(k); }
    by.get(k)!.push(r);
  }
  const out: GroupItem[] = [];
  let n = 0;
  for (const k of order) {
    const list = by.get(k)!;
    const closed = folded.includes(k);
    out.push({ g: true, key: k, label: k === "" ? `No ${f.title.toLowerCase()}` : cellText(f, f.type === "checkbox" ? k === "true" : k, names), n: list.length, closed });
    if (!closed) for (const row of list) out.push({ g: false, row, n: ++n });
  }
  return out;
}

export function colourOf(f: FieldDef | undefined, r: RecordRow): string | null {
  if (!f) return null;
  const v = r.fields[f.key];
  if (v === undefined || v === null || v === "") return null;
  const key = String(v);
  const opt = optionsOf(f).find((o) => o.key === key);
  const hue = opt?.color && /^\d+$/.test(opt.color) ? Number(opt.color) : hueOf(key);
  return `hsla(${hue}, 65%, 52%, 0.10)`;
}

// ---------------------------------------------------------------- picking rows

/** The rows picked in the table: the ids ticked one by one, or every row of the table. */
export interface RowPick { ids: ReadonlySet<string>; every: boolean }
export const NO_PICK: RowPick = { ids: new Set(), every: false };

/** Cmd-click: that row joins or leaves the pick. Picking one by one after "all" starts again from that row. */
export function togglePick(p: RowPick, id: string): RowPick {
  const ids = new Set(p.every ? [] : p.ids);
  if (ids.has(id)) ids.delete(id); else ids.add(id);
  return { ids, every: false };
}

/** The header checkbox: anything picked clears it; nothing picked takes the rows that are loaded. */
export function toggleHeader(p: RowPick, loaded: readonly string[]): RowPick {
  return p.every || p.ids.size > 0 ? NO_PICK : { ids: new Set(loaded), every: false };
}

/** A row is picked when it is in the set or the pick is every row. */
export const isPickedRow = (p: RowPick, id: string): boolean => p.every || p.ids.has(id);

/** How many the pick holds, given the table's count. */
export const pickCount = (p: RowPick, total: number): number => (p.every ? total : p.ids.size);
