// The addresses an agent's web search showed it, for a short while: chrome_read opens such an address without asking, because the person's question led there. It is the exact address (the same path and the
// same query, no fragment), never a host: an agent that picks the search's `site` or its words could otherwise make any host "shown", and add anything to the query. Any other address is a place the
// agent chose itself, and a read of it waits for a person (the Gate). In memory and short: a restart only means a few more reads ask.
const TTL_MS = 5 * 60_000;
const MAX_KEYS = 500;
const seen = new Map<string, { at: number; urls: Set<string> }>();

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

/** An address as compared here: scheme, host, port, path and query; never the fragment. Null when it is not an http or https address. */
export function exactUrl(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    return `${u.protocol}//${u.host.toLowerCase()}${u.pathname}${u.search}`;
  } catch {
    return null;
  }
}

export function rememberSearchUrls(key: string, urls: readonly string[], now: number = Date.now()): void {
  const set = new Set<string>();
  for (const u of urls) {
    const e = exactUrl(u);
    if (e) set.add(e);
  }
  if (set.size === 0) return;
  const cur = seen.get(key);
  if (cur && now - cur.at < TTL_MS) for (const u of set) cur.urls.add(u);
  else seen.set(key, { at: now, urls: set });
  if (seen.size > MAX_KEYS) for (const [k, v] of seen) if (now - v.at >= TTL_MS) seen.delete(k);
}

/** Did a search in this turn show exactly this address (the same path and query; a different query, path, subdomain or host is another address)? */
export function searchShowed(key: string, url: string, now: number = Date.now()): boolean {
  const cur = seen.get(key);
  const e = exactUrl(url);
  return !!cur && e !== null && now - cur.at < TTL_MS && cur.urls.has(e);
}

export function forgetWebTurns(): void {
  seen.clear();
}
