// The crew as a person reads it (owner, 4 Nov 2026, prototype p-crew): one pure model over engine.crew.status. Every number here comes from the read; the words are said once, in one place, so the strip in the chat,
// the Crew pane, the Island and the header agree. Nothing here names a tool.
import type { CapMap } from "../../../../../../generated/types.ts";

export type CrewStatusOut = CapMap["engine.crew.status"]["out"];
export type CrewMember = CrewStatusOut["members"][number];
export type CrewTotals = CrewStatusOut["totals"];
export type MemberState = CrewMember["state"];
export type Show = "all" | "working" | "needs_you" | "done" | "failed";

/** 0:12, 1:05, 1:02:03. */
export function clock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  const two = (n: number): string => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${two(m)}:${two(r)}` : `${m}:${two(r)}`;
}

/** 41 s, 1 min 20 s, 2 h 5 min. */
export function span(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} s`;
  if (s < 3600) { const m = Math.floor(s / 60), r = s % 60; return r === 0 ? `${m} min` : `${m} min ${r} s`; }
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

/** $0.12; under a cent says so, and a flat plan that reports nothing says nothing. */
export function money(micros: number): string {
  if (micros <= 0) return "$0.00";
  if (micros < 10_000) return "under $0.01";
  return `$${(micros / 1_000_000).toFixed(2)}`;
}

/** 1,234 or 12.3k. */
export function tokens(n: number): string {
  return n < 10_000 ? n.toLocaleString("en-US") : n < 1_000_000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k` : `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
}

/** The second line of a row: what it is on, what it found, or what went wrong, in plain words. */
export function lineOf(m: Pick<CrewMember, "state" | "step" | "found">): string {
  if (m.state === "working") return m.step ?? "Working";
  if (m.state === "needs_you") return m.step ?? "Needs you";
  if (m.state === "done") return m.found ?? "Done";
  if (m.state === "failed") return m.found ?? "Could not finish. Try again.";
  return "Stopped";
}

/** The word for a state, as the peek and the pane say it. */
export const stateWord = (s: MemberState): string => (s === "working" ? "Working" : s === "needs_you" ? "Needs you" : s === "done" ? "Done" : s === "failed" ? "Failed" : "Stopped");

/** The role next to the name: what the helper was asked to do, short. */
export const roleOf = (m: Pick<CrewMember, "title">): string => (m.title.length > 28 ? `${m.title.slice(0, 27)}…` : m.title);

/** The name a row wears: the helper's own name, else its title. */
export const nameOf = (m: Pick<CrewMember, "name" | "title">): string => m.name ?? m.title;

/** The model tag of a row: the model that really ran, and where it came from when the person chose it. */
export function modelTag(m: Pick<CrewMember, "model" | "accountLabel" | "why" | "fellBackFrom">): string {
  if (!m.model) return "";
  const from = m.fellBackFrom ? ` (not ${m.fellBackFrom})` : "";
  return `${m.model}${from}`;
}

/** The strip's one line: how many, who needs you, how long. */
export function stripTitle(t: CrewTotals): string {
  if (t.members === 0) return "";
  const noun = t.members === 1 ? "1 helper" : `${t.members} helpers`;
  if (t.working === 0 && t.needsYou === 0) {
    if (t.failed > 0 || t.stopped > 0) return `${t.done} of ${t.members} done${t.failed > 0 ? ` · ${t.failed} failed` : ""}${t.stopped > 0 ? ` · ${t.stopped} stopped` : ""} · ${span(t.elapsedMs)}`;
    return `${t.done} of ${t.members} done · ${span(t.elapsedMs)}`;
  }
  const parts = [noun];
  if (t.needsYou > 0) parts.push(`${t.needsYou} needs you`);
  else parts.push("working");
  parts.push(clock(t.elapsedMs));
  return parts.join(" · ");
}

/** The strip's light: needs you beats working beats finished. */
export const stripTone = (t: CrewTotals): "need" | "live" | "idle" => (t.needsYou > 0 ? "need" : t.working > 0 ? "live" : "idle");

const RANK: Record<MemberState, number> = { needs_you: 0, failed: 1, working: 2, stopped: 3, done: 4 };

/** What a row's Show menu keeps. */
export const shows = (m: Pick<CrewMember, "state">, show: Show): boolean => show === "all" || m.state === show;

/** Needs you first, then failed, then working, then the rest; the order they started in within each. */
export function sorted<T extends Pick<CrewMember, "state" | "startedAt">>(members: readonly T[]): T[] {
  return [...members].sort((a, b) => RANK[a.state] - RANK[b.state] || a.startedAt - b.startedAt);
}

/** The timeline: each member's bar as fractions of the whole span (start and width, 0 to 1). */
export function timeline(members: readonly Pick<CrewMember, "startedAt" | "endedAt" | "elapsedMs" | "state">[], now: number): Array<{ left: number; width: number }> {
  if (members.length === 0) return [];
  const start = Math.min(...members.map((m) => m.startedAt));
  const end = Math.max(...members.map((m) => m.endedAt ?? Math.max(now, m.startedAt + m.elapsedMs)));
  const whole = Math.max(1, end - start);
  return members.map((m) => {
    const to = m.endedAt ?? Math.max(now, m.startedAt + m.elapsedMs);
    return { left: (m.startedAt - start) / whole, width: Math.max(0.02, (to - m.startedAt) / whole) };
  });
}

/** "Ran together: 41 s instead of 1 min 20 s": only when they really overlapped and all of them have ended. */
export function ranTogether(members: readonly Pick<CrewMember, "startedAt" | "endedAt" | "elapsedMs" | "state">[]): string | null {
  const ended = members.filter((m) => m.endedAt !== undefined && m.state !== "working");
  if (members.length < 2 || ended.length !== members.length) return null;
  const wall = Math.max(...ended.map((m) => m.endedAt!)) - Math.min(...ended.map((m) => m.startedAt));
  const sum = ended.reduce((n, m) => n + m.elapsedMs, 0);
  if (sum - wall < 1500) return null;
  return `Ran together: ${span(wall)} instead of ${span(sum)}`;
}

/** The one-sentence total for the Crew pane. */
export function totalsLine(t: CrewTotals): string {
  if (t.members === 0) return "No helpers yet";
  const bits = [`${t.done} of ${t.members} done`];
  if (t.needsYou > 0) bits.push(`${t.needsYou} needs you`);
  if (t.working > 0) bits.push(`${t.working} working`);
  if (t.failed > 0) bits.push(`${t.failed} failed`);
  bits.push(span(t.elapsedMs));
  return bits.join(" · ");
}

/** Input against output as fractions of the sum, for the token bar. */
export function tokenSplit(t: Pick<CrewTotals, "tokensIn" | "tokensOut">): { input: number; output: number } {
  const sum = t.tokensIn + t.tokensOut;
  return sum === 0 ? { input: 0, output: 0 } : { input: t.tokensIn / sum, output: t.tokensOut / sum };
}

/** Code work shows its branch and its change; plain research shows neither. */
export const isCode = (m: Pick<CrewMember, "branch">): boolean => m.branch !== undefined && m.branch !== "";

/** The Island and header counts: how many are on it, and how many wait for a person. */
export function counts(t: CrewTotals): { active: number; needsYou: number } {
  return { active: t.working + t.needsYou, needsYou: t.needsYou };
}

/** Keys in the Crew pane: Cmd or Ctrl and the full stop stops all; Alt and 1 to 9 jumps to that helper. */
export function keyAction(e: { key: string; code?: string; metaKey?: boolean; ctrlKey?: boolean; altKey?: boolean }, rows: readonly { id: string }[]): { kind: "stop_all" } | { kind: "jump"; id: string } | null {
  if ((e.metaKey || e.ctrlKey) && (e.key === "." || e.code === "Period")) return { kind: "stop_all" };
  if (e.altKey) {
    const n = /^(?:Digit|Numpad)([1-9])$/.exec(e.code ?? "")?.[1] ?? (/^[1-9]$/.test(e.key) ? e.key : "");
    const row = n ? rows[Number(n) - 1] : undefined;
    if (row) return { kind: "jump", id: row.id };
  }
  return null;
}

/** The header chip: its badge counts the helpers on it (else all of them) and its label says who needs you. */
export function crewChipOf(t: CrewTotals): { active: number; total: number; label: string } {
  const c = counts(t);
  const noun = t.members === 1 ? "helper" : "helpers";
  const label = c.needsYou > 0 ? `${t.members} ${noun}, ${c.needsYou} ${c.needsYou === 1 ? "needs" : "need"} you` : c.active > 0 ? `${c.active} ${c.active === 1 ? "helper" : "helpers"} working` : `${t.members} ${noun}, all done`;
  return { active: c.active, total: t.members, label };
}

/** What the last test run said: "Tests running", "Tests passing" (with the count when known), "3 failing". */
export function testsWords(t: CrewMember["tests"]): string {
  if (!t) return "";
  if (t.state === "running") return "Tests running";
  if (t.state === "passing") return t.passed !== undefined ? `${t.passed} tests passing` : "Tests passing";
  return t.failed !== undefined ? `${t.failed} failing` : "Tests failing";
}

/** The helpers that wait for a person's yes with a held request to answer: each one's request is drawn as an approval card under the strip. */
export const holdsOf = <T extends Pick<CrewMember, "state"> & { holdTaskId?: string }>(members: readonly T[]): Array<T & { holdTaskId: string }> =>
  members.filter((m): m is T & { holdTaskId: string } => m.state === "needs_you" && typeof m.holdTaskId === "string" && m.holdTaskId !== "");
