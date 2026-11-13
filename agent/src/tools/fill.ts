// What the tool layer fills in for a model (13 Nov 2026, owner: "its first attempts are always failing"). A `create` capability requires an idempotency key that no description mentions; the model had to invent it.
// The tool layer makes it. A key the model gives is kept.
import type { ToolCtx, ToolDef } from "./types.ts";

/**
 * The input the capability gets: the model's own, with the idempotency key filled when the capability needs one and the model gave none.
 *
 * A key is derived only from a real identity: the turn id AND the tool-call id (the model's own id for that call; a transport retry of the call carries the same one). Then a retry makes the same thing once and two
 * calls the model makes on purpose have two keys. When either is missing (a CLI engine's call comes through MCP with no turn id, and a JSON-RPC request id restarts when a client reconnects), the key is random for
 * this call: the call acts, exactly as when a model made up a fresh key itself. Never a constant, never a hash of the input, never a counter that restarts: the store keeps keys for 30 days, and a repeated
 * "publish the weekly report" must not return last week's.
 */
export function fillKey(t: ToolDef, input: unknown, ctx: ToolCtx): unknown {
  if (t.keyed !== true || input === null || typeof input !== "object" || Array.isArray(input)) return input;
  const given = (input as Record<string, unknown>)["idempotencyKey"];
  if (typeof given === "string" && given !== "") return input;
  const key = ctx.turnId && ctx.callId ? `ag:${ctx.turnId}:${ctx.callId}` : `ag:r:${globalThis.crypto.randomUUID()}`;
  return { ...(input as Record<string, unknown>), idempotencyKey: key };
}
