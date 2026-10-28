// What this device keeps between launches so the shell paints at once: the Space's address, the session token and the Space's card (name, kind, kit), so the frame can draw before
// any request returns. The token is the device session of the signed-in person; signing out or a 401 removes it. Web keeps it in localStorage until the secure store lands on native.
import type { SpaceDef } from "../spaces/model.ts";

const KEY = "vyre.session.v1";

export interface StoredSession {
  baseUrl: string; token: string; def: SpaceDef; personId: string;
  /** Server-supplied continuity marker. It can detect a changed response, but does not authenticate the Space. */
  marker: string;
  /** The sync epoch this device agreed with the server; absent until the first live hello. */
  syncEpoch?: number;
}
export interface KeyValueStore { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void }

export interface VerifiedSpace { id: string; marker: string }
/** Optional continuity checks from local state; these are mismatch signals, not trust anchors. */
export interface SpaceContinuityHint { id?: string; marker?: string }
interface OpenedSession { def: Pick<SpaceDef, "spaceId">; me: { id: string }; close(): void }

/** `fingerprint` is the current anonymous display marker returned by the contract, never used to authenticate a Space. */
export interface SignInOptions { name: string; fingerprint: string; password: boolean; github: boolean; sso: Array<{ key: string; title: string }>; secondFactorRequired: boolean }
export interface SignInAnswer { status: "ok" | "second_factor_required"; session?: { token: string } }

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
      if (!isObj(candidate) || typeof candidate["baseUrl"] !== "string" || typeof candidate["token"] !== "string" || typeof candidate["personId"] !== "string" || typeof candidate["marker"] !== "string" || !isObj(candidate["def"])) continue;
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

/** A managed Personal profile keeps its Space identity when its loopback port changes. */
export function readStoredSpace(spaceId:string,store:KeyValueStore|undefined=browserStore()):StoredSession|null{return Object.values(sessions(store)).find(s=>s.def.spaceId===spaceId)??null;}

/** The gate never carries a prior Space across an address change. */
export function phaseForStoredAddress<T>(stored: T | null): { kind: "signin" } | { kind: "shell"; stored: T } {
  return stored ? { kind: "shell", stored } : { kind: "signin" };
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

/** Opens a signed-in session first, then persists only after authenticated Space ID continuity checks. */
export async function openVerifiedSession<T extends OpenedSession>({ baseUrl, token, continuity, open, getSpace, persist = writeStored }: {
  baseUrl: string; token: string; continuity?: SpaceContinuityHint; open: () => Promise<T>; getSpace: () => Promise<VerifiedSpace>; persist?: (stored: StoredSession) => void;
}): Promise<StoredSession> {
  const real = await open();
  try {
    const actual = await getSpace();
    if (real.def.spaceId !== actual.id || (continuity?.id !== undefined && actual.id !== continuity.id) || (continuity?.marker !== undefined && actual.marker !== continuity.marker)) throw new Error("This Space no longer matches the session for this address. Check the address and try again.");
    const stored: StoredSession = { baseUrl, token, def: real.def as SpaceDef, personId: real.me.id, marker: actual.marker };
    persist(stored);
    return stored;
  } finally {
    real.close();
  }
}

/** A first sign-in displays anonymous options, then records only the authenticated Space response for later continuity checks. */
export async function signInAndVerify<T extends OpenedSession>({ baseUrl, continuity, discover, signIn, open, getSpace, persist, afterVerified }: {
  baseUrl: string; continuity?: SpaceContinuityHint; discover: () => Promise<SignInOptions>; signIn: () => Promise<SignInAnswer>; open: () => Promise<T>; getSpace: () => Promise<VerifiedSpace>; persist?: (stored: StoredSession) => void; afterVerified?: (stored: StoredSession) => Promise<void> | void;
}): Promise<{ status: "second_factor_required"; options: SignInOptions } | { status: "ok"; options: SignInOptions; stored: StoredSession }> {
  const options = await discover();
  const answer = await signIn();
  if (answer.status === "second_factor_required") return { status: answer.status, options };
  const token = answer.session?.token;
  if (!token) throw new Error("The Space did not return a session. Try again.");
  const stored = await openVerifiedSession({ baseUrl, token, continuity, open, getSpace, ...(persist ? { persist } : {}) });
  await afterVerified?.(stored);
  return { status: "ok", options, stored };
}

/** A remembered Space stays open only when its authenticated ID and continuity marker still match this address. */
export async function verifyStoredSession<T extends OpenedSession>({ stored, open, getSpace }: {
  stored: StoredSession; open: () => Promise<T>; getSpace: (session: T) => Promise<VerifiedSpace>;
}): Promise<T> {
  const real = await open();
  try {
    const actual = await getSpace(real);
    if (real.def.spaceId !== actual.id || actual.id !== stored.def.spaceId || actual.marker !== stored.marker) throw new Error("This Space no longer matches the session for this address. Check the address and try again.");
    return real;
  } catch (error) {
    real.close();
    throw error;
  }
}

/** HTTPS is required away from this device; local daemon and development endpoints may use loopback HTTP. */
export function spaceEndpoint(value: string): string | null {
  try {
    const parsed = new URL(value);
    const loopback = parsed.hostname.toLowerCase() === "localhost" || parsed.hostname === "127.0.0.1" || parsed.hostname === "[::1]" || parsed.hostname === "::1";
    return parsed.host && (parsed.protocol === "https:" || (parsed.protocol === "http:" && loopback)) ? parsed.origin : null;
  } catch {
    return null;
  }
}

/** The Space's HTTP(S) address for this page: `?space=` when given, else the served origin. Packaged `tauri://` is never a Space. */
export function spaceAddress(loc: { origin: string; search: string } | undefined = (globalThis as { location?: { origin: string; search: string } }).location): string | null {
  if (!loc) return null;
  const q = new URLSearchParams(loc.search).get("space");
  return q === null ? spaceEndpoint(loc.origin) : spaceEndpoint(q);
}
