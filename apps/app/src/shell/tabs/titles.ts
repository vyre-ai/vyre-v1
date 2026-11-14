// A tab opened on an item (an automation, a record, a file, a chat, a task) is named for the item, not for its place: "Weekly digest", "Elena Rivera". The place's own name stays until the
// item's name arrives; a subject this does not know keeps the place's name. Opening the same item again finds its tab by key (tabKey = place + hash), so tabs are one per item.
import { chatName, hasRealTitle } from "../../../../../lib/chat-name.ts";
import { parseHash, subjectOf } from "../hash/hash.ts";
import { isJustMade } from "../session/just-made.ts";

export interface Ask {
  cap: string;
  input: Record<string, unknown>;
  name(out: unknown): string | null;
  /** Read when the first read gave no name. */
  next?: Ask;
  /** The name when nothing gave one. */
  empty?: string;
  /** A live read of the same thing: when it changes the name is read again (a rename shows on the tab). */
  live?: { cap: string; input: Record<string, unknown> };
  /** A name that needs more reads than the item's own (who is in a chat): asked first, and it wins when it answers (lib/chat-name.ts). */
  resolve?(out: unknown, call: (cap: string, input: unknown) => Promise<unknown>, meId: string): Promise<string | null>;
}

const obj = (v: unknown): Record<string, unknown> | null =>
  v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
const text = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);
const at = (out: unknown, key: string, field: string): string | null => text(obj(obj(out)?.[key])?.[field]);

/** The first thing in a record's fields that reads as its name. */
export function recordTitle(fields: unknown): string | null {
  const f = obj(fields);
  if (!f) return null;
  for (const k of ["name", "title", "subject", "label"]) {
    const t = text(f[k]);
    if (t) return t;
  }
  for (const v of Object.values(f)) {
    const t = text(v);
    if (t) return t;
  }
  return null;
}

/** What to read to name a tab opened on `subject`, or null for a subject with no name to read. */
export function titleAsk(
  subject: { type: string; id: string },
  args: Readonly<Record<string, unknown>> = {},
): Ask | null {
  const { type, id } = subject;
  switch (type) {
    case "automation":
      return { cap: "automations.get", input: { automationId: id }, name: (o) => at(o, "automation", "name") };
    // a record is read by its type and id; the tab's hash carries the type (a record opened without one keeps the place's name)
    case "record":
    case "contact":
      return typeof args["type"] !== "string" || args["type"] === ""
        ? null
        : {
            cap: "records.get",
            input: { type: args["type"], recordId: id },
            name: (o) => recordTitle(obj(obj(o)?.["record"])?.["fields"]),
          };
    case "project":
      return { cap: "projects.get", input: { projectId: id }, name: (o) => at(o, "project", "title") };
    case "file":
    case "doc":
    case "document":
      return { cap: "files.get", input: { fileId: id }, name: (o) => at(o, "file", "name") };
    case "task":
      return { cap: "tasks.get", input: { taskId: id }, name: (o) => at(o, "task", "title") };
    case "artifact":
      return { cap: "sites.get", input: { siteId: id }, name: (o) => at(o, "site", "name") };
    case "goal":
      return { cap: "goals.get", input: { goalId: id }, name: (o) => at(o, "goal", "title") };
    case "run":
      return { cap: "runs.get", input: { runId: id }, name: (o) => at(o, "run", "name") };
    // a chat's tab carries the chat's one name (lib/chat-name.ts), the same as the list and the header; a rename shows live; a blank chat is "New chat"; a message's first line never stands in
    case "chat":
    case "thread":
      return {
        cap: "threads.get",
        input: { threadId: id },
        live: { cap: "threads.get", input: { threadId: id } },
        name: (o) => {
          const t = at(o, "thread", "title");
          return hasRealTitle(t) ? t : null;
        },
        resolve: chatTabName,
        empty: "New chat",
      };
    case "agent":
      return agentAsk(id, (n) => n);
    default:
      return null;
  }
}

const agentAsk = (agentId: string, title: (name: string) => string): Ask => ({
  cap: "agents.get",
  input: { agentId },
  live: { cap: "agents.get", input: { agentId } },
  name: (o) => {
    const n = at(o, "agent", "name");
    return n === null ? null : title(n);
  },
});

/** A screen tab that shows one agent is named for it: its page by its name, its form as "Edit <name>". A new agent's form keeps "New agent" until it has an agent. */
export function screenAsk(screen: string | undefined, args: Readonly<Record<string, unknown>>): Ask | null {
  const id = typeof args["agentId"] === "string" && args["agentId"] !== "" ? args["agentId"] : null;
  if (id === null) return null;
  if (screen === "chats.agent-page") return agentAsk(id, (n) => n);
  if (screen === "chats.agent-form") return agentAsk(id, (n) => `Edit ${n}`);
  return null;
}

/** What to read to name a Records tab opened on a record type (its hash carries the type's key): the type's own plural, "Companies" in place of "Records". */
export function typeTitleAsk(place: string, args: Readonly<Record<string, unknown>>): Ask | null {
  const key = args["type"];
  if (place !== "records" || typeof key !== "string" || key === "") return null;
  return {
    cap: "schema.types.list",
    input: {},
    name: (o) => {
      const types = obj(o)?.["types"];
      const t = Array.isArray(types) ? types.map(obj).find((x) => x !== null && x["key"] === key) : undefined;
      return text(t?.["plural"]) ?? text(t?.["title"]);
    },
  };
}

/** The tab of a chat carries the chat's one name (lib/chat-name.ts), the same as the list and the header: a direct message is the person, else the title, else who is in it. */
async function chatTabName(
  out: unknown,
  call: (cap: string, input: unknown) => Promise<unknown>,
  meId: string,
): Promise<string | null> {
  const t = obj(obj(out)?.["thread"]);
  if (!t) return null;
  const agents = (Array.isArray(t["agents"]) ? t["agents"] : [])
    .map((a) => text(obj(a)?.["agentId"]))
    .filter((x): x is string => x !== null);
  const people = [
    ...new Set(
      (Array.isArray(t["members"]) ? t["members"] : [])
        .map(obj)
        .filter((m) => m !== null && m["kind"] === "person" && m["id"] !== meId)
        .map((m) => String(m!["id"])),
    ),
  ];
  const title = text(t["title"]);
  // a real title on a chat that is not a direct message needs no names
  if (hasRealTitle(title) && !(agents.length === 0 && people.length === 1)) return title;
  const names = new Map<string, string>();
  const read = async (cap: string, key: string, idKey: string): Promise<void> => {
    try {
      for (const r of (obj(await call(cap, {}))?.[key] as unknown[] | undefined) ?? []) {
        const o = obj(r);
        const id = text(o?.[idKey]);
        const n = text(o?.["name"]);
        if (id && n) names.set(id, n);
      }
    } catch {
      /* the name stays the id */
    }
  };
  await Promise.all([
    agents.length ? read("agents.list", "agents", "agentId") : Promise.resolve(),
    people.length ? read("access.principals.list", "principals", "id") : Promise.resolve(),
  ]);
  // a blank chat (no title, nobody else in it) has no name of its own yet: the tab says "New chat"
  const name = chatName({ title, kind: text(t["kind"]) ?? "chat", agents, people }, (id) => names.get(id) ?? "Someone");
  return name === "Chat" ? null : name;
}

/** What follow needs of a session: the read, and a live query on a thread that says when it changes. */
export interface TitleSession {
  call(cap: string, input: unknown): Promise<unknown>;
  me?: { id: string };
  hooks: { capQuery(cap: string, input?: unknown): { subscribe(listener: () => void): () => void } };
}

/**
 * Names a tab for its item: its one name (a chat: lib/chat-name.ts), else its own name, else the next read, else the ask's own empty name ("New chat"). A chat is read again whenever it changes, so the tab follows
 * its renames. Returns the stop.
 */
/** What a chat tab says when the chat cannot be opened: the place, nothing false about the chat. */
export const REFUSED_CHAT_TAB = "Chats";
/** A read the server refused (not yours or not found): permission.* or validation.not_found. */
export const isRefusedRead = (e: unknown): boolean => {
  const c = (e as { code?: unknown } | null)?.code;
  return typeof c === "string" && (c.startsWith("permission.") || c === "validation.not_found");
};

/**
 * Three links to chats the person cannot open would leave three tabs that all say "Chats". The tab that was just found refused keeps its place; an older refusal tab (an item tab named "Chats", not the place's own
 * tab, which has no item) is the one to close, unless it is the one on screen, in which case the new one goes instead. Returns the key to close, or null.
 */
export function staleRefusalTab(
  tabs: ReadonlyArray<{ key: string; title: string; hash?: string | undefined; pinned?: boolean | undefined }>,
  justRefused: string,
  active: string,
): string | null {
  const refused = (t: { title: string; hash?: string | undefined; pinned?: boolean | undefined }): boolean =>
    t.title === REFUSED_CHAT_TAB && t.hash !== undefined && t.hash !== "" && t.pinned !== true;
  const older = tabs.find((t) => t.key !== justRefused && refused(t));
  if (older === undefined) return null;
  return older.key === active ? justRefused : older.key;
}

export function followTitle(
  session: TitleSession,
  ask: Ask,
  retitle: (title: string, empty?: boolean) => void,
  o: { retryMs?: number } = {},
): () => void {
  let off = false;
  // a read that failed is not an item with no name: it is "unknown yet" (undefined). A chat just made may not be readable for a moment; naming its tab "New chat" and marking it blank then made "+" select it instead of opening a new tab.
  const read = (a: Ask): Promise<string | null | undefined> =>
    session.call(a.cap, a.input).then(
      async (out) => {
        // the item's one name first when it needs more reads (a chat: who is in it); then its own name; then the next read
        const full = a.resolve ? await a.resolve(out, session.call, session.me?.id ?? "").catch(() => null) : null;
        return full ?? a.name(out) ?? (a.next ? read(a.next) : null);
      },
      (e) => {
        // a chat the person cannot open is not "New chat": the tab says only the place. Every other failed read is "unknown yet"
        // (undefined): the tab keeps its name and the read is asked again. A chat just made is not refused, only not readable yet.
        const tid = (a.input as { threadId?: unknown } | null | undefined)?.threadId;
        const landing = typeof tid === "string" && isJustMade(tid);
        return ask.empty === "New chat" && isRefusedRead(e) && !landing ? REFUSED_CHAT_TAB : undefined;
      },
    );
  let latest = 0;
  let tries = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const run = (): void => {
    const mine = ++latest;
    void read(ask).then((name) => {
      if (off || mine !== latest) return;
      if (name === undefined) {
        // keep the name the tab has and ask again in a moment (a few times; the live subscription asks too when the item changes)
        if (tries++ < 8) timer = setTimeout(run, o.retryMs ?? 1500);
        return;
      }
      tries = 0;
      const t = name ?? ask.empty;
      if (t) retitle(t, name === null);
    });
  };
  run();
  const live = ask.live ? session.hooks.capQuery(ask.live.cap, ask.live.input) : null;
  const stop = live ? live.subscribe(run) : undefined;
  return () => {
    off = true;
    if (timer) clearTimeout(timer);
    stop?.();
  };
}

/** The ask that names the tab showing `hash` in `place`, or null for a place's own tab and anything with no name to read. */
export function askForHash(place: string, hash: string): Ask | null {
  const target = parseHash(hash);
  const subject = subjectOf(target);
  return subject
    ? titleAsk(subject, target.args)
    : (screenAsk(target.screen, target.args) ?? typeTitleAsk(place, target.args));
}

export interface TabSource {
  tabs(): ReadonlyArray<{ key: string; place: string; hash?: string; isNew?: boolean }>;
  subscribe(listener: () => void): () => void;
}

/**
 * A tab has no title of its own: its label is the current name of the item it shows. Every tab on an item is followed, the selected one or not, so a chat that is named (or renamed) while another tab is
 * selected changes on its tab at once, and a tab restored from the last launch is read again. A tab that is closed, or that now shows another item, stops being followed. Returns the stop.
 */
export function followAllTabs(
  session: TitleSession,
  source: TabSource,
  retitle: (key: string, title: string, empty?: boolean) => void,
): () => void {
  const followers = new Map<string, { sig: string; stop: () => void }>();
  const sync = (): void => {
    const live = new Set<string>();
    for (const tab of source.tabs()) {
      if (tab.isNew === true || tab.hash === undefined || tab.hash === "") continue;
      const ask = askForHash(tab.place, tab.hash);
      if (!ask) continue;
      live.add(tab.key);
      const sig = `${tab.place}|${tab.hash}`;
      if (followers.get(tab.key)?.sig === sig) continue;
      followers.get(tab.key)?.stop();
      const key = tab.key;
      followers.set(key, { sig, stop: followTitle(session, ask, (t, empty) => retitle(key, t, empty)) });
    }
    for (const [k, f] of followers)
      if (!live.has(k)) {
        f.stop();
        followers.delete(k);
      }
  };
  sync();
  const off = source.subscribe(sync);
  return () => {
    off();
    for (const f of followers.values()) f.stop();
    followers.clear();
  };
}
