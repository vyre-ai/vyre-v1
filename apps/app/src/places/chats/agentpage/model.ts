// The agent page's logic, with no renderer (spec 2.6 Agent, 3.2 Agent page): the five tabs, the status line, the role line and what may be saved, the strip of numbers, the
// routine label every routine post carries, and the settings rows. Nothing here reads the replica, so the tests drive every rule directly.
import type { CapMap } from "../../../../../../generated/types.ts";
import { agoLabel, cronWords, nextLabel } from "../rightpane/model.ts";
import type { Clock } from "../rightpane/model.ts";

export type { Clock } from "../rightpane/model.ts";

export type AgentRow = CapMap["agents.get"]["out"]["agent"];
export type Summary = CapMap["agents.summary"]["out"];
export type Routine = CapMap["agents.routines.list"]["out"]["routines"][number];
export type Suggestion = CapMap["agents.suggestions.list"]["out"]["suggestions"][number];
export type Config = CapMap["agents.config.get"]["out"];
export type Thread = CapMap["threads.list"]["out"]["threads"][number];

export type TabKey = "chats" | "memory" | "files" | "computer" | "settings";
export const TABS: readonly { key: TabKey; title: string }[] = [
  { key: "chats", title: "Chats" },
  { key: "memory", title: "Memory" },
  { key: "files", title: "Files" },
  { key: "computer", title: "Computer" },
  { key: "settings", title: "Settings" },
];
export const DEFAULT_TAB: TabKey = "chats";

export function isTabKey(v: string): v is TabKey {
  return TABS.some((t) => t.key === v);
}

/* ---------- status ---------- */

export const STATUS_WORDS: Record<AgentRow["status"], string> = { awake: "Awake", working: "Working", asleep: "Asleep", paused: "Paused" };

/** "Working", "Asleep", or "Paused by Maya Chen: Waiting for the new retainer terms". */
export function statusLine(a: AgentRow, nameOf: (id: string) => string): string {
  if (a.status !== "paused") return STATUS_WORDS[a.status];
  const who = a.pausedBy ? ` by ${nameOf(a.pausedBy)}` : "";
  return a.pausedReason ? `Paused${who}: ${a.pausedReason}` : `Paused${who}`;
}

/* ---------- the role line ---------- */

export const ROLE_MAX = 140;

/** What Enter would save: trimmed, one line, and not the same as before. Null means nothing to save. */
export function roleToSave(draft: string, current: string): string | null {
  const next = draft.replace(/\s+/g, " ").trim();
  if (next === "" || next === current.trim()) return null;
  return next.length > ROLE_MAX ? next.slice(0, ROLE_MAX).trimEnd() : next;
}

/** The hover note on a read-only role line. */
export const LOCKED_NOTE = "Only people who can change this agent can edit this line";

/* ---------- the strip ---------- */

export interface Stat { key: string; value: string; label: string }

/** Dollars from micros: "$0.42", "$5", "$12", "$1.5k". Whole amounts drop the cents; nothing spent is "$0.00". */
export function dollars(micros: number): string {
  const d = micros / 1_000_000;
  if (d >= 1000) return `$${(d / 1000).toFixed(d >= 10_000 ? 0 : 1)}k`;
  if (d >= 10 || (d > 0 && Number.isInteger(d))) return `$${Math.round(d)}`;
  return `$${d.toFixed(2)}`;
}

/** "$0.42 of $5 today", or just the spend when no daily limit is set. */
export function spendLine(s: Summary): string {
  return s.spendLimitMicros !== undefined && s.spendLimitMicros > 0 ? `${dollars(s.spendTodayMicros)} of ${dollars(s.spendLimitMicros)} today` : `${dollars(s.spendTodayMicros)} today`;
}

export function spendRatio(s: Summary): number {
  return s.spendLimitMicros !== undefined && s.spendLimitMicros > 0 ? Math.min(1, s.spendTodayMicros / s.spendLimitMicros) : 0;
}

/** The numbers under the name: chats this week, open tasks, runs today, spend against limit, memory facts, proposed facts. */
export function stripOf(s: Summary): Stat[] {
  return [
    { key: "chats", value: String(s.chatsThisWeek), label: s.chatsThisWeek === 1 ? "chat this week" : "chats this week" },
    { key: "tasks", value: String(s.openTasks), label: s.openTasks === 1 ? "open task" : "open tasks" },
    { key: "runs", value: String(s.runsToday), label: s.runsToday === 1 ? "run today" : "runs today" },
    { key: "spend", value: dollars(s.spendTodayMicros), label: s.spendLimitMicros !== undefined && s.spendLimitMicros > 0 ? `of ${dollars(s.spendLimitMicros)} today` : "spent today" },
    { key: "facts", value: String(s.memoryFacts), label: s.memoryFacts === 1 ? "memory fact" : "memory facts" },
    { key: "proposed", value: String(s.proposedFacts), label: s.proposedFacts === 1 ? "proposed fact" : "proposed facts" },
  ];
}

/* ---------- routines and their label ---------- */

/** The line every message or post an agent makes because of a routine carries. Nobody else sees or edits the routine. */
export function routineLabel(agentName: string, ownerName: string): string {
  return `Sent by ${agentName} on a routine ${ownerName} set`;
}

/** Only the routines you set are yours to see on this page: another person's routine stays theirs. */
export function mineOnly(routines: readonly Routine[], meId: string): Routine[] {
  return routines.filter((r) => r.ownerId === meId);
}

export function routineNote(r: Routine, c: Clock): string {
  const words = r.kind === "watch" ? "On new messages" : cronWords(r.cron ?? "");
  const when = r.enabled ? words : `Paused · ${words}`;
  if (r.enabled && r.nextRunAt !== undefined) return `${when} · next ${nextLabel(r.nextRunAt, c)}`;
  return when;
}

export function lastRun(r: Routine, c: Clock): string {
  return r.lastRunAt === undefined ? "Not run yet" : `Last run ${agoLabel(r.lastRunAt, c)}`;
}

/* ---------- settings rows ---------- */

export const AGENT_MD_LIMIT = 150;

/** "93 of 150 lines"; over 130 it says so. */
export function instructionsLine(lines: number): string {
  return lines > AGENT_MD_LIMIT ? `${lines} of ${AGENT_MD_LIMIT} lines, over the limit` : lines > 130 ? `${lines} of ${AGENT_MD_LIMIT} lines, nearly full` : `${lines} of ${AGENT_MD_LIMIT} lines`;
}

export const CAPTURE_WORDS: Record<AgentRow["captureMode"], string> = {
  propose: "Proposes facts for you to accept",
  auto_low_risk: "Saves low-risk facts on its own",
  off: "Does not capture memory",
};

export function accountLine(a: AgentRow): string {
  return a.accountPolicy === "key" ? `Runs on the key ${a.accountKey ?? "set for it"}` : "Runs on the account of whoever asks";
}

export interface LimitRow { key: string; label: string; value: string }

/** Only the limits that are set. Money caps apply to API keys; subscriptions are capped in turns, time and tokens. */
export function limitRows(l: AgentRow["limits"]): LimitRow[] {
  const out: LimitRow[] = [];
  if (l.runCostMicros !== undefined) out.push({ key: "run", label: "Spend per run", value: dollars(l.runCostMicros) });
  if (l.dayCostMicros !== undefined) out.push({ key: "day", label: "Spend per day", value: dollars(l.dayCostMicros) });
  if (l.monthCostMicros !== undefined) out.push({ key: "month", label: "Spend per month", value: dollars(l.monthCostMicros) });
  if (l.turnsPerDay !== undefined) out.push({ key: "turns", label: "Turns per day", value: String(l.turnsPerDay) });
  if (l.minutesPerRun !== undefined) out.push({ key: "mins", label: "Minutes per run", value: String(l.minutesPerRun) });
  if (l.tokensPerDay !== undefined) out.push({ key: "tokens", label: "Tokens per day", value: l.tokensPerDay.toLocaleString("en-US") });
  return out;
}

/** The agent's chats: threads it leads or listens in, newest first. */
export function chatsOf(agentId: string, threads: readonly Thread[]): Thread[] {
  return threads.filter((t) => (t.kind === "chat" || t.kind === "channel") && t.agents.some((a) => a.agentId === agentId)).sort((a, b) => b.createdAt - a.createdAt);
}

export function chatNote(t: Thread, c: Clock): string {
  return agoLabel(t.createdAt, c);
}

/** The one-line result of a suggestion for its row. */
export function suggestionTitle(s: Suggestion): string {
  const first = s.diff.split("\n").find((l) => l.startsWith("+") && !l.startsWith("+++"));
  const added = first ? first.slice(1).trim() : "";
  return s.kind === "template" ? `Template change to ${s.file}` : added !== "" ? `${s.file}: ${added}` : `Change to ${s.file}`;
}

/** Builds a list from a list. Written as a function (not `.map`) so a list of JSX is plainly the composition of its parts. */
export function collect<T, U>(list: readonly T[], fn: (item: T, index: number) => U): U[] {
  const out: U[] = [];
  for (const [i, x] of list.entries()) out.push(fn(x, i));
  return out;
}
