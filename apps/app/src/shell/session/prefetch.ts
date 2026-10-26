// Apps is not warmed: Sites moved to v1.1 (ruling 93), sites.list answers 503 until then, so nothing calls it before the person opens Apps.
// What each place reads first, so the shell can warm it before the person gets there (idle after the Space opens, and on pointer-enter or focus of a rail item or tab). Warming reads
// the queries with nobody watching; the answer stays in the session's cache, so the place draws it on its first frame and a revisit does not read again.
import type { PlaceId } from "../rail/kits.ts";

export interface Warm { screen: string; query: string; state?: Record<string, unknown> }

export const PLACE_QUERIES: Readonly<Partial<Record<PlaceId, readonly Warm[]>>> = {
  chats: [{ screen: "chats.sidebar", query: "recent", state: { filter: "all" } }],
  inbox: [{ screen: "inbox.contact-list", query: "rows" }],
  records: [{ screen: "records.saved-views", query: "views" }],
  files: [{ screen: "files.list", query: "items" }],
  automations: [{ screen: "automations.sidebar", query: "automations" }],
  vault: [{ screen: "vault.layout", query: "items" }],
  settings: [{ screen: "settings.page", query: "pages" }],
};

/** The order places are warmed in when idle: the ones people open most first. */
export const WARM_ORDER: readonly PlaceId[] = ["chats", "inbox", "records", "files", "settings", "vault", "automations"];
