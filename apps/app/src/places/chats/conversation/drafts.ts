// Unsent text per chat, kept on this device only (lead's ruling, 13 Nov: no server field, no sync across devices in v1). The composer writes what the person typed; a send or an empty line clears it;
// the sidebar's pencil mark is derived from it. Bounded: at most MAX_DRAFTS chats (the oldest go first) and MAX_CHARS per chat, so the store never grows without limit.
export const DRAFTS_KEY = "vyre.drafts.v1";
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
function read(st: DraftStorage | null): Store {
  if (!st) return {};
  try {
    const v = JSON.parse(st.getItem(DRAFTS_KEY) ?? "{}") as unknown;
    return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Store) : {};
  } catch {
    return {};
  }
}

/** The unsent text of a chat ("" when none). */
export function draftOf(threadId: string, st: DraftStorage | null = localStore()): string {
  return read(st)[threadId]?.t ?? "";
}
/** Keep what the person typed in a chat; an empty or blank line clears it (a send does the same). */
export function setDraft(
  threadId: string,
  text: string,
  st: DraftStorage | null = localStore(),
  now = Date.now(),
): void {
  if (!st) return;
  const all = read(st);
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
    st.setItem(DRAFTS_KEY, JSON.stringify(all));
  } catch {
    return;
  }
  for (const f of [...listeners]) f();
}
/** The thread ids that have an unsent line: the sidebar draws a pencil on each. */
export function draftThreads(st: DraftStorage | null = localStore()): ReadonlySet<string> {
  return new Set(Object.keys(read(st)));
}
