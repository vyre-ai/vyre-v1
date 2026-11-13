// The sites a browser profile is "signed in" to, as a person reads them (Computer tab, "Signed in on its browser"). browserd lists the hosts that hold cookies; this leaves out only what is the
// browser's own or can never be a login: loopback, the unspecified address, things that are not hosts, and the Space's own container and service names. A private-network site (10.x, 192.168.x,
// `.local`, `.lan`, a dotless name such as an intranet "dms") is a real sign-in: it stays, so the person can see it and sign out of it.
import { BROWSER_CONTAINER } from "./names.ts";

/** The Space's own names: its browser container (and a test's), its compose services (images/vyred/compose.server.yml) and the name the Vault channel is reached by from inside the browser's network. */
const OWN_NAMES: ReadonlySet<string> = new Set([BROWSER_CONTAINER, "vyre-space-browser", "host.docker.internal", "vyred", "sites-runner"]);
const OWN_PATTERN = /^vyre-sbrowser-test-[a-z0-9-]{1,40}$/;

/** The host as written, lower case, without a leading or trailing dot, brackets or a `:port`. */
export function hostOf(site: string): string {
  let h = site.trim().toLowerCase();
  const v6 = /^\[([^\]]*)\](?::\d+)?$/.exec(h);
  if (v6) return (v6[1] ?? "").replace(/\.+$/, "");
  if (/^[^:]+:\d+$/.test(h)) h = h.slice(0, h.lastIndexOf(":"));
  return h.replace(/^\.+/, "").replace(/\.+$/, "");
}

/** Loopback or unspecified: 127.0.0.0/8, 0.0.0.0, ::1, ::, ::ffff:127.x, localhost and *.localhost. */
export function isLoopback(host: string): boolean {
  if (host === "localhost" || host.endsWith(".localhost") || host === "0.0.0.0" || host === "::" || host === "::1") return true;
  const m = /^(?:::ffff:)?(\d{1,3})\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.exec(host);
  return m !== null && Number(m[1]) === 127;
}

/** A host name or address as a cookie domain writes it (letters, digits, dots, dashes, underscores, colons of an IPv6 literal); about:blank, a scheme or a space is not one. */
const isHostLike = (h: string): boolean => h !== "" && /^[a-z0-9._:-]+$/.test(h) && !/^[a-z][a-z0-9+.-]*:(?!:)/.test(h.replace(/^[0-9a-f:]+$/, "0"));

/** Is this entry a site a person could have signed in to. */
export function isSignInSite(site: string): boolean {
  const h = hostOf(site);
  if (!isHostLike(h) || isLoopback(h)) return false;
  return !OWN_NAMES.has(h) && !OWN_PATTERN.test(h);
}

/** The rows of a list of signed-in sites that are real sites, in the order given. */
export function signInSites<T extends { site: string }>(rows: readonly T[]): T[] {
  return rows.filter((r) => isSignInSite(r.site));
}
