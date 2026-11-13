// The sites a browser profile is "signed in" to, as a person reads them (Computer tab, "Signed in on its browser"). browserd lists the hosts that hold cookies; a host that is the browser's own
// (its start page on a loopback address), an address inside the Space or the server, or no host at all is not a site the agent signed in to, so it is left out here, where every list passes.

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

/** An address that only means something on this computer or inside this Space's network: loopback, link-local, private, shared (carrier) and unspecified ranges, v4 and v6. */
export function isInternalAddress(host: string): boolean {
  const m = IPV4.exec(host);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  if (!host.includes(":")) return false;
  const v6 = host.replace(/^\[|\]$/g, "").toLowerCase();
  return v6 === "::" || v6 === "::1" || /^f[cd][0-9a-f]{2}:/.test(v6) || /^fe[89ab][0-9a-f]:/.test(v6) || /^::ffff:/.test(v6);
}

/** Is this host one a person could have signed in to: a real name with a dot that is not the machine's own or the Space's. */
export function isSignInSite(site: string): boolean {
  const host = site.trim().toLowerCase().replace(/^\./, "");
  if (host === "" || host === "localhost" || host.endsWith(".localhost")) return false;
  if (isInternalAddress(host)) return false;
  // a name with no dot is a machine on the Space's own network (a container name, "host"); these suffixes are names that never leave one
  if (!host.includes(".")) return false;
  return !/\.(local|localdomain|internal|lan|intranet)$/.test(host);
}

/** The rows of a list of signed-in sites that are real sites, in the order given. */
export function signInSites<T extends { site: string }>(rows: readonly T[]): T[] {
  return rows.filter((r) => isSignInSite(r.site));
}
