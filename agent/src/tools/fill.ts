// What the tool layer fills in for a model (13 Nov 2026, owner: "its first attempts are always failing"). A `create` capability requires an idempotency key that no description mentions; the model had to invent it.
// The tool layer makes it. A key the model gives is kept.
import type { ToolCtx, ToolDef } from "./types.ts";

/**
 * The input the capability gets: the model's own, with the idempotency key filled when the capability needs one and the model gave none.
 *
 * A key is derived only from a real identity: the turn id AND the call id. The call id the engine hands over is the position of the call in the turn plus the provider's own id (api-tools.ts): some providers number their
 * calls from 0 again at every model step, so the provider's id alone is not unique inside a turn. Then a retry makes the same thing once and two
 * calls the model makes on purpose have two keys. When either is missing (a CLI engine's call comes through MCP with no turn id, and a JSON-RPC request id restarts when a client reconnects), the key is random for
 * this call: the call acts, exactly as when a model made up a fresh key itself. Never a constant, never a hash of the input, never a counter that restarts: the store keeps keys for 30 days, and a repeated
 * "publish the weekly report" must not return last week's.
 */
/** A call id as a part of a key: kept when short, else a fixed-length hash of it (the store refuses a long key). Not a secret. */
export function idPart(id: string): string {
  if (id.length <= 80) return id;
  let a = 0x811c9dc5,
    b = 0x1b873593;
  for (let i = 0; i < id.length; i++) {
    a = Math.imul(a ^ id.charCodeAt(i), 0x01000193) >>> 0;
    b = Math.imul(b ^ id.charCodeAt(i), 0x85ebca6b) >>> 0;
  }
  return `h${a.toString(16).padStart(8, "0")}${b.toString(16).padStart(8, "0")}${id.length}`;
}

export function fillKey(t: ToolDef, input: unknown, ctx: ToolCtx): unknown {
  if (t.keyed !== true || input === null || typeof input !== "object" || Array.isArray(input)) return input;
  const given = (input as Record<string, unknown>)["idempotencyKey"];
  if (typeof given === "string" && given !== "") return input;
  const key =
    ctx.turnId && ctx.callId ? `ag:${ctx.turnId}:${idPart(ctx.callId)}` : `ag:r:${globalThis.crypto.randomUUID()}`;
  return { ...(input as Record<string, unknown>), idempotencyKey: key };
}
