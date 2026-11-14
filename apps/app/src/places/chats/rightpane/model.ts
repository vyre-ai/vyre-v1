// The Chats right pane's logic, with no renderer: the five tabs, what a computer's state says, how a routine's schedule reads, which facts a filter keeps, how the
// agent's folder is walked. The pane follows the agent of the open chat (spec 3.2); nothing here reads the replica, so the tests drive every rule directly.
import type { CapMap } from "../../../../../../generated/types.ts";

export type TabKey =
  | "overview"
  | "about"
  | "computer"
  | "threads"
  | "files"
  | "terminal"
  | "memory"
  | "routines"
  | "crew"
  | "skills"
  | "hooks"
  | "kept"
  | "people";
export const TABS: readonly { key: TabKey; title: string }[] = [
  { key: "about", title: "About" },
  { key: "computer", title: "Computer" },
  { key: "threads", title: "Chats" },
  { key: "files", title: "Files" },
  { key: "memory", title: "Knows" },
  { key: "routines", title: "Routines" },
];
/** Terminal sits after Files, for every agent, where the shell has one. It opens where the chat runs: the agent's computer when it has one, else this computer; the host chip lists only machines the person may use. */
export const TERMINAL_TAB: { key: TabKey; title: string } = { key: "terminal", title: "Terminal" };
/** The Crew tab: shown only in a chat that has teammates working for it, right after Chats. */
export const CREW_TAB: { key: TabKey; title: string } = { key: "crew", title: "Crew" };
/** The tabs of a pane, shown only when useful: Computer once the agent has one, Terminal for every agent where the shell has a terminal, Crew when teammates work for the chat. */
export const tabsOf = (
  terminal: boolean,
  crew = false,
  computer = true,
  skills = false,
  hooks = false,
  overview = false,
): readonly { key: TabKey; title: string }[] => {
  const out: { key: TabKey; title: string }[] = overview ? [OVERVIEW_TAB] : [];
  for (const t of TABS) {
    if (t.key === "computer" && !computer) continue;
    out.push(t);
    if (t.key === "threads" && crew) out.push(CREW_TAB);
    if (t.key === "files" && terminal) out.push(TERMINAL_TAB); // every agent has a Terminal (owner, 31 Oct: reaching every machine, safe); its host chip picks the machine
  }
  if (hooks) out.push(HOOKS_TAB); // once the chat has hooks (l-hooks)
  if (skills) out.push(SKILLS_TAB); // once the person has skills (l-install)
  return out;
};
/** The session Overview: first, in a long chat (lane l-session). */
export const OVERVIEW_TAB: { key: TabKey; title: string } = { key: "overview", title: "Overview" };
/** The Hooks tab: the hooks that run in this chat, shown once there are some or when a hook line opened it. */
export const HOOKS_TAB: { key: TabKey; title: string } = { key: "hooks", title: "Hooks" };
/** The Skills tab: the person's skills and an agent's, last, once there are any. */
export const SKILLS_TAB: { key: TabKey; title: string } = { key: "skills", title: "Skills" };
export const DEFAULT_TAB: TabKey = "about";

/* ---------- the chat's own pane, by what the chat is (G5, G6; DESIGN-chat-system, Side pane row) ---------- */

/** What the pane's tabs follow. Agent and group chat read Crew, Computer, Threads, Files, Kept; a channel Threads, Files, Kept, People; a chat with one other person Files, Kept. */
export type PaneKind = "agent" | "group" | "channel" | "dm";

/** What the chat has, which decides which of its optional tabs are drawn: Crew once teammates work, Computer once the agent has one, Kept once there is a Kept list, and the rest where they exist. */
export interface PaneHas {
  crew: boolean;
  computer: boolean;
  kept: boolean;
  people: boolean;
  terminal: boolean;
  skills: boolean;
  hooks: boolean;
}

/** The titles the chat's pane gives its tabs (a key's title in the agent page stays as it was). */
const KIND_TITLE: Partial<Record<TabKey, string>> = {
  threads: "Threads",
  memory: "Knows",
  kept: "Kept",
  people: "People",
  crew: "Crew",
};
const BASE_TITLE = new Map<string, string>([
  ["computer", "Computer"],
  ["files", "Files"],
  ["routines", "Routines"],
  ["terminal", "Terminal"],
  ["skills", "Skills"],
  ["hooks", "Hooks"],
]);
const titleOf = (k: TabKey): string => KIND_TITLE[k] ?? BASE_TITLE.get(k) ?? k;

/**
 * The tabs of the chat's pane, in the order the prototype lists them (CTXK in a-data.js). The strip draws as many as the width holds and folds the rest behind its More menu, so the tail
 * (Knows, Routines, Terminal, Skills) is what More holds at the pane's usual width. A tab for something the chat does not have is not drawn.
 */
export function kindTabs(kind: PaneKind, has: PaneHas): { key: TabKey; title: string }[] {
  const order: TabKey[] =
    kind === "dm"
      ? ["files", "kept"]
      : kind === "channel"
        ? ["threads", "files", "kept", "people"]
        : kind === "group"
          ? ["crew", "computer", "threads", "files", "kept", "memory", "terminal", "skills", "hooks"]
          : ["crew", "computer", "threads", "files", "kept", "memory", "routines", "terminal", "skills", "hooks"];
  const keep = (k: TabKey): boolean =>
    k === "crew"
      ? has.crew
      : k === "computer"
        ? has.computer
        : k === "kept"
          ? has.kept
          : k === "people"
            ? has.people
            : k === "terminal"
              ? has.terminal
              : k === "skills"
                ? has.skills
                : k === "hooks"
                  ? has.hooks
                  : true;
  return order.filter(keep).map((key) => ({ key, title: titleOf(key) }));
}

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
  tabs: readonly T[],
  active: string,
  width: number,
  o: { chrome?: number; widthOf?: (title: string) => number } = {},
): FittedTabs<T> {
  const tabWidth = o.widthOf ?? tabW;
  const room = width - (o.chrome ?? HEADER_CHROME);
  let total = 0;
  for (const t of tabs) total += tabWidth(t.title);
  if (total <= room) return { shown: tabs.slice(), hidden: [] };
  let left = room - tabWidth("More") - 2;
  const keep = new Set<string>();
  const open = tabs.find((t) => t.key === active);
  if (open) {
    keep.add(open.key);
    left -= tabWidth(open.title);
  }
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

export interface Clock {
  now: number;
  offsetMin: number;
}
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
    case "asleep":
      return { label: "Asleep", screen: "asleep", detail: "Wakes when it has work", action: "wake" };
    case "waking":
      return { label: "Waking", screen: "busy", detail: "One moment", action: null };
    case "provisioning":
      return { label: "Setting up", screen: "busy", detail: "Its computer is being made", action: null };
    case "working":
      return { label: c.caption ? `Working: ${c.caption}` : "Working", screen: "live", detail: tabs, action: "take" };
    case "takeover":
      return { label: "You're in control", screen: "mine", detail: tabs, action: "give" };
    case "error":
      return { label: "Needs attention", screen: "error", detail: "It could not start", action: "wake" };
  }
}

export function stepsLine(n: number): string {
  return `${n} ${n === 1 ? "step" : "steps"}`;
}

/** The timeline, newest last, as the prototype lists it; a step you took reads "You took over". */
export function stepRows(steps: readonly Step[]): Step[] {
  return steps.slice().sort((a, b) => a.idx - b.idx);
}

/** The tool a step used, in a word: a step keeps the tool's own name (chrome_open, screen_click, computer_files_write), which is never shown as it is (f-wire, 12 Nov). */
/** Where a step or a card's work happened: an agent's computer, its own profile in the Space browser, or the person's own Chrome through Vyre for Chrome. */
export type WorkPlace = "computer" | "browser" | "my-chrome";

/**
 * The one word for where a step happened (review, 12 Nov): the chat card, the Steps list and the Computer tab all use it. The agent's Space browser is "Browser", the person's own Chrome is
 * "Your Chrome", and on an agent's computer the app that did it (Chrome, Screen, Files, Terminal).
 */
export function placeWord(tool: string | null, where: WorkPlace = "computer"): string {
  if (where === "browser") return "Browser";
  if (where === "my-chrome") return "Your Chrome";
  return tool === null ? "Computer" : toolWord(tool);
}

export function toolWord(tool: string): string {
  if (/^chrome_/.test(tool)) return "Chrome";
  if (/^screen_/.test(tool)) return "Screen";
  if (/^computer_files_/.test(tool)) return "Files";
  if (/^terminal/i.test(tool)) return "Terminal";
  return tool;
}

export function stepWho(s: Step, where: WorkPlace = "computer"): string {
  return s.by === "person" ? "You" : placeWord(s.tool, where);
}

/* ---------- threads ---------- */

export interface ThreadGroups {
  worked: Thread[];
  helpers: Helper[];
  chats: Thread[];
}

/** Threads the agent worked in (children of the open chat or channel), its running helpers first, and its own chats, newest first. */
export function groupThreads(
  agentId: string,
  children: readonly Thread[],
  helpers: readonly Helper[],
  chats: readonly Thread[],
): ThreadGroups {
  const mine = (t: Thread): boolean => t.agents.some((a) => a.agentId === agentId);
  const byNew = (a: Thread, b: Thread): number => b.createdAt - a.createdAt;
  const rank = (s: Helper["status"]): number => (s === "running" ? 0 : 1);
  return {
    worked: children.filter((t) => t.kind === "thread" && mine(t) && t.closedAt === undefined).sort(byNew),
    helpers: helpers
      .filter((h) => h.agentId === agentId)
      .sort((a, b) => rank(a.status) - rank(b.status) || b.startedAt - a.startedAt),
    chats: chats.filter((t) => t.kind === "chat" && mine(t) && t.closedAt === undefined).sort(byNew),
  };
}

export function helperNote(h: Helper, c: Clock): string {
  if (h.status === "running") return "Working now";
  if (h.status === "failed") return `Failed ${agoLabel(h.startedAt, c)}`;
  if (h.status === "stopped") return `Stopped ${agoLabel(h.startedAt, c)}`;
  return `Done ${agoLabel(h.startedAt, c)}`;
}

export type CrewJob = CapMap["engine.crew.list"]["out"]["jobs"][number];

/** A teammate's second line in the Crew tab: what it is on and how it stands, in a few words. */
export function crewNote(j: CrewJob, c: Clock): string {
  const files = Array.isArray(j.result?.["summary"] && (j.result["summary"] as { files?: unknown[] }).files)
    ? (j.result?.["summary"] as { files: unknown[] }).files.length
    : null;
  switch (j.state) {
    case "working":
      return `Working · started ${agoLabel(j.startedAt, c)}`;
    case "waiting":
      return "Waiting on you";
    case "paused":
      return "Paused with its agent";
    case "lost":
      return `The server stopped ${agoLabel(j.endedAt ?? j.startedAt, c)} · run it again?`;
    case "done":
      return `Done ${agoLabel(j.endedAt ?? j.startedAt, c)}${files === null ? "" : ` · ${files} ${files === 1 ? "file" : "files"}`}`;
    case "merged":
      return `Merged ${agoLabel(j.endedAt ?? j.startedAt, c)}`;
    case "failed":
      return `Could not finish ${agoLabel(j.endedAt ?? j.startedAt, c)}`;
    default:
      return `Stopped ${agoLabel(j.endedAt ?? j.startedAt, c)}`;
  }
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

export interface Crumb {
  folderId: string;
  name: string;
}

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
/** The two folders Vyre keeps in an agent's folder for itself: its search index and its own state. Only these stay out of the pane; an agent's .env or .gitignore are its own files and show (review O5). */
export const VYRE_OWN_NAMES: ReadonlySet<string> = new Set([".index", ".vyre"]);

/** One level of the agent's folder, without Vyre's own .index and .vyre (owner walk, 12 Nov). */
export function folderEntries(
  folders: readonly FolderRow[],
  files: readonly FileRow[],
  folderId: string,
): { folders: FolderRow[]; files: FileRow[] } {
  const byName = (a: { name: string }, b: { name: string }): number => a.name.localeCompare(b.name);
  const shown = (name: string): boolean => !VYRE_OWN_NAMES.has(name);
  return {
    folders: folders.filter((f) => f.parentId === folderId && shown(f.name)).sort(byName),
    files: files.filter((f) => f.folderId === folderId && f.deletedAt === undefined && shown(f.name)).sort(byName),
  };
}

export function filePath(crumbs: readonly Crumb[], name?: string): string {
  const parts = crumbs.map((c) => c.name);
  if (name) parts.push(name);
  return parts.join("/");
}

/* ---------- memory ---------- */

export interface MemoryFilter {
  fromMe: boolean;
  replaced: boolean;
}
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
    case "chat":
      return "a chat";
    case "channel":
      return "a channel";
    case "task":
      return "a task";
    case "record":
      return "a record";
    case "run":
      return "a run";
    case "journey":
      return "a Journey";
    case "manual":
      return "you";
  }
}

/** The second line of a fact: when it holds, when it was learned, where from. */
export function factNote(f: Fact, c: Clock): string {
  const since = `Since ${dayMonth(f.validFrom, c)}`;
  const learned = `learned ${dayMonth(f.learnedAt, c)}`;
  const from = `from ${sourceName(f.sourceKind)}`;
  return f.status === "closed"
    ? `Replaced ${dayMonth(f.closedAt ?? f.validTo ?? f.learnedAt, c)} · ${learned} · ${from}`
    : `${since} · ${learned} · ${from}`;
}

/** Proposed facts wait for Accept or Reject; the rest are what the agent knows. Proposed never mixes into the current list. */
export function splitFacts(facts: readonly Fact[]): { proposed: Fact[]; known: Fact[] } {
  const newest = (a: Fact, b: Fact): number => b.learnedAt - a.learnedAt;
  return {
    proposed: facts.filter((f) => f.status === "proposed").sort(newest),
    known: facts
      .filter((f) => f.status !== "proposed" && f.status !== "removed")
      .sort((a, b) => (a.status === b.status ? newest(a, b) : a.status === "current" ? -1 : 1)),
  };
}

/* ---------- routines ---------- */

/** A cron string in words for the common shapes; anything else shows as written. */
/**
 * A cron in plain words, in the viewer's time zone (`c.offsetMin`; the server keeps every cron in UTC): "Every minute", "Every 5 minutes", "Every hour at :30", "Weekdays at 09:00",
 * "Every Friday at 17:00", "Mon, Wed and Fri at 08:00", "On day 1 of each month at 08:00". A shape the words cannot say is "On a custom schedule"; the raw cron is only ever in Details.
 */
export function cronWords(cron: string, c: { offsetMin: number } = { offsetMin: 0 }): string {
  const w = cronShape(cron, c.offsetMin);
  if (w === null) return CUSTOM_SCHEDULE;
  switch (w.t) {
    case "minute":
      return "Every minute";
    case "minutes":
      return `Every ${w.n} minutes`;
    case "hourly":
      return `Every hour at :${two(w.min)}`;
    case "daily":
      return w.days === null ? `Every day at ${w.at}` : `${daysWords(w.days)} at ${w.at}`;
    case "monthly":
      return `On day ${w.day} of each month at ${w.at}`;
  }
}
export const CUSTOM_SCHEDULE = "On a custom schedule";
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
function daysWords(days: readonly number[]): string {
  const k = days.join(",");
  if (k === "1,2,3,4,5") return "Weekdays";
  if (k === "0,6") return "Weekends";
  if (days.length === 1) return `Every ${DAY_NAMES[days[0]!]}`;
  const names = days.map((d) => DAY_SHORT[d]!);
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}
type CronShape =
  | { t: "minute" }
  | { t: "minutes"; n: number }
  | { t: "hourly"; min: number }
  | { t: "daily"; at: string; h: number; m: number; days: number[] | null }
  | { t: "monthly"; at: string; day: number };
/** The day-of-week field as days (0 is Sunday; 7 is Sunday too), or null when it is not a plain list or range. */
function dowSet(f: string): number[] | null {
  const out = new Set<number>();
  for (const part of f.split(",")) {
    const r = /^(\d)(?:-(\d))?$/.exec(part);
    if (!r) return null;
    const a = Number(r[1]),
      b = r[2] === undefined ? a : Number(r[2]);
    if (a > 7 || b > 7 || b < a) return null;
    for (let d = a; d <= b; d++) out.add(d % 7);
  }
  return [...out].sort((x, y) => x - y);
}
/** What a UTC cron means where the viewer is: the time moved by their offset, and the days moved with it when the time crosses midnight. Null for a shape the words do not cover. */
export function cronShape(cron: string, offsetMin: number): CronShape | null {
  const p = cron.trim().split(/\s+/);
  if (p.length !== 5) return null;
  const [min, hour, dom, mon, dow] = p as [string, string, string, string, string];
  if (mon !== "*") return null;
  if (min === "*" && hour === "*" && dom === "*" && dow === "*") return { t: "minute" };
  const every = /^\*\/(\d+)$/.exec(min);
  if (every && hour === "*" && dom === "*" && dow === "*")
    return Number(every[1]) === 1 ? { t: "minute" } : { t: "minutes", n: Number(every[1]) };
  if (!/^\d+$/.test(min)) return null;
  if (hour === "*" && dom === "*" && dow === "*")
    return { t: "hourly", min: (((Number(min) + offsetMin) % 60) + 60) % 60 };
  if (!/^\d+$/.test(hour)) return null;
  const total = Number(hour) * 60 + Number(min) + offsetMin;
  const shift = Math.floor(total / 1440);
  const local = ((total % 1440) + 1440) % 1440;
  const h = Math.floor(local / 60),
    m = local % 60;
  const at = `${two(h)}:${two(m)}`;
  if (dom === "*") {
    if (dow === "*") return { t: "daily", at, h, m, days: null };
    const days = dowSet(dow);
    if (days === null) return null;
    return {
      t: "daily",
      at,
      h,
      m,
      days: [...new Set(days.map((d) => (((d + shift) % 7) + 7) % 7))].sort((x, y) => x - y),
    };
  }
  // a day of the month moved across midnight would be a different day each month: only the plain case is put in words
  if (/^\d+$/.test(dom) && dow === "*" && shift === 0) return { t: "monthly", at, day: Number(dom) };
  return null;
}

/** A watcher (kind "watch") fires on a new message in a channel, not a clock. */
export function isWatcher(r: Routine): boolean {
  return r.kind === "watch";
}

/** The short schedule the prototype writes on a row, in the viewer's time zone: "every minute", "weekdays 8:00", "every Friday 9:00", "every day 17:00"; else the plain words, lower case. */
export function shortSchedule(cron: string, c: { offsetMin: number } = { offsetMin: 0 }): string {
  const w = cronShape(cron, c.offsetMin);
  if (w !== null && w.t === "daily") {
    const at = `${w.h}:${two(w.m)}`;
    if (w.days === null) return `every day ${at}`;
    const k = w.days.join(",");
    if (k === "1,2,3,4,5") return `weekdays ${at}`;
    if (w.days.length === 1) return `every ${DAY_NAMES[w.days[0]!]} ${at}`;
  }
  const words = cronWords(cron, c);
  return words.charAt(0).toLowerCase() + words.slice(1);
}

/** "Mon Oct 27": the weekday and the date, the way the prototype says when a routine runs next. */
export function nextDay(ts: number, c: Clock): string {
  const d = local(ts, c);
  return `${WEEKDAYS[d.getUTCDay()]} ${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getUTCMonth()]} ${d.getUTCDate()}`;
}

export function routineNote(r: Routine, c: Clock): string {
  const cron = r.cron ?? "";
  if (!r.enabled && r.pausedReason) return r.pausedReason; // paused by itself after failed runs: the row says why
  if (!r.enabled) return `Paused · ${isWatcher(r) ? "on new messages" : cronWords(cron, c)}`;
  if (isWatcher(r)) return "on new messages";
  return r.nextRunAt !== undefined
    ? `${shortSchedule(cron, c)} · next ${nextDay(r.nextRunAt, c)}`
    : shortSchedule(cron, c);
}

/** The one Next line under an open routine's title: "Next: today 09:12", "Next: tomorrow 08:00", "Next: Mon 10:00"; Paused, or nothing scheduled, says so. */
export function nextLine(r: Routine, c: Clock): string {
  if (!r.enabled) return "Paused. Turn it on to schedule the next run.";
  if (isWatcher(r)) return "Runs on every new message in the channel";
  return r.nextRunAt !== undefined ? `Next: ${nextLower(r.nextRunAt, c)}` : "No run is scheduled";
}
const nextLower = (ts: number, c: Clock): string =>
  nextLabel(ts, c).replace(/^(Today|Tomorrow)\b/, (w) => w.toLowerCase());

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
export const ROUTINE_STARTS: readonly string[] = [
  "Every morning at 8, ",
  "When someone mentions ",
  "Every Friday, summarise ",
];

export function changeByAsking(title: string): string {
  return `Change “${title}”: `;
}

/** The file name a routine's instructions live in: routines/<slug>.md. */
export function routineSlug(title: string): string {
  const s = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return s === "" ? "routine" : s;
}

export function routineFile(title: string): string {
  return `routines/${routineSlug(title)}.md`;
}

export function lastRunLine(r: Routine, c: Clock): string {
  if (r.lastRunAt === undefined) return "Not run yet";
  // how the last run went, once its agent's turn ended: "Done 2 min ago", "Failed 2 min ago", "Stopped ...", or "Running, started 2 min ago"
  const last = (r as Routine & { lastRun?: { status?: string } }).lastRun?.status;
  const ago = agoLabel(r.lastRunAt, c);
  if (last === "running") return `Running, started ${ago}`;
  if (last === "succeeded") return `Done ${ago}`;
  if (last === "failed") return `Failed ${ago}`;
  if (last === "stopped") return `Stopped ${ago}`;
  return ago;
}

/* ---------- MAP.md ---------- */

export interface MapRow {
  key: string;
  text: string;
}
export interface MapIndex {
  rows: MapRow[];
  lines: number;
}
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

/* ---------- ids in words ---------- */

export type IdPart = { text: string } | { id: string; kind: "thread" | "channel" };
/** A routine's instructions with the chat and channel ids picked out, so each is drawn as its name and a link, never as "thr_01a19...". */
export function idParts(text: string): IdPart[] {
  const out: IdPart[] = [];
  const re = /\b(thr|chn)_[A-Za-z0-9]{6,}\b/g;
  let at = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > at) out.push({ text: text.slice(at, m.index) });
    out.push({ id: m[0], kind: m[1] === "chn" ? "channel" : "thread" });
    at = m.index + m[0].length;
  }
  if (at < text.length) out.push({ text: text.slice(at) });
  return out;
}

/** The name an id is shown as: "this chat" for the chat the pane is beside, "#intake" for a channel, the chat's title, else a plain word. */
export function idName(
  p: { id: string; kind: "thread" | "channel" },
  here: string,
  found: { kind?: string; title?: string; name?: string } | null | undefined,
): string {
  if (p.kind === "thread" && p.id === here) return "this chat";
  if (p.kind === "channel") return found?.name ? `#${found.name}` : "a channel";
  if (found?.kind === "channel" && found.title) return `#${found.title}`;
  return found?.title ?? "a chat";
}
