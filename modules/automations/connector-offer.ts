// One setup offer per saved Vault item. Declining or accepting is final for that item.
// Field keys are names only. This module does not read secret values and does not copy them.

export interface SavedItem {
  itemId: string;
  name: string;
  fieldKeys: readonly string[];
}

export interface Offer {
  itemId: string;
  appName: string;
  text: string;
}

export type OfferState = Readonly<Record<string, "open" | "declined" | "accepted">>;

const LIVE_KEY = "sk_live_";
const SAFE_APP = "this app";

function decisionOf(state: OfferState, itemId: string): OfferState[string] | undefined {
  if (!Object.hasOwn(state, itemId)) return undefined;
  return state[itemId];
}

// Surrounding space is removed. A live key in the title is not repeated, including when whitespace is inserted inside it.
function appNameOf(name: string): string {
  const collapsed = name.replace(/\s+/g, "");
  if (collapsed.includes(LIVE_KEY)) return SAFE_APP;
  const trimmed = name.trim();
  if (trimmed.length === 0) return SAFE_APP;
  return trimmed;
}

export function offerForSavedItem(state: OfferState, item: SavedItem): { state: OfferState; offer: Offer | null } {
  if (decisionOf(state, item.itemId) !== undefined) return { state, offer: null };
  const appName = appNameOf(item.name);
  return {
    state: { ...state, [item.itemId]: "open" },
    offer: { itemId: item.itemId, appName, text: `Set up ${appName} for Automations?` },
  };
}

export function declineOffer(state: OfferState, itemId: string): OfferState {
  const current = decisionOf(state, itemId);
  if (current === undefined || current === "declined") return state;
  return { ...state, [itemId]: "declined" };
}

export function acceptOffer(state: OfferState, itemId: string): OfferState {
  const current = decisionOf(state, itemId);
  if (current === undefined || current === "accepted") return state;
  return { ...state, [itemId]: "accepted" };
}
