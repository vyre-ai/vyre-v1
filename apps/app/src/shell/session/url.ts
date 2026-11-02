import { SHELL_PLACES } from "../places.ts";
import type { ShellHub } from "../spaces/hub.ts";

const segment = (pathname: string): string => pathname.split("/")[1] ?? "";

export function readUrlIntoHub(hub: ShellHub, location: { pathname: string; hash: string }): void {
  // a place's address is its route (/mail) or its name (/inbox): both open it, never the last place
  const at = segment(location.pathname);
  const place = (SHELL_PLACES.find((p) => p.id === at) ?? SHELL_PLACES.find((p) => p.screens === at))?.screens;
  const hash = location.hash.replace(/^#/, "");
  if (place && (place !== hub.state().place || hash !== hub.state().hash)) hub.go(place as Parameters<ShellHub["go"]>[0], hash);
}

export function hubUrl(hub: ShellHub, search = ""): string | null {
  const state = hub.state();
  const route = SHELL_PLACES.find((p) => p.screens === state.place)?.id;
  return route ? `/${route}${search}${state.hash ? `#${state.hash}` : ""}` : null;
}

