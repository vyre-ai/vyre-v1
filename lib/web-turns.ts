// Which hosts an agent's web search showed it, for the length of its turn: chrome_read opens such a host without asking, because the person's question led there. Any other host is a place the agent
// chose by itself, and a read of it waits for a person (the Gate). In memory and short: a restart only means a few more reads ask.
const TTL_MS = 15 * 60_000;
const MAX_KEYS = 500;
const seen = new Map<string, { at: number; hosts: Set<string> }>();

export const webTurnKey = (principalId: string, thread: string | undefined): string => `${principalId}:${thread ?? ""}`;

/** The host part of an address, lower case, or null. */
export function hostOf(url: string): string | null {
  try {
    const h = new URL(url).hostname.toLowerCase().replace(/\.$/, "");
    return h === "" ? null : h;
  } catch {
    return null;
  }
}

export function rememberSearchHosts(key: string, urls: readonly string[], now: number = Date.now()): void {
  const hosts = new Set<string>();
  for (const u of urls) {
    const h = hostOf(u);
    if (h) hosts.add(h);
  }
  if (hosts.size === 0) return;
  const cur = seen.get(key);
  if (cur && now - cur.at < TTL_MS) for (const h of hosts) cur.hosts.add(h);
  else seen.set(key, { at: now, hosts });
  if (seen.size > MAX_KEYS) for (const [k, v] of seen) if (now - v.at >= TTL_MS) seen.delete(k);
}

/** Did a search in this turn show this host (exactly: a result for docs.example.com does not open evil.example.com or example.com)? */
export function searchShowed(key: string, host: string, now: number = Date.now()): boolean {
  const cur = seen.get(key);
  return !!cur && now - cur.at < TTL_MS && cur.hosts.has(host);
}

export function forgetWebTurns(): void {
  seen.clear();
}
