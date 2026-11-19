// The Kanban's numbers, pure: what a column header says (count against a WIP limit, the value total, the stage's time limit, how many cards are late, over its limit) and what a card says
// (days in its stage, late or not, the progress of the fields its next stage needs). No React and no clock: the caller passes `now`.
import type { FieldDef, RecordRow } from "../views-a/model.ts";

/** A money or number value as a plain number: a number, or the amount of a money value. */
export function numberOf(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (v && typeof v === "object" && typeof (v as { amount?: unknown }).amount === "number") {
    const a = (v as { amount: number }).amount;
    return Number.isFinite(a) ? a : null;
  }
  return null;
}

export const DAY_MS = 86_400_000;
export const HOUR_MS = 3_600_000;

/** A stage as the board needs it: its key and, when the Journey (or the view) sets them, a time limit in hours and a WIP limit. */
export interface StageInfo {
  key: string;
  title: string;
  /** Hours a card may stay; undefined means no limit. */
  limitHours?: number;
  /** Cards the stage should hold at most; undefined means no limit. */
  wip?: number;
  /** A finish line (won, lost, done): drawn collapsed at the right, not as a column. */
  final?: boolean;
  needToEnter?: readonly string[];
  needToLeave?: readonly string[];
}

/** Whole days a card has been in its stage, never negative. */
export function daysIn(enteredAt: number, now: number): number {
  return Math.max(0, Math.floor((now - enteredAt) / DAY_MS));
}

/** Days past the stage's time limit (0 when on time or no limit). */
export function daysLate(enteredAt: number, now: number, limitHours: number | undefined): number {
  if (limitHours === undefined) return 0;
  const over = now - enteredAt - limitHours * HOUR_MS;
  return over <= 0 ? 0 : Math.max(1, Math.floor(over / DAY_MS));
}

export const isLate = (enteredAt: number, now: number, limitHours: number | undefined): boolean =>
  limitHours !== undefined && now - enteredAt >= limitHours * HOUR_MS;

/** "5 d" for a limit of 120 hours, "12 h" under two days. */
export function limitWords(hours: number): string {
  if (hours >= 48 && hours % 24 === 0) return `${hours / 24} d`;
  if (hours >= 48) return `${Math.round(hours / 24)} d`;
  return `${hours} h`;
}

export interface ColumnStats {
  count: number;
  /** "3 of 5" when a WIP limit is set, else just the count. */
  countText: string;
  overWip: boolean;
  late: number;
  /** The sum of the value field over the cards loaded; `partial` is true when more cards are in the lane than were summed. */
  total: number | null;
  partial: boolean;
}

/** The numbers of one column. `rows` are the cards loaded for it, `count` all the cards in it, `enteredAt` the time each entered (a card with none counts as on time). */
export function columnStats(
  stage: StageInfo,
  rows: readonly RecordRow[],
  count: number,
  value: FieldDef | undefined,
  enteredAt: (r: RecordRow) => number | undefined,
  now: number,
  /** The late count the server knows for the whole column (journeys.stage_counts), when it has one. */
  serverLate?: number,
): ColumnStats {
  let late = 0;
  let total = 0;
  let any = false;
  for (const r of rows) {
    const at = enteredAt(r);
    if (at !== undefined && isLate(at, now, stage.limitHours)) late++;
    if (value) {
      const v = numberOf(r.fields[value.key]);
      if (v !== null) {
        total += v;
        any = true;
      }
    }
  }
  return {
    count,
    countText: stage.wip !== undefined ? `${count} of ${stage.wip}` : String(count),
    overWip: stage.wip !== undefined && count > stage.wip,
    late: serverLate ?? late,
    total: value && any ? total : null,
    partial: rows.length < count,
  };
}

/** The fields a card still has to fill for the stage it would go to next: how many are filled of how many, for the progress ring. null when the next stage asks for nothing. */
export function requiredProgress(
  row: RecordRow,
  need: readonly string[] | undefined,
): { filled: number; of: number; missing: string[] } | null {
  if (!need || need.length === 0) return null;
  const missing = need.filter((k) => {
    const v = row.fields[k];
    return v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);
  });
  return { filled: need.length - missing.length, of: need.length, missing };
}

/** What moving a card from one stage to another is known to need before any call: the fields of the target's `needToEnter` and the source's `needToLeave` that are empty. */
export function fieldsNeeded(
  row: RecordRow,
  from: StageInfo | undefined,
  to: StageInfo | undefined,
): { key: string; stage: string; when: "enter" | "leave" }[] {
  const out: { key: string; stage: string; when: "enter" | "leave" }[] = [];
  const empty = (k: string): boolean => {
    const v = row.fields[k];
    return v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);
  };
  for (const k of from?.needToLeave ?? []) if (empty(k)) out.push({ key: k, stage: from!.key, when: "leave" });
  for (const k of to?.needToEnter ?? []) if (empty(k)) out.push({ key: k, stage: to!.key, when: "enter" });
  return out;
}

/** Cards of a lane grouped for swimlanes: by the value of any field (owner, a choice, a status). The empty value is its own lane, last. */
export function swimKeys(rows: readonly RecordRow[], field: FieldDef): string[] {
  const seen: string[] = [];
  let empty = false;
  for (const r of rows) {
    const v = r.fields[field.key];
    if (v === undefined || v === null || v === "") empty = true;
    else if (!seen.includes(String(v))) seen.push(String(v));
  }
  return empty ? [...seen, ""] : seen;
}

/** The slice of a long lane to draw: rows from `first` to `last` plus an overscan, and the heights above and below to keep the scroll bar honest. */
export function windowOf(
  total: number,
  rowH: number,
  scrollTop: number,
  viewH: number,
  overscan = 6,
): { from: number; to: number; before: number; after: number } {
  const from = Math.max(0, Math.floor(scrollTop / rowH) - overscan);
  const to = Math.min(total, Math.ceil((scrollTop + viewH) / rowH) + overscan);
  return { from, to, before: from * rowH, after: Math.max(0, (total - to) * rowH) };
}
