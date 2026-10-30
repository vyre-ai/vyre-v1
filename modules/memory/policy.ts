// The Space settings memory reads: whether shared memory waits for review, how long Trash keeps a fact before Archive, the monthly cap on upkeep spend and how meaning search is served.
// A setting that cannot be read leaves its default in charge, so a Space that never opened Settings behaves as the design says.
import type { Layer, MemCtx } from "./projections.ts";

export const TRASH_DAYS_DEFAULT = 60;
export const TRASH_DAYS_MIN = 30;
export const TRASH_DAYS_MAX = 90;
export const UPKEEP_CAP_DEFAULT_MICROS = 5_000_000;

export async function setting<T>(ctx: Pick<MemCtx, "call">, key: string, fallback: T, ok: (v: unknown) => v is T): Promise<T> {
  try {
    const res = (await ctx.call("settings.get", { key })) as { row?: { value?: unknown } };
    const v = res.row?.value;
    if (v !== undefined && ok(v)) return v;
  } catch { /* the default applies */ }
  return fallback;
}

const isBool = (v: unknown): v is boolean => typeof v === "boolean";
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isStrs = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === "string");

/** Days a fact stays in Trash before Archive: the Space setting, held between 30 and 90 (default 60). */
export async function trashDays(ctx: Pick<MemCtx, "call">): Promise<number> {
  const v = await setting(ctx, "memory.trash_days", TRASH_DAYS_DEFAULT, isNum);
  return Math.min(TRASH_DAYS_MAX, Math.max(TRASH_DAYS_MIN, Math.round(v)));
}

/** Monthly cap on model upkeep, in micro-dollars (the setting is in dollars). */
export async function upkeepCapMicros(ctx: Pick<MemCtx, "call">): Promise<number> {
  const usd = await setting(ctx, "memory.upkeep_monthly_cap", UPKEEP_CAP_DEFAULT_MICROS / 1_000_000, isNum);
  return Math.max(0, Math.round(usd * 1_000_000));
}

export type MeaningMode = "local" | "key" | "off";
export async function meaningMode(ctx: Pick<MemCtx, "call">): Promise<MeaningMode> {
  const v = await setting<string>(ctx, "memory.meaning_search", "local", (x): x is string => x === "local" || x === "key" || x === "off");
  return v as MeaningMode;
}

/**
 * "Require review for shared memory": when the Space setting is on, every Space and project fact an agent learns waits in Proposed. A project named in memory.review_projects waits even when the
 * Space setting is off. The agent and personal layers are never held back by it.
 */
export async function reviewRequired(ctx: Pick<MemCtx, "call">, layer: Layer, projectId: string | null): Promise<boolean> {
  if (layer !== "space" && layer !== "project") return false;
  if (await setting(ctx, "memory.require_review", false, isBool)) return true;
  if (layer === "project" && projectId) return (await setting<string[]>(ctx, "memory.review_projects", [], isStrs)).includes(projectId);
  return false;
}
