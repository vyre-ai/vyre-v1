// Unsent text per chat, kept on this device only (lead's ruling, 13 Nov: no server field, no sync across devices in v1). The composer writes what the person typed; a send or an empty line clears it;
// the sidebar's pencil mark is derived from it. Bounded: at most MAX_DRAFTS chats (the oldest go first) and MAX_CHARS per chat, so the store never grows without limit.
export const DRAFTS_PREFIX = "vyre.drafts.v2.";
/** One store per person per Space (origin): a draft is never read by anyone else who uses this browser. */
export const draftScope = (origin: string, person: string): string => `${origin}|${person}`;
const keyOf = (scope: string): string => `${DRAFTS_PREFIX}${scope}`;
/** The scope of the person using this window, from where the app is served and who is signed in. */
export const scopeOf = (person: string | undefined): string =>
  draftScope((globalThis as { location?: { origin?: string } }).location?.origin ?? "", person ?? "");
export const DRAFTS_KEY = keyOf("");
export const MAX_DRAFTS = 200;
export const MAX_CHARS = 4000;

export interface DraftStorage {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
}
type Store = Record<string, { t: string; at: number }>;

const listeners = new Set<() => void>();
/** Told when any draft is set or cleared on this device (the sidebar re-derives its pencils). */
export function subscribeDrafts(f: () => void): () => void {
  listeners.add(f);
  return () => void listeners.delete(f);
}

function localStore(): DraftStorage | null {
  try {
    return (globalThis as { localStorage?: DraftStorage }).localStorage ?? null;
  } catch {
    return null;
  }
}
function read(st: DraftStorage | null, scope: string): Store {
  if (!st || scope.endsWith("|")) return {};
  try {
    const v = JSON.parse(st.getItem(keyOf(scope)) ?? "{}") as unknown;
    return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Store) : {};
  } catch {
    return {};
  }
}

/** The unsent text of a chat ("" when none). */
export function draftOf(threadId: string, scope: string, st: DraftStorage | null = localStore()): string {
  return read(st, scope)[threadId]?.t ?? "";
}
/** Keep what the person typed in a chat; an empty or blank line clears it (a send does the same). */
export function setDraft(
  threadId: string,
  text: string,
  scope: string,
  st: DraftStorage | null = localStore(),
  now = Date.now(),
): void {
  if (!st || scope.endsWith("|")) return;
  const all = read(st, scope);
  const had = all[threadId] !== undefined;
  if (text.trim() === "") {
    if (!had) return;
    delete all[threadId];
  } else {
    all[threadId] = { t: text.slice(0, MAX_CHARS), at: now };
    const ids = Object.keys(all);
    if (ids.length > MAX_DRAFTS)
      for (const id of ids.sort((a, b) => all[a]!.at - all[b]!.at).slice(0, ids.length - MAX_DRAFTS)) delete all[id];
  }
  try {
    st.setItem(keyOf(scope), JSON.stringify(all));
  } catch {
    return;
  }
  for (const f of [...listeners]) f();
}
/** The thread ids that have an unsent line: the sidebar draws a pencil on each. */
export function draftThreads(scope: string, st: DraftStorage | null = localStore()): ReadonlySet<string> {
  return new Set(Object.keys(read(st, scope)));
}

/**
 * Forget the drafts of a sign-out: of one Space (its origin), or of every Space on this browser when none is given. The device purge (a person removed, a device revoked) wipes everything under "vyre." already.
 * Storage that cannot list its keys keeps nothing to forget here.
 */
export function forgetDrafts(
  st:
    | (DraftStorage & { length?: number; key?(i: number): string | null; removeItem?(k: string): void })
    | null = localStore() as never,
  origin?: string,
): void {
  if (!st || typeof st.key !== "function" || typeof st.removeItem !== "function" || typeof st.length !== "number")
    return;
  try {
    const gone: string[] = [];
    for (let i = 0; i < st.length; i++) {
      const k = st.key(i);
      if (
        k !== null &&
        k.startsWith(DRAFTS_PREFIX) &&
        (origin === undefined || k.startsWith(`${DRAFTS_PREFIX}${origin}|`))
      )
        gone.push(k);
    }
    for (const k of gone) st.removeItem(k);
  } catch {
    return;
  }
  for (const f of [...listeners]) f();
}
