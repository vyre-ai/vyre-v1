import { sha256Hex } from "../../../kernel/src/log/hash.ts";

// The one answer to "what address do people outside reach this Space at?". Every public link (a form, a booking page, a signed link, an unsubscribe) starts from it.
// An address the Space was given wins. Otherwise a phone name it holds at the relay is the address: a relay Space has no cfg.address, because claiming <name>.vyre.run only writes network_phone.
// "Reached through the relay" is a fact about the Space (it holds that phone name at the relay), never a guess from how an address ends: a Space whose address is mla.vyre.run with its DNS pointing straight at its
// own server is an own-address Space, and the relay answers nothing for it (13 Nov 2026: that guess handed such a Space the artifact host mla-a.vyre.run, which only the relay's wildcard answers).
const ZONE = "vyre.run";

export interface PublicOrigin {
  origin: string;
  /** the address is a phone name this Space holds at the relay: the relay answers the app there and carries only /p/*, so a public link has to live under /p/ */
  relay: boolean;
}

export function publicOriginOf(
  address: string | null | undefined,
  claimed: string | null | undefined,
): PublicOrigin | null {
  if (address) {
    const origin = (/^https?:\/\//.test(address) ? address : `https://${address}`).replace(/\/+$/, "");
    let host = "";
    try {
      host = new URL(origin).hostname.toLowerCase();
    } catch {
      /* not an address: it stays a plain own domain */
    }
    // the address is the phone name this Space holds (an address and a held name that agree), not any name that ends in .vyre.run
    const held = claimed ? `${claimed.toLowerCase()}.${ZONE}` : null;
    return { origin, relay: held !== null && host === held };
  }
  return claimed ? { origin: `https://${claimed}.${ZONE}`, relay: true } : null;
}

/**
 * The host artifacts are served from, apart from the app's origin (host/src/routes/artifact-host.ts): a phone name `harbor` this Space holds at the relay is `harbor-a.vyre.run`, and an own address
 * `vyre.example.com` (under any zone, vyre.run included: `mla.vyre.run` is `a.mla.vyre.run`) is `a.vyre.example.com` (the daemon writes the Caddy route for it; its DNS record is the person's to add). Null where there is no public address to hang one on: a local http address,
 * an IP address, a port. An address that is already an artifact host is not given another.
 */
export function artifactHostOf(address: string | null | undefined, claimed: string | null | undefined): string | null {
  const o = publicOriginOf(address, claimed);
  if (!o) return null;
  let url: URL;
  try {
    url = new URL(o.origin);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  // a Space on this computer, reached at a loopback address: browsers send *.localhost to loopback, so a.localhost:<port> is its own origin
  if (url.protocol === "http:" && /^(127\.0\.0\.1|localhost|\[::1\])$/.test(host))
    return `a.localhost${url.port ? `:${url.port}` : ""}`;
  if (o.relay) {
    const label = host.slice(0, -`.${ZONE}`.length);
    return label && !label.includes(".") && !label.endsWith("-a") ? `${label}-a.${ZONE}` : null;
  }
  if (
    url.protocol !== "https:" ||
    url.port !== "" ||
    !/^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(host) ||
    host.startsWith("a.")
  )
    return null;
  return `a.${host}`;
}

/** What a Space's artifact host answers at /.well-known/vyre-artifact-host: the check that a name reaches this Space and no other server (the daemon's self-check and `vyre-server doctor` both read it). */
export const artifactMarkerOf = (spaceId: string): string =>
  `vyre-artifact-host ${sha256Hex(`${spaceId}:vyre-artifact-host`).slice(0, 32)}`;
