// Places the shell routes to, and the loader for each. Only the active place's bundle is loaded: every loader is a dynamic import,
// so Metro splits it into its own chunk (ARCH 7, speed b12). A place module default-exports a React component.
import type { ComponentType } from "react";

export const PLACES = [
  "home", "chat", "files", "records", "mail", "calendar", "tasks", "sites", "forms", "campaigns", "automations", "agents", "vault", "settings", "console",
] as const;

export type PlaceId = (typeof PLACES)[number];
export type PlaceModule = { default: ComponentType<{ place: string }> };
export type PlaceLoader = () => Promise<PlaceModule>;

export const DEFAULT_PLACE: PlaceId = "home";

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

/** The place to open: the persisted last place if it is a real one, else Home. */
export function resolveLastPlace(persisted: string | null | undefined): PlaceId {
  return persisted && isPlace(persisted) ? persisted : DEFAULT_PLACE;
}
