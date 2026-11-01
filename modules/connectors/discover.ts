// Read what an unknown JSON answer looks like, so an agent can fill a SyncSpec from a real page instead of guessing from docs: where the lists are, what one item holds,
// what the next-page hints and the total look like. Pure: it takes a parsed body and returns shapes. Values in the examples are shortened and are the person's own data.
import { pointerGet } from "./projections.ts";
import type { SpecFieldType } from "./syncspec.ts";

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const ID_GUESS = ["/id", "/_id", "/uid", "/uuid", "/key", "/ID", "/Id", "/gid", "/guid", "/pk"];
const ID_NAME = /^(.*_)?(id|uid|uuid|guid)$/i;
const CURSOR_NAME = /(next|cursor|after|token|start_?after|page_?token)/i;
const TOTAL_NAME = /^(total|total_?count|count|total_?records|total_?items|total_?results|records_?total|matches?)$/i;
const MAX_DEPTH = 3;

export interface FieldShape { path: string; type: SpecFieldType; seen: number; example?: string }
export interface ListShape { itemsAt: string; count: number; idAt?: string; updatedAtGuess?: string; fields: FieldShape[] }
export interface BodyShape {
  kind: "object" | "array" | "empty" | "text";
  lists: ListShape[];
  /** Scalars that look like a next-page cursor, with the pointer they sit at. */
  cursors: { pointer: string; value: string }[];
  /** Numbers that look like a total record count. */
  totals: { pointer: string; value: number }[];
  /** An object of named things rather than a list (for a field-metadata answer keyed by name). */
  keys?: string[];
}

export function guessType(v: unknown): SpecFieldType {
  if (typeof v === "boolean") return "bool";
  if (typeof v === "number") return "number";
  if (Array.isArray(v)) return v.every((x) => typeof x === "string") ? "multi" : "json";
  if (isObj(v)) return "json";
  if (typeof v === "string") {
    if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) return "email";
    if (/^https?:\/\//.test(v)) return "url";
    if (/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/.test(v)) return "date";
    if (/^\+?[\d\s().-]{7,20}$/.test(v) && /\d{7,}/.test(v.replace(/\D/g, ""))) return "phone";
  }
  return "text";
}

const short = (v: unknown): string => {
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return s.length > 40 ? `${s.slice(0, 37)}...` : s;
};

function flat(item: unknown, prefix: string, depth: number, out: Map<string, { type: SpecFieldType; seen: number; example?: string }>): void {
  if (!isObj(item)) return;
  for (const [k, v] of Object.entries(item)) {
    const path = `${prefix}/${k.replaceAll("~", "~0").replaceAll("/", "~1")}`;
    if (isObj(v) && depth < MAX_DEPTH && Object.keys(v).length > 0) { flat(v, path, depth + 1, out); continue; }
    const cur = out.get(path);
    if (v === null || v === undefined) { if (!cur) out.set(path, { type: "text", seen: 0 }); continue; }
    if (!cur || cur.seen === 0) out.set(path, { type: guessType(v), seen: 1, example: short(v) });
    else cur.seen++;
  }
}

function listShape(itemsAt: string, items: unknown[]): ListShape {
  const merged = new Map<string, { type: SpecFieldType; seen: number; example?: string }>();
  for (const it of items.slice(0, 8)) flat(it, "", 1, merged);
  const sample = items.slice(0, 8);
  const scalar = (p: string): boolean => sample.every((it) => { const v = pointerGet(it, p); return typeof v === "string" || typeof v === "number"; });
  const unique = (p: string): boolean => new Set(sample.map((it) => String(pointerGet(it, p)))).size === sample.length;
  const idAt = items.length ? (ID_GUESS.find(scalar) ?? [...merged.keys()].find((p) => p.split("/").length === 2 && ID_NAME.test(p.slice(1)) && scalar(p) && unique(p))) : undefined;
  const updated = [...merged.keys()].find((p) => /(updated|modified|changed)_?(at|on|date|time)?$/i.test(p.split("/").pop() ?? "") && merged.get(p)?.type === "date");
  return {
    itemsAt, count: items.length, ...(idAt ? { idAt } : {}), ...(updated ? { updatedAtGuess: updated } : {}),
    fields: [...merged.entries()].map(([path, f]) => ({ path, type: f.type, seen: f.seen, ...(f.example !== undefined ? { example: f.example } : {}) })),
  };
}

export function analyzeBody(body: unknown): BodyShape {
  if (typeof body === "string") return { kind: "text", lists: [], cursors: [], totals: [] };
  if (body === null || body === undefined) return { kind: "empty", lists: [], cursors: [], totals: [] };
  const lists: ListShape[] = [];
  const cursors: BodyShape["cursors"] = [];
  const totals: BodyShape["totals"] = [];
  const walk = (v: unknown, pointer: string, depth: number): void => {
    if (Array.isArray(v)) {
      if (v.length === 0 || v.every(isObj)) lists.push(listShape(pointer === "" ? "/" : pointer, v));
      return;
    }
    if (!isObj(v) || depth > MAX_DEPTH) return;
    for (const [k, x] of Object.entries(v)) {
      const p = `${pointer}/${k.replaceAll("~", "~0").replaceAll("/", "~1")}`;
      if (typeof x === "string" && x !== "" && CURSOR_NAME.test(k)) cursors.push({ pointer: p, value: short(x) });
      else if (typeof x === "number" && TOTAL_NAME.test(k)) totals.push({ pointer: p, value: x });
      else walk(x, p, depth + 1);
    }
  };
  walk(body, "", 0);
  lists.sort((a, b) => b.count - a.count);
  return { kind: Array.isArray(body) ? "array" : "object", lists, cursors, totals, ...(isObj(body) && lists.length === 0 ? { keys: Object.keys(body).slice(0, 40) } : {}) };
}
