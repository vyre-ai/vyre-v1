// What this device keeps between launches so the shell paints at once: the Space's address, the session token and the Space's card (name, kind, kit), so the frame can draw before
// any request returns. The token is the device session of the signed-in person; signing out or a 401 removes it. Web keeps it in localStorage until the secure store lands on native.
import type { SpaceDef } from "../spaces/model.ts";

const KEY = "vyre.session.v1";

export interface StoredSession { baseUrl: string; token: string; def: SpaceDef; personId: string; /** The sync epoch this device agreed with the server; absent until the first live hello. */ syncEpoch?: number }
export interface KeyValueStore { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void }

const browserStore = (): KeyValueStore | undefined => (globalThis as { localStorage?: KeyValueStore }).localStorage;

const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);

export function readStored(store: KeyValueStore | undefined = browserStore()): StoredSession | null {
  try {
    const raw = store?.getItem(KEY);
    if (!raw) return null;
    const j: unknown = JSON.parse(raw);
    if (!isObj(j) || typeof j["baseUrl"] !== "string" || typeof j["token"] !== "string" || typeof j["personId"] !== "string" || !isObj(j["def"])) return null;
    const def = j["def"];
    if (typeof def["spaceId"] !== "string" || typeof def["name"] !== "string") return null;
    return j as unknown as StoredSession;
  } catch {
    return null;
  }
}

export function writeStored(s: StoredSession, store: KeyValueStore | undefined = browserStore()): void {
  try { store?.setItem(KEY, JSON.stringify(s)); } catch { /* blocked storage: the session lasts until the page closes */ }
}

export function clearStored(store: KeyValueStore | undefined = browserStore()): void {
  try { store?.removeItem(KEY); } catch { /* blocked storage */ }
}

function httpAddress(value: string): string | null {
  try {
    const parsed = new URL(value);
    return (parsed.protocol === "http:" || parsed.protocol === "https:") && parsed.host ? parsed.origin : null;
  } catch {
    return null;
  }
}

/** The Space's HTTP(S) address for this page: `?space=` when given, else the served origin. Packaged `tauri://` is never a Space. */
export function spaceAddress(loc: { origin: string; search: string } | undefined = (globalThis as { location?: { origin: string; search: string } }).location): string | null {
  if (!loc) return null;
  const q = new URLSearchParams(loc.search).get("space");
  return (q ? httpAddress(q) : null) ?? httpAddress(loc.origin);
}
