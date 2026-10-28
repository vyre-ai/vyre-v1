// The places the shell shows and how each one is mounted (spec 2.1, 3.0, ARCH 7). Nine places, each a lazy route: only the active place's bundle loads (speed b12).
// Every place is wrapped in its data provider over the Space's replica (see ./providers). The app routes (src/startup/places.ts) know a place by its route id; the screens
// of the generated registry know it by their `place` field, so both are kept here.
import { registerPlace } from "../startup/places.ts";
import type { PlaceId, PlaceLoader } from "../startup/places.ts";
import { loadComposer } from "../../../../ui/src/Composer/load.ts";

export interface ShellPlace {
  /** The route id (src/startup/places.ts). */
  id: PlaceId;
  label: string;
  /** The `place` field of this place's screens in generated/screens.ts. */
  screens: string;
  /** Loads the place's provider module (src/shell/providers/<place>.tsx). A place whose full layout is not composed yet re-exports the first list from the replica. */
  load: PlaceLoader;
}

const withComposer = (load: PlaceLoader): PlaceLoader => async () => {
  const [place] = await Promise.all([load(), loadComposer()]);
  return place;
};

export const SHELL_PLACES: readonly ShellPlace[] = [
  { id: "home", label: "Home", screens: "home", load: withComposer(() => import("./providers/home.tsx")) },
  { id: "chat", label: "Chats", screens: "chats", load: withComposer(() => import("./providers/chats.tsx")) },
  { id: "mail", label: "Inbox", screens: "inbox", load: withComposer(() => import("./providers/inbox.tsx")) },
  { id: "records", label: "Records", screens: "records", load: () => import("./providers/records.tsx") },
  { id: "files", label: "Files", screens: "files", load: () => import("./providers/files.tsx") },
  { id: "sites", label: "Apps", screens: "apps", load: withComposer(() => import("./providers/apps.tsx")) },
  { id: "automations", label: "Automations", screens: "automations", load: () => import("./providers/automations.tsx") },
  { id: "vault", label: "Vault", screens: "vault", load: () => import("./providers/vault.tsx") },
  { id: "settings", label: "Settings", screens: "settings", load: () => import("./providers/settings.tsx") },
  { id: "console", label: "Console", screens: "console", load: () => import("./providers/console.tsx") },
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
