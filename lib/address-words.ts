// A Space's address as a person reads it (owner, 13 Nov 2026: a loopback address is never shown as content). An address only this computer can reach is "This computer"; any other is shown as it is.

/** True when the address names this computer only (localhost and any *.localhost, 127.x, ::1, 0.0.0.0). Takes a host, a host:port or a full URL. */
export function isLoopbackAddress(address: string | null | undefined): boolean {
  if (!address) return false;
  let host = "";
  try {
    host = new URL(/^[a-z]+:\/\//i.test(address) ? address : `http://${address}`).hostname.toLowerCase();
  } catch {
    return false;
  }
  // RFC 6761: every name under .localhost is this computer (the packaged Windows app runs at http://tauri.localhost)
  return (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host === "[::1]" ||
    host === "::1" ||
    /^127\./.test(host) ||
    host === "0.0.0.0"
  );
}

/**
 * What to show for a Space's address. A loopback address is this computer only for a person on it: `viewer` is the address the viewer reaches the Space by (the window's own host). Seen from another
 * computer, a loopback address in the Space's record is the server's own, so it reads "This server". An address that is not loopback is shown as it is. No address reads `fallback`.
 */
export function addressWords(
  address: string | null | undefined,
  opts: { fallback?: string; viewer?: string | null | undefined } = {},
): string {
  const fallback = opts.fallback ?? "This computer";
  if (!address) return fallback;
  if (!isLoopbackAddress(address)) return address;
  // no host to compare with (an empty host, as a file or custom-scheme window has) is this computer, not another one
  return !opts.viewer || isLoopbackAddress(opts.viewer) ? "This computer" : "This server";
}
