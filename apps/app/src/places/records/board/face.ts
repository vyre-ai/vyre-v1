// A card's face, pure: which of its fields are the owner (a face), the amount (the big figure) and the rest (small values), what the card says about time, and the height each preset keeps.
import type { CardPreset, FieldDef, RecordRow } from "../views-a/model.ts";
import { daysIn, daysLate, isLate, numberOf } from "./stats.ts";

export interface Split {
  owner: FieldDef | undefined;
  amount: FieldDef | undefined;
  rest: FieldDef[];
}

/** The card's fields sorted by job: the first person is the owner, the first money (else number) the amount, the others small values in order. */
export function splitFace(shown: readonly FieldDef[]): Split {
  const owner = shown.find((f) => f.type === "person");
  const amount = shown.find((f) => f.type === "money") ?? shown.find((f) => f.type === "number");
  return { owner, amount, rest: shown.filter((f) => f !== owner && f !== amount) };
}

/** What a card says about its time in the stage. */
export interface Age {
  /** "Day 3", or "2 d late" past the limit. */
  text: string;
  late: boolean;
}
export function ageOf(enteredAt: number | undefined, now: number, limitHours: number | undefined): Age | null {
  if (enteredAt === undefined) return null;
  if (isLate(enteredAt, now, limitHours)) return { text: `${daysLate(enteredAt, now, limitHours)} d late`, late: true };
  return { text: `Day ${daysIn(enteredAt, now)}`, late: false };
}

/** The line a card shows when its next stage needs something it does not have yet, or null. */
export function needLine(titles: readonly string[], nextTitle: string | undefined): string | null {
  if (titles.length === 0 || !nextTitle) return null;
  return `Needs ${titles.length === 1 ? titles[0]!.toLowerCase() : `${titles.length} fields`} before ${nextTitle}`;
}

/** The slot a card takes in a long lane that is drawn by window (every card the same height). */
export const SLOT: Record<CardPreset, number> = { simple: 76, detail: 124, visual: 176 };
/** A lane with more cards than this is drawn by window. */
export const BIG_LANE = 120;

/** The number of a stage move's cards for a toast: "Harbor Co" or "3 customers". */
export function cardsWords(titles: readonly string[], plural: string): string {
  return titles.length === 1 ? titles[0]! : `${titles.length} ${plural.toLowerCase()}`;
}

/** The value of a record's amount as a number, or null. */
export function amountOf(row: RecordRow, f: FieldDef | undefined): number | null {
  return f ? numberOf(row.fields[f.key]) : null;
}

/** A column's total in few characters: $850, $74k, $1.2M. */
export function totalText(total: number, symbol = "$"): string {
  const abs = Math.abs(total);
  const trim = (n: number): string => String(Math.round(n * 10) / 10);
  if (abs >= 1_000_000) return `${symbol}${trim(total / 1_000_000)}M`;
  if (abs >= 1_000) return `${symbol}${trim(total / 1_000)}k`;
  return `${symbol}${Math.round(total)}`;
}

/** The symbol a money value shows: its currency's, a dollar when it has none. */
export function symbolOf(v: unknown): string {
  const c = v && typeof v === "object" ? (v as { currency?: unknown }).currency : undefined;
  if (c === "EUR") return "€";
  if (c === "GBP") return "£";
  return typeof c === "string" && c !== "USD" ? `${c} ` : "$";
}
