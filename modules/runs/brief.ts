// Typed briefs and results (r42-runtime slice 3b): a node may be started with what it must hand back, and a result that does not fit is not accepted: it goes back to the worker with the reasons, the node is not done.
//   brief   { goal, instructions?, inputs?: vyre:// references, expects?: { schema?, doneWhen? } }
//   schema  a small subset of JSON Schema, enough for a result a person reads: an object with required keys, and for each key a type (string, number, integer, boolean, array, object), an optional enum, items for an
//           array of one type, and a length cap on a string. Nothing else is checked, and nothing is evaluated.
// DECISION: the check runs when a node is moved to succeeded with a result; a node with no schema accepts any result, as before. A refusal is `result_invalid` with the first problems in plain words.
import type { RunsCtx } from "./projections.ts";
import { clean, raise } from "./projections.ts";

export interface Expects {
  schema?: Schema;
  doneWhen?: string;
}
export interface Schema {
  type?: "object" | "string" | "number" | "integer" | "boolean" | "array";
  required?: string[];
  properties?: Record<string, Schema>;
  enum?: unknown[];
  items?: Schema;
  maxLength?: number;
}
export interface Brief {
  goal?: string;
  instructions?: string;
  inputs?: string[];
  expects?: Expects;
}

const MAX_PROBLEMS = 6;
const typeOf = (v: unknown): string => (Array.isArray(v) ? "array" : v === null ? "null" : typeof v);

/** The problems of a value against a schema, each a plain sentence naming where. Empty means it fits. */
export function problems(schema: Schema, value: unknown, at = "the result", depth = 0): string[] {
  const out: string[] = [];
  if (depth > 8) return out;
  const t = typeOf(value);
  if (schema.type !== undefined) {
    const ok = schema.type === "integer" ? Number.isInteger(value) : schema.type === t;
    if (!ok)
      return [
        `${at} should be ${/^[aeiou]/.test(schema.type) ? "an" : "a"} ${schema.type}, not ${t === "null" ? "empty" : `${/^[aeiou]/.test(t) ? "an" : "a"} ${t}`}.`,
      ];
  }
  if (schema.enum !== undefined && !schema.enum.some((e) => JSON.stringify(e) === JSON.stringify(value)))
    out.push(`${at} should be one of ${schema.enum.map((e) => JSON.stringify(e)).join(", ")}.`);
  if (typeof value === "string" && schema.maxLength !== undefined && value.length > schema.maxLength)
    out.push(`${at} is ${value.length} characters; at most ${schema.maxLength}.`);
  if (t === "object") {
    const o = value as Record<string, unknown>;
    for (const k of schema.required ?? [])
      if (!(k in o) || o[k] === undefined || o[k] === null) out.push(`${at} has no "${k}".`);
    for (const [k, s] of Object.entries(schema.properties ?? {}))
      if (k in o && o[k] !== undefined && o[k] !== null) out.push(...problems(s, o[k], `"${k}"`, depth + 1));
  }
  if (t === "array" && schema.items !== undefined)
    (value as unknown[])
      .slice(0, 50)
      .forEach((x, i) => out.push(...problems(schema.items!, x, `${at} item ${i + 1}`, depth + 1)));
  return out.slice(0, MAX_PROBLEMS);
}

/** A brief as stored: only the parts that are defined, with the sizes held to what a person could read. Refuses a schema that is not a schema. */
export function checkBrief(ctx: RunsCtx, brief: unknown): Brief | undefined {
  if (brief === undefined || brief === null) return undefined;
  if (typeof brief !== "object" || Array.isArray(brief))
    raise(ctx, "validation.bad_input", "A brief is an object.", { reason: "bad_brief" });
  const b = brief as Record<string, unknown>;
  const str = (v: unknown, n: number): string | undefined =>
    typeof v === "string" && v !== "" ? v.slice(0, n) : undefined;
  const inputs = Array.isArray(b["inputs"])
    ? (b["inputs"] as unknown[]).filter((x): x is string => typeof x === "string").slice(0, 50)
    : undefined;
  const ex = b["expects"] as Record<string, unknown> | undefined;
  let expects: Expects | undefined;
  if (ex !== undefined && ex !== null) {
    if (typeof ex !== "object" || Array.isArray(ex))
      raise(ctx, "validation.bad_input", "What it must hand back is an object.", { reason: "bad_brief" });
    const schema = ex["schema"];
    if (schema !== undefined && (typeof schema !== "object" || schema === null || Array.isArray(schema)))
      raise(ctx, "validation.bad_input", "The shape of the result must be an object.", { reason: "bad_schema" });
    if (schema !== undefined && JSON.stringify(schema).length > 8_000)
      raise(ctx, "validation.bad_input", "The shape of the result is too large.", { reason: "bad_schema" });
    expects = clean({ schema: schema as Schema | undefined, doneWhen: str(ex["doneWhen"], 400) }) as Expects;
  }
  return clean({ goal: str(b["goal"], 2000), instructions: str(b["instructions"], 20_000), inputs, expects }) as Brief;
}

/** A result that does not fit what the brief asked for is refused, with the reasons, before the node can be done. */
export function acceptResult(ctx: RunsCtx, brief: unknown, result: unknown): void {
  const schema = (brief as Brief | undefined)?.expects?.schema;
  if (schema === undefined || result === undefined) return;
  const bad = problems(schema, result);
  if (bad.length > 0)
    raise(ctx, "validation.precondition_failed", `The result does not fit what was asked for. ${bad.join(" ")}`, {
      reason: "result_invalid",
      problems: bad,
    });
}
