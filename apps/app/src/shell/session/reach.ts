// Whether an address can be opened from another device. Kept apart from desktop.ts so a screen can ask without loading the desktop bridge.

/** True when a phone elsewhere could open this Space address: not this computer (localhost, 127.x, ::1, 0.0.0.0) and not link-local (169.254.x, fe80::). Names and LAN addresses pass. */
export function phoneCanReach(address: string): boolean {
  let host: string;
  try { host = new URL(address).hostname.toLowerCase().replace(/^\[|\]$/g, ""); } catch { return false; }
  if (!host || host === "localhost" || host.endsWith(".localhost") || host === "::1" || host === "::" || host.startsWith("fe80:")) return false;
  const v4 = /^(\d+)\.(\d+)\.\d+\.\d+$/.exec(host);
  if (v4) { const a = Number(v4[1]); const b = Number(v4[2]); if (a === 127 || a === 0 || (a === 169 && b === 254)) return false; }
  return true;
}
