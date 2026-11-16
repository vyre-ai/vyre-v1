import { SHELL_PLACES } from "../places.ts";
import type { ShellHub } from "../spaces/hub.ts";

const segment = (pathname: string): string => pathname.split("/")[1] ?? "";

export function readUrlIntoHub(
  hub: ShellHub,
  location: { pathname: string; hash: string },
  opts: { load?: boolean } = {},
): void {
  // a place's address is its route (/mail) or its name (/inbox): both open it, never the last place
  const at = segment(location.pathname);
  const place = (SHELL_PLACES.find((p) => p.id === at) ?? SHELL_PLACES.find((p) => p.screens === at))?.screens;
  const hash = (opts.load === true ? loadedHash : (h: string) => h)(location.hash.replace(/^#/, ""));
  if (place && (place !== hub.state().place || hash !== hub.state().hash))
    hub.go(place as Parameters<ShellHub["go"]>[0], hash, false, true);
}

// A screen that is a popover or a sheet a press opens (the terminal list, All agents, the terminal rules) is a moment, not a page. Its address is made by the press and spent at once (ChatsMounted
// forgets it as soon as the layer is up); an address that is read when the app loads (a reload, a pasted or restored link, a crawler's visit) must not open it again over a page nobody pressed from.
const PRESSED_LAYERS: readonly string[] = ["chats.terminal-list", "chats.all-agents", "chats.terminal-rules"];

/** The address a page load should follow: a spent popover or sheet address becomes its place's landing. Anything else, a place, a chat, a record, a recording, is kept as it is. */
export function loadedHash(hash: string): string {
  const screen = new URLSearchParams(hash.replace(/^#/, "")).get("screen") ?? "";
  return PRESSED_LAYERS.includes(screen) ? "" : hash;
}

export function hubUrl(hub: ShellHub, search = ""): string | null {
  const state = hub.state();
  const route = SHELL_PLACES.find((p) => p.screens === state.place)?.id;
  return route ? `/${route}${search}${state.hash ? `#${state.hash}` : ""}` : null;
}
