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
