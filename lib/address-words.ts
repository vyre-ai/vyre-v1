// A Space's address as a person reads it (owner, 13 Nov 2026: a loopback address is never shown as content). An address only this computer can reach is "This computer"; any other is shown as it is.

/** True when the address names this computer only (localhost, 127.x, ::1, 0.0.0.0). Takes a host, a host:port or a full URL. */
export function isLoopbackAddress(address: string | null | undefined): boolean {
  if (!address) return false;
  let host = "";
  try { host = new URL(/^[a-z]+:\/\//i.test(address) ? address : `http://${address}`).hostname.toLowerCase(); } catch { return false; }
  return host === "localhost" || host === "[::1]" || host === "::1" || /^127\./.test(host) || host === "0.0.0.0";
}

/** What to show for a Space's address: "This computer" for a loopback one, else the address. */
export const addressWords = (address: string | null | undefined, fallback = "This computer"): string => (!address ? fallback : isLoopbackAddress(address) ? "This computer" : address);
