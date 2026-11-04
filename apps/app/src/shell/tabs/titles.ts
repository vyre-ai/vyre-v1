// A tab opened on an item (an automation, a record, a file, a chat, a task) is named for the item, not for its place: "Weekly digest", "Elena Rivera". The place's own name stays until the
// item's name arrives; a subject this does not know keeps the place's name. Opening the same item again finds its tab by key (tabKey = place + hash), so tabs are one per item.

export interface Ask {
  cap: string;
  input: Record<string, unknown>;
  name(out: unknown): string | null;
  /** Read when the first read gave no name: a chat with no name of its own is called by its first message. */
  next?: Ask;
  /** The name when nothing gave one. */
  empty?: string;
}

const obj = (v: unknown): Record<string, unknown> | null => (v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const text = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);
const at = (out: unknown, key: string, field: string): string | null => text(obj(obj(out)?.[key])?.[field]);

/** The first thing in a record's fields that reads as its name. */
export function recordTitle(fields: unknown): string | null {
  const f = obj(fields);
  if (!f) return null;
  for (const k of ["name", "title", "subject", "label"]) { const t = text(f[k]); if (t) return t; }
  for (const v of Object.values(f)) { const t = text(v); if (t) return t; }
  return null;
}

/** A chat's first message, cut short, as its tab's name. */
export function firstMessageTitle(out: unknown): string | null {
  const list = obj(out)?.["messages"];
  if (!Array.isArray(list)) return null;
  for (const m of list) {
    const body = text(obj(m)?.["body"]);
    if (body === null) continue;
    const one = body.replace(/\s+/g, " ");
    return one.length <= 32 ? one : `${one.slice(0, 31).trimEnd()}\u2026`;
  }
  return null;
}

/** What to read to name a tab opened on `subject`, or null for a subject with no name to read. */
export function titleAsk(subject: { type: string; id: string }, args: Readonly<Record<string, unknown>> = {}): Ask | null {
  const { type, id } = subject;
  switch (type) {
    case "automation": return { cap: "automations.get", input: { automationId: id }, name: (o) => at(o, "automation", "name") };
    // a record is read by its type and id; the tab's hash carries the type (a record opened without one keeps the place's name)
    case "record": case "contact": return typeof args["type"] !== "string" || args["type"] === "" ? null : { cap: "records.get", input: { type: args["type"], recordId: id }, name: (o) => recordTitle(obj(obj(o)?.["record"])?.["fields"]) };
    case "project": return { cap: "projects.get", input: { projectId: id }, name: (o) => at(o, "project", "title") };
    case "file": case "doc": case "document": return { cap: "files.get", input: { fileId: id }, name: (o) => at(o, "file", "name") };
    case "task": return { cap: "tasks.get", input: { taskId: id }, name: (o) => at(o, "task", "title") };
    case "goal": return { cap: "goals.get", input: { goalId: id }, name: (o) => at(o, "goal", "title") };
    case "run": return { cap: "runs.get", input: { runId: id }, name: (o) => at(o, "run", "name") };
    case "chat": case "thread": return { cap: "threads.get", input: { threadId: id }, name: (o) => at(o, "thread", "title"), next: { cap: "chat.messages.list", input: { threadId: id }, name: firstMessageTitle }, empty: "New chat" };
    default: return null;
  }
}

/** What to read to name a Records tab opened on a record type (its hash carries the type's key): the type's own plural, "Companies" in place of "Records". */
export function typeTitleAsk(place: string, args: Readonly<Record<string, unknown>>): Ask | null {
  const key = args["type"];
  if (place !== "records" || typeof key !== "string" || key === "") return null;
  return {
    cap: "schema.types.list", input: {},
    name: (o) => {
      const types = obj(o)?.["types"];
      const t = Array.isArray(types) ? types.map(obj).find((x) => x !== null && x["key"] === key) : undefined;
      return text(t?.["plural"]) ?? text(t?.["title"]);
    },
  };
}

/** What follow needs of a session: the read, and a live query on a thread that says when it changes. */
export interface TitleSession {
  call(cap: string, input: unknown): Promise<unknown>;
  hooks: { capQuery(cap: string, input?: unknown): { subscribe(listener: () => void): () => void } };
}

/**
 * Names a tab for its item: the name, else the next read (a chat's first message), else the ask's own empty name ("New chat"). A chat is read again whenever it changes, so the tab follows
 * its first message and its renames. Returns the stop.
 */
export function followTitle(session: TitleSession, target: { subject?: { type: string; id: string } }, ask: Ask, retitle: (title: string) => void): () => void {
  let off = false;
  const read = (a: Ask): Promise<string | null> => session.call(a.cap, a.input).then((out) => a.name(out) ?? (a.next ? read(a.next) : null), () => null);
  let latest = 0;
  const run = (): void => {
    const mine = ++latest;
    void read(ask).then((name) => { const t = name ?? ask.empty; if (!off && mine === latest && t) retitle(t); });
  };
  run();
  const sub = target.subject;
  const live = sub && (sub.type === "thread" || sub.type === "chat") ? session.hooks.capQuery("threads.get", { threadId: sub.id }) : null;
  const stop = live ? live.subscribe(run) : undefined;
  return () => { off = true; stop?.(); };
}
