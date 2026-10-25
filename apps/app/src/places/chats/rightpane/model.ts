// The Chats right pane's logic, with no renderer: the five tabs, what a computer's state says, how a routine's schedule reads, which facts a filter keeps, how the
// agent's folder is walked. The pane follows the agent of the open chat (spec 3.2); nothing here reads the replica, so the tests drive every rule directly.
import type { CapMap } from "../../../../../../generated/types.ts";

export type TabKey = "computer" | "threads" | "files" | "memory" | "routines";
export const TABS: readonly { key: TabKey; title: string }[] = [
  { key: "computer", title: "Computer" },
  { key: "threads", title: "Threads" },
  { key: "files", title: "Files" },
  { key: "memory", title: "Memory" },
  { key: "routines", title: "Routines" },
];
export const DEFAULT_TAB: TabKey = "computer";

/* ---------- the tab strip at a narrow width ---------- */

/** The key of the strip's last tab when some are folded away: it opens a menu of the rest. */
export const MORE_KEY = "more";
/** The width the pane has before it is measured (ui/SidePane's default). */
export const PANE_WIDTH_GUESS = 340;
/** Everything in the pane header that is not a tab: the toggle, the strip's padding and its options button. */
export const HEADER_CHROME = 80;
const GLYPH_W = 6.8;
const TAB_CHROME = 20;
/** What a tab in ui/TabStrip adds around its text: 10 + 6 padding, 1 + 1 border, the 7 px gap, the 18 px close slot and the 2 px between tabs (measured off the 390 px shots). The text itself is measured on screen. */
export const TAB_EXTRA = 45;
/** The room one tab takes in the shared strip (12.5 px type, 10 + 6 padding, 2 gap). */
export function tabWidth(title: string): number {
  return tabW(title);
}
function tabW(title: string): number {
  return Math.ceil(title.length * GLYPH_W + TAB_CHROME);
}

export interface FittedTabs<T extends { key: string; title: string }> {
  shown: T[];
  hidden: T[];
}

/**
 * Which tabs the strip draws at `width` (the pane's own width). When all fit, all are shown. Otherwise the open tab is always shown, as many others as fit
 * follow in their own order, and the rest go behind a More tab. Nothing is ever clipped.
 */
export function fitTabs<T extends { key: string; title: string }>(
  tabs: readonly T[], active: string, width: number, o: { chrome?: number; widthOf?: (title: string) => number } = {},
): FittedTabs<T> {
  const tabWidth = o.widthOf ?? tabW;
  const room = width - (o.chrome ?? HEADER_CHROME);
  let total = 0;
  for (const t of tabs) total += tabWidth(t.title);
  if (total <= room) return { shown: tabs.slice(), hidden: [] };
  let left = room - tabWidth("More") - 2;
  const keep = new Set<string>();
  const open = tabs.find((t) => t.key === active);
  if (open) { keep.add(open.key); left -= tabWidth(open.title); }
  for (const t of tabs) {
    if (keep.has(t.key)) continue;
    const w = tabWidth(t.title);
    if (w > left) break;
    keep.add(t.key);
    left -= w;
  }
  return { shown: tabs.filter((t) => keep.has(t.key)), hidden: tabs.filter((t) => !keep.has(t.key)) };
}
export const PANE_KEY = "chats-right-pane";

export function isTabKey(v: string): v is TabKey {
  return TABS.some((t) => t.key === v);
}

export type Computer = CapMap["computers.get"]["out"]["computer"];
export type Session = CapMap["computers.sessions.list"]["out"]["sessions"][number];
export type Step = CapMap["computers.timeline"]["out"]["steps"][number];
export type Thread = CapMap["threads.list"]["out"]["threads"][number];
export type Helper = CapMap["chat.helpers.list"]["out"]["helpers"][number];
export type Fact = CapMap["memory.facts.list"]["out"]["facts"][number];
export type Routine = CapMap["agents.routines.list"]["out"]["routines"][number];
export type FileRow = CapMap["files.list"]["out"]["files"][number];
export type FolderRow = CapMap["files.list"]["out"]["folders"][number];
export type AgentRow = CapMap["agents.get"]["out"]["agent"];

/* ---------- time ---------- */

export interface Clock { now: number; offsetMin: number }
const DAY = 86_400_000;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const local = (ts: number, c: Clock): Date => new Date(ts + c.offsetMin * 60_000);
const two = (n: number): string => String(n).padStart(2, "0");
const dayNo = (ts: number, c: Clock): number => Math.floor((ts + c.offsetMin * 60_000) / DAY);

/** "17:00" in the person's offset. */
export function clock24(ts: number, c: Clock): string {
  const d = local(ts, c);
  return `${two(d.getUTCHours())}:${two(d.getUTCMinutes())}`;
}

/** "12 Oct". */
export function dayMonth(ts: number, c: Clock): string {
  const d = local(ts, c);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

/** A moment ahead: "Today 17:00", "Tomorrow 08:00", "Mon 17:00" within a week, else "12 Nov". */
export function nextLabel(ts: number, c: Clock): string {
  const gap = dayNo(ts, c) - dayNo(c.now, c);
  if (gap <= 0) return `Today ${clock24(ts, c)}`;
  if (gap === 1) return `Tomorrow ${clock24(ts, c)}`;
  if (gap < 7) return `${WEEKDAYS[local(ts, c).getUTCDay()]} ${clock24(ts, c)}`;
  return dayMonth(ts, c);
}

/** A moment behind: "just now", "5 min ago", "2 h ago", "Yesterday", else "12 Oct". */
export function agoLabel(ts: number, c: Clock): string {
  const mins = Math.floor((c.now - ts) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const gap = dayNo(c.now, c) - dayNo(ts, c);
  if (gap <= 0) return `${Math.floor(mins / 60)} h ago`;
  if (gap === 1) return "Yesterday";
  return dayMonth(ts, c);
}

/* ---------- the computer ---------- */

export interface ComputerView {
  label: string;
  /** what the screen shows: a moon when asleep, the live window while working, your hand when you took over */
  screen: "asleep" | "live" | "mine" | "busy" | "error";
  /** the quiet line under the status: tabs open, the host */
  detail: string;
  /** the one action the header offers */
  action: "wake" | "take" | "give" | null;
}

export function computerView(c: Computer): ComputerView {
  const tabs = `${c.tabs} of ${c.tabLimit} tabs`;
  switch (c.state) {
    case "asleep": return { label: "Asleep", screen: "asleep", detail: "Wakes when it has work", action: "wake" };
    case "waking": return { label: "Waking", screen: "busy", detail: "One moment", action: null };
    case "provisioning": return { label: "Setting up", screen: "busy", detail: "Its computer is being made", action: null };
    case "working": return { label: c.caption ? `Working: ${c.caption}` : "Working", screen: "live", detail: tabs, action: "take" };
    case "takeover": return { label: "You're in control", screen: "mine", detail: tabs, action: "give" };
    case "error": return { label: "Needs attention", screen: "error", detail: "It could not start", action: "wake" };
  }
}

export function stepsLine(n: number): string {
  return `${n} ${n === 1 ? "step" : "steps"}`;
}

/** The timeline, newest last, as the prototype lists it; a step you took reads "You took over". */
export function stepRows(steps: readonly Step[]): Step[] {
  return steps.slice().sort((a, b) => a.idx - b.idx);
}

export function stepWho(s: Step): string {
  return s.by === "person" ? "You" : s.tool;
}

/* ---------- threads ---------- */

export interface ThreadGroups {
  worked: Thread[];
  helpers: Helper[];
  chats: Thread[];
}

/** Threads the agent worked in (children of the open chat or channel), its running helpers first, and its own chats, newest first. */
export function groupThreads(agentId: string, children: readonly Thread[], helpers: readonly Helper[], chats: readonly Thread[]): ThreadGroups {
  const mine = (t: Thread): boolean => t.agents.some((a) => a.agentId === agentId);
  const byNew = (a: Thread, b: Thread): number => b.createdAt - a.createdAt;
  const rank = (s: Helper["status"]): number => (s === "running" ? 0 : 1);
  return {
    worked: children.filter((t) => t.kind === "thread" && mine(t) && t.closedAt === undefined).sort(byNew),
    helpers: helpers.filter((h) => h.agentId === agentId).sort((a, b) => rank(a.status) - rank(b.status) || b.startedAt - a.startedAt),
    chats: chats.filter((t) => t.kind === "chat" && mine(t) && t.closedAt === undefined).sort(byNew),
  };
}

export function helperNote(h: Helper, c: Clock): string {
  if (h.status === "running") return "Working now";
  if (h.status === "failed") return `Failed ${agoLabel(h.startedAt, c)}`;
  if (h.status === "stopped") return `Stopped ${agoLabel(h.startedAt, c)}`;
  return `Done ${agoLabel(h.startedAt, c)}`;
}

export function threadNote(t: Thread, c: Clock): string {
  return `Started ${agoLabel(t.createdAt, c)}`;
}

/** A thread it worked in, as the prototype's second line: "5 replies · last 9:34" when the thread says how many and when, else when it started. */
export function workedNote(t: Thread, c: Clock): string {
  if (t.replyCount === undefined) return threadNote(t, c);
  const n = `${t.replyCount} ${t.replyCount === 1 ? "reply" : "replies"}`;
  return t.lastMessageAt === undefined ? n : `${n} · last ${chatWhen(t.lastMessageAt, c)}`;
}

/** When a chat last moved, as the prototype's Its chats list says it: the clock time today, "Yesterday", the weekday within a week, else the date. */
export function chatWhen(ts: number, c: Clock): string {
  const gap = dayNo(c.now, c) - dayNo(ts, c);
  if (gap <= 0) return clock24(ts, c).replace(/^0/, "");
  if (gap === 1) return "Yesterday";
  if (gap < 7) return WEEKDAYS[local(ts, c).getUTCDay()]!;
  return dayMonth(ts, c);
}

/* ---------- files ---------- */

export interface Crumb { folderId: string; name: string }

/** Walks into a folder. */
export function enter(stack: readonly Crumb[], folder: Crumb): Crumb[] {
  return [...stack, folder];
}

/** Goes back to `folderId` (the crumb itself stays); an unknown id goes to the root. */
export function backTo(stack: readonly Crumb[], folderId: string): Crumb[] {
  const i = stack.findIndex((c) => c.folderId === folderId);
  return i < 0 ? stack.slice(0, 1) : stack.slice(0, i + 1);
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

/** Folders first, then files, each by name. The files list is already the folder's own rows. */
export function folderEntries(folders: readonly FolderRow[], files: readonly FileRow[], folderId: string): { folders: FolderRow[]; files: FileRow[] } {
  const byName = (a: { name: string }, b: { name: string }): number => a.name.localeCompare(b.name);
  return {
    folders: folders.filter((f) => f.parentId === folderId).sort(byName),
    files: files.filter((f) => f.folderId === folderId && f.deletedAt === undefined).sort(byName),
  };
}

export function filePath(crumbs: readonly Crumb[], name?: string): string {
  const parts = crumbs.map((c) => c.name);
  if (name) parts.push(name);
  return parts.join("/");
}

/* ---------- memory ---------- */

export interface MemoryFilter { fromMe: boolean; replaced: boolean }
export const CURRENT: MemoryFilter = { fromMe: false, replaced: false };

export function statusFor(f: MemoryFilter): Fact["status"][] {
  return f.replaced ? ["current", "closed"] : ["current"];
}

export function isDefaultFilter(f: MemoryFilter): boolean {
  return !f.fromMe && !f.replaced;
}

/** "Showing facts from you, including replaced" / "Showing all facts, including replaced" / "Showing facts from you". */
export function showingLine(f: MemoryFilter): string {
  if (isDefaultFilter(f)) return "";
  return `Showing ${f.fromMe ? "facts from you" : "all facts"}${f.replaced ? ", including replaced" : ""}`;
}

export function sourceName(kind: Fact["sourceKind"]): string {
  switch (kind) {
    case "chat": return "a chat";
    case "channel": return "a channel";
    case "task": return "a task";
    case "record": return "a record";
    case "run": return "a run";
    case "journey": return "a Journey";
    case "manual": return "you";
  }
}

/** The second line of a fact: when it holds, when it was learned, where from. */
export function factNote(f: Fact, c: Clock): string {
  const since = `Since ${dayMonth(f.validFrom, c)}`;
  const learned = `learned ${dayMonth(f.learnedAt, c)}`;
  const from = `from ${sourceName(f.sourceKind)}`;
  return f.status === "closed" ? `Replaced ${dayMonth(f.closedAt ?? f.validTo ?? f.learnedAt, c)} · ${learned} · ${from}` : `${since} · ${learned} · ${from}`;
}

/** Proposed facts wait for Accept or Reject; the rest are what the agent knows. Proposed never mixes into the current list. */
export function splitFacts(facts: readonly Fact[]): { proposed: Fact[]; known: Fact[] } {
  const newest = (a: Fact, b: Fact): number => b.learnedAt - a.learnedAt;
  return {
    proposed: facts.filter((f) => f.status === "proposed").sort(newest),
    known: facts.filter((f) => f.status !== "proposed" && f.status !== "removed").sort((a, b) => (a.status === b.status ? newest(a, b) : a.status === "current" ? -1 : 1)),
  };
}

/* ---------- routines ---------- */

/** A cron string in words for the common shapes; anything else shows as written. */
export function cronWords(cron: string): string {
  const p = cron.trim().split(/\s+/);
  if (p.length !== 5) return cron;
  const [min, hour, dom, mon, dow] = p as [string, string, string, string, string];
  if (!/^\d+$/.test(min) || !/^\d+$/.test(hour) || dom !== "*" || mon !== "*") return cron;
  const at = `${two(Number(hour))}:${two(Number(min))}`;
  if (dow === "*") return `Every day at ${at}`;
  if (dow === "1-5") return `Weekdays at ${at}`;
  if (/^[0-6]$/.test(dow)) {
    const names = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    return `Every ${names[Number(dow)]} at ${at}`;
  }
  return cron;
}

/** A watcher (kind "watch") fires on a new message in a channel, not a clock. */
export function isWatcher(r: Routine): boolean {
  return r.kind === "watch";
}

/** The short schedule the prototype writes on a row: "weekdays 8:00", "every Friday 9:00", "every day 17:00"; anything else as it is. */
export function shortSchedule(cron: string): string {
  const p = cron.trim().split(/\s+/);
  if (p.length !== 5 || !/^\d+$/.test(p[0]!) || !/^\d+$/.test(p[1]!) || p[2] !== "*" || p[3] !== "*") return cron;
  const at = `${Number(p[1])}:${two(Number(p[0]))}`;
  const dow = p[4]!;
  if (dow === "*") return `every day ${at}`;
  if (dow === "1-5") return `weekdays ${at}`;
  if (/^[0-6]$/.test(dow)) return `every ${["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][Number(dow)]} ${at}`;
  return cron;
}

/** "Mon Oct 27": the weekday and the date, the way the prototype says when a routine runs next. */
export function nextDay(ts: number, c: Clock): string {
  const d = local(ts, c);
  return `${WEEKDAYS[d.getUTCDay()]} ${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getUTCMonth()]} ${d.getUTCDate()}`;
}

export function routineNote(r: Routine, c: Clock): string {
  const cron = r.cron ?? "";
  if (!r.enabled) return `Paused · ${isWatcher(r) ? "on new messages" : cronWords(cron)}`;
  if (isWatcher(r)) return "on new messages";
  return r.nextRunAt !== undefined ? `${shortSchedule(cron)} · next ${nextDay(r.nextRunAt, c)}` : shortSchedule(cron);
}

export function routinesOn(rs: readonly Routine[]): number {
  return rs.filter((r) => r.enabled).length;
}

/** On first, then by next run; paused ones last by title. */
export function sortRoutines(rs: readonly Routine[]): Routine[] {
  return rs.slice().sort((a, b) => {
    if (a.enabled !== b.enabled) return a.enabled ? -1 : 1;
    if (a.enabled) return (a.nextRunAt ?? Infinity) - (b.nextRunAt ?? Infinity);
    return a.title.localeCompare(b.title);
  });
}

/** The three sentence starters; each fills the chat composer, because routines are made by asking the agent. */
export const ROUTINE_STARTS: readonly string[] = ["Every morning at 8, ", "When someone mentions ", "Every Friday, summarise "];

export function changeByAsking(title: string): string {
  return `Change “${title}”: `;
}

/** The file name a routine's instructions live in: routines/<slug>.md. */
export function routineSlug(title: string): string {
  const s = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return s === "" ? "routine" : s;
}

export function routineFile(title: string): string {
  return `routines/${routineSlug(title)}.md`;
}

export function lastRunLine(r: Routine, c: Clock): string {
  return r.lastRunAt === undefined ? "Not run yet" : agoLabel(r.lastRunAt, c);
}

/* ---------- MAP.md ---------- */

export interface MapRow { key: string; text: string }
export interface MapIndex { rows: MapRow[]; lines: number }
/** MAP.md is the index every chat loads; it stays under this many lines. */
export const MAP_LIMIT = 200;

/** Reads MAP.md: each "- `key` what it points to" line is a row; the line count is what counts against the limit. */
export function parseMap(markdown: string, lines?: number): MapIndex {
  const rows: MapRow[] = [];
  for (const line of markdown.split("\n")) {
    const m = /^\s*[-*]\s+`([^`]+)`\s*[:\u2013-]?\s*(.*)$/.exec(line);
    if (m) rows.push({ key: m[1]!, text: m[2]!.trim() });
  }
  return { rows, lines: lines ?? rows.length };
}

/** Where a proposed fact came from, in the prototype's words: the chat's title, "#channel", you, else the kind. */
export function sourceLabel(f: Fact, chatTitle: (id: string) => string | undefined): string {
  if (f.sourceKind === "chat") return chatTitle(f.sourceRef) ?? "a chat";
  if (f.sourceKind === "channel") return `#${f.sourceRef}`;
  return sourceName(f.sourceKind);
}

/** The clock time a fact was learned today ("9:31"), else the date. */
export function learnedWhen(ts: number, c: Clock): string {
  return dayNo(c.now, c) - dayNo(ts, c) <= 0 ? clock24(ts, c).replace(/^0/, "") : dayMonth(ts, c);
}
