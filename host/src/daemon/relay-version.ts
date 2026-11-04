// The relay's version, read from its /health on the relay link (lane l-machines), and kept in network_info beside this Space server's own, for the Console's Relay card ("Vyre relay v1.4.1", amber when it is older).
import type { FetchFn } from "../platform/probes.ts";

export interface InfoDb { run(sql: string, ...args: unknown[]): unknown }

/** The relay's health address from the address the box dials (wss://relay.example.com/box, https://relay.example.com, ...). */
export function relayHealthUrl(relay: string): string | null {
  try { const u = new URL(relay); u.protocol = u.protocol === "wss:" ? "https:" : u.protocol === "ws:" ? "http:" : u.protocol; u.pathname = "/health"; u.search = ""; u.hash = ""; return u.protocol.startsWith("http") ? u.toString() : null; } catch { return null; }
}

/** The version the relay's /health says, or null when it says none (an older relay) or does not answer. Never throws. */
export async function fetchRelayVersion(relay: string, fetchFn: FetchFn | null, timeoutMs = 4000): Promise<string | null> {
  const url = relayHealthUrl(relay);
  if (!url || !fetchFn) return null;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  timer.unref?.();
  try {
    const r = await fetchFn(url, { signal: ctl.signal });
    if (!r.ok) return null;
    const v = (JSON.parse(await r.text()) as { version?: unknown }).version;
    return typeof v === "string" && /^[0-9A-Za-z.+-]{1,40}$/.test(v) ? v : null;
  } catch { return null; } finally { clearTimeout(timer); }
}

export function storeInfo(db: InfoDb, key: string, value: string, at: number): void {
  db.run("INSERT INTO network_info (key, value, at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, at = excluded.at", key, value, at);
}

/** Checks the relay at most every five minutes, and not again while a check is out. */
export function relayVersionWatch(o: { relay: string; fetch: FetchFn | null; db: InfoDb; now(): number; everyMs?: number }): () => void {
  let last = -Infinity, busy = false;
  return () => {
    const t = o.now();
    if (busy || t - last < (o.everyMs ?? 300_000)) return;
    busy = true; last = t;
    void fetchRelayVersion(o.relay, o.fetch).then((v) => { if (v) { try { storeInfo(o.db, "relay_version", v, o.now()); } catch { /* the database closed while stopping */ } } }).finally(() => { busy = false; });
  };
}
