import type { CapMap } from "../../../../../generated/types.ts";

/** A decimal input is dollars; the engine stores integer millionths of a dollar. */
export function amountInMicros(raw: string): number | undefined {
  const value = raw.trim();
  if (!value) return undefined;
  if (!/^\d+(?:\.\d{1,6})?$/.test(value))
    throw new Error("Enter a non-negative dollar amount with at most six decimal places.");
  const [whole = "0", fraction = ""] = value.split(".");
  const micros = BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, "0"));
  if (micros > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("This amount is too large.");
  return Number(micros);
}

const count = (raw: string): number | undefined => {
  const value = raw.trim();
  if (!value) return undefined;
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)))
    throw new Error("Enter a whole non-negative number.");
  return Number(value);
};

export function limitDraft(input: {
  run: string;
  day: string;
  month: string;
  turns: string;
  time: string;
}): CapMap["engine.spend.caps.set"]["in"]["caps"] {
  const values = {
    run: amountInMicros(input.run),
    dayMicros: amountInMicros(input.day),
    monthMicros: amountInMicros(input.month),
    turnsPerDay: count(input.turns),
    timeMinutesPerRun: count(input.time),
  };
  return Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined));
}

type Limit = CapMap["engine.spend.raise"]["in"]["limit"];
export function raiseAmount(limit: Limit, raw: string): number | undefined {
  if (limit === "run" || limit === "day" || limit === "month") return amountInMicros(raw);
  const value = count(raw);
  if (value === 0) throw new Error("The raise must be more than zero.");
  return value;
}

export function capsMatch(
  left: CapMap["engine.spend.caps.set"]["in"]["caps"],
  right: CapMap["engine.spend.caps.set"]["in"]["caps"],
): boolean {
  return (["run", "dayMicros", "monthMicros", "turnsPerDay", "timeMinutesPerRun"] as const).every(
    (key) => left[key] === right[key],
  );
}

export function retentionValue(raw: string): string {
  const value = raw.trim();
  if (!/^(?:forever|per_policy|[0-9]+[dwmy])$/.test(value))
    throw new Error("Use a whole duration such as 30d, 12w, 2m or 1y, or choose forever or per policy.");
  return value;
}

const UNIT: Readonly<Record<string, readonly [string, string]>> = {
  d: ["day", "days"],
  w: ["week", "weeks"],
  m: ["month", "months"],
  y: ["year", "years"],
};
const span = (t: string): string | null => {
  const m = /^(\d+)([dwmy])$/.exec(t);
  if (!m) return null;
  const n = Number(m[1]);
  const u = UNIT[m[2]!]!;
  return `${n} ${n === 1 ? u[0] : u[1]}`;
};

/** A keep rule in words (owner walk, 12 Nov: Keep and delete showed "per_policy" and "30d+daily90d+monthly"): "Forever", "30 days", "By its own schedule", "All for 30 days, then daily for 90 days, then monthly". */
export function retentionWords(raw: string): string {
  const value = raw.trim();
  if (value === "forever") return "Forever";
  if (value === "per_policy") return "By its own schedule";
  const parts = value.split("+").map((t, i) => {
    const plain = span(t);
    if (plain) return i === 0 ? (value.includes("+") ? `all for ${plain}` : plain) : `then all for ${plain}`;
    const m = /^(daily|weekly|monthly|yearly)(\d+[dwmy])?$/.exec(t);
    if (m) return `${i === 0 ? "" : "then "}${m[1]}${m[2] ? ` for ${span(m[2])}` : ""}`;
    return null;
  });
  if (parts.some((p) => p === null) || parts.length === 0) return "A custom rule";
  const out = parts.join(", ");
  return out.charAt(0).toUpperCase() + out.slice(1);
}

export function policySelection(mode: "all" | "selected", values: readonly string[]): string[] {
  if (mode === "all") return [];
  const unique = [...new Set(values)];
  if (unique.length === 0) throw new Error("Choose at least one item, or allow all.");
  return unique;
}

export function policyMode(values: readonly string[], draft: "all" | "selected" | null): "all" | "selected" {
  return draft ?? (values.length === 0 ? "all" : "selected");
}

const sameSelection = (left: readonly string[], right: readonly string[]): boolean => {
  const a = [...new Set(left)].sort();
  const b = [...new Set(right)].sort();
  return a.length === b.length && a.every((value, index) => value === b[index]);
};

export function policyMatches(
  actual: CapMap["engine.policy.get"]["out"],
  expected: CapMap["engine.policy.set"]["in"],
): boolean {
  if (actual.allowedAccounts !== expected.allowedAccounts) return false;
  if (!sameSelection(actual.allowedProviders, expected.allowedProviders ?? [])) return false;
  if (!sameSelection(actual.allowedModels, expected.allowedModels ?? [])) return false;
  const labels = new Set([...Object.keys(actual.labelProviders), ...Object.keys(expected.labelProviders ?? {})]);
  return [...labels].every((label) => {
    const actualRule = actual.labelProviders[label];
    const expectedRule = expected.labelProviders?.[label];
    return (
      (actualRule === undefined && expectedRule === undefined) ||
      (actualRule !== undefined && expectedRule !== undefined && sameSelection(actualRule, expectedRule))
    );
  });
}

const LABELS = new Set(["public", "internal", "confidential", "restricted"]);
export function reviewSampling(value: unknown): { percent: number; labels: string[] } {
  if (!value || typeof value !== "object") throw new Error("Review sampling is not configured correctly.");
  const input = value as { percent?: unknown; labels?: unknown };
  if (!Number.isInteger(input.percent) || (input.percent as number) < 0 || (input.percent as number) > 100)
    throw new Error("Sampling percent must be a whole number from 0 to 100.");
  if (!Array.isArray(input.labels) || input.labels.some((label) => typeof label !== "string" || !LABELS.has(label)))
    throw new Error("Sampling labels must use the Space sensitivity labels.");
  return { percent: input.percent as number, labels: [...new Set(input.labels as string[])] };
}

export const dollarInput = (micros: number | undefined): string =>
  micros === undefined ? "" : String(micros / 1_000_000);
export const dollars = (micros: number): string =>
  new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 4 }).format(
    micros / 1_000_000,
  );
