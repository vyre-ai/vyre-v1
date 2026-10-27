// Route/rail translation stays provider-free so URL synchronization does not pull the place registry into the app root.
import type { PlaceId } from "../rail/kits.ts";

const ROUTES: readonly { route: string; place: PlaceId }[] = [
  { route: "home", place: "home" },
  { route: "chat", place: "chats" },
  { route: "mail", place: "inbox" },
  { route: "records", place: "records" },
  { route: "files", place: "files" },
  { route: "sites", place: "apps" },
  { route: "automations", place: "automations" },
  { route: "vault", place: "vault" },
  { route: "settings", place: "settings" },
];

export function routeIdOf(place: PlaceId): string | null {
  return ROUTES.find((entry) => entry.place === place)?.route ?? null;
}

export function railPlaceOf(routeId: string): PlaceId | null {
  return ROUTES.find((entry) => entry.route === routeId)?.place ?? null;
}
