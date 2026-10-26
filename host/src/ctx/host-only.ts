// A capability only the host may run (P-L5_17): a provider's webhook is recorded after the host has checked its signature, never because a member posted the same body. The host reaches
// the module through a host call (consumers.ts: origin "hook", depth 0), so the capability that records the event refuses every other caller: a gateway or MCP call (any other origin), and a
// call from another module's ctx.call (depth 1 or more). Nothing here is a permission: no role, owner included, can lift it.
import { fail } from "../routes/errors.ts";

export function hostOnly(ctx: { origin: string; depth: number; trace: { traceId: string } }, cap: string): void {
  if (ctx.origin === "hook" && ctx.depth === 0) return;
  throw fail("permission.no_grant", ctx.trace.traceId, { message: "Only the server records a provider's webhook, after it has checked the signature.", details: { cap } });
}
