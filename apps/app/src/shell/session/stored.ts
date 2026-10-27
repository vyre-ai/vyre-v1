// What this device keeps between launches so the shell paints at once: the Space's address, the session token and the Space's card (name, kind, kit), so the frame can draw before
// any request returns. The token is the device session of the signed-in person; signing out or a 401 removes it. Web keeps it in localStorage until the secure store lands on native.
import type { SpaceDef } from "../spaces/model.ts";

const KEY = "vyre.session.v1";

export interface StoredSession { baseUrl: string; token: string; def: SpaceDef; personId: string; fingerprint: string }
export interface KeyValueStore { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void }

export interface VerifiedSpace { id: string; fingerprint: string }
interface OpenedSession { def: Pick<SpaceDef, "spaceId">; me: { id: string }; close(): void }

const browserStore = (): KeyValueStore | undefined => (globalThis as { localStorage?: KeyValueStore }).localStorage;

const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);

const sessions = (store: KeyValueStore | undefined): Record<string, StoredSession> => {
  try {
    const raw = store?.getItem(KEY);
    if (!raw) return {};
    const j: unknown = JSON.parse(raw);
    const list = isObj(j) && isObj(j["sessions"]) ? j["sessions"] : isObj(j) ? { [String(j["baseUrl"] ?? "")]: j } : {};
    const valid: Record<string, StoredSession> = {};
    for (const candidate of Object.values(list)) {
      if (!isObj(candidate) || typeof candidate["baseUrl"] !== "string" || typeof candidate["token"] !== "string" || typeof candidate["personId"] !== "string" || typeof candidate["fingerprint"] !== "string" || !isObj(candidate["def"])) continue;
      const def = candidate["def"];
      if (typeof def["spaceId"] !== "string" || typeof def["name"] !== "string") continue;
      valid[candidate["baseUrl"]] = candidate as unknown as StoredSession;
    }
    return valid;
  } catch {
    return {};
  }
};

export function readStored(store: KeyValueStore | undefined = browserStore(), baseUrl?: string): StoredSession | null {
  const all = sessions(store);
  return baseUrl ? all[baseUrl] ?? null : Object.values(all)[0] ?? null;
}

export function writeStored(s: StoredSession, store: KeyValueStore | undefined = browserStore()): void {
  try { store?.setItem(KEY, JSON.stringify({ sessions: { ...sessions(store), [s.baseUrl]: s } })); } catch { /* blocked storage: the session lasts until the page closes */ }
}

export function clearStored(store: KeyValueStore | undefined = browserStore(), baseUrl?: string): void {
  try {
    if (!baseUrl) { store?.removeItem(KEY); return; }
    const all = sessions(store);
    delete all[baseUrl];
    if (Object.keys(all).length === 0) store?.removeItem(KEY);
    else store?.setItem(KEY, JSON.stringify({ sessions: all }));
  } catch { /* blocked storage */ }
}

/** Opens a signed-in session first, then persists only if the preflight and authenticated Space proofs agree. */
export async function openVerifiedSession<T extends OpenedSession>({ baseUrl, token, expected, open, getSpace, persist = writeStored }: {
  baseUrl: string; token: string; expected: VerifiedSpace; open: () => Promise<T>; getSpace: () => Promise<VerifiedSpace>; persist?: (stored: StoredSession) => void;
}): Promise<StoredSession> {
  const real = await open();
  try {
    const actual = await getSpace();
    if (real.def.spaceId !== expected.id || actual.id !== expected.id || actual.fingerprint !== expected.fingerprint) throw new Error("This Space's identity changed. Check its address and try again.");
    const stored: StoredSession = { baseUrl, token, def: real.def as SpaceDef, personId: real.me.id, fingerprint: actual.fingerprint };
    persist(stored);
    return stored;
  } finally {
    real.close();
  }
}

/** The Space's address for this page: `?space=` when given (a test or a second server), else the origin the page was served from. */
export function spaceAddress(loc: { origin: string; search: string } | undefined = (globalThis as { location?: { origin: string; search: string } }).location): string | null {
  if (!loc) return null;
  const q = new URLSearchParams(loc.search).get("space");
  if (q && /^https?:\/\//.test(q)) return q.replace(/\/+$/, "");
  return loc.origin && loc.origin !== "null" ? loc.origin : null;
}
