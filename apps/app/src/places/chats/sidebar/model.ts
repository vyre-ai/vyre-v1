// Chats sidebar (spec 3.2, 2.23): the pure part. What each section shows, worked out from the capability answers (types from generated/types.ts).
// No React and no I/O here, so grouping, filters, the Cmd-digit map, next unread and the local new-chat row are tested without a renderer.
import type { CapMap } from "../../../../../../generated/types.ts";

export type RecentOut = CapMap["chat.recent"]["out"];
export type RecentItem = RecentOut["today"][number];
export type Channel = CapMap["channels.list"]["out"]["channels"][number];
export type Agent = CapMap["agents.list"]["out"]["agents"][number];
export type NeedsItem = CapMap["tasks.needs_you"]["out"]["items"][number];
export type Filter = NonNullable<CapMap["chat.recent"]["in"]["filter"]>;

export const FILTERS: readonly { key: Filter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "unread", label: "Unread" },
  { key: "people", label: "People" },
  { key: "agents", label: "Agents" },
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

export type SectionKey = "needs" | "faces" | "recent" | "channels";

/** A recent row as the sidebar draws it. `person` marks a chat with one person; `local` marks one made on this device that the server has not answered yet. */
export interface ChatRow {
  threadId: string;
  title: string;
  who: string;
  kind: "person" | "agent";
  unread: number;
  working: boolean;
  starred: boolean;
  lastAt: number;
  local: boolean;
}

/** Who a recent item is with. The chat capability lists agents by id; a chat with no agent is with a person (its title is their name). */
export function rowOf(item: RecentItem, agentName: (id: string) => string): ChatRow {
  const agent = item.agents[0];
  return {
    threadId: item.threadId,
    title: item.title,
    who: agent !== undefined ? agentName(agent) : item.title,
    kind: agent !== undefined ? "agent" : "person",
    unread: item.unread,
    working: item.working,
    starred: item.starred,
    lastAt: item.lastAt,
    local: item.threadId.startsWith(LOCAL_PREFIX),
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

/** The server filters; this is the same rule for rows already on the device (a local row with no agent counts as People). */
export function matchesFilter(row: ChatRow, f: Filter): boolean {
  return f === "all" || (f === "unread" && row.unread > 0) || (f === "people" && row.kind === "person") || (f === "agents" && row.kind === "agent");
}

/** Counts for the filter menu, from the unfiltered answer. */
export function filterCounts(recent: RecentOut, local: readonly ChatRow[], agentName: (id: string) => string): Record<Filter, number> {
  const all = [...local, ...GROUPS.flatMap((g) => recent[g.key].filter((i) => i.kind === "chat").map((i) => rowOf(i, agentName)))];
  const c: Record<Filter, number> = { all: all.length, unread: 0, people: 0, agents: 0 };
  for (const r of all) {
    if (matchesFilter(r, "unread")) c.unread++;
    if (matchesFilter(r, "people")) c.people++;
    if (matchesFilter(r, "agents")) c.agents++;
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
  | { key: string; type: "need"; item: NeedsItem }
  | { key: string; type: "face"; agent: Agent; digit?: number; working: boolean }
  | { key: string; type: "more"; label: string; to: "agents" | "unread" }
  | { key: string; type: "group"; label: string }
  | { key: string; type: "chat"; row: ChatRow }
  | { key: string; type: "channel"; channel: Channel; project: boolean }
  | { key: string; type: "empty"; text: string };

export interface SidebarInput {
  needs: readonly NeedsItem[];
  /** how many wait in all (the header says 7 while the sidebar lists the top 3) */
  needsTotal: number;
  faces: readonly Agent[];
  workingAgents: ReadonlySet<string>;
  groups: readonly Group[];
  channels: readonly Channel[];
  filter: Filter;
  closed: ReadonlySet<SectionKey>;
}

export function isProject(c: Channel): boolean {
  return c.recordId !== undefined;
}

/** Channels, then the Projects group beneath them (a project's own channel; the list already holds only what the person can see). Archived channels stay out. */
export function splitChannels(channels: readonly Channel[]): { plain: Channel[]; projects: Channel[] } {
  const live = channels.filter((c) => !c.archived);
  return { plain: live.filter((c) => !isProject(c)), projects: live.filter(isProject) };
}

/** The flat list, top to bottom, exactly as spec 3.2 orders it: Needs you (only when something waits), Starred faces, Recent, Channels. */
export function buildEntries(i: SidebarInput): Entry[] {
  const out: Entry[] = [];
  const open = (s: SectionKey): boolean => !i.closed.has(s);
  if (i.needs.length) {
    out.push({ key: "h:needs", type: "head", section: "needs", label: "Needs you", count: Math.max(i.needsTotal, i.needs.length), open: open("needs") });
    if (open("needs")) for (const n of i.needs) out.push({ key: `n:${n.task.id}`, type: "need", item: n });
  }
  out.push({ key: "h:faces", type: "head", section: "faces", label: "Agents", open: open("faces") });
  if (open("faces")) {
    const digits = faceDigits(i.faces);
    for (const a of i.faces) {
      const d = digits.get(a.agentId);
      out.push({ key: `f:${a.agentId}`, type: "face", agent: a, ...(d !== undefined ? { digit: d } : {}), working: i.workingAgents.has(a.agentId) });
    }
    out.push({ key: "f:all", type: "more", label: "All agents", to: "agents" });
  }
  out.push({ key: "h:recent", type: "head", section: "recent", label: "Chats", open: open("recent") });
  if (open("recent")) {
    const rows = i.groups.reduce((n, g) => n + g.rows.length, 0);
    if (!rows) out.push({ key: "e:recent", type: "empty", text: i.filter === "all" ? "No chats yet" : "Nothing here" });
    for (const g of i.groups) {
      out.push({ key: `g:${g.key}`, type: "group", label: g.label });
      for (const r of g.rows) out.push({ key: `c:${r.threadId}`, type: "chat", row: r });
    }
  }
  const { plain, projects } = splitChannels(i.channels);
  if (plain.length || projects.length) {
    out.push({ key: "h:channels", type: "head", section: "channels", label: "Channels", open: open("channels") });
    if (open("channels")) {
      for (const c of plain) out.push({ key: `ch:${c.channelId}`, type: "channel", channel: c, project: false });
      if (projects.length) {
        out.push({ key: "g:projects", type: "group", label: "Projects" });
        for (const c of projects) out.push({ key: `ch:${c.channelId}`, type: "channel", channel: c, project: true });
      }
    }
  }
  return out;
}

/** Entries a person can land on with the arrow keys, in order. */
export function selectable(entries: readonly Entry[]): string[] {
  return entries.filter((e) => e.type !== "group" && e.type !== "empty").map((e) => e.key);
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
