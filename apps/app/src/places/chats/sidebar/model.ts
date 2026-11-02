// Chats sidebar (spec 3.2, 2.23): the pure part. What each section shows, worked out from the capability answers (types from generated/types.ts).
// No React and no I/O here, so grouping, filters, the Cmd-digit map, next unread and the local new-chat row are tested without a renderer.
import type { CapMap } from "../../../../../../generated/types.ts";
import type { ImportedRow } from "../imported/model.ts";

export type RecentOut = CapMap["chat.recent"]["out"];
export type RecentItem = RecentOut["today"][number];
export type Channel = CapMap["channels.list"]["out"]["channels"][number];
export type Agent = CapMap["agents.list"]["out"]["agents"][number];
export type NeedsItem = CapMap["tasks.needs_you"]["out"]["items"][number];
export type Filter = NonNullable<CapMap["chat.recent"]["in"]["filter"]>;

/** The sidebar's filter menu. The server filters All and Unread; Needs you and Running are read off the rows. */
export type SideFilter = "all" | "unread" | "needs" | "running";
export const FILTERS: readonly { key: SideFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "unread", label: "Unread" },
  { key: "needs", label: "Needs you" },
  { key: "running", label: "Running" },
];

/** Cmd-1 to Cmd-9 jump to the first nine starred agent faces. */
export const MAX_DIGITS = 9;
/** A new chat shows as a row before the server answers; it is ready in under this many milliseconds (budget chat_open). */
export const NEW_CHAT_MS = 100;
export const LOCAL_PREFIX = "local_";

export type GroupKey = "starred" | "today" | "yesterday" | "earlier";
export const GROUPS: readonly { key: GroupKey; label: string }[] = [
  { key: "starred", label: "Starred" },
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "earlier", label: "Earlier" },
];

export type SectionKey = "now" | "people" | "faces" | "recent" | "channels" | "imported" | "archived";

/** A recent row as the sidebar draws it. `person` marks a chat with one person; `local` marks one made on this device that the server has not answered yet. */
export interface ChatRow {
  threadId: string;
  title: string;
  who: string;
  /** The agent's id when the chat is with an agent: the face is seeded by it. */
  whoId?: string | undefined;
  kind: "person" | "agent";
  /** A group chat: up to three of its agents, drawn as stacked faces. Absent for a chat with one. */
  members?: { id: string; name: string }[] | undefined;
  unread: number;
  working: boolean;
  /** Something in this chat waits on you: the amber ring. */
  waiting?: boolean;
  starred: boolean;
  lastAt: number;
  local: boolean;
  /** In my Archived section: the row menu offers Unarchive and the list keeps it quiet. */
  archived?: boolean;
  /** A chat with no agent is with other people (a direct message): the menu offers Leave chat, not Delete chat. */
  withPeople?: boolean;
}

/** Who a recent item is with. The chat capability lists agents by id; a chat with no agent is with a person (its title is their name). */
export function rowOf(item: RecentItem, agentName: (id: string) => string): ChatRow {
  const agent = item.agents[0];
  return {
    threadId: item.threadId,
    title: item.title,
    who: agent !== undefined ? agentName(agent) : item.title,
    ...(agent !== undefined ? { whoId: agent } : {}),
    kind: agent !== undefined ? "agent" : "person",
    ...(item.agents.length > 1 ? { members: item.agents.slice(0, 3).map((id) => ({ id, name: agentName(id) })) } : {}),
    unread: item.unread,
    working: item.working,
    starred: item.starred,
    lastAt: item.lastAt,
    local: item.threadId.startsWith(LOCAL_PREFIX),
    withPeople: item.agents.length === 0,
  };
}

export interface Group { key: GroupKey; label: string; rows: ChatRow[] }

/** The four groups in order, empty ones left out. A local row sits first in Today. */
export function groupRecent(recent: RecentOut, local: readonly ChatRow[], agentName: (id: string) => string): Group[] {
  const out: Group[] = [];
  for (const g of GROUPS) {
    const rows = recent[g.key].filter((i) => i.kind === "chat").map((i) => rowOf(i, agentName));
    if (g.key === "today") rows.unshift(...local);
    if (rows.length) out.push({ key: g.key, label: g.label, rows });
  }
  return out;
}

/** The chats I archived, newest first as the server sent them: the Archived section at the foot. An older server that sends none has none. */
export function archivedRows(recent: RecentOut, agentName: (id: string) => string): ChatRow[] {
  return (recent.archived ?? []).filter((i) => i.kind === "chat").map((i) => ({ ...rowOf(i, agentName), archived: true }));
}

/** The server filters; this is the same rule for rows already on the device (a local row with no agent counts as People). */
export function matchesFilter(row: ChatRow, f: SideFilter): boolean {
  return f === "all" || (f === "unread" && row.unread > 0) || (f === "needs" && row.waiting === true) || (f === "running" && row.working);
}

/** The shared search field: a row stays when every word of the query is in one of its texts (case-insensitive). An empty query keeps everything. */
export function matchesQuery(query: string, ...texts: readonly string[]): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const hay = texts.join(" ").toLowerCase();
  return words.every((w) => hay.includes(w));
}

/** Counts for the filter menu, from the unfiltered answer. */
export function filterCounts(rows: readonly ChatRow[]): Record<SideFilter, number> {
  const c: Record<SideFilter, number> = { all: rows.length, unread: 0, needs: 0, running: 0 };
  for (const r of rows) {
    if (matchesFilter(r, "unread")) c.unread++;
    if (matchesFilter(r, "needs")) c.needs++;
    if (matchesFilter(r, "running")) c.running++;
  }
  return c;
}

/** Starred agent faces in the order given; the first nine take Cmd-1 to Cmd-9. */
export function faceDigits(faces: readonly Agent[]): Map<string, number> {
  const m = new Map<string, number>();
  faces.slice(0, MAX_DIGITS).forEach((a, i) => m.set(a.agentId, i + 1));
  return m;
}

/** The face for a Cmd-digit press ("1".."9"), or undefined when fewer are starred. */
export function faceForDigit(faces: readonly Agent[], key: string): Agent | undefined {
  if (!/^[1-9]$/.test(key)) return undefined;
  return faces[Number(key) - 1];
}

/** A person-readable clock for a row: the time today, "Yesterday", the weekday this week, else the date. */
export function whenLabel(ts: number, now: number, offsetMin: number): string {
  const day = (t: number): number => Math.floor((t + offsetMin * 60_000) / 86_400_000);
  const d = day(now) - day(ts);
  const x = new Date(ts + offsetMin * 60_000);
  if (d <= 0) return `${x.getUTCHours()}:${String(x.getUTCMinutes()).padStart(2, "0")}`;
  if (d === 1) return "Yesterday";
  if (d < 7) return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][x.getUTCDay()]!;
  return `${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][x.getUTCMonth()]} ${x.getUTCDate()}`;
}

/** What a Needs you row says about itself: the verb on the right. */
export function needsKind(item: NeedsItem): { label: string; tone: "accent" | "warn" } {
  const t = item.task;
  if (t.kind === "unblock" || t.blocked) return { label: "Blocked", tone: "warn" };
  return { label: t.kind === "approve" ? "Approve" : "Review", tone: "accent" };
}

// ---------------------------------------------------------------- the one flat list the sidebar draws

export type Entry =
  | { key: string; type: "head"; section: SectionKey; label: string; count?: number; open: boolean }
  | { key: string; type: "face"; agent: Agent; digit?: number; working: boolean; waiting: boolean; assistant?: boolean }
  | { key: string; type: "more"; label: string; to: "agents" | "unread" | "recent" | "people" | "faces" }
  /** The two rows at the top: Tasks and Threads. */
  | { key: string; type: "nav"; to: "tasks" | "threads"; label: string; count: number; dot?: boolean }
  /** A person of the Space: a press opens your chat with them. */
  | { key: string; type: "person"; id: string; name: string; unread: number }
  | { key: string; type: "group"; label: string }
  | { key: string; type: "chat"; row: ChatRow }
  | { key: string; type: "channel"; channel: Channel; project: boolean }
  /** An imported coding session of the Imported group: its row opens the transcript, or the chat it was continued in. */
  | { key: string; type: "imported"; row: ImportedRow }
  | { key: string; type: "empty"; text: string }
  /** A row that does something when pressed (an empty Channels section offers "Create a channel"). */
  | { key: string; type: "action"; label: string; to: "new-channel" }
  /** A read of this section failed: one compact row under its head (the section's other reads and the other sections still draw). */
  | { key: string; type: "error"; section: SectionKey; text: string; cause: string; code?: string; traceId?: string };

/** What a failed read of a section says: the row's words, and the cause, code and trace id behind its menu. */
export interface SectionError { text: string; cause: string; code?: string; traceId?: string }

/** Retry on a failed row: ask the Space's live reads to read again (the remote hooks have `invalidate`; a stand-in without it has nothing to re-ask). True when a re-read was asked for. */
export function refetch(screens: object): boolean {
  const f = (screens as { invalidate?: () => void }).invalidate;
  if (typeof f !== "function") return false;
  f.call(screens);
  return true;
}

export interface SidebarInput {
  faces: readonly Agent[];
  /** Your own Assistant, first under Agents. */
  assistant?: { agentId: string; name: string };
  /** What you owe, on the Tasks row. */
  tasksCount?: number;
  threadsDot?: boolean;
  /** Chats with something waiting on you: they rise to Now. */
  waitingThreads?: ReadonlySet<string>;
  people?: readonly { id: string; name: string; unread?: number }[];
  moreRecent?: boolean;
  morePeople?: boolean;
  moreAgents?: boolean;
  workingAgents: ReadonlySet<string>;
  /** agents with something waiting on the person (any open Needs you item they raised, not only the top three); the face says "Waiting on you" */
  waitingAgents?: ReadonlySet<string>;
  groups: readonly Group[];
  channels: readonly Channel[];
  filter: SideFilter;
  closed: ReadonlySet<SectionKey>;
  /** Agents beyond the faces shown: a row under them opens All agents. */
  facesMore?: number;
  /** Sections whose read failed: the row under the head says so (and the section never says "empty"). */
  errors?: Partial<Record<SectionKey, SectionError>>;
  /** The chats I archived, already narrowed by the filter and the search box. The section is left out when there are none, and is collapsed until its head is pressed (`archivedOpen`). */
  archived?: readonly ChatRow[];
  archivedOpen?: boolean;
  /** The imported sessions, newest first, already narrowed by the search box. The group is left out when there are none. */
  imported?: readonly ImportedRow[];
  /** A Personal Space has no channels: the section and its entry points are left out. */
  personal?: boolean;
  /** The search box has text: a Channels section with no match is left out, not offered as empty. */
  searching?: boolean;
}

/** The Agents group shows this many agents (the Cmd-1..9 faces); a Space with more has an All agents row for the rest. */
export const FACES_SHOWN = 9;

export function isProject(c: Channel): boolean {
  return c.recordId !== undefined;
}

/** Channels, then the Projects group beneath them (a project's own channel; the list already holds only what the person can see). Archived channels stay out. */
export function splitChannels(channels: readonly Channel[]): { plain: Channel[]; projects: Channel[] } {
  const live = channels.filter((c) => !c.archived);
  return { plain: live.filter((c) => !isProject(c)), projects: live.filter(isProject) };
}

/** Recent shows this many, then "N more". */
export const RECENT_SHOWN = 3;
/** People and Agents show this many, then "N more". */
export const LIST_SHOWN = 3;

/** The flat list, top to bottom: Tasks and Threads, then Now (running and waiting rise here), Recent, Channels, People, Agents. Every list survives 300 rows: each folds, and long ones stop at "N more". */
export function buildEntries(i: SidebarInput): Entry[] {
  const out: Entry[] = [];
  const open = (s: SectionKey): boolean => !i.closed.has(s);
  const err = (s: SectionKey): Entry[] => { const e = i.errors?.[s]; return e ? [{ key: `x:${s}`, type: "error", section: s, text: e.text, cause: e.cause, ...(e.code ? { code: e.code } : {}), ...(e.traceId ? { traceId: e.traceId } : {}) }] : []; };
  if (!i.searching) {
    out.push({ key: "nav:tasks", type: "nav", to: "tasks", label: "Tasks", count: i.tasksCount ?? 0 });
    out.push({ key: "nav:threads", type: "nav", to: "threads", label: "Threads", count: 0, dot: i.threadsDot === true });
  }
  const rows = i.groups.flatMap((g) => g.rows);
  const unique = rows.filter((r, n) => rows.findIndex((x) => x.threadId === r.threadId) === n);
  const isNow = (r: ChatRow): boolean => r.working || i.waitingThreads?.has(r.threadId) === true;
  const now = unique.filter(isNow);
  const rest = unique.filter((r) => !isNow(r) && !(r.kind === "person" && r.withPeople === true));
  if (now.length) {
    out.push({ key: "h:now", type: "head", section: "now", label: "Now", count: now.length, open: open("now") });
    if (open("now")) for (const r of now) out.push({ key: `c:${r.threadId}`, type: "chat", row: r });
  }
  out.push({ key: "h:recent", type: "head", section: "recent", label: "Recent", count: rest.length, open: open("recent") });
  if (open("recent")) {
    out.push(...err("recent"));
    if (!rest.length && !now.length && !i.errors?.recent) out.push({ key: "e:recent", type: "empty", text: i.filter === "all" ? "No chats yet" : "Nothing here" });
    const shown = i.moreRecent === true || i.searching ? rest : rest.slice(0, RECENT_SHOWN);
    for (const r of shown) out.push({ key: `c:${r.threadId}`, type: "chat", row: r });
    if (shown.length < rest.length) out.push({ key: "m:recent", type: "more", label: `${rest.length - shown.length} more`, to: "recent" });
  }
  if (i.filter === "all") {
    const { plain, projects } = splitChannels(i.channels);
    if (!i.personal && (plain.length || projects.length || i.errors?.channels || !i.searching)) {
      out.push({ key: "h:channels", type: "head", section: "channels", label: "Channels", count: plain.length + projects.length, open: open("channels") });
      if (open("channels")) {
        out.push(...err("channels"));
        if (!plain.length && !projects.length && !i.errors?.channels) out.push({ key: "a:new-channel", type: "action", label: "Create a channel", to: "new-channel" });
        for (const c of plain) out.push({ key: `ch:${c.channelId}`, type: "channel", channel: c, project: false });
        if (projects.length) {
          out.push({ key: "g:projects", type: "group", label: "Projects" });
          for (const c of projects) out.push({ key: `ch:${c.channelId}`, type: "channel", channel: c, project: true });
        }
      }
    }
    const people = i.people ?? [];
    if (people.length) {
      out.push({ key: "h:people", type: "head", section: "people", label: "People", count: people.length, open: open("people") });
      if (open("people")) {
        const shown = i.morePeople === true || i.searching ? people : people.slice(0, LIST_SHOWN);
        for (const p of shown) out.push({ key: `p:${p.id}`, type: "person", id: p.id, name: p.name, unread: p.unread ?? 0 });
        if (shown.length < people.length) out.push({ key: "m:people", type: "more", label: `${people.length - shown.length} more`, to: "people" });
      }
    }
    // a head with nothing under it says nothing: no agents to show, no Agents head
    const showFaces = i.assistant !== undefined || i.faces.length > 0 || (i.facesMore ?? 0) > 0 || i.errors?.faces !== undefined;
    if (showFaces) out.push({ key: "h:faces", type: "head", section: "faces", label: "Agents", count: i.faces.length + (i.assistant ? 1 : 0) + (i.facesMore ?? 0), open: open("faces") });
    if (showFaces && open("faces")) {
      out.push(...err("faces"));
      if (i.assistant) out.push({ key: `f:${i.assistant.agentId}`, type: "face", agent: i.assistant as Agent, working: false, waiting: false, assistant: true });
      const digits = faceDigits(i.faces);
      const shown = i.moreAgents === true || i.searching ? i.faces : i.faces.slice(0, LIST_SHOWN);
      for (const a of shown) {
        const d = digits.get(a.agentId);
        out.push({ key: `f:${a.agentId}`, type: "face", agent: a, ...(d !== undefined ? { digit: d } : {}), working: i.workingAgents.has(a.agentId), waiting: i.waitingAgents?.has(a.agentId) === true });
      }
      const hidden = i.faces.length - shown.length;
      if (hidden > 0) out.push({ key: "m:faces", type: "more", label: `${hidden} more`, to: "faces" });
      if (hidden <= 0 && (i.facesMore ?? 0) > 0) out.push({ key: "m:agents", type: "more", label: `All agents (${(i.facesMore ?? 0) + i.faces.length})`, to: "agents" });
    }
  }
  if (i.archived?.length) {
    out.push({ key: "h:archived", type: "head", section: "archived", label: "Archived", count: i.archived.length, open: i.archivedOpen === true });
    if (i.archivedOpen === true) for (const r of i.archived) out.push({ key: `c:${r.threadId}`, type: "chat", row: r });
  }
  if (i.imported?.length) {
    out.push({ key: "h:imported", type: "head", section: "imported", label: "Imported", count: i.imported.length, open: open("imported") });
    if (open("imported")) for (const r of i.imported) out.push({ key: `i:${r.conversationId}`, type: "imported", row: r });
  }
  return out;
}

/** Entries a person can land on with the arrow keys, in order. */
export function selectable(entries: readonly Entry[]): string[] {
  return entries.filter((e) => e.type !== "group" && e.type !== "empty" && e.type !== "error").map((e) => e.key);
}

export function stepKey(order: readonly string[], from: string | null, dir: 1 | -1): string | null {
  if (!order.length) return null;
  const at = from === null ? -1 : order.indexOf(from);
  if (at < 0) return dir === 1 ? order[0]! : order[order.length - 1]!;
  return order[Math.max(0, Math.min(order.length - 1, at + dir))]!;
}

// ---------------------------------------------------------------- a new chat is a local row first

let localSeq = 0;

/** The row a new chat shows the moment it is asked for, before chat.start answers (budget: ready in under 100 ms). */
export function newLocalRow(who: string, kind: "person" | "agent", now: number): ChatRow {
  return { threadId: `${LOCAL_PREFIX}${++localSeq}`, title: "New chat", who, kind, unread: 0, working: false, starred: false, lastAt: now, local: true };
}

/** One idempotency key per local row, so a retry after a dropped answer starts the same chat. */
export function startKey(row: ChatRow): string {
  return `chat.start:${row.threadId}`;
}

/** The agents behind open Needs you items: each one's face says "Waiting on you" (prototype Agents section). */
export function waitingAgents(all: readonly NeedsItem[], assistantId?: string): Set<string> {
  // The assistant is your own: its requests are in Needs you, but its face never says "Waiting on you" (prototype).
  return new Set(all.filter((n) => n.task.createdBy !== assistantId).map((n) => n.task.createdBy));
}
