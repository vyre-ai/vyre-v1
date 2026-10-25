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

export function routineNote(r: Routine, c: Clock): string {
  if (!r.enabled) return `Paused · ${cronWords(r.cron)}`;
  return r.nextRunAt !== undefined ? `${cronWords(r.cron)} · next ${nextLabel(r.nextRunAt, c)}` : cronWords(r.cron);
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
