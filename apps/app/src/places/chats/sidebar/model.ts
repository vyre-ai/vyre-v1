// Chats sidebar (spec 3.2, 2.23): the pure part. What each section shows, worked out from the capability answers (types from generated/types.ts).
// No React and no I/O here, so grouping, filters, the Cmd-digit map, next unread and the local new-chat row are tested without a renderer.
import { chatName } from "../../../../../../lib/chat-name.ts";
import type { CapMap } from "../../../../../../generated/types.ts";
import type { ImportedRow } from "../imported/model.ts";
import type { TeamNow } from "../../../shell/team/now.ts";
import type { GoalLine } from "../goals/model.ts";
import { PROJECTS_SHOWN } from "../projects/model.ts";
import type { ProjectLine } from "../projects/model.ts";

export type RecentOut = CapMap["chat.recent"]["out"];
export type RecentItem = RecentOut["today"][number];
export type Channel = CapMap["channels.list"]["out"]["channels"][number];
export type Agent = CapMap["agents.list"]["out"]["agents"][number];
export type NeedsItem = CapMap["tasks.needs_you"]["out"]["items"][number];
export type Filter = NonNullable<CapMap["chat.recent"]["in"]["filter"]>;

/** The sidebar's filter menu. The server filters All and Unread; Needs you and Running are read off the rows. */
export type SideFilter = "all" | "unread" | "needs" | "running" | "asks";
export const FILTERS: readonly { key: SideFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "unread", label: "Unread" },
  { key: "needs", label: "Needs you" },
  { key: "running", label: "Running" },
  // the Ask history: every Ask pane you opened beside something in another place (they stay out of Recent until you ask for them here)
  { key: "asks", label: "Asks" },
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

export type SectionKey = "now" | "goals" | "projects" | "team" | "people" | "faces" | "recent" | "channels" | "imported" | "archived";

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
  /** New replies, to messages you follow, in this chat: its row is bold with this count. */
  repliesUnread?: number | undefined;
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
  /** A direct message: no agent and exactly one other person. It lives under People, not in Recent. A people-only group chat is not one. */
  direct?: boolean;
  /** A chat with one agent and nobody else: its unread is also the agent row's, so the agent row shows it only while this row is not drawn. */
  solo?: boolean;
  /** A goal's own chat: its Goal row opens it, so it is not listed again among the chats. */
  goalId?: string;
  /** I muted it: it does not shout (no unread on the row, nothing toward the totals) and it sits at the end of its group. */
  muted?: boolean;
}

/** The one person a direct message is with: a chat with no agent and exactly one other person. Null for anything else (an older server that names nobody, too). */
export function dmPerson(item: Pick<RecentItem, "kind" | "agents"> & { people?: readonly string[] | undefined }): string | null {
  return item.kind === "chat" && item.agents.length === 0 && item.people?.length === 1 ? item.people[0]! : null;
}

/** Who a recent item is with. The chat capability lists agents by id; a chat with no agent is with a person: a direct message goes by that person's name (`personName`), unless someone titled it. */
export function rowOf(item: RecentItem, agentName: (id: string) => string, personName?: (id: string) => string): ChatRow {
  const agent = item.agents[0];
  const person = dmPerson(item);
  const name = person !== null && personName ? personName(person) : null;
  return {
    threadId: item.threadId,
    // one name for a chat, the same in the list, the header, the tabs and search (lib/chat-name.ts): a direct message is the person, any other chat its title, else who is in it
    title: chatName({ title: item.title, kind: item.kind, agents: item.agents, people: item.people ?? [] }, (id) => (id.startsWith("agt_") || id === "assistant" ? agentName(id) : personName ? personName(id) : id)),
    who: agent !== undefined ? agentName(agent) : name ?? item.title,
    ...(agent !== undefined ? { whoId: agent } : person !== null ? { whoId: person } : {}),
    kind: agent !== undefined ? "agent" : "person",
    ...(item.agents.length > 1 ? { members: item.agents.slice(0, 3).map((id) => ({ id, name: agentName(id) })) } : {}),
    unread: item.unread,
    ...(item.repliesUnread ? { repliesUnread: item.repliesUnread } : {}),
    working: item.working,
    starred: item.starred,
    lastAt: item.lastAt,
    local: item.threadId.startsWith(LOCAL_PREFIX),
    withPeople: item.agents.length === 0,
    // an older server that names nobody: a chat with no agent was a direct message there, as before
    ...(person !== null || (item.kind === "chat" && item.agents.length === 0 && item.people === undefined) ? { direct: true } : {}),
    ...(item.kind === "chat" && item.agents.length === 1 && !(item.people?.length) ? { solo: true } : {}),
    ...((item as { goalId?: string }).goalId ? { goalId: (item as { goalId?: string }).goalId } : {}),
  };
}

export interface Group { key: GroupKey; label: string; rows: ChatRow[] }

/** The four groups in order, empty ones left out. A local row sits first in Today. */
export function groupRecent(recent: RecentOut, local: readonly ChatRow[], agentName: (id: string) => string, personName?: (id: string) => string): Group[] {
  const out: Group[] = [];
  for (const g of GROUPS) {
    const rows = recent[g.key].filter((i) => i.kind === "chat").map((i) => rowOf(i, agentName, personName));
    if (g.key === "today") rows.unshift(...local);
    if (rows.length) out.push({ key: g.key, label: g.label, rows });
  }
  return out;
}

/** The chats I archived, newest first as the server sent them: the Archived section at the foot. An older server that sends none has none. */
export function archivedRows(recent: RecentOut, agentName: (id: string) => string, personName?: (id: string) => string): ChatRow[] {
  return (recent.archived ?? []).filter((i) => i.kind === "chat").map((i) => ({ ...rowOf(i, agentName, personName), archived: true }));
}

// ---------------------------------------------------------------- unread, everywhere a conversation shows

/** The chats of the day groups once each (an archived chat is quiet: it counts nowhere until it comes back). */
function liveItems(recent: RecentOut): RecentItem[] {
  const seen = new Set<string>();
  const out: RecentItem[] = [];
  for (const g of GROUPS) for (const i of recent[g.key]) if (!seen.has(i.threadId)) { seen.add(i.threadId); out.push(i); }
  return out;
}

/** Unread in my direct message with each person, by person id: the People rows' dot. */
export function personUnread(recent: RecentOut): Map<string, number> {
  const m = new Map<string, number>();
  for (const i of liveItems(recent)) { const p = dmPerson(i); if (p !== null && i.unread > 0) m.set(p, (m.get(p) ?? 0) + i.unread); }
  return m;
}

/** My direct message with each person, by person id: what their row's menu marks read or unread. */
export function dmThreads(recent: RecentOut): Map<string, string> {
  const m = new Map<string, string>();
  for (const i of liveItems(recent)) { const p = dmPerson(i); if (p !== null && !m.has(p)) m.set(p, i.threadId); }
  return m;
}

/** Unread in my chats with each agent alone (no other person, no second agent), by agent id: the Agents rows' dot. */
export function agentUnread(recent: RecentOut): Map<string, number> {
  const m = new Map<string, number>();
  for (const i of liveItems(recent)) {
    const a = i.agents[0];
    if (i.kind === "chat" && a !== undefined && i.agents.length === 1 && !((i as { people?: readonly string[] }).people?.length) && i.unread > 0) m.set(a, (m.get(a) ?? 0) + i.unread);
  }
  return m;
}

/**
 * The People list in one stable order (lane l-polish L5): the people I talk with most recently first (my direct message's last activity), then everyone else by name. Reading a message never
 * moves anyone; an unread one is kept above "N more" by buildEntries instead.
 */
export function orderPeople<P extends { id: string; name: string }>(people: readonly P[], unread: ReadonlyMap<string, number>, recent: RecentOut | null): (P & { unread: number })[] {
  const last = new Map<string, number>();
  if (recent) for (const i of liveItems(recent)) { const p = dmPerson(i); if (p !== null) last.set(p, Math.max(last.get(p) ?? 0, i.lastAt)); }
  return people.map((p) => ({ ...p, unread: unread.get(p.id) ?? 0 }))
    .sort((a, b) => (last.get(b.id) ?? -1) - (last.get(a.id) ?? -1) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

/** The People list with each person's unread, the ones with something new first (so "N more" never hides one); otherwise the Space's order. */
export function peopleWithUnread<P extends { id: string; name: string }>(people: readonly P[], unread: ReadonlyMap<string, number>): (P & { unread: number })[] {
  const all = people.map((p) => ({ ...p, unread: unread.get(p.id) ?? 0 }));
  return [...all.filter((p) => p.unread > 0), ...all.filter((p) => p.unread === 0)];
}

/** What I muted, as the sidebar asks it: a chat or channel thread, a channel, a person or an agent. Absent: nothing is muted. */
export type MutedFn = (kind: "thread" | "channel" | "person" | "agent", id: string) => boolean;
const NONE_MUTED: MutedFn = () => false;

/**
 * The one unread total (lane l-polish): new messages in my chats, my channels and the replies I follow, each counted once, and nothing from what I muted. The rail's Chats dot, the Unread filter and
 * the list all read this rule, so no number disagrees with another.
 */
export function unreadTotal(recent: RecentOut | null, channels: readonly Pick<Channel, "unread" | "channelId" | "mainThreadId">[], muted: MutedFn = NONE_MUTED): number {
  let n = 0;
  if (recent) {
    for (const i of liveItems(recent)) if (!muted("thread", i.threadId)) n += i.unread + (i.repliesUnread ?? 0);
  }
  for (const c of channels) if (!muted("channel", c.channelId) && !muted("thread", c.mainThreadId)) n += c.unread;
  return n;
}

/** Is anything new for me in Chats: a chat, a channel, or a thread I am in, not counting what I muted. The rail's Chats dot. */
export function anyUnread(recent: RecentOut | null, channels: readonly Pick<Channel, "unread">[], muted: MutedFn = NONE_MUTED): boolean {
  if (recent && ((recent as { threadsUnread?: number }).threadsUnread ?? 0) > 0) return true;
  return unreadTotal(recent, channels as readonly Pick<Channel, "unread" | "channelId" | "mainThreadId">[], muted) > 0;
}

/** A muted chat row: quiet (no unread, no replies count), marked, and so never lifted above "N more" for being new. */
export function quieted(r: ChatRow, muted: MutedFn): ChatRow {
  return muted("thread", r.threadId) ? { ...r, unread: 0, repliesUnread: undefined, muted: true } : r;
}

/** One stable order for chats: starred first, then the newest, ties by title and id, so reading a chat never moves it and two loads of the same data draw the same list. */
export function chatOrder(a: ChatRow, b: ChatRow): number {
  return Number(b.starred) - Number(a.starred) || Number(a.muted === true) - Number(b.muted === true) || b.lastAt - a.lastAt || a.title.localeCompare(b.title) || a.threadId.localeCompare(b.threadId);
}

/** The first `cap` of a list, plus every later item `keep` says must show (unread, starred, the open one), in list order; and how many stay behind "N more". */
export function capped<T>(all: readonly T[], cap: number, keep: (x: T) => boolean): { shown: T[]; hidden: number } {
  const shown = all.filter((x, n) => n < cap || keep(x));
  return { shown, hidden: all.length - shown.length };
}

// ---------------------------------------------------------------- folded groups, remembered per Space

/** Where the folded groups of one Space are kept on this device. */
export const foldedKey = (space: string): string => `vyre.sidebar.folded.${space}`;
const SECTIONS: readonly SectionKey[] = ["now", "goals", "projects", "team", "people", "faces", "recent", "channels", "imported", "archived"];
/** The folded groups read back (Team now starts folded when nothing was kept); anything that is not a group is dropped. */
export function readFolded(raw: string | null | undefined): Set<SectionKey> {
  if (!raw) return new Set<SectionKey>(["team"]);
  try {
    const v = JSON.parse(raw) as unknown;
    return new Set<SectionKey>(Array.isArray(v) ? v.filter((x): x is SectionKey => typeof x === "string" && (SECTIONS as readonly string[]).includes(x)) : ["team"]);
  } catch { return new Set<SectionKey>(["team"]); }
}
export function writeFolded(closed: ReadonlySet<SectionKey>): string {
  return JSON.stringify(SECTIONS.filter((x) => closed.has(x)));
}

/** The server filters; this is the same rule for rows already on the device (a local row with no agent counts as People). */
export function matchesFilter(row: ChatRow, f: SideFilter): boolean {
  return f === "all" || (f === "unread" && (row.unread > 0 || (row.repliesUnread ?? 0) > 0)) || (f === "needs" && row.waiting === true) || (f === "running" && row.working);
}

/** The shared search field: a row stays when every word of the query is in one of its texts (case-insensitive). An empty query keeps everything. */
export function matchesQuery(query: string, ...texts: readonly string[]): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const hay = texts.join(" ").toLowerCase();
  return words.every((w) => hay.includes(w));
}

/**
 * Counts for the filter menu, from the unfiltered answer: what each filter will show. Unread counts unread chats and, when given, unread channels (muted ones neither); Needs you is the Tasks count
 * when given, the same number the Tasks row and the rail say, so the menu never says 0 beside a 4.
 */
export function filterCounts(rows: readonly ChatRow[], o: { channels?: readonly Pick<Channel, "unread" | "channelId" | "mainThreadId">[]; muted?: MutedFn; needs?: number } = {}): Record<SideFilter, number> {
  const muted = o.muted ?? NONE_MUTED;
  const c: Record<SideFilter, number> = { all: rows.length, unread: 0, needs: 0, running: 0, asks: 0 };
  for (const r0 of rows) {
    const r = quieted(r0, muted);
    if (matchesFilter(r, "unread")) c.unread++;
    if (matchesFilter(r, "needs")) c.needs++;
    if (matchesFilter(r, "running")) c.running++;
  }
  for (const ch of o.channels ?? []) if (ch.unread > 0 && !muted("channel", ch.channelId) && !muted("thread", ch.mainThreadId)) c.unread++;
  if (o.needs !== undefined) c.needs = Math.max(c.needs, o.needs);
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
  return { label: t.kind === "approve" ? "Allow" : "Review", tone: "accent" };
}

// ---------------------------------------------------------------- the one flat list the sidebar draws

export type Entry =
  | { key: string; type: "head"; section: SectionKey; label: string; count?: number; open: boolean }
  | { key: string; type: "face"; agent: Agent; digit?: number; working: boolean; waiting: boolean; assistant?: boolean; unread?: number }
  | { key: string; type: "more"; label: string; to: "agents" | "unread" | "recent" | "people" | "faces" | "goals" | "projects" }
  /** The rows at the top: Tasks and Notes. */
  | { key: string; type: "nav"; to: "tasks" | "notes"; label: string; count: number; dot?: boolean }
  /** A goal: its lead's face, its title, a steady bar and what changes what you do (a two-line row, GOAL_ROW_H). */
  | { key: string; type: "goal"; goal: GoalLine }
  /** A project: its health dot and its name. */
  | { key: string; type: "project"; project: ProjectLine }
  /** A person of the Space: a press opens your chat with them. `presence` is their steady dot (online, away). */
  | { key: string; type: "person"; id: string; name: string; unread: number; presence?: "online" | "away" }
  /** While you were away (owner D21): one quiet row at the very top, only after an absence that had something in it; a press shows what happened. */
  | { key: string; type: "digest"; count: number }
  /** A line of Team now (owner D24): a teammate who is around, or an agent at work with where and for whom. */
  | { key: string; type: "pulse"; kind: "person" | "agent"; id: string; name: string; line: string; presence?: "online" | "away"; threadId?: string }
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
  /** The unseen While you were away digest, by its item count; null or absent draws no row. */
  digest?: { count: number } | null;
  /** Team now: who is around and what agents are doing. Absent in a Personal Space. */
  team?: TeamNow | null;
  /** The steady dot on each person (online or away), by person id. */
  presence?: ReadonlyMap<string, "online" | "away">;
  /** Your own Assistant, first under Agents. */
  assistant?: { agentId: string; name: string };
  /** What you owe, on the Tasks row. */
  tasksCount?: number;
  /** The Notes row is drawn (the shell has a Notes page). */
  notes?: boolean;
  /** Unread in my chats with each agent alone, by agent id: the face's dot. */
  agentUnread?: ReadonlyMap<string, number>;
  /** Chats with something waiting on you: they rise to Now. */
  waitingThreads?: ReadonlySet<string>;
  /** Your goals and the ones you help with, in the order the Goals group shows them (goals/model.ts sidebarGoals). */
  goals?: readonly GoalLine[];
  moreGoals?: boolean;
  /** The Space's projects, starred first (projects/model.ts sidebarProjects), shown after Goals. A Space with none shows no group. */
  projects?: readonly ProjectLine[];
  moreProjects?: boolean;
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
  /** The imported sessions I archived: they sit in the Archived section after the chats, newest first. */
  archivedImported?: readonly ImportedRow[];
  /** A Personal Space has no channels: the section and its entry points are left out. */
  personal?: boolean;
  /** The search box has text: a Channels section with no match is left out, not offered as empty. */
  searching?: boolean;
  /** What the middle shows (`openKeyOf`): its row is always drawn, past any "N more" (lane l-polish L6). */
  open?: string | null;
  /** The chats goals own: a goal's chat is its Goal row, never a second row in Now or Recent (lane l-polish L2). */
  goalThreads?: ReadonlySet<string>;
  /** What I muted: those rows do not shout and sit at the end of their group. */
  muted?: MutedFn;
  /** What I starred beyond chats (agents and channels, from stars.list): starred rows are never hidden behind "N more". */
  starred?: (kind: "agent" | "channel", id: string) => boolean;
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

/** The Goals group shows this many, then "N more". */
export const GOALS_SHOWN = 5;
/** Recent shows this many, then "N more"; unread, starred and open rows always show (lane l-polish). */
export const RECENT_SHOWN = 8;
/** People and Agents show this many, then "N more". */
export const LIST_SHOWN = 3;

/** The flat list, top to bottom: Tasks and Notes, then Now (running and waiting rise here), Recent, Channels, People, Agents. Every list survives 300 rows: each folds, and long ones stop at "N more". */
export function buildEntries(i: SidebarInput): Entry[] {
  const out: Entry[] = [];
  const open = (s: SectionKey): boolean => !i.closed.has(s);
  const err = (s: SectionKey): Entry[] => { const e = i.errors?.[s]; return e ? [{ key: `x:${s}`, type: "error", section: s, text: e.text, cause: e.cause, ...(e.code ? { code: e.code } : {}), ...(e.traceId ? { traceId: e.traceId } : {}) }] : []; };
  if (!i.searching && i.digest && i.digest.count > 0) out.push({ key: "digest", type: "digest", count: i.digest.count });
  if (!i.searching) {
    out.push({ key: "nav:tasks", type: "nav", to: "tasks", label: "Tasks", count: i.tasksCount ?? 0 });
    if (i.notes) out.push({ key: "nav:notes", type: "nav", to: "notes", label: "Notes", count: 0 });
  }
  const muted = i.muted ?? NONE_MUTED;
  const starredOf = i.starred ?? (() => false);
  const filtered = i.filter !== undefined && i.filter !== "all";
  // a filter narrows every group to what it is about, and shows all of it (no "N more" under a filter)
  const all = (more: boolean | undefined): boolean => more === true || i.searching === true || filtered;
  // Goals sit under Tasks: what needs you first. A Space with none shows no group. Under a filter only Needs you keeps goals: the ones waiting on you or stuck.
  const goals = (i.goals ?? []).filter((g) => !filtered || (i.filter === "needs" && (g.status === "waiting" || g.status === "stuck")));
  if (!i.searching && goals.length > 0) {
    out.push({ key: "h:goals", type: "head", section: "goals", label: "Goals", count: goals.length, open: open("goals") });
    if (open("goals")) {
      const { shown, hidden } = all(i.moreGoals) ? { shown: goals, hidden: 0 } : capped(goals, GOALS_SHOWN, (g) => g.status === "waiting" || g.status === "stuck" || i.open === `g:${g.id}`);
      for (const g of shown) out.push({ key: `g:${g.id}`, type: "goal", goal: g });
      if (hidden > 0) out.push({ key: "m:goals", type: "more", label: `${hidden} more`, to: "goals" });
    }
  }
  // Projects sit right after Goals. They carry no unread or running state, so a filter leaves them out.
  const projectLines = filtered ? [] : i.projects ?? [];
  if (!i.searching && projectLines.length > 0) {
    out.push({ key: "h:projects", type: "head", section: "projects", label: "Projects", count: projectLines.length, open: open("projects") });
    if (open("projects")) {
      const { shown, hidden } = all(i.moreProjects) ? { shown: projectLines, hidden: 0 } : capped(projectLines, PROJECTS_SHOWN, (p) => p.starred || i.open === `p:${p.id}`);
      for (const p of shown) out.push({ key: `pj:${p.id}`, type: "project", project: p });
      if (hidden > 0) out.push({ key: "m:projects", type: "more", label: `${hidden} more`, to: "projects" });
    }
  }
  const rows = i.groups.flatMap((g) => g.rows);
  // each chat once, never a goal's own chat (the Goal row is its door), and a muted one made quiet
  const unique = rows.filter((r, n) => rows.findIndex((x) => x.threadId === r.threadId) === n && i.goalThreads?.has(r.threadId) !== true && r.goalId === undefined).map((r) => quieted(r, muted));
  const isNow = (r: ChatRow): boolean => r.working || i.waitingThreads?.has(r.threadId) === true;
  const now = unique.filter(isNow);
  // a direct message is the person's row under People; every other chat, a people-only group chat too ("Offsite planning", lane l-polish L9), is in Recent
  const rest = unique.filter((r) => !isNow(r) && r.direct !== true).sort(chatOrder);
  if (now.length) {
    out.push({ key: "h:now", type: "head", section: "now", label: "Now", count: now.length, open: open("now") });
    if (open("now")) for (const r of now) out.push({ key: `c:${r.threadId}`, type: "chat", row: r });
  }
  // Team now: collapsed until opened (the sidebar starts with it closed); a head with nobody around and no agent at work is not drawn
  const team = i.team;
  if (team && !i.personal && !i.searching && i.filter === "all" && (team.people.length || team.agents.length)) {
    out.push({ key: "h:team", type: "head", section: "team", label: "Team now", count: team.people.length + team.agents.length, open: open("team") });
    if (open("team")) {
      for (const a of team.agents) out.push({ key: `w:${a.id}`, type: "pulse", kind: "agent", id: a.id, name: a.name, line: a.line, ...(a.threadId ? { threadId: a.threadId } : {}) });
      for (const p of team.people) out.push({ key: `o:${p.id}`, type: "pulse", kind: "person", id: p.id, name: p.name, line: p.state === "away" ? "Away" : "Online", presence: p.state });
    }
  }
  out.push({ key: "h:recent", type: "head", section: "recent", label: "Recent", count: rest.length, open: open("recent") });
  if (open("recent")) {
    out.push(...err("recent"));
    if (!rest.length && !now.length && !i.errors?.recent) out.push({ key: "e:recent", type: "empty", text: i.filter === "all" ? "No chats yet" : "Nothing here" });
    // unread, starred and the open chat never sit behind "N more"
    const { shown, hidden } = all(i.moreRecent) ? { shown: rest, hidden: 0 } : capped(rest, RECENT_SHOWN, (r) => r.unread > 0 || (r.repliesUnread ?? 0) > 0 || r.starred || i.open === `t:${r.threadId}`);
    for (const r of shown) out.push({ key: `c:${r.threadId}`, type: "chat", row: r });
    if (hidden > 0) out.push({ key: "m:recent", type: "more", label: `${hidden} more`, to: "recent" });
  }
  // the chat rows on screen: an agent's own row shows its unread only while its chat is not one of them
  const drawn = new Set(out.flatMap((e) => (e.type === "chat" ? [e.row.threadId] : [])));
  {
    // a project's channel belongs to the project (its Chat tab): with the Projects group above, the channel list does not repeat it
    const split = splitChannels(i.channels);
    const chMuted = (c: Channel): boolean => muted("channel", c.channelId) || muted("thread", c.mainThreadId);
    const keepCh = (c: Channel): boolean => !filtered || (i.filter === "unread" && c.unread > 0 && !chMuted(c));
    // starred first, muted last, otherwise the Space's order; a muted channel shows no count
    const chOrder = (list: readonly Channel[]): Channel[] => list.map((c, n) => ({ c, n })).sort((a, b) => Number(starredOf("channel", b.c.channelId)) - Number(starredOf("channel", a.c.channelId)) || Number(chMuted(a.c)) - Number(chMuted(b.c)) || a.n - b.n).map((x) => (chMuted(x.c) ? { ...x.c, unread: 0 } : x.c)).filter(keepCh);
    const plain = chOrder(split.plain);
    const projects = (i.projects?.length ?? 0) > 0 ? [] : chOrder(split.projects);
    if (!i.personal && (plain.length || projects.length || i.errors?.channels || (!i.searching && !filtered))) {
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
    const people = (i.people ?? []).map((p) => (muted("person", p.id) ? { ...p, unread: 0 } : p)).filter((p) => !filtered || (i.filter === "unread" && (p.unread ?? 0) > 0));
    if (people.length) {
      out.push({ key: "h:people", type: "head", section: "people", label: "People", count: people.length, open: open("people") });
      if (open("people")) {
        const openDm = i.open?.startsWith("t:") ? rows.find((r) => r.direct === true && `t:${r.threadId}` === i.open)?.whoId : undefined;
        const { shown, hidden } = all(i.morePeople) ? { shown: people, hidden: 0 } : capped(people, LIST_SHOWN, (p) => (p.unread ?? 0) > 0 || p.id === openDm);
        for (const p of shown) { const mark = i.presence?.get(p.id); out.push({ key: `p:${p.id}`, type: "person", id: p.id, name: p.name, unread: p.unread ?? 0, ...(mark ? { presence: mark } : {}) }); }
        if (hidden > 0) out.push({ key: "m:people", type: "more", label: `${hidden} more`, to: "people" });
      }
    }
    // an agent's unread is its own chats' unread that is not already on a drawn row (one unread, shown once); without the rows (an older caller) the given counts stand
    const solo = unique.filter((r) => r.solo === true && r.whoId !== undefined);
    const unreadOfId = (id: string): number => (solo.length || !i.agentUnread ? solo.filter((r) => r.whoId === id && !drawn.has(r.threadId) && !muted("agent", id)).reduce((n, r) => n + r.unread, 0) : (i.agentUnread.get(id) ?? 0));
    const unreadOf = (id: string): { unread?: number } => { const n = unreadOfId(id); return n > 0 ? { unread: n } : {}; };
    const faceKeep = (a: Agent): boolean => !filtered || (i.filter === "unread" && unreadOfId(a.agentId) > 0) || (i.filter === "needs" && i.waitingAgents?.has(a.agentId) === true) || (i.filter === "running" && i.workingAgents.has(a.agentId));
    const faces = i.faces.filter(faceKeep);
    const assistant = i.assistant && (!filtered || (i.filter === "unread" && unreadOfId(i.assistant.agentId) > 0)) ? i.assistant : undefined;
    // a head with nothing under it says nothing: no agents to show, no Agents head
    const showFaces = assistant !== undefined || faces.length > 0 || (!filtered && ((i.facesMore ?? 0) > 0 || i.errors?.faces !== undefined));
    if (showFaces) out.push({ key: "h:faces", type: "head", section: "faces", label: "Agents", count: faces.length + (assistant ? 1 : 0) + (filtered ? 0 : i.facesMore ?? 0), open: open("faces") });
    if (showFaces && open("faces")) {
      out.push(...err("faces"));
      if (assistant) out.push({ key: `f:${assistant.agentId}`, type: "face", agent: assistant as Agent, working: false, waiting: false, assistant: true, ...unreadOf(assistant.agentId) });
      const digits = faceDigits(i.faces);
      const { shown, hidden: hiddenFaces } = all(i.moreAgents) ? { shown: faces, hidden: 0 } : capped(faces, LIST_SHOWN, (a) => i.waitingAgents?.has(a.agentId) === true || unreadOfId(a.agentId) > 0 || starredOf("agent", a.agentId) || i.open === `a:${a.agentId}`);
      for (const a of shown) {
        const d = digits.get(a.agentId);
        out.push({ key: `f:${a.agentId}`, type: "face", agent: a, ...(d !== undefined ? { digit: d } : {}), working: i.workingAgents.has(a.agentId), waiting: i.waitingAgents?.has(a.agentId) === true, ...unreadOf(a.agentId) });
      }
      const hidden = hiddenFaces;
      if (hidden > 0) out.push({ key: "m:faces", type: "more", label: `${hidden} more`, to: "faces" });
      if (hidden <= 0 && !filtered && (i.facesMore ?? 0) > 0) out.push({ key: "m:agents", type: "more", label: `All agents (${(i.facesMore ?? 0) + i.faces.length})`, to: "agents" });
    }
  }
  const archivedCount = (i.archived?.length ?? 0) + (i.archivedImported?.length ?? 0);
  if (archivedCount > 0) {
    out.push({ key: "h:archived", type: "head", section: "archived", label: "Archived", count: archivedCount, open: i.archivedOpen === true });
    if (i.archivedOpen === true) {
      for (const r of i.archived ?? []) out.push({ key: `c:${r.threadId}`, type: "chat", row: r });
      for (const r of i.archivedImported ?? []) out.push({ key: `i:${r.conversationId}`, type: "imported", row: r });
    }
  }
  if (i.imported?.length) {
    out.push({ key: "h:imported", type: "head", section: "imported", label: "Imported", count: i.imported.length, open: open("imported") });
    if (open("imported")) for (const r of i.imported) out.push({ key: `i:${r.conversationId}`, type: "imported", row: r });
  }
  return out;
}

/**
 * The row of what the middle shows (`openKeyOf` in mounts/route.ts), or null when it has none on screen: a chat is its row, else the channel whose thread it is, else the imported session that
 * was continued in it; an imported transcript, an agent's page, Tasks and Threads are their rows; Artifacts is the row above the list. Nothing else is ever drawn selected.
 */
export function openEntry(entries: readonly Entry[], open: string | null): string | null {
  if (!open) return null;
  const has = (k: string): string | null => (entries.some((e) => e.key === k) ? k : null);
  if (open === "artifacts") return "artifacts";
  if (open === "tasks" || open === "notes") return has(`nav:${open}`);
  if (open.startsWith("g:")) return has(open);
  if (open.startsWith("p:")) return has(`pj:${open.slice(2)}`);
  if (open.startsWith("i:")) return has(open);
  if (open.startsWith("a:")) return has(`f:${open.slice(2)}`);
  if (open.startsWith("t:")) {
    const id = open.slice(2);
    return has(`c:${id}`)
      ?? entries.find((e) => e.type === "channel" && e.channel.mainThreadId === id)?.key
      ?? entries.find((e) => e.type === "imported" && e.row.continuedThreadId === id)?.key
      ?? null;
  }
  return null;
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
