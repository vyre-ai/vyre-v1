// WHERE A KEY MAY GO (b-connect3, 16 Nov 2026; review r-keyreach-9-b-connect item B and the second look r-asker-b-connect-second-look 5). One function decides whether a connector is exact enough to be connected from a card, and so
// to be sent a key a person typed or saved: `destinationProblem`. connectors.for_service (what the card shows), connectors.check_key (the typed key's one try) and the card's own submit all stand on it; nothing else
// decides. A connector passes only when every host a key could reach is a plain public name the person saw on the card:
//   - the declared domains are exactly the hosts its actions call (no wildcard, no extra domain, no action on an undeclared host);
//   - every action is https and every host has a registrable name (no address, no localhost, no .internal, .local, .lan or single-label host, no credentials);
//   - a connector that is not built in names no host that a built-in connector's domains cover, or that covers one (a connector somebody published cannot receive the key of a built-in's host or stand beside it).
import { keyHosts, probeOf } from "./projections.ts";
import type { ConnectorDef } from "./projections.ts";

const PRIVATE_SUFFIX = /\.(internal|local|localhost|lan|home|corp|intranet|private|test\.internal|home\.arpa)$/i;
const V4 = /^\d{1,3}(\.\d{1,3}){3}$/;

/** A name that is not a public host: an address (v4 or v6, in any form), localhost, a single label, or a private suffix. */
export function notPublicHost(raw: string): boolean {
  const h = raw.toLowerCase().replace(/\.$/, "");
  if (!h || h.includes(":") || h.startsWith("[") || h.includes("%")) return true; // an IPv6 literal or a scoped one
  if (V4.test(h) || /^0x[0-9a-f]+$/i.test(h) || /^\d+$/.test(h)) return true; // dotted, hex or whole-number address
  if (h === "localhost" || PRIVATE_SUFFIX.test(h)) return true;
  if (!h.includes(".")) return true; // a single label is an internal name
  return !/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(h);
}

/** Does `a` equal `b`, or sit inside it or hold it (api.fathom.ai and fathom.ai overlap; fathom.ai and notfathom.ai do not)? Wildcards count as their bare domain. */
const overlaps = (a: string, b: string): boolean => {
  const x = a.toLowerCase().replace(/^\*\./, "");
  const y = b.toLowerCase().replace(/^\*\./, "");
  return x === y || x.endsWith(`.${y}`) || y.endsWith(`.${x}`);
};

/**
 * Why this connector may not be connected from a card (said for a log or a test, never to a person), or null when it may.
 * `builtins` are the built-in connectors of the Space: a connector that is not built in must not overlap any of them.
 */
export function destinationProblem(def: ConnectorDef, builtins: readonly ConnectorDef[]): string | null {
  const calls = keyHosts(def).map((h) => h.toLowerCase());
  const declared = def.domains.map((d) => d.toLowerCase());
  if (calls.length === 0) return "no action has an address";
  if (declared.some((d) => d.includes("*"))) return "a wildcard domain";
  if (!declared.every((d) => calls.includes(d)) || !calls.every((h) => declared.includes(h)))
    return "the declared domains are not exactly the hosts the actions call";
  for (const a of def.actions) {
    if (a.url === undefined) continue;
    if (!/^https:\/\//i.test(a.url)) return "an action that is not https";
    try {
      const u = new URL(a.url.replace(/\{[^}]*\}/g, "x"));
      if (u.username || u.password) return "an address with credentials in it";
    } catch {
      return "an action address that is not an address";
    }
  }
  for (const h of calls) if (notPublicHost(h)) return `${h} is not a public host`;
  if (def.builtin !== true)
    for (const b of builtins) {
      if (b.key === def.key) continue;
      for (const bd of [...b.domains, ...keyHosts(b)])
        for (const h of calls) if (overlaps(h, bd)) return `${h} overlaps the built-in ${b.title}`;
    }
  // the check must be one of its own calls (a key is tried only where it will be kept)
  const probe = probeOf(def);
  if (probe !== undefined && !def.actions.some((a) => a.name === probe)) return "the check is not one of its actions";
  return null;
}
