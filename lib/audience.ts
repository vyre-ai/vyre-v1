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
  /** A fact kept for a place (rule 1): the chat it was learned in. Who may read it is whoever may open that chat NOW, not who could when it was written. */
  live?: string;
  /** For memory kept for a place: when it was learned there; and, read live from the place, its kind, who started it and when it first had a second person. */
  at?: number;
  kind?: string;
  starter?: string;
  sharedAt?: number;
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

/** The stored form of memory kept for a place: it always names the place's chat, and never reads as open to the Space, so a place that narrows later narrows its memory with it. */
export function placeAudienceText(a: Audience, threadId: string, at?: number): string {
  return JSON.stringify({ people: [...new Set(a.people)].sort(), live: threadId, ...(at !== undefined ? { at } : {}) });
}

export function audienceFrom(text: unknown): Audience | null {
  if (typeof text !== "string" || text === "") return null;
  try {
    const v = JSON.parse(text) as { people?: unknown; live?: unknown; at?: unknown };
    if (typeof v.live === "string" && v.live !== "") return { space: false, people: Array.isArray(v.people) ? v.people.filter((p): p is string => typeof p === "string") : [], live: v.live, ...(typeof v.at === "number" ? { at: v.at } : {}) };
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

/**
 * Who may open a place's chat right now, for reading memory kept in it. Unlike chatAudience this fails closed: a chat the caller cannot open (or that is gone) answers null, so nobody reads
 * its memory through it. A person who may not open the place is the common case, not an error.
 */
export async function placeAudience(call: Call, threadId: string): Promise<Audience | null> {
  let t: (ThreadOut & { threadId?: string; kind?: string; sharedAt?: number }) | undefined;
  try {
    t = ((await call("threads.get", { threadId })) as { thread?: ThreadOut & { threadId?: string; kind?: string; sharedAt?: number } }).thread;
    // the answer must be about the place asked for: a lookup that came back as some other chat is no proof the caller may open this one
    if (!t || t.threadId !== threadId) return null;
  } catch { return null; }
  const a = await chatAudience(call, threadId);
  return { ...a, ...(t.kind ? { kind: t.kind } : {}), ...(t.starter ? { starter: t.starter } : {}), ...(typeof t.sharedAt === "number" ? { sharedAt: t.sharedAt } : {}) };
}
