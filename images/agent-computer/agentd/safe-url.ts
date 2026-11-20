// A request's address, read without ever throwing (r40 incident: a scanner sent `//` and `new URL(req.url, base)` threw "Invalid URL" out of a route and ended the daemon).
// Every route reads its address here. A request target that is not an origin-form path ("/..." that stays on this host) is answered 400 before any route sees it (requestTargetOk).

/** The address a request asked for, or the base's root when it cannot be read. Never throws. */
export function safeUrl(raw: string | undefined, base: string): URL {
  try {
    return new URL(raw ?? "/", base);
  } catch {
    try {
      return new URL("/", base);
    } catch {
      return new URL("http://invalid.invalid/");
    }
  }
}

/** Origin-form only: starts with one "/" (not "//", not "/\"), has no control character or space, and parses on this host. `*`, absolute-form and garbage are false. */
export function requestTargetOk(raw: string | undefined): boolean {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 16_384) return false;
  if (raw[0] !== "/" || raw[1] === "/" || raw[1] === "\\") return false;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000- \u007f]/.test(raw)) return false;
  try {
    return new URL(raw, "http://vyred").origin === "http://vyred";
  } catch {
    return false;
  }
}

/** A path segment or value decoded without throwing on a bad `%` sequence: the text as sent when it cannot be decoded. */
export function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}
