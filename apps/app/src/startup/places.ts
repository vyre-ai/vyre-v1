// Places the shell routes to, and the loader for each. Only the active place's bundle is loaded: every loader is a dynamic import,
// so Metro splits it into its own chunk (ARCH 7, speed b12). A place module default-exports a React component.
import type { ComponentType } from "react";

export const PLACES = [
  "chat",
  "files",
  "records",
  "mail",
  "calendar",
  "tasks",
  "sites",
  "forms",
  "automations",
  "agents",
  "vault",
  "settings",
  "console",
] as const;

export type PlaceId = (typeof PLACES)[number];
export type PlaceModule = { default: ComponentType<{ place: string }> };
export type PlaceLoader = () => Promise<PlaceModule>;

export const DEFAULT_PLACE: PlaceId = "chat";

/** Addresses of places that are gone. The export keeps a page for each, so an old link or an installed app still lands in the shell, which opens Chats. */
export const OLD_PLACES: readonly string[] = ["home", "inbox"];

export function isPlace(id: string): id is PlaceId {
  return (PLACES as readonly string[]).includes(id);
}

const loaders = new Map<string, PlaceLoader>();

/** A place packet registers its screen here from its own module. Until it does, the route shows the placeholder below. */
export function registerPlace(id: PlaceId, loader: PlaceLoader): void {
  loaders.set(id, loader);
}

export function loaderFor(id: string): PlaceLoader {
  return loaders.get(id) ?? (() => import("./PlaceholderPlace.tsx"));
}

/** The place to open: the persisted last place if it is a real one, else Chats. */
export function resolveLastPlace(persisted: string | null | undefined): PlaceId {
  return persisted && isPlace(persisted) ? persisted : DEFAULT_PLACE;
}

const pendingPlaces = new Map<string, Promise<PlaceModule>>();
const settledPlaces = new Map<string, PlaceModule>();

/** The place's module, loaded once. Everything that opens a place (the shell when it draws one, the page's own warm-up before) comes through here, so there is one load and the answer is kept. */
export function loadPlace(id: string): Promise<PlaceModule> {
  let p = pendingPlaces.get(id);
  if (!p) {
    p = loaderFor(id)().then((m) => {
      settledPlaces.set(id, m);
      return m;
    });
    p.catch(() => pendingPlaces.delete(id));
    pendingPlaces.set(id, p);
  }
  return p;
}

/** The place's module when it is already loaded: drawn at once, with nothing to wait for (a lazy component that is not loaded makes React show a fallback and hold the reveal for 300 ms). */
export function loadedPlace(id: string): PlaceModule | undefined {
  return settledPlaces.get(id);
}
