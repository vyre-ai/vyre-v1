// List and close the one setup offer for a Vault item. The reply is a name and a sentence. It is not a key.
// An offer is shown only when the person's assistant can finish it (owner, 13 Nov 2026: "its beyond the scope of my assistant so then dont show that to me"): the item is not a company key, the assistant is
// cleared to use it, and it holds the Connector builder role or the person may give it with one press. An offer that cannot be checked is not shown.
import { isCompanyKey } from "../../../lib/company-keys.ts";
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
  return new Set(
    rows.flatMap((r) => {
      const v = (r as Record<string, unknown> | null)?.[field];
      return typeof v === "string" ? [v] : [];
    }),
  );
};

const textOf = (o: { appName: string }, allow: boolean): string =>
  allow
    ? `Set up ${o.appName} for Automations? Your assistant will be allowed to build connectors.`
    : `Set up ${o.appName} for Automations?`;

interface Status {
  allowed?: unknown;
  canGrant?: unknown;
  reaches?: unknown;
}

/** The open offers the caller may act on: an item they can still see in the Vault, not the key of an AI account (an AI key is saved as an api_key item, so the save alone cannot tell), and one their assistant can finish. */
export async function connectorOffers(
  ctx: AutoCtx,
): Promise<{ offers: { itemId: string; appName: string; text: string }[] }> {
  const open = listOpenOffers(ctx.db as OfferDb, ctx.actingFor ?? ctx.principal.id);
  if (open.length === 0 || !ctx.call) return { offers: open };
  const call = ctx.call;
  const [items, ai, assistant] = await Promise.all([
    // one page is enough to judge; a Vault with more pages than that is not filtered by it (an offer is never hidden because the list was cut short)
    call("vault.items.list", { limit: 200 }).then(
      (o) => (typeof (o as { next?: unknown } | null)?.next === "string" ? null : idsOf(o, "items", "id")),
      () => null,
    ),
    call("providers.list", {}).then(
      (o) => idsOf(o, "providers", "itemId"),
      () => null,
    ),
    call("agents.assistant_of", { personId: ctx.actingFor ?? ctx.principal.id }).then(
      (o) => {
        const id = (o as { agentId?: unknown } | null)?.agentId;
        return typeof id === "string" && id !== "" ? id : null;
      },
      () => null,
    ),
  ]);
  const seen = open.filter((o) => (items === null || items.has(o.itemId)) && !(ai?.has(o.itemId) ?? false));
  if (assistant === null) return { offers: [] };
  const kept: { itemId: string; appName: string; text: string }[] = [];
  for (const o of seen) {
    if (isCompanyKey(`#${o.appName.replace(/[^A-Za-z0-9]+/g, "_")}`)) continue;
    const st = await call("access.connector_builder.status", { agentId: assistant, itemId: o.itemId }).then(
      (r) => r as Status | null,
      () => null,
    );
    if (st === null || st.reaches === false || (st.allowed !== true && st.canGrant !== true)) continue;
    kept.push({ ...o, text: textOf(o, st.allowed !== true) });
  }
  return { offers: kept };
}

export function declineConnectorOffer(ctx: AutoCtx, input: In): { decision: "declined" | "absent" } {
  const decision = decideOffer(ctx.db as OfferDb, itemIdOf(input), "decline", ctx.now());
  return { decision: decision === "declined" ? "declined" : "absent" };
}

export function acceptConnectorOffer(ctx: AutoCtx, input: In): { decision: "accepted" | "absent" } {
  const decision = decideOffer(ctx.db as OfferDb, itemIdOf(input), "accept", ctx.now());
  return { decision: decision === "accepted" ? "accepted" : "absent" };
}
