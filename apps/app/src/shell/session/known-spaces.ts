// The Spaces this device has used, so opening Vyre shows them and one press enters: each with the Space's name and picture and whose account it is. It is a list of where the person has been,
// never a credential: no token is kept here (the saved sign-ins are in stored.ts and are never deleted by anything in this file), and a Space stays listed after signing out, so its row leads
// to its sign-in with the username already there. A Space on Vyre's relay that the desktop app opened in the browser is listed too, and opens there again.
import { spaceLabel } from "../spaces/space-label.ts";
import { readStoredSessions, spaceEndpoint } from "./stored.ts";
import type { KeyValueStore, StoredSession } from "./stored.ts";

const KEY = "vyre.spaces.v1";
/** A Space picture kept for the list: small ones only, so the list never fills the browser's storage. */
const IMAGE_MAX = 30_000;
const LIST_MAX = 24;

export interface KnownSpace {
  address: string;
  name: string;
  spaceId?: string;
  kind?: "personal" | "team";
  image?: string;
  /** The person's name as they wrote it, and the username they sign in with. */
  person?: string;
  username?: string;
  /** Where it opens: in this app, or in the browser (a Space on Vyre's relay opened from the desktop app). */
  via: "app" | "browser";
  usedAt: number;
}

/** One row of Your Spaces. `in`: a saved sign-in opens it. `out`: it leads to the Space's sign-in. `browser`: it opens in the browser. */
export interface SpaceRow extends KnownSpace {
  state: "in" | "out" | "browser";
  session: StoredSession | null;
}

const browserStore = (): KeyValueStore | undefined => {
  try {
    return (globalThis as { localStorage?: KeyValueStore }).localStorage;
  } catch {
    return undefined;
  }
};
const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const text = (v: unknown): string | undefined => (typeof v === "string" && v !== "" ? v : undefined);

export function readKnown(store: KeyValueStore | undefined = browserStore()): KnownSpace[] {
  try {
    const j: unknown = JSON.parse(store?.getItem(KEY) ?? "null");
    const list = isObj(j) && Array.isArray(j["spaces"]) ? j["spaces"] : [];
    const out: KnownSpace[] = [];
    for (const c of list) {
      if (!isObj(c)) continue;
      const address = text(c["address"]);
      if (!address || spaceEndpoint(address) !== address) continue;
      const kind = c["kind"] === "personal" || c["kind"] === "team" ? c["kind"] : undefined;
      const image = text(c["image"]);
      out.push({
        address,
        name: spaceLabel(text(c["name"]), address),
        ...(text(c["spaceId"]) ? { spaceId: text(c["spaceId"])! } : {}),
        ...(kind ? { kind } : {}),
        ...(image && image.startsWith("data:image/") ? { image } : {}),
        ...(text(c["person"]) ? { person: text(c["person"])! } : {}),
        ...(text(c["username"]) ? { username: text(c["username"])! } : {}),
        via: c["via"] === "browser" ? "browser" : "app",
        usedAt: typeof c["usedAt"] === "number" && Number.isFinite(c["usedAt"]) ? c["usedAt"] : 0,
      });
    }
    return out;
  } catch {
    return [];
  }
}

function write(list: KnownSpace[], store: KeyValueStore | undefined): void {
  try {
    const kept = [...list].sort((a, b) => b.usedAt - a.usedAt).slice(0, LIST_MAX);
    store?.setItem(KEY, JSON.stringify({ spaces: kept }));
  } catch {
    /* blocked or full storage: the list is a convenience, the sign-ins are elsewhere */
  }
}

/** The same Space: by its id when both know it (a Personal Space changes port), else by address. */
const same = (a: Pick<KnownSpace, "address" | "spaceId">, b: Pick<KnownSpace, "address" | "spaceId">): boolean =>
  a.spaceId && b.spaceId ? a.spaceId === b.spaceId : a.address === b.address;

function put(next: KnownSpace, store: KeyValueStore | undefined): void {
  const rest = readKnown(store).filter((k) => !same(k, next) && k.address !== next.address);
  write([next, ...rest], store);
}

/** A Space the person is in, in this app: called when its shell opens. */
export function rememberSession(
  s: StoredSession,
  store: KeyValueStore | undefined = browserStore(),
  now: number = Date.now(),
): void {
  const image = s.def.image && s.def.image.length <= IMAGE_MAX ? s.def.image : undefined;
  put(
    {
      address: s.baseUrl,
      name: s.def.name,
      spaceId: s.def.spaceId,
      kind: s.def.kind,
      ...(image ? { image } : {}),
      ...(s.displayName ? { person: s.displayName } : {}),
      ...(s.username ? { username: s.username } : {}),
      via: "app",
      usedAt: now,
    },
    store,
  );
}

/** A Space on Vyre's relay that the desktop app opened in the browser. What is already known about it (whose it is, its picture) stays. */
export function rememberBrowserSpace(
  o: { address: string; name?: string },
  store: KeyValueStore | undefined = browserStore(),
  now: number = Date.now(),
): void {
  const had = readKnown(store).find((k) => k.address === o.address);
  put(
    {
      ...(had ?? {}),
      address: o.address,
      name: o.name?.trim() || had?.name || spaceLabel(undefined, o.address),
      via: "browser",
      usedAt: now,
    },
    store,
  );
}

/** Take one Space off the list (the person asked). Its saved sign-in, if any, is not touched here. */
export function forgetKnown(address: string, store: KeyValueStore | undefined = browserStore()): void {
  write(
    readKnown(store).filter((k) => k.address !== address),
    store,
  );
}

/** Your Spaces: every saved sign-in and every remembered Space, one row each, the most recently used first. */
export function yourSpaces(store: KeyValueStore | undefined = browserStore()): SpaceRow[] {
  const known = readKnown(store);
  const rows: SpaceRow[] = [];
  const used = new Set<KnownSpace>();
  // one row for a Space: two saved sign-ins with one Space id (a Personal Space that changed port) list the one used last; the other stays saved, only unlisted
  const used_ = (s: StoredSession): number => known.find((c) => c.address === s.baseUrl)?.usedAt ?? 0;
  const sessions = readStoredSessions(store).sort((a, b) => used_(b) - used_(a));
  for (const s of sessions) {
    if (s.def.spaceId && rows.some((r) => r.spaceId === s.def.spaceId)) continue;
    const k = known.find((c) => !used.has(c) && same(c, { address: s.baseUrl, spaceId: s.def.spaceId }));
    if (k) used.add(k);
    const browser = k?.via === "browser" && k.address === s.baseUrl;
    rows.push({
      address: s.baseUrl,
      name: s.def.name,
      spaceId: s.def.spaceId,
      kind: s.def.kind,
      ...((s.def.image ?? k?.image) ? { image: (s.def.image ?? k?.image)! } : {}),
      ...((s.displayName ?? k?.person) ? { person: (s.displayName ?? k?.person)! } : {}),
      ...((s.username ?? k?.username) ? { username: (s.username ?? k?.username)! } : {}),
      via: browser ? "browser" : "app",
      usedAt: k?.usedAt ?? 0,
      state: browser ? "browser" : "in",
      session: s,
    });
  }
  for (const k of known) {
    if (used.has(k) || rows.some((r) => r.address === k.address)) continue;
    rows.push({ ...k, state: k.via === "browser" ? "browser" : "out", session: null });
  }
  return rows.sort((a, b) => b.usedAt - a.usedAt);
}

/** The other saved sign-ins of the same Space (one Space id at another address: a Personal Space that changed port, a team Space that moved). The list shows the one used last; when that address
 * does not answer, these are tried so a person is never left on the dead one. Never deleted, only tried. */
export function siblingSessions(
  of: Pick<StoredSession, "baseUrl" | "def">,
  store: KeyValueStore | undefined = browserStore(),
): StoredSession[] {
  const id = of.def.spaceId;
  if (!id) return [];
  const seen = new Set<string>();
  return readStoredSessions(store).filter((s) => {
    if (s.def.spaceId !== id || s.baseUrl === of.baseUrl || seen.has(s.baseUrl)) return false;
    seen.add(s.baseUrl);
    return true;
  });
}
