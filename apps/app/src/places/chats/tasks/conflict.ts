// Two people edited one task (tasks.update refused the second save, reason stale_version). The page keeps what the second person wrote, sets it beside what the task holds now, one field at a time,
// and saves only the fields they keep, on the version they just saw. Nothing is dropped until they choose, and what they left out is said once after.
import { dueLabel, PRIORITIES } from "./model.ts";

export type Pick = "mine" | "current";
export interface ClashRow { key: string; label: string; mine: unknown; current: unknown; pick: Pick }
export interface Clash { version: number; by: string | undefined; rows: ClashRow[] }

export const FIELD_LABEL: Record<string, string> = {
  title: "Title", summary: "Summary", why: "Reason", due: "Due", start: "Start", effort: "Estimate", priority: "Priority", labels: "Labels", recur: "Repeat", fields: "Fields", blocks: "Content", parentTaskId: "Parent",
};

const SKIP = new Set(["taskId", "expectedVersion", "idempotencyKey"]);
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** The clash a refused save makes, or null when the refusal is something else. Fields the other person left as the writer wanted them are not in it. */
export function clashFrom(error: unknown, mine: Record<string, unknown>): Clash | null {
  const e = error as { code?: string; details?: Record<string, unknown> } | null;
  const d = e?.details;
  if (e?.code !== "validation.precondition_failed" || !d || d.reason !== "stale_version" || typeof d.version !== "number") return null;
  const current = (d.current && typeof d.current === "object" ? d.current : {}) as Record<string, unknown>;
  const rows: ClashRow[] = [];
  for (const key of Object.keys(mine)) {
    if (SKIP.has(key) || !(key in current) || same(mine[key], current[key])) continue;
    rows.push({ key, label: FIELD_LABEL[key] ?? key, mine: mine[key], current: current[key], pick: "mine" });
  }
  return { version: d.version, by: typeof d.by === "string" ? d.by : undefined, rows };
}

/** A second refused save while the card is open (the person changed another field too) adds its rows to the same card, on the same version. Another version means the task changed again: the new card replaces it. */
export function mergeClash(prev: Clash | null, next: Clash): Clash {
  if (!prev || prev.version !== next.version) return next;
  const rows = prev.rows.map((r) => { const n = next.rows.find((x) => x.key === r.key); return n ? { ...n, pick: r.pick } : r; });
  for (const n of next.rows) if (!rows.some((r) => r.key === n.key)) rows.push(n);
  return { ...next, rows };
}

/** What a field value reads as on screen. */
export function wordsOf(key: string, v: unknown, now: number, offsetMin: number): string {
  if (v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0)) return "Empty";
  if ((key === "due" || key === "start") && typeof v === "number") { const l = dueLabel(v, now, offsetMin); return l.text; }
  if (key === "effort" && typeof v === "number") return v >= 60 && v % 60 === 0 ? `${v / 60} h` : `${v} min`;
  if (key === "priority") return PRIORITIES.find((p) => p.key === v)?.title ?? String(v);
  if (key === "labels" && Array.isArray(v)) return v.map((x) => `#${String(x)}`).join(", ");
  if (key === "blocks") return "Different content";
  if (typeof v === "string") return v;
  return JSON.stringify(v);
}

export const setPick = (c: Clash, key: string, pick: Pick): Clash => ({ ...c, rows: c.rows.map((r) => (r.key === key ? { ...r, pick } : r)) });
export const setAll = (c: Clash, pick: Pick): Clash => ({ ...c, rows: c.rows.map((r) => ({ ...r, pick })) });
/** The fields the person keeps as theirs: what one tasks.update on the version they just saw carries. */
export function keptPatch(c: Clash): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const r of c.rows) if (r.pick === "mine") out[r.key] = r.mine;
  return out;
}
/** After saving: what the person wrote and did not keep, so nothing leaves without being said. */
export function leftOut(c: Clash, now: number, offsetMin: number): string {
  const rows = c.rows.filter((r) => r.pick === "current");
  if (rows.length === 0) return "";
  return `Not kept from you: ${rows.map((r) => `${r.label.toLowerCase()} ${r.key === "title" || r.key === "summary" || r.key === "why" ? `"${wordsOf(r.key, r.mine, now, offsetMin)}"` : wordsOf(r.key, r.mine, now, offsetMin)}`).join(", ")}.`;
}

const LONG = 120;
/** A value too long for a choice card: both sides cut to the part that differs, with a little context, so the card shows what changed. Null when both are short, or not text. */
export function shortDiff(a: unknown, b: unknown): [string, string] | null {
  if (typeof a !== "string" || typeof b !== "string" || (a.length <= LONG && b.length <= LONG)) return null;
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;
  const ctx = 24;
  const cut = (v: string): string => {
    const from = Math.max(0, head - ctx), to = Math.min(v.length, v.length - tail + ctx);
    return `${from > 0 ? "\u2026" : ""}${v.slice(from, to)}${to < v.length ? "\u2026" : ""}`;
  };
  return [cut(a), cut(b)];
}
