// The durable half of a connector setup offer. One row per Vault item. No key and no field value.
import { acceptOffer, declineOffer, offerForSavedItem } from "./connector-offer.ts";
import type { Offer, OfferState, SavedItem } from "./connector-offer.ts";

export interface OfferDb {
  all(sql: string, ...args: unknown[]): unknown[];
  run(sql: string, ...args: unknown[]): { changes: number };
}

interface Row { item_id: string; app_name: string; decision: string; owner: string }

function listed(db: OfferDb): Row[] {
  return db.all(`SELECT item_id, app_name, decision, owner FROM automations_connector_offers`) as Row[];
}

function stateOf(rows: readonly Row[]): OfferState {
  const state: Record<string, "open" | "declined" | "accepted"> = {};
  for (const row of rows) {
    if (row.decision === "open" || row.decision === "declined" || row.decision === "accepted") state[row.item_id] = row.decision;
  }
  return state;
}

/** `owner` is the person a Mine item belongs to; empty for a shared item, whose offer is the Space's. */
export function recordSavedItem(db: OfferDb, item: SavedItem, now: number, owner = ""): Offer | null {
  const next = offerForSavedItem(stateOf(listed(db)), item);
  if (next.offer === null) return null;
  db.run(
    `INSERT INTO automations_connector_offers (item_id, app_name, decision, updated_at, owner) VALUES (?, ?, 'open', ?, ?)`,
    item.itemId, next.offer.appName, now, owner,
  );
  return next.offer;
}

export function listOpenOffers(db: OfferDb, viewer?: string): { itemId: string; appName: string; text: string }[] {
  const open: { itemId: string; appName: string; text: string }[] = [];
  for (const row of listed(db)) {
    if (row.decision !== "open") continue;
    // an offer for a Mine item is for the person who saved it and no one else
    if (viewer !== undefined && row.owner !== "" && row.owner !== viewer) continue;
    open.push({ itemId: row.item_id, appName: row.app_name, text: `Set up ${row.app_name} for Automations?` });
  }
  return open;
}

export function decideOffer(db: OfferDb, itemId: string, which: "decline" | "accept", now: number): "declined" | "accepted" | "absent" {
  const state = stateOf(listed(db));
  const next = which === "decline" ? declineOffer(state, itemId) : acceptOffer(state, itemId);
  const decision = next[itemId];
  if (decision !== "declined" && decision !== "accepted") return "absent";
  if (state[itemId] === decision) return decision;
  db.run(`UPDATE automations_connector_offers SET decision = ?, updated_at = ? WHERE item_id = ?`, decision, now, itemId);
  return decision;
}
