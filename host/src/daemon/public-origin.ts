// The one answer to "what address do people outside reach this Space at?". Every public link (a form, a booking page, a signed link, an unsubscribe) starts from it.
// An address the Space was given wins. Otherwise a phone name it holds at the relay is the address: a relay Space has no cfg.address, because claiming <name>.vyre.run only writes network_phone.
const ZONE = "vyre.run";

export interface PublicOrigin {
  origin: string;
  /** the address is a phone name: the relay answers the app there and carries only /p/*, so a public link has to live under /p/ */
  relay: boolean;
}

export function publicOriginOf(address: string | null | undefined, claimed: string | null | undefined): PublicOrigin | null {
  if (address) {
    const origin = (/^https?:\/\//.test(address) ? address : `https://${address}`).replace(/\/+$/, "");
    let host = "";
    try { host = new URL(origin).hostname.toLowerCase(); } catch { /* not an address: it stays a plain own domain */ }
    return { origin, relay: host.endsWith(`.${ZONE}`) };
  }
  return claimed ? { origin: `https://${claimed}.${ZONE}`, relay: true } : null;
}

/**
 * The host artifacts are served from, apart from the app's origin (host/src/routes/artifact-host.ts): a relay name `harbor` is `harbor-a.vyre.run`, and an own domain `vyre.example.com` is
 * `a.vyre.example.com` (the installer prints the DNS record and the daemon writes the Caddy route for it). Null where there is no public address to hang one on: a local http address,
 * an IP address, a port. An address that is already an artifact host is not given another.
 */
export function artifactHostOf(address: string | null | undefined, claimed: string | null | undefined): string | null {
  const o = publicOriginOf(address, claimed);
  if (!o) return null;
  let url: URL;
  try { url = new URL(o.origin); } catch { return null; }
  const host = url.hostname.toLowerCase();
  // a Space on this computer, reached at a loopback address: browsers send *.localhost to loopback, so a.localhost:<port> is its own origin
  if (url.protocol === "http:" && /^(127\.0\.0\.1|localhost|\[::1\])$/.test(host)) return `a.localhost${url.port ? `:${url.port}` : ""}`;
  if (o.relay) {
    const label = host.slice(0, -(`.${ZONE}`.length));
    return label && !label.includes(".") && !label.endsWith("-a") ? `${label}-a.${ZONE}` : null;
  }
  if (url.protocol !== "https:" || url.port !== "" || !/^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(host) || host.startsWith("a.")) return null;
  return `a.${host}`;
}
