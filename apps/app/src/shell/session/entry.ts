import { bareSpaceName, normalizeSpaceAddress } from "../../join/logic.ts";
import type { DesktopRoute } from "./desktop.ts";
import { probeDirectSpace } from "./caps.ts";
import { SHELL_PLACES } from "../places.ts";
/**
 * What one address box makes of what was typed or pasted: a Space to sign in to, an invite to join, an owner link to claim. `link` is the address as it was given when it carries more than
 * the Space's address (a relay link's key lives in its fragment), kept so a browser can be handed exactly that.
 */
export type EntryTarget = (
  | Extract<DesktopRoute, { kind: "signin" | "join" }>
  | { kind: "claim"; address: string; url: string }
) & { link?: string };
const control = /[\u0000-\u001f\u007f-\u009f]/u;
/** A Space's own key in a link's fragment (#box=): the link a relay Space opens from the first time on a device. */
const BOX_KEY = /^[A-Za-z0-9_-]{43}$/;
/** The app's own pages (/chat, /home, ...): an address copied from the browser's bar names the Space it is in. */
const ownPage = (pathname: string): boolean => {
  const first = pathname.split("/")[1] ?? "";
  return SHELL_PLACES.some((p) => p.id === first);
};
/** Canonical invitation/owner links remain distinct from a Space sign-in address. A bare name is that name under vyre.run, here as in every address box. */
export function entryTarget(raw: string): EntryTarget | null {
  const value = raw.trim();
  if (!value || value.length > 4096 || control.test(value)) return null;
  let url: URL;
  try {
    const named = bareSpaceName(value);
    url = new URL(named ? `https://${named}` : /^[a-z][a-z0-9+.-]*:/i.test(value) ? value : `https://${value}`);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const address = normalizeSpaceAddress(url.origin);
  if (!address || url.username || url.password) return null;
  if (url.pathname === "/" && !url.search && !url.hash) return { kind: "signin", address };
  // the Space link of a relay Space: its address with the Space's key in the fragment, on any page of it
  if (BOX_KEY.test(new URLSearchParams(url.hash.slice(1)).get("box") ?? ""))
    return { kind: "signin", address, link: url.href };
  // an address copied from the browser while in the Space: the page it was on is not part of where the Space is
  if (ownPage(url.pathname)) return { kind: "signin", address };
  const invite = /^\/join\/([A-Z0-9]{4}-[A-Z0-9]{4})\/?$/.exec(url.pathname);
  if (invite) {
    const fingerprint = new URLSearchParams(url.hash.slice(1)).get("fp");
    return fingerprint && /^[a-f0-9]{8,128}$/i.test(fingerprint) && !url.search
      ? { kind: "join", address, code: invite[1]!, fingerprint }
      : null;
  }
  // a phone address's invite keeps its code in the fragment (/join#c=<code>&k=<the invite's key>&fp=), which never reaches the relay
  if (/^\/join\/?$/.test(url.pathname) && !url.search) {
    const h = new URLSearchParams(url.hash.slice(1));
    const code = h.get("c"),
      fingerprint = h.get("fp");
    return code && /^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(code) && fingerprint && /^[a-f0-9]{8,128}$/i.test(fingerprint)
      ? { kind: "join", address, code, fingerprint, link: url.href }
      : null;
  }
  if (/^\/claim\/[A-Za-z0-9_-]{16,256}$/.test(url.pathname) && new URLSearchParams(url.hash.slice(1)).has("s"))
    return { kind: "claim", address, url: url.href };
  return null;
}
/** The desktop shell on a Mac, the one place "Run this Mac as the Space server" is offered (a phone browser also says Mac in its user agent, so iPhone and iPad are left out). */
export function isMacShell(
  nav: { platform?: string; userAgent?: string } | undefined = (
    globalThis as { navigator?: { platform?: string; userAgent?: string } }
  ).navigator,
): boolean {
  const text = `${nav?.platform ?? ""} ${nav?.userAgent ?? ""}`;
  return /Mac/.test(text) && !/iPhone|iPad|iPod/.test(text);
}

// read when the app loads: the first address of this tab (the invite link) is what the tab came in by, even when the gate rewrites it later
let cameByInvite = /^\/join(\/|$)/.test((globalThis as { location?: { pathname?: string } }).location?.pathname ?? "");
/** This tab was opened on an invite link (the address was rewritten by consumeBrowserInvite): the page behind it is the spent link, so Back must not go there. */
export const joinedByLink = (): boolean => cameByInvite;

/** Remove a spent or dismissed browser invite before shell navigation can remount the gate. */
export function consumeBrowserInvite(
  browser: {
    location?: { pathname: string };
    history?: { replaceState(data: unknown, unused: string, url: string): void };
  } = globalThis as never,
): void {
  const p = browser.location?.pathname ?? "";
  if (p === "/join" || p.startsWith("/join/")) {
    cameByInvite = true;
    browser.history?.replaceState(null, "", "/chat");
  }
}

/** The name rule alone: <name>.vyre.run, the shape of a relay phone address. Not an answer by itself: a Space server can hold a vyre.run name with its own DNS record and TLS (northwind.vyre.run).
 * Use isRelayAddress, which asks the address; this is its fallback when the address does not answer as a Space. */
export function isPhoneAddress(address: string): boolean {
  try {
    const host = new URL(address).hostname.toLowerCase();
    return host.endsWith(".vyre.run") && host.split(".").length === 3;
  } catch {
    return false;
  }
}
/** A page on a relay name runs under the phone shell's service worker (/__vyre/sw.js), which carries every request to the box: its /healthz is the box's, so the page's own probe proves nothing there. */
export function underRelayShell(
  nav: { serviceWorker?: { controller?: { scriptURL?: string } | null } } | undefined = (
    globalThis as { navigator?: { serviceWorker?: { controller?: { scriptURL?: string } | null } } }
  ).navigator,
): boolean {
  try {
    const s = nav?.serviceWorker?.controller?.scriptURL;
    return !!s && new URL(s).pathname === "/__vyre/sw.js";
  } catch {
    return false;
  }
}
export interface AddressCheck {
  probe?: (origin: string) => Promise<boolean>;
  page?: { origin?: string } | undefined;
  relayShell?: () => boolean;
}
const direct = new Map<string, Promise<boolean>>();
/** Forget what addresses answered (tests). */
export function forgetAddressChecks(): void {
  direct.clear();
}
/**
 * Is this a relay phone address? Decided by what it answers, not by its name. An address that is not a vyre.run name is never one and is not asked. A vyre.run name is direct when it answers
 * as a Space server (client/src/gateway/space-probe.ts: /healthz naming a Space, or the sign-in options), which the relay cannot do; otherwise, and on a timeout, the name rule stands.
 * A direct answer is kept for the session; a relay answer is not, so a slow network asks again next time.
 */
export async function isRelayAddress(address: string, o: AddressCheck = {}): Promise<boolean> {
  if (!isPhoneAddress(address)) return false;
  const origin = new URL(address).origin;
  const page = o.page !== undefined ? o.page : (globalThis as { location?: { origin?: string } }).location;
  if (page?.origin === origin && (o.relayShell ?? underRelayShell)()) return true;
  let asked = direct.get(origin);
  if (!asked) {
    asked = (o.probe ?? probeDirectSpace)(origin).catch(() => false);
    direct.set(origin, asked);
  }
  const yes = await asked;
  if (!yes && direct.get(origin) === asked) direct.delete(origin);
  return !yes;
}
/**
 * The address a browser is handed for a Space on Vyre's relay. The desktop app cannot carry a relay Space itself: a relay name answers only a small shell page, and everything else rides that
 * page's service worker over a channel sealed to the Space's key, which lives in that page's own storage and is never supplied by the relay. The app's window is another origin (and a Mac
 * webview runs no service workers), so the app opens the browser for the person instead of telling them to. The link as given goes along when it has one: its fragment holds the key.
 */
export function browserLink(target: EntryTarget): string {
  if (target.kind === "claim") return target.url;
  if (target.link) {
    try {
      if (new URL(target.link).origin === new URL(target.address).origin) return target.link;
    } catch {
      /* the plain address below */
    }
  }
  return target.kind === "join"
    ? `${target.address}/join/${target.code}#fp=${target.fingerprint}`
    : new URL("/chat", target.address).toString();
}
/** The existing desktop join protocol accepts HTTPS Space addresses only, and not a relay phone address, which opens in a browser (browserLink). `relay` is isRelayAddress's answer; the name rule until it arrives. */
export function inviteAppLink(
  route: Extract<DesktopRoute, { kind: "join" }>,
  relay: boolean = isPhoneAddress(route.address),
): string | null {
  if (!route.address.startsWith("https://") || relay) return null;
  return `vyre://join?${new URLSearchParams({ address: route.address, code: route.code, fp: route.fingerprint })}`;
}
/** The owner claim handed to the desktop app (rc.14): the same link, as vyre://claim, so the app can use the account it already has. HTTPS Spaces only, not a relay phone address (`relay` as for inviteAppLink). */
export function claimAppLink(
  address: string,
  token: string,
  fragment: string,
  relay: boolean = isPhoneAddress(address),
): string | null {
  if (!address.startsWith("https://") || relay || !/^[A-Za-z0-9_-]{8,200}$/.test(token)) return null;
  const h = new URLSearchParams(fragment.replace(/^#/, ""));
  const s = h.get("s");
  if (!s) return null;
  const q = new URLSearchParams({ address, token, s });
  for (const k of ["fp", "n"]) {
    const v = h.get(k);
    if (v) q.set(k, v);
  }
  return `vyre://claim?${q}`;
}
export const VYRE_DOWNLOADS = "https://github.com/vyre-ai/vyre-v1/releases";
