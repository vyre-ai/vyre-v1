// Chats sidebar (spec 3.2, 2.23): the pure part. What each section shows, worked out from the capability answers (types from generated/types.ts).
// No React and no I/O here, so grouping, filters, the Cmd-digit map, next unread and the local new-chat row are tested without a renderer.
import type { CapMap } from "../../../../../../generated/types.ts";
import type { ImportedRow } from "../imported/model.ts";
import type { TeamNow } from "../../../shell/team/now.ts";

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

export type SectionKey = "now" | "team" | "people" | "faces" | "recent" | "channels" | "imported" | "archived";

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
    title: name !== null && (item.title === "" || item.title === "New chat") ? name : item.title,
    who: agent !== undefined ? agentName(agent) : name ?? item.title,
    ...(agent !== undefined ? { whoId: agent } : person !== null ? { whoId: person } : {}),
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

/** The People list with each person's unread, the ones with something new first (so "N more" never hides one); otherwise the Space's order. */
export function peopleWithUnread<P extends { id: string; name: string }>(people: readonly P[], unread: ReadonlyMap<string, number>): (P & { unread: number })[] {
  const all = people.map((p) => ({ ...p, unread: unread.get(p.id) ?? 0 }));
  return [...all.filter((p) => p.unread > 0), ...all.filter((p) => p.unread === 0)];
}

/** Is anything new for me in Chats: a chat, a channel, or a thread I am in. The rail's Chats dot. */
export function anyUnread(recent: RecentOut | null, channels: readonly Pick<Channel, "unread">[]): boolean {
  if (recent && (liveItems(recent).some((i) => i.unread > 0) || ((recent as { threadsUnread?: number }).threadsUnread ?? 0) > 0)) return true;
  return channels.some((c) => c.unread > 0);
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
  | { key: string; type: "face"; agent: Agent; digit?: number; working: boolean; waiting: boolean; assistant?: boolean; unread?: number }
  | { key: string; type: "more"; label: string; to: "agents" | "unread" | "recent" | "people" | "faces" }
  /** The two rows at the top: Tasks and Threads. */
  | { key: string; type: "nav"; to: "tasks" | "threads"; label: string; count: number; dot?: boolean }
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
  threadsDot?: boolean;
  /** Unread in my chats with each agent alone, by agent id: the face's dot. */
  agentUnread?: ReadonlyMap<string, number>;
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
  /** The imported sessions I archived: they sit in the Archived section after the chats, newest first. */
  archivedImported?: readonly ImportedRow[];
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
  if (!i.searching && i.digest && i.digest.count > 0) out.push({ key: "digest", type: "digest", count: i.digest.count });
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
        for (const p of shown) { const mark = i.presence?.get(p.id); out.push({ key: `p:${p.id}`, type: "person", id: p.id, name: p.name, unread: p.unread ?? 0, ...(mark ? { presence: mark } : {}) }); }
        if (shown.length < people.length) out.push({ key: "m:people", type: "more", label: `${people.length - shown.length} more`, to: "people" });
      }
    }
    // a head with nothing under it says nothing: no agents to show, no Agents head
    const showFaces = i.assistant !== undefined || i.faces.length > 0 || (i.facesMore ?? 0) > 0 || i.errors?.faces !== undefined;
    if (showFaces) out.push({ key: "h:faces", type: "head", section: "faces", label: "Agents", count: i.faces.length + (i.assistant ? 1 : 0) + (i.facesMore ?? 0), open: open("faces") });
    if (showFaces && open("faces")) {
      out.push(...err("faces"));
      const unreadOf = (id: string): { unread?: number } => { const n = i.agentUnread?.get(id) ?? 0; return n > 0 ? { unread: n } : {}; };
      if (i.assistant) out.push({ key: `f:${i.assistant.agentId}`, type: "face", agent: i.assistant as Agent, working: false, waiting: false, assistant: true, ...unreadOf(i.assistant.agentId) });
      const digits = faceDigits(i.faces);
      const shown = i.moreAgents === true || i.searching ? i.faces : i.faces.slice(0, LIST_SHOWN);
      for (const a of shown) {
        const d = digits.get(a.agentId);
        out.push({ key: `f:${a.agentId}`, type: "face", agent: a, ...(d !== undefined ? { digit: d } : {}), working: i.workingAgents.has(a.agentId), waiting: i.waitingAgents?.has(a.agentId) === true, ...unreadOf(a.agentId) });
      }
      const hidden = i.faces.length - shown.length;
      if (hidden > 0) out.push({ key: "m:faces", type: "more", label: `${hidden} more`, to: "faces" });
      if (hidden <= 0 && (i.facesMore ?? 0) > 0) out.push({ key: "m:agents", type: "more", label: `All agents (${(i.facesMore ?? 0) + i.faces.length})`, to: "agents" });
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
  if (open === "tasks" || open === "threads") return has(`nav:${open}`);
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
