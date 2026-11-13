// What the tool layer fills in for a model (13 Nov 2026, owner: "its first attempts are always failing"). A `create` capability requires an idempotency key that no description mentions; the model had to invent it.
// The tool layer makes it: one call is one key. A key the model gives is kept.
import type { ToolCtx, ToolDef } from "./types.ts";

/** A stable text of a value: keys sorted, so the same input always reads the same. */
export function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v !== null && typeof v === "object")
    return `{${Object.keys(v as object)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  return JSON.stringify(v) ?? "null";
}

/** A short stable hash of a text (FNV-1a, 32 bits, in hex): enough to tell two calls of one turn apart, never a secret. */
export function shortHash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/**
 * The input the capability gets: the model's own, with the idempotency key filled when the capability needs one and the model gave none. The key is the call's own id when the engine has one (the model's tool-call
 * id; for a CLI engine the session and request id): a retry of that call carries the same id, so it makes the same thing once, and two calls the model makes on purpose have two ids. Only a call with no id falls
 * back to turn, tool, input and `n`, the count of that same call in the turn.
 */
export function fillKey(t: ToolDef, input: unknown, ctx: ToolCtx, n: number): unknown {
  if (t.keyed !== true || input === null || typeof input !== "object" || Array.isArray(input)) return input;
  const given = (input as Record<string, unknown>)["idempotencyKey"];
  if (typeof given === "string" && given !== "") return input;
  const key = ctx.callId
    ? `ag:${ctx.turnId ?? ""}:${ctx.callId}`
    : `ag:${ctx.turnId ?? ctx.trace?.traceId ?? "t"}:${t.name}:${shortHash(canonical(input))}:${n}`;
  return { ...(input as Record<string, unknown>), idempotencyKey: key };
}
