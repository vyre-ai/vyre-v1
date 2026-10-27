// The desktop adapter keeps the Tauri bridge at the session boundary. It turns
// validated native links into the same URL-backed flows used by the browser;
// it never gives the React app a general native invoke surface.
import { makeBridge, shellInvoke, shellListen } from "../../../../desktop/src/bridge.ts";
import type { Bridge, DesktopDeepLink, Unlisten } from "../../../../desktop/src/bridge.ts";

export type DesktopRoute =
  | { kind: "signin"; address: string; pairCode?: string }
  | { kind: "join"; address: string; code: string; fingerprint: string };

export type DesktopBootstrapBridge = Pick<Bridge, "bootstrap" | "listenLinks">;

function address(value: string | undefined, httpsOnly = false): string | null {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    if ((parsed.protocol !== "http:" && parsed.protocol !== "https:") || (httpsOnly && parsed.protocol !== "https:") || !parsed.host) return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

/** Converts a validated native payload into an existing Sign in or Join flow. */
export function routeDesktopLink(link: DesktopDeepLink): DesktopRoute | null {
  const space = address(link.params["address"]);
  if (link.action === "open" || link.action === "signin") return space ? { kind: "signin", address: space } : null;
  if (link.action === "pair") {
    const code = link.params["code"];
    return space && code ? { kind: "signin", address: space, pairCode: code } : null;
  }
  const code = link.params["code"];
  const fingerprint = link.params["fp"];
  const verifiedSpace = address(link.params["address"], true);
  return verifiedSpace && code && fingerprint ? { kind: "join", address: verifiedSpace, code, fingerprint } : null;
}

/** The typed bridge is present only in the packaged desktop shell. */
export function desktopBridge(): DesktopBootstrapBridge | null {
  const invoke = shellInvoke();
  const listen = shellListen();
  return invoke && listen ? makeBridge(invoke, listen) : null;
}

/** Delivers bootstrap before live links, preserving the bridge's established order. */
export async function consumeDesktopBootstrap(bridge: DesktopBootstrapBridge, onRoute: (route: DesktopRoute) => void): Promise<Unlisten> {
  const boot = await bridge.bootstrap();
  const pending = boot.pendingLink && routeDesktopLink(boot.pendingLink);
  if (pending) onRoute(pending);
  const unlisten = await bridge.listenLinks((link) => {
    const route = routeDesktopLink(link);
    if (route) onRoute(route);
  });
  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    unlisten();
  };
}
