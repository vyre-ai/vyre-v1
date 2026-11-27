// The Space browser's own names, in a file with no imports so that anything may read them without pulling in the Docker adapter.
/** The Space browser container's name (and so its host name on its network); the volume is `<name>-data`. */
export const BROWSER_CONTAINER = "vyre-sbrowser";

/**
 * This Space's own Space browser container (rc.44): `vyre-sbrowser-<space id>`, its volume `<name>-data`, its network `<name>net`. The old name above is the shared one every Space of a host used before; its volume is only read
 * (copied from, never changed) when a Space moves its saved sign-ins to its own.
 */
export function browserNameFor(spaceId: string): string {
  const safe = spaceId.replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 60);
  return safe.length >= 3 ? `${BROWSER_CONTAINER}-${safe}` : BROWSER_CONTAINER;
}
