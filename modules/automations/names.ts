// The names a definition holds only as keys, said as people named them: a record type's title, a field's label, the title of a choice or a stage. Read once per call from the Space's record types
// (schema.describe, which answers for what the caller may read); a Space whose types cannot be read still gets its words: keys are said plainly.
import { registry } from "../../generated/registry.ts";
import type { SentenceNames } from "../../lib/flow-sentence.ts";
import type { AutoCtx } from "./projections.ts";

const STEP_TITLES = new Map(registry.steps.map((s) => [s.key, s.title] as const));
export const cap = (s: string): string => (s === "" ? s : s[0]!.toUpperCase() + s.slice(1));
export const words = (key: string): string => key.replace(/[_\-.]+/g, " ").trim().toLowerCase();

interface FieldLite {
  key: string;
  title?: string;
  type?: string;
  options?: Record<string, unknown>;
}
interface TypeLite {
  key: string;
  title?: string;
  plural?: string;
  titleField?: string;
  fields?: FieldLite[];
}
export interface Names extends SentenceNames {
  types: Map<string, TypeLite>;
  plural(key: string): string;
}

/** The record types of the Space as the caller may read them, once per call. A Space whose types cannot be read still gets its sentences: keys are said as words. */
export async function namesFor(ctx: Pick<AutoCtx, "call">): Promise<Names> {
  const types = new Map<string, TypeLite>();
  if (ctx.call) {
    try {
      const d = (await ctx.call("schema.describe", {})) as { types?: TypeLite[] } | null;
      for (const t of d?.types ?? []) if (typeof t?.key === "string") types.set(t.key, t);
    } catch {
      /* the keys are said as words */
    }
  }
  const field = (type: string | undefined, key: string): FieldLite | undefined =>
    type ? types.get(type)?.fields?.find((f) => f.key === key) : undefined;
  return {
    types,
    type: (key) => types.get(key)?.title,
    plural: (key) => types.get(key)?.plural ?? `${words(key)}s`,
    field: (type, key) => field(type, key)?.title,
    value: (type, key, v) => {
      const f = field(type, key);
      const list = f?.type === "status" ? f.options?.["stages"] : f?.options?.["choices"];
      if (!Array.isArray(list) || typeof v !== "string") return undefined;
      const hit = (list as { key?: unknown; title?: unknown }[]).find((c) => c.key === v);
      return typeof hit?.title === "string" ? hit.title : undefined;
    },
    stepTitle: (key) => STEP_TITLES.get(key),
  };
}

export const typeWord = (names: Names, key: unknown): string =>
  typeof key === "string" && key !== "" ? (names.type?.(key) ?? words(key)).toLowerCase() : "record";
export const fieldWord = (names: Names, type: unknown, key: string): string =>
  names.field?.(typeof type === "string" ? type : undefined, key) ?? cap(words(key));
export function valueWord(names: Names, type: unknown, field: string, v: unknown): string {
  const said = names.value?.(typeof type === "string" ? type : undefined, field, v);
  if (said) return said;
  if (v === undefined || v === null || v === "") return "empty";
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (typeof v === "number") return String(v);
  if (typeof v !== "string") return "something else";
  if (/^[a-z]{2,5}_[0-9a-z]{6,}$/i.test(v)) return "something else"; // an id is never shown
  // a stored key ("not_hired") is said as words; what a person typed is kept as they typed it
  return /^[a-z0-9_]+$/.test(v) ? cap(words(v)) : v.length > 40 ? `${v.slice(0, 37).trimEnd()}…` : v;
}
