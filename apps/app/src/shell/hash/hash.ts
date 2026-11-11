// The tab hash (spec 3.0): what a tab opened inside a place, as text that survives reload and links. `screen=<id>&subject=<type>:<id>&k=v`. The shell writes it (session.open), a place reads it
// on mount and opens that item in its own layout. No hash means "the place itself".
export interface HashTarget {
  screen?: string;
  subject?: { type: string; id: string };
  args: Record<string, string>;
}

export function parseHash(hash: string): HashTarget {
  const out: HashTarget = { args: {} };
  const p = new URLSearchParams(hash.replace(/^#/, ""));
  for (const [k, v] of p) {
    // Threads is gone as a page: a link to it opens the Replies list in the Inbox
    if (k === "screen") out.screen = v === "chats.threads" ? "inbox.replies" : v;
    else if (k === "subject") {
      const i = v.indexOf(":");
      if (i > 0 && i < v.length - 1) out.subject = { type: v.slice(0, i), id: v.slice(i + 1) };
    } else out.args[k] = v;
  }
  return out;
}

/** The item a hash shows: its subject, or the chat a Chats conversation hash (`screen=chats.conversation&threadId=`, what the place writes as you move inside it) names, so both spellings are one tab with one name. */
export function subjectOf(t: HashTarget): { type: string; id: string } | undefined {
  if (t.subject) return t.subject;
  const id = t.args["threadId"];
  return t.screen === "chats.conversation" && typeof id === "string" && id !== "" ? { type: "thread", id } : undefined;
}

export function formatHash(t: { screen?: string; subject?: { type: string; id: string }; args?: Record<string, unknown> }): string {
  const p = new URLSearchParams();
  if (t.screen) p.set("screen", t.screen === "chats.threads" ? "inbox.replies" : t.screen);
  if (t.subject) p.set("subject", `${t.subject.type}:${t.subject.id}`);
  for (const [k, v] of Object.entries(t.args ?? {})) if (v !== undefined && v !== null) p.set(k, typeof v === "string" ? v : JSON.stringify(v));
  return p.toString();
}

/** The rail place that shows a thing of this type. A type no place shows has none (the click then does nothing, never a wrong place). */
const SUBJECT_PLACE: Readonly<Record<string, string>> = {
  record: "records", contact: "records", project: "chats", view: "records",
  file: "files", folder: "files", doc: "files", document: "files",
  chat: "chats", person: "chats", thread: "chats", channel: "chats", agent: "chats", message: "chats",
  call: "inbox", conversation: "inbox", mail: "inbox", email: "inbox", meeting: "inbox", event: "inbox",
  run: "automations", automation: "automations", journey: "automations",
  task: "chats", goal: "chats", artifact: "chats",
  vault: "vault", item: "vault",
};
export function placeForSubject(type: string): string | null {
  return SUBJECT_PLACE[type] ?? null;
}

/** The id a place should open from its hash: the subject when its type is one of `types`, else the first of `argKeys` that is set. */
export function openedId(t: HashTarget, types: readonly string[], argKeys: readonly string[]): string | null {
  if (t.subject && types.includes(t.subject.type)) return t.subject.id;
  for (const k of argKeys) {
    const v = t.args[k];
    if (v) return v;
  }
  return null;
}
