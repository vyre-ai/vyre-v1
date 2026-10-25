// The Schema map and the Record types list without a renderer (spec 3.4: a read-only Record types list and Schema map in the app; structure is edited in the Console).
// The map is the prototype's: one card per record type (name, record count, its fields: the title field first, then links, then the rest, five shown and "+N more"), a curve from
// each link field to the card it points at (a crow's foot at the many side, a bar at the one side), laid out on a canvas that pans and zooms, with a minimap. Hovering or selecting
// a card lights its links and dims the rest. Nothing here edits: there are no add, drag-to-link or delete controls.
import type { CapMap } from "../../../../../../generated/types.ts";

export type MapOut = CapMap["schema.map"]["out"];
export type MapNode = MapOut["nodes"][number];
export type MapEdge = MapOut["edges"][number];
export type TypeDetail = CapMap["schema.types.get"]["out"]["type"];
export type FieldDef = TypeDetail["fields"][number];
export type TypeRow = CapMap["schema.types.list"]["out"]["types"][number];

// ---------------------------------------------------------------- sizes (the prototype's)

export const CARD_W = 232;
export const HEAD_H = 40;
export const FIELD_H = 26;
export const MORE_H = 28;
export const FOOT_H = 6;
export const SHOWN = 5;
export const ZMIN = 0.3;
export const ZMAX = 2.2;

// ---------------------------------------------------------------- fields on a card

const TYPE_NAME: Readonly<Record<string, string>> = {
  text: "Text", longtext: "Long text", number: "Number", money: "Money", datetime: "Date and time", duration: "Duration", choice: "Choice", multichoice: "Multi-choice", status: "Status",
  checkbox: "Checkbox", rating: "Rating", person: "Person", email: "Email", phone: "Phone", url: "URL", address: "Address", relation: "Link", lookup: "Lookup", rollup: "Rollup",
  formula: "Formula", autonumber: "Auto number", created_time: "Created time", created_by: "Created by", modified_time: "Modified time", modified_by: "Modified by", files: "Files",
  signature: "Signature", sealed: "Sealed", button: "Button", ai: "AI field",
};

/** The little mark before a field: a symbol for the computed and text kinds, a named icon for the rest. */
const SYMBOL: Readonly<Record<string, string>> = { text: "Aa", longtext: "¶", money: "$", autonumber: "#", rollup: "Σ", formula: "ƒx" };

export interface FieldRow {
  key: string;
  title: string;
  /** The words at the right of the row: "Text", "Link to Projects", "Linked from Clients". */
  typeLabel: string;
  kind: "relation" | "plain";
  /** Outgoing links start a curve; incoming ones are the other end of someone else's. */
  outgoing: boolean;
  /** The type this link points at or comes from. */
  other?: string;
  symbol?: string;
  /** Icon name for fields without a symbol. */
  icon: string;
}

function iconOf(type: string): string {
  if (type === "relation") return "link";
  if (type === "datetime" || type === "created_time" || type === "modified_time") return "cal";
  if (type === "choice" || type === "multichoice" || type === "status") return "choice";
  if (type === "person" || type === "created_by" || type === "modified_by") return "person";
  if (type === "checkbox") return "check";
  if (type === "files") return "attach";
  if (type === "sealed") return "lock";
  if (type === "lookup") return "lookup";
  if (type === "ai") return "spark";
  if (type === "rating") return "star";
  return "plain";
}

/** The rows of a card. With the type's details they are every field; without them (still loading) they are the link fields the map itself knows. */
export function fieldRows(type: string, edges: readonly MapEdge[], titleOf: (t: string) => string, detail: TypeDetail | undefined): FieldRow[] {
  const links = new Map<string, FieldRow>();
  for (const e of edges) {
    if (e.from === type) links.set(e.field, { key: e.field, title: humanize(e.field), typeLabel: `Link to ${titleOf(e.to)}`, kind: "relation", outgoing: true, other: e.to, icon: "link" });
    if (e.to === type && e.inverse !== undefined && !(e.from === type && e.inverse === e.field)) {
      if (!links.has(e.inverse)) links.set(e.inverse, { key: e.inverse, title: humanize(e.inverse), typeLabel: `Linked from ${titleOf(e.from)}`, kind: "relation", outgoing: false, other: e.from, icon: "link" });
    }
  }
  const rows: FieldRow[] = [];
  if (detail) {
    for (const f of detail.fields) {
      const link = links.get(f.key);
      if (link) { rows.push({ ...link, title: f.title }); links.delete(f.key); continue; }
      const sym = SYMBOL[f.type];
      rows.push({ key: f.key, title: f.title, typeLabel: TYPE_NAME[f.type] ?? humanize(f.type), kind: "plain", outgoing: false, icon: iconOf(f.type), ...(sym !== undefined ? { symbol: sym } : {}) });
    }
  }
  for (const link of links.values()) rows.push(link);
  const title = detail?.titleField;
  const rank = (r: FieldRow): number => (r.key === title ? 0 : r.kind === "relation" ? 1 : 2);
  return rows.map((r, i) => ({ r, i })).sort((a, b) => rank(a.r) - rank(b.r) || a.i - b.i).map((x) => x.r);
}

export function humanize(key: string): string {
  const s = key.replace(/[_-]+/g, " ").trim();
  return s ? s[0]!.toUpperCase() + s.slice(1) : key;
}

/** Rows drawn: five, or all when the card is expanded. */
export const shownCount = (total: number, expanded: boolean): number => (expanded ? total : Math.min(SHOWN, total));
export const moreCount = (total: number): number => Math.max(0, total - SHOWN);

export function cardHeight(total: number, expanded: boolean): number {
  return HEAD_H + shownCount(total, expanded) * FIELD_H + (total > SHOWN ? MORE_H : FOOT_H);
}

// ---------------------------------------------------------------- where the cards sit

export interface Rect { x: number; y: number; w: number; h: number }

/** Degree of each type: how many links touch it. */
function degrees(nodes: readonly MapNode[], edges: readonly MapEdge[]): Map<string, number> {
  const d = new Map<string, number>();
  for (const n of nodes) d.set(n.type, 0);
  for (const e of edges) { d.set(e.from, (d.get(e.from) ?? 0) + 1); d.set(e.to, (d.get(e.to) ?? 0) + 1); }
  return d;
}

/** A calm starting layout: the most linked types first, three or four columns, each card under the shortest column, columns a little staggered. Stable for the same map. */
export function layout(nodes: readonly MapNode[], edges: readonly MapEdge[], heights: ReadonlyMap<string, number>): Map<string, [number, number]> {
  const deg = degrees(nodes, edges);
  const order = [...nodes].sort((a, b) => (deg.get(b.type) ?? 0) - (deg.get(a.type) ?? 0) || a.title.localeCompare(b.title));
  const cols = Math.max(1, Math.min(4, Math.ceil(Math.sqrt(order.length))));
  const bottoms: number[] = [];
  for (let c = 0; c < cols; c++) bottoms.push(40 + c * 50);
  const out = new Map<string, [number, number]>();
  for (const n of order) {
    let c = 0;
    for (let i = 1; i < cols; i++) if ((bottoms[i] as number) < (bottoms[c] as number)) c = i;
    const y = bottoms[c] as number;
    out.set(n.type, [70 + c * (CARD_W + 128), y]);
    bottoms[c] = y + (heights.get(n.type) ?? cardHeight(SHOWN, false)) + 36;
  }
  return out;
}

// ---------------------------------------------------------------- curves

export interface EdgeGeometry {
  from: string;
  to: string;
  field: string;
  /** Curve, crow's foot at the link field (the many side), bar at the target card (the one side), dot where it leaves. */
  d: string;
  crow: string;
  bar: string;
  dot: [number, number];
}

/** The curve for one link, from its field row on the source card to the target card, as the prototype draws it. */
export function edgeGeometry(e: MapEdge, from: Rect, to: Rect, rowIndex: number, shown: number): EdgeGeometry {
  const sy = rowIndex >= 0 && rowIndex < shown ? from.y + HEAD_H + rowIndex * FIELD_H + FIELD_H / 2 : from.y + 20;
  const ty = to.y + 20;
  const right = to.x + to.w / 2 > from.x + from.w / 2;
  const dir = right ? 1 : -1;
  const sx = right ? from.x + from.w : from.x;
  const tx = right ? to.x : to.x + to.w;
  const dx = Math.max(60, Math.abs(tx - sx) / 2) * dir;
  const n = (v: number): string => String(Math.round(v * 10) / 10);
  return {
    from: e.from, to: e.to, field: e.field,
    d: `M${n(sx)} ${n(sy)} C ${n(sx + dx)} ${n(sy)}, ${n(tx - dx)} ${n(ty)}, ${n(tx)} ${n(ty)}`,
    crow: `M${n(sx + dir * 13)} ${n(sy)} L${n(sx)} ${n(sy - 5.5)} M${n(sx + dir * 13)} ${n(sy)} L${n(sx)} ${n(sy)} M${n(sx + dir * 13)} ${n(sy)} L${n(sx)} ${n(sy + 5.5)}`,
    bar: `M${n(tx - dir * 11)} ${n(ty - 5.5)} L${n(tx - dir * 11)} ${n(ty + 5.5)}`,
    dot: [sx, sy],
  };
}

/** What stands out when `hot` (hovered or selected) is a type: its own links lit, the others dimmed. */
export function emphasis(hot: string | null, e: { from: string; to: string }): "idle" | "hot" | "dim" {
  if (hot === null) return "idle";
  return hot === e.from || hot === e.to ? "hot" : "dim";
}

/** Cards are dimmed when something is hot and they are neither it nor linked to it. */
export function cardDim(hot: string | null, type: string, edges: readonly MapEdge[]): boolean {
  if (hot === null || hot === type) return false;
  return !edges.some((e) => (e.from === hot && e.to === type) || (e.to === hot && e.from === type));
}

// ---------------------------------------------------------------- the canvas

export interface View { k: number; x: number; y: number }

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

export function bounds(rects: readonly Rect[]): Rect | null {
  if (!rects.length) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const r of rects) { x0 = Math.min(x0, r.x); y0 = Math.min(y0, r.y); x1 = Math.max(x1, r.x + r.w); y1 = Math.max(y1, r.y + r.h); }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** The view that shows every card with room around it, as the prototype's Fit does. */
export function fitView(rects: readonly Rect[], width: number, height: number, padRight = 60): View {
  const b = bounds(rects);
  if (!b || width <= 0 || height <= 0) return { k: 1, x: 0, y: 0 };
  const k = clamp(Math.min((width - 60 - padRight) / b.w, (height - 90) / b.h), ZMIN, 1.1);
  return { k, x: 30 + (width - 30 - padRight - b.w * k) / 2 - b.x * k, y: 40 + (height - 70 - b.h * k) / 2 - b.y * k };
}

/** Zoom by `factor` keeping the point under the pointer still. */
export function zoomAt(v: View, factor: number, px: number, py: number): View {
  const k = clamp(v.k * factor, ZMIN, ZMAX);
  const f = k / v.k;
  return { k, x: px - (px - v.x) * f, y: py - (py - v.y) * f };
}

export const panBy = (v: View, dx: number, dy: number): View => ({ k: v.k, x: v.x + dx, y: v.y + dy });

export const MINI_W = 168;
export const MINI_H = 108;

export interface Mini { cards: { type: string; x: number; y: number; w: number; h: number }[]; viewport: Rect; x0: number; y0: number; s: number }

/** The minimap: every card and the part of the canvas on screen, scaled into 168 by 108. */
export function miniModel(rects: ReadonlyMap<string, Rect>, v: View, width: number, height: number): Mini {
  const all = [...rects.values()];
  const vx0 = -v.x / v.k, vy0 = -v.y / v.k, vw = width / v.k, vh = height / v.k;
  const b = bounds([...all, { x: vx0, y: vy0, w: vw, h: vh }]) ?? { x: 0, y: 0, w: 1, h: 1 };
  const pad = 40;
  const s = Math.min(MINI_W / (b.w + pad), MINI_H / (b.h + pad));
  const x0 = b.x - pad / 2, y0 = b.y - pad / 2;
  const cards: Mini["cards"] = [];
  for (const [type, r] of rects) cards.push({ type, x: (r.x - x0) * s, y: (r.y - y0) * s, w: r.w * s, h: r.h * s });
  return { cards, viewport: { x: (vx0 - x0) * s, y: (vy0 - y0) * s, w: vw * s, h: vh * s }, x0, y0, s };
}

/** A press on the minimap centres the view on that spot. */
export function miniGo(m: Mini, mx: number, my: number, v: View, width: number, height: number): View {
  const cx = mx / m.s + m.x0, cy = my / m.s + m.y0;
  return { k: v.k, x: width / 2 - cx * v.k, y: height / 2 - cy * v.k };
}

/** The card to move to from `from` with an arrow key: the nearest one whose centre lies that way. */
export function neighbor(rects: ReadonlyMap<string, Rect>, from: string | null, dir: "left" | "right" | "up" | "down"): string | null {
  const keys = [...rects.keys()];
  if (!keys.length) return null;
  const here = from === null ? undefined : rects.get(from);
  if (!here || from === null) return keys[0] ?? null;
  const cx = here.x + here.w / 2, cy = here.y + here.h / 2;
  let best: string | null = null;
  let bestScore = Infinity;
  for (const [k, r] of rects) {
    if (k === from) continue;
    const dx = r.x + r.w / 2 - cx, dy = r.y + r.h / 2 - cy;
    const along = dir === "right" ? dx : dir === "left" ? -dx : dir === "down" ? dy : -dy;
    if (along <= 0) continue;
    const across = dir === "left" || dir === "right" ? Math.abs(dy) : Math.abs(dx);
    const score = along + across * 2;
    if (score < bestScore) { bestScore = score; best = k; }
  }
  return best ?? from;
}

export function summary(nodes: number, fields: number | null): string {
  const t = `${nodes} ${nodes === 1 ? "table" : "tables"}`;
  return fields === null ? t : `${t} · ${fields} ${fields === 1 ? "field" : "fields"}`;
}

// ---------------------------------------------------------------- types list

export type TypeTag = { kind: "synced"; text: string } | { kind: "plain"; text: string };

/** The small tag at the right of a type: where it comes from. */
export function typeTag(t: Pick<TypeRow, "syncedFrom" | "system" | "group">): TypeTag | null {
  if (t.syncedFrom) return { kind: "synced", text: `Synced from ${humanize(t.syncedFrom)}` };
  if (t.group === "Sites" || t.group === "sites") return { kind: "plain", text: "Site table" };
  if (t.system) return { kind: "plain", text: "Built in" };
  return null;
}

export const recordsWord = (n: number): string => `${n} ${n === 1 ? "record" : "records"}`;
export const fieldsWord = (n: number): string => `${n} ${n === 1 ? "field" : "fields"}`;
export const MANAGED = "Record types are managed in the console";

/** A hue for a type from its key, so a type keeps its colour on every screen. */
export function hueOf(key: string): number {
  let h = 5381;
  for (let i = 0; i < key.length; i++) h = ((h << 5) + h + key.charCodeAt(i)) >>> 0;
  return (h % 12) * 30;
}
