// The endpoint list of a Space (ARCH 5.9): `[{kind, url, lastOk, health, rttMs}]`. The manager races the top two healthy endpoints, sticks to the winner, and marks one down when it fails.
export type EndpointKind = "direct" | "relay" | "tunnel";
export type Health = "unknown" | "healthy" | "down";

export interface Endpoint {
  kind: EndpointKind;
  url: string;
  /** When this endpoint last carried a live connection, ms, or null. */
  lastOk: number | null;
  health: Health;
  rttMs: number | null;
  /** A down endpoint is tried again after this time, ms. */
  downUntil?: number;
}

/** How long a failed endpoint rests before it is tried again. */
export const ENDPOINT_COOLDOWN_MS = 30_000;
const KIND_ORDER: Record<EndpointKind, number> = { direct: 0, tunnel: 1, relay: 2 };

export function endpoint(kind: EndpointKind, url: string, over: Partial<Endpoint> = {}): Endpoint {
  return { kind, url, lastOk: null, health: "unknown", rttMs: null, ...over };
}

/** Usable now: not down, or down with its rest over. */
export function usable(e: Endpoint, now: number): boolean {
  return e.health !== "down" || (e.downUntil !== undefined && e.downUntil <= now);
}

/**
 * Best first: usable endpoints before resting ones; among usable, the one that worked most recently, then the faster, then direct before tunnel before relay.
 * Resting endpoints come last, so a Space with one endpoint still retries it.
 */
export function rank(list: readonly Endpoint[], now: number): Endpoint[] {
  const key = (e: Endpoint): [number, number, number, number] => [usable(e, now) ? 0 : 1, -(e.lastOk ?? 0), e.rttMs ?? Number.MAX_SAFE_INTEGER, KIND_ORDER[e.kind]];
  return [...list].sort((a, b) => {
    const ka = key(a), kb = key(b);
    for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return ka[i]! - kb[i]!;
    return a.url < b.url ? -1 : a.url > b.url ? 1 : 0;
  });
}
