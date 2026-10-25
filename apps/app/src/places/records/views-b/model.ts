// Records views, part B: the pure part of Calendar, Timeline, Map and Charts. Month grids and the day a record falls on, the bars of a timeline and what a drag does to them, the point a record
// has on a map, and the tallies a chart draws. All dates are UTC days. No React and no clock (callers pass "today"); every rule here is tested without a renderer.
import type { CapMap } from "../../../../../../generated/types.ts";
import { hueOf, optionsOf } from "../table/model.ts";
import type { FieldDef, RecordRow, TypeDef } from "../table/model.ts";

export type { FieldDef, RecordRow, TypeDef };

export const DAY = 86_400_000;
/** Records a view reads at once. A calendar, a timeline or a chart is drawn from the first thousand that match; the count beside it is the cached count. */
export const VIEW_LIMIT = 1000;

export const startOfDay = (ms: number): number => Math.floor(ms / DAY) * DAY;
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"] as const;
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;
export const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

export const dayKey = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
export const monthTitle = (ms: number): string => `${MONTHS[new Date(ms).getUTCMonth()]} ${new Date(ms).getUTCFullYear()}`;
export const shortDay = (ms: number): string => `${MON[new Date(ms).getUTCMonth()]} ${new Date(ms).getUTCDate()}`;

/** A stored date as milliseconds: a number, or an ISO string. Anything else is no date. */
export function msOf(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const t = Date.parse(v);
    return Number.isNaN(t) ? null : t;
  }
  return null;
}

export const isDateField = (f: FieldDef): boolean => f.type === "date" || f.type === "datetime";
export const dateFields = (def: TypeDef): FieldDef[] => def.fields.filter(isDateField);

/** The field a view reads: a pick from its menu, then the saved view's `config[key]`, then the first date field. */
export function dateFieldOf(def: TypeDef, key: string, saved?: { config?: Record<string, unknown> }, picked?: string | null): FieldDef | undefined {
  const all = dateFields(def);
  const cfg = saved?.config?.[key];
  for (const k of [picked, typeof cfg === "string" ? cfg : null]) {
    const hit = k ? all.find((f) => f.key === k) : undefined;
    if (hit) return hit;
  }
  return all[0];
}

// ---------------------------------------------------------------- calendar

export interface Cell { ms: number; day: number; inMonth: boolean; key: string }

/** The six weeks that show a month, from the Sunday on or before the 1st. */
export function monthGrid(cursor: number): Cell[] {
  const d = new Date(cursor);
  const first = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
  const start = first - new Date(first).getUTCDay() * DAY;
  const out: Cell[] = [];
  for (let i = 0; i < 42; i++) {
    const ms = start + i * DAY;
    out.push({ ms, day: new Date(ms).getUTCDate(), inMonth: new Date(ms).getUTCMonth() === d.getUTCMonth(), key: dayKey(ms) });
  }
  return out;
}

export function addMonths(cursor: number, n: number): number {
  const d = new Date(cursor);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1);
}

/** Records by the day their date field falls on. Records with no date are left out and counted by the caller. */
export function bucketByDay(rows: readonly RecordRow[], f: FieldDef): Map<string, RecordRow[]> {
  const out = new Map<string, RecordRow[]>();
  for (const r of rows) {
    const ms = msOf(r.fields[f.key]);
    if (ms === null) continue;
    const k = dayKey(ms);
    const list = out.get(k);
    if (list) list.push(r); else out.set(k, [r]);
  }
  for (const list of out.values()) list.sort((a, b) => (msOf(a.fields[f.key]) ?? 0) - (msOf(b.fields[f.key]) ?? 0));
  return out;
}

/** The value a record takes when dropped on a day: that day, keeping the time of day of a date and time field. */
export function dropOnDay(f: FieldDef, current: unknown, day: number): number {
  if (f.type !== "datetime") return startOfDay(day);
  const ms = msOf(current);
  return startOfDay(day) + (ms === null ? 9 * 3_600_000 : ms - startOfDay(ms));
}

/** How many events a day cell shows before "+N more". */
export const CELL_EVENTS = 3;

export function hueOfRow(f: FieldDef | undefined, r: RecordRow): number {
  const v = f ? r.fields[f.key] : undefined;
  if (typeof v !== "string" || v === "") return 240;
  const opt = f ? optionsOf(f).find((o) => o.key === v) : undefined;
  return opt?.color && /^\d+$/.test(opt.color) ? Number(opt.color) : hueOf(v);
}

// ---------------------------------------------------------------- timeline

export const DAY_W = 28;
export const BAR_H = 26;
export const ROW_GAP = 8;
export const ROW_H = BAR_H + ROW_GAP;
export const HEAD_H = 44;
export const LABEL_W = 220;

export interface Range { start: FieldDef; end: FieldDef | null }

/** The two fields a timeline spans: a pick, the saved `config.start` and `config.end`, then the first date field and the next one (a record with only one date is a one day bar). */
export function rangeOf(def: TypeDef, saved?: { config?: Record<string, unknown> }, picked?: string | null): Range | undefined {
  const all = dateFields(def);
  const start = dateFieldOf(def, "start", saved, picked);
  if (!start) return undefined;
  const cfg = saved?.config?.["end"];
  const end = (typeof cfg === "string" ? all.find((f) => f.key === cfg) : undefined) ?? all.find((f) => f !== start) ?? null;
  return { start, end };
}

export interface Bar { id: string; row: RecordRow; start: number; end: number }

/** A bar per record that has a start. The end is the end field, never before the start; with no end it is the start day. Sorted by start, then title. */
export function barsOf(rows: readonly RecordRow[], range: Range, titleField: string): Bar[] {
  const out: Bar[] = [];
  for (const row of rows) {
    const s = msOf(row.fields[range.start.key]);
    if (s === null) continue;
    const e = range.end ? msOf(row.fields[range.end.key]) : null;
    const start = startOfDay(s);
    out.push({ id: row.id, row, start, end: Math.max(start, e === null ? start : startOfDay(e)) });
  }
  return out.sort((a, b) => a.start - b.start || String(a.row.fields[titleField] ?? "").localeCompare(String(b.row.fields[titleField] ?? "")));
}

/** The days a timeline spans: every bar, today, and a week of room either side. */
export function spanOf(bars: readonly Bar[], today: number): { from: number; days: number } {
  let lo = startOfDay(today), hi = startOfDay(today);
  for (const b of bars) { lo = Math.min(lo, b.start); hi = Math.max(hi, b.end); }
  const from = lo - 7 * DAY;
  return { from, days: Math.round((hi + 7 * DAY - from) / DAY) + 1 };
}

export const xOf = (day: number, from: number): number => Math.round((day - from) / DAY) * DAY_W;
export const dayAt = (x: number, from: number): number => from + Math.floor(x / DAY_W) * DAY;

export type DragMode = "move" | "start" | "end";

/** What a drag of `dx` pixels does to a bar: move both ends, or one end (never past the other). */
export function dragBar(b: Pick<Bar, "start" | "end">, dx: number, mode: DragMode): { start: number; end: number } {
  const d = Math.round(dx / DAY_W) * DAY;
  if (mode === "move") return { start: b.start + d, end: b.end + d };
  if (mode === "start") return { start: Math.min(b.start + d, b.end), end: b.end };
  return { start: b.start, end: Math.max(b.end + d, b.start) };
}

/** The patch a finished drag writes: the start field, and the end field if the bar has one and its end changed. */
export function datePatch(range: Range, row: RecordRow, next: { start: number; end: number }): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  const keep = (f: FieldDef, day: number): number => {
    const cur = msOf(row.fields[f.key]);
    return f.type === "datetime" && cur !== null ? day + (cur - startOfDay(cur)) : day;
  };
  patch[range.start.key] = keep(range.start, next.start);
  if (range.end) patch[range.end.key] = keep(range.end, next.end);
  return patch;
}

/** The relation field that ties a record to its project: only records of a project have a plan to cascade. */
export function projectFieldOf(def: TypeDef): FieldDef | undefined {
  return def.fields.find((f) => f.key === "project" && f.type === "relation");
}

export function projectIdOf(def: TypeDef, row: RecordRow): string | null {
  const f = projectFieldOf(def);
  const v = f ? row.fields[f.key] : undefined;
  return Array.isArray(v) && typeof v[0] === "string" ? v[0] : null;
}

export type Cascade = CapMap["projects.cascade"]["out"];

/** The line over a cascade proposal: its summary, or the count of moves. Kept dates are the other choice. */
export function cascadeLine(c: Cascade): string {
  if (c.summary) return c.summary;
  const n = c.moves.length;
  return n === 0 ? "Nothing else moves." : `${n} later ${n === 1 ? "task moves" : "tasks move"}.`;
}

/** Bars are grouped by a lane field into bands; a record with no value sits in the last band. */
export interface Band { key: string; title: string; bars: Bar[] }
export function bandsOf(bars: readonly Bar[], lane: FieldDef | undefined): Band[] {
  if (!lane) return [{ key: "", title: "", bars: [...bars] }];
  const opts = optionsOf(lane);
  const out: Band[] = opts.map((o) => ({ key: o.key, title: o.title, bars: [] }));
  const none: Band = { key: "", title: `No ${lane.title.toLowerCase()}`, bars: [] };
  for (const b of bars) {
    const v = b.row.fields[lane.key];
    (out.find((x) => x.key === v) ?? none).bars.push(b);
  }
  if (none.bars.length) out.push(none);
  return out.filter((x) => x.bars.length > 0);
}

// ---------------------------------------------------------------- map

export interface Point { id: string; lat: number; lng: number; row: RecordRow }

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** The place a record has: number fields called lat and lng (or latitude and longitude), or an address field holding them. */
export function pointOf(def: TypeDef, row: RecordRow): Point | null {
  let lat: number | null = null, lng: number | null = null;
  for (const f of def.fields) {
    const k = f.key.toLowerCase();
    const v = row.fields[f.key];
    if ((k === "lat" || k === "latitude") && lat === null) lat = num(v);
    else if ((k === "lng" || k === "lon" || k === "longitude") && lng === null) lng = num(v);
    else if (f.type === "address" && v && typeof v === "object") {
      const a = v as Record<string, unknown>;
      lat ??= num(a["lat"]);
      lng ??= num(a["lng"]);
    }
  }
  return lat !== null && lng !== null && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { id: row.id, lat, lng, row } : null;
}

export interface Bounds { minLat: number; maxLat: number; minLng: number; maxLng: number }

/** The box that holds every point with a margin, never thinner than a tenth of a degree so one point still has a view. */
export function boundsOf(points: readonly Point[]): Bounds {
  if (points.length === 0) return { minLat: -60, maxLat: 75, minLng: -180, maxLng: 180 };
  let minLat = 90, maxLat = -90, minLng = 180, maxLng = -180;
  for (const p of points) { minLat = Math.min(minLat, p.lat); maxLat = Math.max(maxLat, p.lat); minLng = Math.min(minLng, p.lng); maxLng = Math.max(maxLng, p.lng); }
  const padLat = Math.max(0.05, (maxLat - minLat) * 0.12), padLng = Math.max(0.05, (maxLng - minLng) * 0.12);
  return { minLat: minLat - padLat, maxLat: maxLat + padLat, minLng: minLng - padLng, maxLng: maxLng + padLng };
}

/** A point in a box of w by h pixels, north up, the box's scale the same both ways so distances are not stretched. */
export function plot(p: { lat: number; lng: number }, b: Bounds, w: number, h: number): { x: number; y: number } {
  const spanX = b.maxLng - b.minLng, spanY = b.maxLat - b.minLat;
  const k = Math.min(w / spanX, h / spanY);
  const offX = (w - spanX * k) / 2, offY = (h - spanY * k) / 2;
  return { x: Math.round(offX + (p.lng - b.minLng) * k), y: Math.round(offY + (b.maxLat - p.lat) * k) };
}

// ---------------------------------------------------------------- charts

export type Measure = { kind: "count" } | { kind: "sum"; field: string };
export interface Slice { key: string; label: string; value: number; hue: number }

export const isMeasureField = (f: FieldDef): boolean => f.type === "number" || f.type === "money" || f.type === "duration" || f.type === "rating";
export const isGroupField = (f: FieldDef): boolean => f.type === "choice" || f.type === "status" || f.type === "person" || f.type === "checkbox" || isDateField(f);

function amountOf(v: unknown): number {
  if (typeof v === "number") return v;
  if (v && typeof v === "object" && typeof (v as { amount?: unknown }).amount === "number") return (v as { amount: number }).amount;
  return 0;
}

/**
 * The slices of a chart: records counted (or a field summed) under each value of the group field. Choice and status follow their options' order, dates group by month in time order,
 * people by name. A record with no value is counted under "None".
 */
export function tally(rows: readonly RecordRow[], group: FieldDef, measure: Measure, names: (id: string) => string): Slice[] {
  const by = new Map<string, number>();
  const label = new Map<string, string>();
  const value = (r: RecordRow): number => (measure.kind === "count" ? 1 : amountOf(r.fields[measure.field]));
  for (const r of rows) {
    const raw = r.fields[group.key];
    let key = "", text = "None";
    if (isDateField(group)) {
      const ms = msOf(raw);
      if (ms !== null) { const d = new Date(ms); key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`; text = `${MON[d.getUTCMonth()]} ${d.getUTCFullYear()}`; }
    } else if (raw !== undefined && raw !== null && raw !== "") {
      key = String(raw);
      text = group.type === "person" ? names(key) : group.type === "checkbox" ? (raw === true ? "Yes" : "No") : optionsOf(group).find((o) => o.key === key)?.title ?? key;
    }
    by.set(key, (by.get(key) ?? 0) + value(r));
    label.set(key, text);
  }
  const order = isDateField(group) ? [...by.keys()].filter((k) => k !== "").sort() : optionsOf(group).map((o) => o.key).filter((k) => by.has(k));
  const rest = [...by.keys()].filter((k) => k !== "" && !order.includes(k)).sort((a, b) => (label.get(a) ?? "").localeCompare(label.get(b) ?? ""));
  const keys = [...order, ...rest, ...(by.has("") ? [""] : [])];
  return keys.map((k) => ({ key: k, label: label.get(k) ?? "None", value: by.get(k) ?? 0, hue: k === "" ? -1 : hueOfKey(group, k) }));
}

function hueOfKey(group: FieldDef, key: string): number {
  const opt = optionsOf(group).find((o) => o.key === key);
  return opt?.color && /^\d+$/.test(opt.color) ? Number(opt.color) : hueOf(key);
}

/** The share of the largest slice each bar fills, as whole percents; a chart of nothing is all zeros. */
export function widths(slices: readonly Slice[]): number[] {
  const max = Math.max(0, ...slices.map((s) => s.value));
  return slices.map((s) => (max === 0 ? 0 : Math.max(s.value > 0 ? 2 : 0, Math.round((s.value / max) * 100))));
}

export function total(slices: readonly Slice[]): number {
  return slices.reduce((n, s) => n + s.value, 0);
}

export function measureText(measure: Measure, def: TypeDef): string {
  return measure.kind === "count" ? `Number of ${def.plural.toLowerCase()}` : `Sum of ${(def.fields.find((f) => f.key === measure.field)?.title ?? measure.field).toLowerCase()}`;
}

export function valueText(n: number, measure: Measure, def: TypeDef): string {
  const f = measure.kind === "sum" ? def.fields.find((x) => x.key === measure.field) : undefined;
  const plain = Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return f?.type === "money" ? `$${plain}` : plain;
}
