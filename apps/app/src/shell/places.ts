// The places the shell shows and how each one is mounted (spec 2.1, 3.0, ARCH 7). Nine places, each a lazy route: only the active place's bundle loads (speed b12).
// Every place is wrapped in its data provider over the Space's replica (see ./providers). The app routes (src/startup/places.ts) know a place by its route id; the screens
// of the generated registry know it by their `place` field, so both are kept here.
import { registerPlace } from "../startup/places.ts";
import type { PlaceId, PlaceLoader } from "../startup/places.ts";

export interface ShellPlace {
  /** The route id (src/startup/places.ts). */
  id: PlaceId;
  label: string;
  /** The `place` field of this place's screens in generated/screens.ts. */
  screens: string;
  /** Loads the place. Home is its own screen; the others mount the place's first list from the replica until their own screens register. */
  load: PlaceLoader;
}

const home: PlaceLoader = () => import("./providers/home.tsx");
const list: PlaceLoader = () => import("./providers/first-list.tsx");

export const SHELL_PLACES: readonly ShellPlace[] = [
  { id: "home", label: "Home", screens: "home", load: home },
  { id: "chat", label: "Chats", screens: "chats", load: list },
  { id: "mail", label: "Inbox", screens: "inbox", load: list },
  { id: "records", label: "Records", screens: "records", load: list },
  { id: "files", label: "Files", screens: "files", load: list },
  { id: "sites", label: "Apps", screens: "apps", load: list },
  { id: "automations", label: "Automations", screens: "automations", load: list },
  { id: "vault", label: "Vault", screens: "vault", load: list },
  { id: "settings", label: "Settings", screens: "settings", load: list },
];

export function shellPlace(id: string): ShellPlace | undefined {
  return SHELL_PLACES.find((p) => p.id === id);
}

let registered = false;

/** Puts every place in the route table. Safe to call more than once; the app root calls it before the first route renders. */
export function registerShellPlaces(): void {
  if (registered) return;
  registered = true;
  for (const p of SHELL_PLACES) registerPlace(p.id, p.load);
}
