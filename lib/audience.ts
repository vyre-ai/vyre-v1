// Who reads a chat: its audience. One rule for every place that puts something into a chat other people read (memory recall and every memory tool, an agent's answer): content goes in only
// when every person who reads the chat may read the content too.
//
//   a private chat, an Ask pane, a helper, a run    its starter and members, and those of the chat it hangs under
//   the Ask behind a record comment (recordId set)   the whole Space: its answer posts as a comment on the record, which the record's readers see
//   an invite-only channel and its threads          the channel's members
//   a public channel and its threads                the whole Space (`space`), with the members who are in it now as `people`
//   a chat that cannot be read                      the whole Space: nothing private goes in unless it is known to be safe
//
// `within(inner, outer)`: everyone who reads `inner` also reads `outer`. Memory kept for a channel's people (outer) may come back in a chat (inner) only when it holds.

export interface Audience {
  /** Anyone in the Space may read it (a public channel, or a chat that could not be read). */
  space: boolean;
  /** The people in it now. For a Space-wide audience, those who are present. */
  people: readonly string[];
}

/** The widest audience: a chat nobody could read is treated as the Space's. */
export const SPACE_WIDE: Audience = { space: true, people: [] };

/** Does everyone who reads `inner` also read `outer`? */
export function within(inner: Audience, outer: Audience): boolean {
  if (outer.space) return true;
  if (inner.space) return false;
  return inner.people.every((p) => outer.people.includes(p));
}

/** Does anyone besides `me` read it? */
export const othersRead = (a: Audience, me: string): boolean => a.space || a.people.some((p) => p !== me);

/** A stored audience (memory kept for a channel's people): the people as JSON, or null when it is open to the Space. */
export function audienceText(a: Audience): string | null {
  return a.space ? null : JSON.stringify({ people: [...new Set(a.people)].sort() });
}

export function audienceFrom(text: unknown): Audience | null {
  if (typeof text !== "string" || text === "") return null;
  try {
    const v = JSON.parse(text) as { people?: unknown };
    return Array.isArray(v.people) ? { space: false, people: v.people.filter((p): p is string => typeof p === "string") } : null;
  } catch { return { space: false, people: [] } }   // a row that cannot be read is kept for nobody
}

type Call = (cap: string, input: unknown) => Promise<unknown>;
interface ThreadOut { kind?: string; starter?: string; channelId?: string; parentThreadId?: string; recordId?: string; members?: Array<{ kind?: string; id?: string }> }

/**
 * An Ask whose answer posts into a shared place: a record comment's Ask (records.comments starts it with recordId set) answers with a comment on the record. Its one member is the person who was
 * mentioned, but the record's readers read what it writes, so it is as wide as the Space. An Ask pane opened on a record from the screen (scopeType record, no recordId) stays private.
 */
const postsShared = (t: ThreadOut): boolean => t.kind === "ask" && typeof t.recordId === "string" && t.recordId !== "";

const people = (t: ThreadOut): string[] => [...(t.starter?.startsWith("usr_") ? [t.starter] : []), ...(t.members ?? []).filter((m) => m.kind === "person" && typeof m.id === "string").map((m) => m.id as string)];

/** The audience of a chat, read as the caller (who is in it, so may read it). Anything that cannot be read makes it Space-wide. */
export async function chatAudience(call: Call, threadId: string): Promise<Audience> {
  try {
    const seen = new Set<string>();
    let t = ((await call("threads.get", { threadId })) as { thread?: ThreadOut }).thread;
    if (!t) return SPACE_WIDE;
    for (const p of people(t)) seen.add(p);
    if (postsShared(t)) return { space: true, people: [...seen] };
    for (let i = 0; i < 8 && t.parentThreadId && !t.channelId; i++) {
      const up: ThreadOut | undefined = ((await call("threads.get", { threadId: t.parentThreadId })) as { thread?: ThreadOut }).thread;
      if (!up) return SPACE_WIDE;
      t = up;
      for (const p of people(t)) seen.add(p);
      if (postsShared(t)) return { space: true, people: [...seen] };
    }
    if (t.channelId || t.kind === "channel") {
      if (!t.channelId) return { space: true, people: [...seen] };
      const ch = ((await call("channels.get", { channelId: t.channelId })) as { channel?: { visibility?: string; members?: Array<{ kind?: string; id?: string }> } }).channel;
      if (!ch) return SPACE_WIDE;
      for (const m of ch.members ?? []) if (m.kind === "person" && typeof m.id === "string") seen.add(m.id);
      return { space: ch.visibility !== "invite", people: [...seen] };
    }
    return { space: false, people: [...seen] };
  } catch { return SPACE_WIDE; }
}
