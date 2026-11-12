// List and close the one setup offer for a Vault item. The reply is a name and a sentence. It is not a key.
import { decideOffer, listOpenOffers } from "../offer-store.ts";
import type { OfferDb } from "../offer-store.ts";
import type { AutoCtx } from "../projections.ts";

type In = { itemId?: unknown };

function itemIdOf(input: In): string {
  return typeof input.itemId === "string" ? input.itemId : "";
}

const idsOf = (out: unknown, list: string, field: string): Set<string> | null => {
  const rows = (out as Record<string, unknown> | null)?.[list];
  if (!Array.isArray(rows)) return null;
  return new Set(rows.flatMap((r) => { const v = (r as Record<string, unknown> | null)?.[field]; return typeof v === "string" ? [v] : []; }));
};

/** The open offers the caller may act on: an item they can still see in the Vault, and not the key of an AI account (an AI key is saved as an api_key item, so the save alone cannot tell). */
export async function connectorOffers(ctx: AutoCtx): Promise<{ offers: { itemId: string; appName: string; text: string }[] }> {
  const open = listOpenOffers(ctx.db as OfferDb, ctx.actingFor ?? ctx.principal.id);
  if (open.length === 0 || !ctx.call) return { offers: open };
  const [items, ai] = await Promise.all([
    // one page is enough to judge; a Vault with more pages than that is not filtered by it (an offer is never hidden because the list was cut short)
    ctx.call("vault.items.list", { limit: 200 }).then((o) => (typeof (o as { next?: unknown } | null)?.next === "string" ? null : idsOf(o, "items", "id")), () => null),
    ctx.call("providers.list", {}).then((o) => idsOf(o, "providers", "itemId"), () => null),
  ]);
  return { offers: open.filter((o) => (items === null || items.has(o.itemId)) && !(ai?.has(o.itemId) ?? false)) };
}

export function declineConnectorOffer(ctx: AutoCtx, input: In): { decision: "declined" | "absent" } {
  const decision = decideOffer(ctx.db as OfferDb, itemIdOf(input), "decline", ctx.now());
  return { decision: decision === "declined" ? "declined" : "absent" };
}

export function acceptConnectorOffer(ctx: AutoCtx, input: In): { decision: "accepted" | "absent" } {
  const decision = decideOffer(ctx.db as OfferDb, itemIdOf(input), "accept", ctx.now());
  return { decision: decision === "accepted" ? "accepted" : "absent" };
}
