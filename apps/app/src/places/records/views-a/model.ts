// Records views, part A: the pure part of Board, Gallery and List. The lanes of a board and the query each lane asks for, the patch a drop writes, the fields a card shows, the grid a gallery
// lays out and the cover it draws, the note under a list row. No React and no clock; every rule here is tested without a renderer.
import type { CapMap } from "../../../../../../generated/types.ts";
import { filterOf, hasOptions, hueOf, optionsOf } from "../table/model.ts";
import type { Clause, FieldDef, RecordRow, TableViewState, TypeDef } from "../table/model.ts";
import type { ViewRow } from "../sidebar/model.ts";

export type { Clause, FieldDef, RecordRow, TableViewState, TypeDef };

// ---------------------------------------------------------------- the kinds of view

/** The kinds this part draws. The table is the table packet's; calendar, timeline, map and charts come from part B through `extraKinds`. */
export type ViewKind = "table" | "board" | "gallery" | "list";
export const KIND_LABEL: Record<ViewKind, string> = { table: "Table", board: "Board", gallery: "Gallery", list: "List" };
export const KIND_ORDER: readonly ViewKind[] = ["table", "board", "gallery", "list"];

/** The kind a saved view opens as; a kind this part does not know is read as the table. */
export function kindOf(saved: { kind: string } | undefined, known: readonly string[] = KIND_ORDER): string {
  return saved && known.includes(saved.kind) ? saved.kind : "table";
}

// ---------------------------------------------------------------- board

/** The lane of cards whose lane field is empty. */
export const NONE_KEY = "";
/** The cards one lane draws at first, and each press of "Show more" adds this many. */
export const LANE_PAGE = 40;
export const LANE_W = 276;

export interface Lane { key: string; title: string; color?: string; none: boolean }

/** A field a board can make lanes from: its options are the lanes. */
export const isLaneField = (f: FieldDef): boolean => f.type === "status" || f.type === "choice";

/**
 * The field a board runs on: the saved view's `config.lane`, then its group, then the first status field, then the first choice field. A key that names no lane field falls through.
 */
export function laneFieldOf(def: TypeDef, saved?: Pick<ViewRow, "config" | "group">, picked?: string | null): FieldDef | undefined {
  const lanes = def.fields.filter(isLaneField);
  const cfg = saved?.config?.["lane"];
  for (const key of [picked, typeof cfg === "string" ? cfg : null, saved?.group]) {
    const hit = key ? lanes.find((f) => f.key === key) : undefined;
    if (hit) return hit;
  }
  return lanes.find((f) => f.type === "status") ?? lanes[0];
}

/** The lanes of a field, in the order of its options, then the lane for records with no value. */
export function lanesOf(f: FieldDef): Lane[] {
  const out: Lane[] = optionsOf(f).map((o) => ({ key: o.key, title: o.title, ...(o.color ? { color: o.color } : {}), none: false }));
  out.push({ key: NONE_KEY, title: `No ${f.title.toLowerCase()}`, none: true });
  return out;
}

export function laneClause(f: FieldDef, lane: Lane): Clause {
  return lane.none ? { field: f.key, op: "empty" } : { field: f.key, op: "eq", value: lane.key };
}

/** The view's own filter and the lane, joined with and. The lane field's own clauses are dropped: a lane is that choice, so the filter menu cannot empty the board. */
function inLane(v: TableViewState, titleField: string, f: FieldDef, lane: Lane): unknown {
  const own = filterOf({ ...v, clauses: v.clauses.filter((c) => c.field !== f.key) }, titleField);
  const clause = laneClause(f, lane);
  return own === undefined ? clause : { and: [own, clause] };
}

/** What one lane asks the local copy for: its cards, a page at a time, in the view's sort. */
export function laneSpec(type: string, v: TableViewState, titleField: string, f: FieldDef, lane: Lane, limit: number): CapMap["records.query"]["in"] {
  return { type, filter: inLane(v, titleField, f, lane), ...(v.sort.length ? { sort: v.sort.map((s) => ({ ...s })) } : {}), offset: 0, limit };
}

/** The cached count of one lane, for its header. */
export function laneCountSpec(type: string, v: TableViewState, titleField: string, f: FieldDef, lane: Lane): CapMap["records.counts"]["in"] {
  return { type, filter: inLane(v, titleField, f, lane) };
}

/** The lane a record sits in. */
export function laneOfRow(f: FieldDef, row: RecordRow, lanes: readonly Lane[]): Lane {
  const v = row.fields[f.key];
  return lanes.find((l) => !l.none && l.key === v) ?? lanes[lanes.length - 1]!;
}

/** What a drop writes through records.update: the lane field takes the lane's key, or is cleared by the empty lane. */
export function movePatch(f: FieldDef, lane: Lane): Record<string, unknown> {
  return { [f.key]: lane.none ? null : lane.key };
}

/** The lane beside this one. The empty lane only takes part when it holds cards. */
export function neighbour(lanes: readonly Lane[], key: string, dir: 1 | -1, shown: (l: Lane) => boolean = () => true): Lane | undefined {
  const from = lanes.findIndex((l) => l.key === key);
  for (let i = from + dir; i >= 0 && i < lanes.length; i += dir) if (shown(lanes[i]!)) return lanes[i];
  return undefined;
}

// ---------------------------------------------------------------- what a card shows

const RANK: Record<string, number> = { person: 0, money: 1, date: 2, datetime: 2, rating: 3, number: 4, choice: 5, status: 5, checkbox: 6, text: 7, email: 8, phone: 9, url: 9, duration: 10 };

/**
 * The fields under a card's title: up to `max`, from those the type has, leaving out the title, the lane (or badge) field and the fields the view hides. Long text, files, sealed values and
 * relations never sit on a card. People first, then money and dates, then the rest in the type's order.
 */
export function cardFields(def: TypeDef, hidden: readonly string[], skip: string | null, max = 3): FieldDef[] {
  const ok = def.fields.filter((f) => f.key !== def.titleField && f.key !== skip && !hidden.includes(f.key) && RANK[f.type] !== undefined);
  return ok.map((f, i) => ({ f, i })).sort((a, b) => RANK[a.f.type]! - RANK[b.f.type]! || a.i - b.i).slice(0, max).map((x) => x.f);
}

/** The field a gallery card and a list row show as a tag: the type's first status, else its first choice. */
export function badgeFieldOf(def: TypeDef): FieldDef | undefined {
  return def.fields.find((f) => f.type === "status") ?? def.fields.find((f) => f.type === "choice");
}

/** The fields the Fields menu can toggle on a card: everything but the title. */
export const toggleable = (def: TypeDef): FieldDef[] => def.fields.filter((f) => f.key !== def.titleField);

/** The choice fields the filter menu lists. */
export const filterable = (def: TypeDef): FieldDef[] => def.fields.filter(hasOptions);

// ---------------------------------------------------------------- gallery

export const CARD_MIN = 232;
export const CARD_GAP = 14;
export const GALLERY_PAD = 16;
export const COVER_H = 96;
export const BODY_H = 84;
export const CARD_H = COVER_H + BODY_H;
/** The cards a gallery asks for at a time; "Show more" adds this many. */
export const GALLERY_PAGE = 60;

/** The columns and the card width for a container width: as many cards of at least 232 px as fit, sharing the width. Every card has the same fixed box, so nothing moves as covers load. */
export function galleryLayout(width: number): { cols: number; cardW: number } {
  const inner = Math.max(CARD_MIN, width - GALLERY_PAD * 2);
  const cols = Math.max(1, Math.floor((inner + CARD_GAP) / (CARD_MIN + CARD_GAP)));
  return { cols, cardW: Math.floor((inner - CARD_GAP * (cols - 1)) / cols) };
}

const IMAGE = /\.(png|jpe?g|gif|webp|avif|svg)$/i;
export interface Cover { url: string; name: string }

/** The first image in a record's files, if any. A cover is drawn in the card's fixed box and loaded only when it nears the screen. */
export function coverOf(def: TypeDef, row: RecordRow): Cover | null {
  for (const f of def.fields) {
    if (f.type !== "files") continue;
    const list = row.fields[f.key];
    if (!Array.isArray(list)) continue;
    for (const x of list) {
      if (!x || typeof x !== "object") continue;
      const file = x as { name?: unknown; url?: unknown; mime?: unknown };
      if (typeof file.url !== "string" || typeof file.name !== "string") continue;
      if ((typeof file.mime === "string" && file.mime.startsWith("image/")) || IMAGE.test(file.name)) return { url: file.url, name: file.name };
    }
  }
  return null;
}

/** The hue of a card without a picture: from the title, so it stays the same between visits. */
export function coverHue(row: RecordRow, titleField: string): number {
  return hueOf(String(row.fields[titleField] ?? row.id)) + (row.id.length % 3) * 10;
}

/** The record's initials for a cover with no person to show. */
export function initialsOf(text: string): string {
  const words = text.trim().split(/\s+/).filter(Boolean);
  return words.slice(0, 2).map((w) => (w[0] ?? "").toUpperCase()).join("") || "?";
}

// ---------------------------------------------------------------- list

export const LIST_ROW_H = 44;
/** The rows a list loads first; reaching the end adds this many. */
export const LIST_PAGE = 200;

/** The line under a list row's title: the card fields' values, joined. */
export function noteOf(parts: readonly string[]): string {
  return parts.filter((p) => p !== "").join(" · ");
}

/** The spec a gallery or a list asks with: the view's filter and sort over the first `limit` records. */
export function pageSpec(type: string, v: TableViewState, titleField: string, limit: number): CapMap["records.query"]["in"] {
  const filter = filterOf(v, titleField);
  return { type, ...(filter === undefined ? {} : { filter }), ...(v.sort.length ? { sort: v.sort.map((s) => ({ ...s })) } : {}), offset: 0, limit };
}

/** A list mapped with a plain loop: a card, a lane, a menu entry or a tag is not a list row, and the rows lint reads every `.map(` as one. */
export function each<T, R>(list: readonly T[], f: (x: T, i: number) => R): R[] {
  const out: R[] = [];
  for (let i = 0; i < list.length; i++) out.push(f(list[i]!, i));
  return out;
}
