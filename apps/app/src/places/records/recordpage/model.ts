// Record page: the pure part. The sections a type's page is laid out in (the admin's layout, with each person's own folds and kept fields on top), which fields show, the completeness ring, what a typed
// value becomes when it is saved (and what a value that cannot be saved says), `[[` links in text, relation cards and their peek, the rings of a relationship map, and the right pane's tabs.
// No React and no clock; every rule here is tested without a renderer.
import type { CapMap } from "../../../../../../generated/types.ts";
import { cellText, dateText, hueOf, moneyText, optionsOf } from "../table/model.ts";
import type { FieldDef, RecordRow, TypeDef } from "../table/model.ts";

export type { FieldDef, RecordRow, TypeDef };
export type Layout = CapMap["schema.layout.get"]["out"];
export type Prefs = CapMap["records.page_prefs.get"]["out"];
export type Completeness = CapMap["records.completeness"]["out"];
export type RelMap = CapMap["records.relations_map"]["out"];
export type RelNode = RelMap["nodes"][number];
export type Entry = CapMap["records.history"]["out"]["entries"][number];
export type Source = CapMap["records.value_source"]["out"]["source"];
export type Version = CapMap["records.versions"]["out"]["versions"][number];
export type Fact = CapMap["memory.find_by_subject"]["out"]["facts"][number];

// ---------------------------------------------------------------- sections

export interface Section { key: string; title: string; fields: FieldDef[]; folded: boolean }

const PLAIN_SKIP = new Set(["relation", "files", "longtext", "button", "lookup", "rollup"]);

/**
 * The sections of a page. The type's layout names them; with none, the fields fall into Details (the short ones), Notes (the long text) and Related (the relations), the title and the summary left out because the
 * page's heading and the line under it are them. A field the layout does not name goes into the last section. Folds come from the person's page prefs, and from the layout when the person has none.
 */
export function sectionsOf(def: TypeDef, layout: Layout | undefined, prefs: Prefs | undefined): Section[] {
  const by = new Map(def.fields.map((f) => [f.key, f]));
  const out: Section[] = [];
  const used = new Set<string>(def.summaryField ? [def.titleField, def.summaryField] : [def.titleField]);
  const folded = (key: string, own: boolean | undefined): boolean => (prefs && prefs.folded.length > 0 ? prefs.folded.includes(key) : own === true);
  if (layout && layout.sections.length > 0) {
    for (const s of layout.sections) {
      const fields = s.fields.map((k) => by.get(k)).filter((f): f is FieldDef => f !== undefined && !used.has(f.key));
      for (const f of fields) used.add(f.key);
      out.push({ key: s.key, title: s.title, fields, folded: folded(s.key, s.folded) });
    }
    const rest = def.fields.filter((f) => !used.has(f.key));
    if (rest.length > 0) {
      const last = out[out.length - 1];
      if (last) last.fields.push(...rest); else out.push({ key: "details", title: "Details", fields: rest, folded: folded("details", false) });
    }
    return out.filter((s) => s.fields.length > 0);
  }
  const body = def.fields.filter((f) => f.key !== def.titleField && f.key !== def.summaryField);
  const groups: [string, string, FieldDef[]][] = [
    ["details", "Details", body.filter((f) => !PLAIN_SKIP.has(f.type))],
    ["notes", "Notes", body.filter((f) => f.type === "longtext")],
    ["related", "Related", body.filter((f) => f.type === "relation")],
  ];
  for (const [key, title, fields] of groups) if (fields.length > 0) out.push({ key, title, fields, folded: folded(key, false) });
  return out;
}

export const isEmpty = (v: unknown): boolean => v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);

export interface Shown { fields: FieldDef[]; hidden: number }

/** The fields of a section to draw: those with a value, those the person keeps visible, those that are required; the rest wait behind "Show N empty fields" unless `all` is on. */
export function shownFields(s: Section, row: RecordRow, keep: readonly string[], all: boolean): Shown {
  if (all) return { fields: s.fields, hidden: 0 };
  const fields = s.fields.filter((f) => !isEmpty(row.fields[f.key]) || keep.includes(f.key) || f.required === true);
  return { fields, hidden: s.fields.length - fields.length };
}

/** Folds or unfolds one section for the person: the folded list the prefs hold. */
export function toggleFold(folded: readonly string[], key: string): string[] {
  return folded.includes(key) ? folded.filter((k) => k !== key) : [...folded, key];
}

// ---------------------------------------------------------------- completeness

export const RING_R = 9;
export const RING_C = 2 * Math.PI * RING_R;

export interface Ring { fraction: number; dash: string; label: string; complete: boolean }

/** The ring: how much of it is drawn and the words beside it ("8 of 11"). */
export function ringOf(c: Pick<Completeness, "filled" | "total">): Ring {
  const total = Math.max(0, c.total), filled = Math.max(0, Math.min(c.filled, total));
  const fraction = total === 0 ? 1 : filled / total;
  return { fraction, dash: `${(fraction * RING_C).toFixed(2)} ${RING_C.toFixed(2)}`, label: total === 0 ? "Nothing to fill" : `${filled} of ${total}`, complete: total === 0 || filled === total };
}

/** What "Ask for these" asks: the titles of the fields still empty, as a sentence. */
export function askText(c: Completeness, title: string): string {
  if (c.missing.length === 0) return "";
  const names = c.missing.map((m) => m.title.toLowerCase());
  const list = names.length === 1 ? names[0]! : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return `What is ${list} for ${title}?`;
}

// ---------------------------------------------------------------- editing in place

export type EditKind = "text" | "longtext" | "number" | "money" | "date" | "choice" | "checkbox" | "rating" | "none";

/** How a field is edited on the page. Sealed values, files, relations, formulas and the like are changed by their own controls or not at all. */
export function editKind(f: FieldDef): EditKind {
  switch (f.type) {
    case "text": case "email": case "phone": case "url": return "text";
    case "longtext": return "longtext";
    case "number": case "duration": case "autonumber": return f.type === "autonumber" ? "none" : "number";
    case "money": return "money";
    case "date": case "datetime": return "date";
    case "choice": case "status": return "choice";
    case "checkbox": return "checkbox";
    case "rating": return "rating";
    default: return "none";
  }
}

export type Parsed = { ok: true; value: unknown } | { ok: false; message: string };

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

/** What typed text becomes. Empty clears (unless the field is required). A bad value says what is wrong and nothing is written. */
export function parseInput(f: FieldDef, text: string, current?: unknown): Parsed {
  const t = text.trim();
  if (t === "") return f.required === true ? { ok: false, message: `${f.title} is required.` } : { ok: true, value: null };
  switch (editKind(f)) {
    case "number": {
      const n = Number(t.replace(/,/g, ""));
      return Number.isFinite(n) ? { ok: true, value: n } : { ok: false, message: `${f.title} takes a number.` };
    }
    case "money": {
      const n = Number(t.replace(/[$,\s]/g, ""));
      const cur = current && typeof current === "object" && typeof (current as { currency?: unknown }).currency === "string" ? (current as { currency: string }).currency : "USD";
      return Number.isFinite(n) ? { ok: true, value: { amount: n, currency: cur } } : { ok: false, message: `${f.title} takes an amount.` };
    }
    case "date": {
      const m = ISO.exec(t);
      if (!m) return { ok: false, message: `${f.title} takes a date like 2025-10-24.` };
      const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
      return Number.isNaN(ms) || new Date(ms).getUTCDate() !== Number(m[3]) ? { ok: false, message: `${f.title} is not a day on the calendar.` } : { ok: true, value: ms };
    }
    case "rating": {
      const n = Math.round(Number(t));
      return n >= 0 && n <= 5 ? { ok: true, value: n } : { ok: false, message: `${f.title} is from 0 to 5.` };
    }
    default: return { ok: true, value: t };
  }
}

/** The text an editor opens with: the value as it would be typed. */
export function inputText(f: FieldDef, v: unknown): string {
  if (isEmpty(v)) return "";
  switch (editKind(f)) {
    case "date": return typeof v === "number" ? new Date(v).toISOString().slice(0, 10) : String(v).slice(0, 10);
    case "money": return v && typeof v === "object" && typeof (v as { amount?: unknown }).amount === "number" ? String((v as { amount: number }).amount) : String(v);
    default: return typeof v === "object" ? JSON.stringify(v) : String(v);
  }
}

export const sameValue = (a: unknown, b: unknown): boolean => (isEmpty(a) && isEmpty(b)) || JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

export interface Undo { field: string; was: unknown }

/** What saving one field writes, or null when nothing changed (so a blur without a change writes nothing). */
export function patchFor(f: FieldDef, next: unknown, row: RecordRow): { patch: Record<string, unknown>; undo: Undo } | null {
  const was = row.fields[f.key];
  return sameValue(was, next) ? null : { patch: { [f.key]: next }, undo: { field: f.key, was: was ?? null } };
}

/** The text of a value for display on the page. */
export function valueText(f: FieldDef, v: unknown, names: (id: string) => string): string {
  if (f.type === "money") return moneyText(v);
  if (f.type === "date" || f.type === "datetime") return dateText(v, f.type === "datetime");
  return cellText(f, v, names);
}

// ---------------------------------------------------------------- links in text

export type Piece = { text: string } | { link: string };

/** Text with `[[Title]]` links cut into pieces: plain text and the titles the links name. An open bracket with no close stays text. */
export function splitLinks(text: string): Piece[] {
  const out: Piece[] = [];
  const re = /\[\[([^\[\]\n]{1,120})\]\]/g;
  let at = 0;
  for (const m of text.matchAll(re)) {
    const i = m.index ?? 0;
    if (i > at) out.push({ text: text.slice(at, i) });
    out.push({ link: m[1]!.trim() });
    at = i + m[0].length;
  }
  if (at < text.length) out.push({ text: text.slice(at) });
  return out;
}

/** The record a link title names: an exact title among the records near this one (case aside), else the only title that starts with it. */
export function resolveLink(title: string, nodes: readonly RelNode[]): RelNode | null {
  const t = title.trim().toLowerCase();
  const exact = nodes.filter((n) => n.title.toLowerCase() === t);
  if (exact.length > 0) return exact[0]!;
  const near = nodes.filter((n) => n.title.toLowerCase().startsWith(t));
  return near.length === 1 ? near[0]! : null;
}

// ---------------------------------------------------------------- relations

/** The target type of a relation field (the sample and the schema name it in the field's options). */
export const relationTarget = (f: FieldDef): string | null => { const t = f.options?.["to"]; return typeof t === "string" ? t : null; };

/** The record ids a relation holds. */
export function relationIds(f: FieldDef, row: RecordRow): string[] {
  const v = row.fields[f.key];
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

/** The fields a peek shows of a linked record: its summary, then the first few filled fields that are not relations. */
export function peekFields(def: TypeDef, row: RecordRow, max = 4): FieldDef[] {
  const first = def.summaryField ? def.fields.find((f) => f.key === def.summaryField) : undefined;
  const rest = def.fields.filter((f) => f.key !== def.titleField && f.key !== first?.key && !PLAIN_SKIP.has(f.type) && !isEmpty(row.fields[f.key]));
  return [...(first && !isEmpty(row.fields[first.key]) ? [first] : []), ...rest].slice(0, max);
}

// ---------------------------------------------------------------- the relationship map

export const MAP_W = 360;
export const MAP_H = 260;

export interface MapNode extends RelNode { x: number; y: number }

/** The records two hops around this one: it in the middle, its neighbours on a ring, theirs on an outer ring, each ring spread evenly by the order the server gave. */
export function mapLayout(nodes: readonly RelNode[], w = MAP_W, h = MAP_H): MapNode[] {
  const out: MapNode[] = [];
  const cx = w / 2, cy = h / 2;
  for (const hop of [0, 1, 2]) {
    const ring = nodes.filter((n) => n.hop === hop);
    ring.forEach((n, i) => {
      if (hop === 0) { out.push({ ...n, x: cx, y: cy }); return; }
      const rx = hop === 1 ? w * 0.27 : w * 0.45, ry = hop === 1 ? h * 0.28 : h * 0.46;
      const a = (i / ring.length) * Math.PI * 2 - Math.PI / 2 + (hop === 2 ? Math.PI / ring.length : 0);
      out.push({ ...n, x: Math.round(cx + Math.cos(a) * rx), y: Math.round(cy + Math.sin(a) * ry) });
    });
  }
  return out;
}

export { hueOf, optionsOf };

// ---------------------------------------------------------------- the right pane

export type PaneKey = "activity" | "comments" | "chat" | "files" | "memory" | "history";
export const PANE_TABS: readonly { key: PaneKey; title: string }[] = [
  { key: "activity", title: "Activity" }, { key: "comments", title: "Comments" }, { key: "chat", title: "Chat" }, { key: "files", title: "Files" }, { key: "memory", title: "Memory" }, { key: "history", title: "History" },
];

const AGO: readonly (readonly [number, string])[] = [[86_400_000, "d"], [3_600_000, "h"], [60_000, "min"]];
export function ago(at: number, now: number): string {
  const d = Math.max(0, now - at);
  for (const [ms, u] of AGO) if (d >= ms) return `${Math.floor(d / ms)} ${u} ago`;
  return "Just now";
}

/** One line of the Activity tab for a history entry: who changed which field to what. */
export function activityLine(e: Entry, def: TypeDef, names: (id: string) => string): string {
  const f = def.fields.find((x) => x.key === e.field);
  const to = f ? valueText(f, e.value, names) : String(e.value ?? "");
  return `${names(e.actor)} set ${(f?.title ?? e.field).toLowerCase()}${to ? ` to ${to}` : " to empty"}`;
}

/** The versions as the shared History tab wants them: newest has the highest number. */
export function historyVersions(vs: readonly Version[], names: (id: string) => string): { id: string; n: number; who: string; why: string; at: string; runId: string | null; undoable: boolean }[] {
  return vs.map((v, i) => ({ id: v.versionId, n: v.n, who: names(v.by), why: v.reason ?? v.name ?? "", at: new Date(v.at).toISOString(), runId: null, undoable: i === vs.length - 1 }));
}

/** The sentence for where a value came from, for its source popover. */
export function sourceText(s: Source): string {
  const how = s.kind === "agent" ? "an agent" : s.kind === "form" ? "a form" : s.kind === "automation" ? "an automation" : s.kind === "sync" ? "a sync" : s.kind === "import" ? "an import" : "a person";
  const state = s.state === "needs_review" ? " Waiting for review." : s.state === "rejected" ? " Rejected." : "";
  return `From ${how}: ${s.actor}.${state}`;
}

export function each<T, R>(list: readonly T[], f: (x: T, i: number) => R): R[] {
  const out: R[] = [];
  for (let i = 0; i < list.length; i++) out.push(f(list[i]!, i));
  return out;
}
