import type { CapMap } from "../../../../../generated/types.ts";

/** A decimal input is dollars; the engine stores integer millionths of a dollar. */
export function amountInMicros(raw: string): number | undefined {
  const value = raw.trim();
  if (!value) return undefined;
  if (!/^\d+(?:\.\d{1,6})?$/.test(value)) throw new Error("Enter a non-negative dollar amount with at most six decimal places.");
  const [whole = "0", fraction = ""] = value.split(".");
  const micros = BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, "0"));
  if (micros > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("This amount is too large.");
  return Number(micros);
}

const count = (raw: string): number | undefined => {
  const value = raw.trim();
  if (!value) return undefined;
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))) throw new Error("Enter a whole non-negative number.");
  return Number(value);
};

export function limitDraft(input: { run: string; day: string; month: string; turns: string; time: string }): CapMap["engine.spend.caps.set"]["in"]["caps"] {
  const values = { run: amountInMicros(input.run), dayMicros: amountInMicros(input.day), monthMicros: amountInMicros(input.month), turnsPerDay: count(input.turns), timeMinutesPerRun: count(input.time) };
  return Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined));
}

export function policySelection(mode: "all" | "selected", values: readonly string[]): string[] {
  if (mode === "all") return [];
  const unique = [...new Set(values)];
  if (unique.length === 0) throw new Error("Choose at least one item, or allow all.");
  return unique;
}

const LABELS = new Set(["public", "internal", "confidential", "restricted"]);
export function reviewSampling(value: unknown): { percent: number; labels: string[] } {
  if (!value || typeof value !== "object") throw new Error("Review sampling is not configured correctly.");
  const input = value as { percent?: unknown; labels?: unknown };
  if (!Number.isInteger(input.percent) || (input.percent as number) < 0 || (input.percent as number) > 100) throw new Error("Sampling percent must be a whole number from 0 to 100.");
  if (!Array.isArray(input.labels) || input.labels.some((label) => typeof label !== "string" || !LABELS.has(label))) throw new Error("Sampling labels must use the Space sensitivity labels.");
  return { percent: input.percent as number, labels: [...new Set(input.labels as string[])] };
}

export const dollarInput = (micros: number | undefined): string => micros === undefined ? "" : String(micros / 1_000_000);
export const dollars = (micros: number): string => new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 4 }).format(micros / 1_000_000);
