// List and close the one setup offer for a Vault item. The reply is a name and a sentence. It is not a key.
import { decideOffer, listOpenOffers } from "../offer-store.ts";
import type { OfferDb } from "../offer-store.ts";
import type { AutoCtx } from "../projections.ts";

type In = { itemId?: unknown };

function itemIdOf(input: In): string {
  return typeof input.itemId === "string" ? input.itemId : "";
}

export function connectorOffers(ctx: AutoCtx): { offers: { itemId: string; appName: string; text: string }[] } {
  return { offers: listOpenOffers(ctx.db as OfferDb, ctx.actingFor ?? ctx.principal.id) };
}

export function declineConnectorOffer(ctx: AutoCtx, input: In): { decision: "declined" | "absent" } {
  const decision = decideOffer(ctx.db as OfferDb, itemIdOf(input), "decline", ctx.now());
  return { decision: decision === "declined" ? "declined" : "absent" };
}

export function acceptConnectorOffer(ctx: AutoCtx, input: In): { decision: "accepted" | "absent" } {
  const decision = decideOffer(ctx.db as OfferDb, itemIdOf(input), "accept", ctx.now());
  return { decision: decision === "accepted" ? "accepted" : "absent" };
}
