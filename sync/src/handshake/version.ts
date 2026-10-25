// App versions against the server's (ARCH 3.6, spec 3.10): the server supports apps within 2 minor versions of its own. An older app is update_required and read-only; a newer one is a server that needs updating.
// A version is MAJOR.MINOR.PATCH with an optional leading v and an optional pre-release tag (1.4.0-rc.1). The patch and the tag never matter for support.
export const SUPPORTED_MINORS = 2;

export interface Version { major: number; minor: number; patch: number }

export function parseVersion(text: string): Version | null {
  const m = /^v?(\d{1,6})\.(\d{1,6})\.(\d{1,6})(?:[-+][0-9A-Za-z.+-]*)?$/.exec(text.trim());
  if (!m) return null;
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) };
}

/**
 * current   same major and minor as the server
 * supported one to `window` minors behind: works as normal
 * too_old   further behind (or an older major): read-only until the app is updated
 * newer     the app is ahead of this server: the server needs updating, the app is not blocked here
 * unknown   not a version number (a dev build): the registry hash decides
 */
export type Support = "current" | "supported" | "too_old" | "newer" | "unknown";

export function supportOf(appVersion: string, serverVersion: string, window = SUPPORTED_MINORS): Support {
  const app = parseVersion(appVersion), srv = parseVersion(serverVersion);
  if (!app || !srv) return "unknown";
  if (app.major < srv.major) return "too_old";
  if (app.major > srv.major) return "newer";
  const behind = srv.minor - app.minor;
  if (behind < 0) return "newer";
  if (behind === 0) return "current";
  return behind <= window ? "supported" : "too_old";
}

/** How many minor versions the app is behind the server (0 when level or ahead, Infinity for an older major). For the update banner. */
export function minorsBehind(appVersion: string, serverVersion: string): number {
  const app = parseVersion(appVersion), srv = parseVersion(serverVersion);
  if (!app || !srv) return 0;
  if (app.major < srv.major) return Number.POSITIVE_INFINITY;
  return Math.max(0, srv.minor - app.minor);
}
