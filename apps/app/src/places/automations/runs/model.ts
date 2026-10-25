// Runs (spec 2.13, 3.7): the pure parts of run history, the run chat and Failed runs. Words, filters, day groups, the "needs attention" rule, and the run thread turned into the lines the chat draws.
// A Run's thread is its log: agent steps are real turns in it, plain steps are compact rows, an error row carries the retry, a parallel branch is a side thread (message depth above 0).
// The thread says what a row is through one block type per kind (run.row, run.turn, run.join, run.wait, run.error, run.branch, run.stat); a message without one is drawn from its kind and author.
import type { CapMap } from "../../../../../../generated/types.ts";

export type Run = CapMap["runs.list"]["out"]["runs"][number];
export type RunStatus = Run["status"];
export type RunStep = CapMap["runs.steps"]["out"]["steps"][number];
export type ThreadMessage = CapMap["chat.messages.list"]["out"]["messages"][number];
export type UndoPreview = CapMap["runs.preview_undo"]["out"];

export const STATUS_WORD: Readonly<Record<RunStatus, string>> = { queued: "Queued", running: "Running", waiting: "Waiting", succeeded: "Succeeded", failed: "Failed", stopped: "Stopped" };

/* ---------- filters (the quiet menu in the History header) ---------- */

export type FilterKey = "all" | "failed" | "succeeded" | "queued" | "running" | "waiting" | "stopped" | "test";
export interface FilterDef { key: FilterKey; label: string; showing: string }
export const FILTERS: readonly FilterDef[] = [
  { key: "all", label: "All runs", showing: "all runs" },
  { key: "failed", label: "Failed", showing: "failed runs" },
  { key: "succeeded", label: "Succeeded", showing: "succeeded runs" },
  { key: "queued", label: "Queued", showing: "queued runs" },
  { key: "running", label: "Running", showing: "running runs" },
  { key: "waiting", label: "Waiting", showing: "runs waiting on someone" },
  { key: "stopped", label: "Stopped", showing: "stopped runs" },
  { key: "test", label: "Tests", showing: "test runs" },
];

export const isTest = (r: Run): boolean => r.kind === "automation_test";

/** A failed run stops asking for attention once it was retried: the retry is a new Run that points back at it. */
export function handledIds(runs: readonly Run[]): ReadonlySet<string> {
  const out = new Set<string>();
  for (const r of runs) if (r.parentRun) out.add(r.parentRun);
  return out;
}
export const needsAttention = (r: Run, handled: ReadonlySet<string>): boolean => r.status === "failed" && !handled.has(r.id);

export function matchesFilter(r: Run, key: FilterKey): boolean {
  if (key === "all") return true;
  if (key === "test") return isTest(r);
  return r.status === key;
}
export function filterCount(runs: readonly Run[], key: FilterKey): number {
  return runs.reduce((n, r) => n + (matchesFilter(r, key) ? 1 : 0), 0);
}

/* ---------- words ---------- */

export const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

export function waitWords(reason: Run["waitReason"]): string {
  return reason === "approval" ? "Waiting for a yes" : reason === "key" ? "Waiting for a key" : reason === "background" ? "Waiting on background work" : "Waiting";
}

export function durationSeconds(r: Run): number | null {
  return r.endedAt === undefined ? null : Math.max(0, Math.round((r.endedAt - r.startedAt) / 1000));
}

/** The line under a run's title: what it is doing, why it failed, or how it went. */
export function metaLine(r: Run): string {
  switch (r.status) {
    case "queued": return "Queued, starts when a slot is free";
    case "waiting": return waitWords(r.waitReason);
    case "running": return "Running";
    case "failed": return r.summary || "Failed";
    case "stopped": return "Stopped";
    case "succeeded": { const d = durationSeconds(r); return r.summary || (d === null ? "Succeeded" : `Succeeded, ${d} s`); }
  }
}

/** What started it, in the run's own words. */
export const runTitle = (r: Run): string => r.name || "Started";

/* ---------- time ---------- */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const two = (n: number): string => String(n).padStart(2, "0");
const dayNumber = (ts: number): number => { const d = new Date(ts); return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86_400_000); };

export const clock = (ts: number): string => { const d = new Date(ts); return `${two(d.getHours())}:${two(d.getMinutes())}`; };
export type DayGroup = "Today" | "Yesterday" | "Earlier";
export function dayGroup(ts: number, now: number): DayGroup {
  const back = dayNumber(now) - dayNumber(ts);
  return back <= 0 ? "Today" : back === 1 ? "Yesterday" : "Earlier";
}
/** The time at the right of a row: the clock today and yesterday, the weekday and the clock before that. */
export function rowTime(ts: number, now: number): string {
  return dayGroup(ts, now) === "Earlier" ? `${DAYS[new Date(ts).getDay()]} ${clock(ts)}` : clock(ts);
}
/** "Today 10:07" or "Thu 23 Oct 10:07". */
export function stamp(ts: number, now: number): string {
  const g = dayGroup(ts, now);
  if (g === "Today") return `Today ${clock(ts)}`;
  if (g === "Yesterday") return `Yesterday ${clock(ts)}`;
  const d = new Date(ts);
  return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]} ${clock(ts)}`;
}
export function ago(ts: number, now: number): string {
  const min = Math.floor((now - ts) / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  if (min < 1440) return `${Math.round(min / 60)} h ago`;
  return stamp(ts, now);
}

export interface DaySection { group: DayGroup; runs: Run[] }
/** Newest first, under Today, Yesterday and Earlier; an empty group is left out. */
export function daySections(runs: readonly Run[], now: number): DaySection[] {
  const sorted = [...runs].sort((a, b) => b.startedAt - a.startedAt);
  const out: DaySection[] = [];
  for (const r of sorted) {
    const g = dayGroup(r.startedAt, now);
    const last = out[out.length - 1];
    if (last && last.group === g) last.runs.push(r); else out.push({ group: g, runs: [r] });
  }
  return out;
}

/** The trace id as the prototype writes it, for the Copy trace id button. */
export const traceOf = (r: Run): string => r.traceId;

/* ---------- failed runs across Automations ---------- */

export function failedAcross(runs: readonly Run[]): { rows: Run[]; automations: number } {
  const handled = handledIds(runs);
  const rows = runs.filter((r) => needsAttention(r, handled)).sort((a, b) => b.startedAt - a.startedAt);
  return { rows, automations: new Set(rows.map((r) => r.subject?.id ?? r.id)).size };
}
export function failedHeadline(rows: number, automations: number): string {
  return rows === 0 ? "None" : `${plural(rows, "run")} across ${plural(automations, "automation")}`;
}

/* ---------- the run thread as chat lines ---------- */

export type Tone = "ok" | "wait" | "bad" | "muted";
export interface Who { kind: "person" | "agent" | "actor" | "service"; id: string }
export type RunLine =
  | { kind: "row"; id: string; text: string; icon: string; tone: Tone; retry?: string; offset: number }
  | { kind: "turn"; id: string; who: Who; step?: string; text: string; thought?: { secs: number; text: string }; did: string[]; skipped: string[]; key?: string; model?: string; backup?: string; offset: number }
  | { kind: "join"; id: string; who: Who; text: string }
  | { kind: "wait"; id: string; text: string; holdId?: string; taskId?: string; offset: number }
  | { kind: "error"; id: string; text: string; detail: string; retry?: string; step?: string; offset: number }
  | { kind: "say"; id: string; who: Who; text: string; offset: number }
  | { kind: "stat"; id: string; text: string }
  | { kind: "branch"; id: string; label: string; lines: RunLine[] };

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const str = (v: unknown): string | undefined => (typeof v === "string" && v !== "" ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
const blockOf = (m: ThreadMessage): { type: string; data: Record<string, unknown> } | null => {
  const b = m.blocks.find((x) => x.type.startsWith("run."));
  return b ? { type: b.type, data: rec(b.data) } : null;
};

function lineOf(m: ThreadMessage, run: Pick<Run, "startedAt">): RunLine | null {
  const offset = Math.max(0, Math.round((m.createdAt - run.startedAt) / 1000));
  const b = blockOf(m);
  const id = m.messageId;
  if (b?.type === "run.join") return { kind: "join", id, who: m.author, text: m.body };
  if (b?.type === "run.stat") return { kind: "stat", id, text: m.body };
  if (b?.type === "run.wait") return { kind: "wait", id, text: m.body, ...(str(b.data["holdId"]) ? { holdId: str(b.data["holdId"])! } : {}), ...(str(b.data["taskId"]) ? { taskId: str(b.data["taskId"])! } : {}), offset };
  if (b?.type === "run.error") return { kind: "error", id, text: m.body, detail: str(b.data["detail"]) ?? "", ...(str(b.data["retry"]) ? { retry: str(b.data["retry"])! } : {}), ...(str(b.data["step"]) ? { step: str(b.data["step"])! } : {}), offset };
  if (b?.type === "run.row") {
    const retry = str(b.data["retry"]);
    const icon = str(b.data["icon"]) ?? (retry ? "retry" : "check");
    return { kind: "row", id, text: m.body, icon, tone: (str(b.data["tone"]) as Tone | undefined) ?? (retry ? "wait" : icon === "check" ? "ok" : "muted"), ...(retry ? { retry } : {}), offset };
  }
  if (b?.type === "run.turn" || m.kind === "agent") {
    const d: Record<string, unknown> = b?.data ?? {};
    const th = rec(d["thought"]);
    const thoughtText = str(th["text"]);
    return {
      kind: "turn", id, who: m.author, text: m.body, did: strs(d["did"]), skipped: strs(d["skipped"]), offset,
      ...(str(d["title"]) ? { step: str(d["title"])! } : {}),
      ...(thoughtText ? { thought: { secs: num(th["secs"]) ?? 3, text: thoughtText } } : {}),
      ...(str(d["key"]) ? { key: str(d["key"])! } : {}), ...(str(d["model"]) ? { model: str(d["model"])! } : {}), ...(str(d["backup"]) ? { backup: str(d["backup"])! } : {}),
    };
  }
  if (m.kind === "text") return { kind: "say", id, who: m.author, text: m.body, offset };
  if (m.kind === "system" || m.kind === "quiet") return { kind: "row", id, text: m.body, icon: "check", tone: "ok", offset };
  return null;
}

/** The chat lines of a Run: the thread in order, side threads grouped, and an error row from the step log when the thread has none for a failed Run. */
export function buildLines(run: Pick<Run, "id" | "status" | "startedAt">, messages: readonly ThreadMessage[], steps: readonly RunStep[]): RunLine[] {
  const sorted = [...messages].sort((a, b) => a.threadSeq - b.threadSeq);
  const out: RunLine[] = [];
  let branch: Extract<RunLine, { kind: "branch" }> | null = null;
  for (const m of sorted) {
    const line = lineOf(m, run);
    if (!line) continue;
    if (m.depth > 0) {
      const label = str(rec(m.blocks.find((x) => x.type === "run.branch")?.data)["label"]);
      if (!branch || (label && label !== branch.label)) { branch = { kind: "branch", id: `branch-${m.messageId}`, label: label ?? "Side thread", lines: [] }; out.push(branch); }
      branch.lines.push(line);
    } else {
      branch = null;
      out.push(line);
    }
  }
  const hasError = flat(out).some((l) => l.kind === "error");
  if (run.status === "failed" && !hasError) {
    const failed = [...steps].reverse().find((s) => s.state === "failed" && s.error);
    if (failed?.error) out.push({ kind: "error", id: `err-${failed.step}`, text: failed.error.message, detail: "", step: failed.step, retry: `Try ${failed.attempt}, failed.`, offset: Math.max(0, Math.round(((failed.endedAt ?? run.startedAt) - run.startedAt) / 1000)) });
  }
  return out;
}
export function flat(lines: readonly RunLine[]): RunLine[] {
  return lines.flatMap((l) => (l.kind === "branch" ? [l, ...flat(l.lines)] : [l]));
}

/** The step that follows the last failed one in the step log, in first-seen order: where Skip step carries on. */
export function stepAfterFailed(steps: readonly RunStep[]): string | undefined {
  const order: string[] = [];
  for (const s of steps) if (!order.includes(s.step)) order.push(s.step);
  const bad = [...steps].reverse().find((s) => s.state === "failed");
  if (!bad) return undefined;
  return order[order.indexOf(bad.step) + 1];
}

/** The step to retry from: the last error row's step, else the last failed step. */
export function failedStep(lines: readonly RunLine[], steps: readonly RunStep[]): string | undefined {
  const err = [...flat(lines)].reverse().find((l): l is Extract<RunLine, { kind: "error" }> => l.kind === "error");
  return err?.step ?? [...steps].reverse().find((s) => s.state === "failed")?.step;
}

export const offsetWords = (offset: number): string => `+${offset} s`;

/** The right-hand time of a line: the offset into the run, or the start time for the first line. */
export const lineTime = (offset: number, run: Pick<Run, "startedAt">): string => (offset > 0 ? offsetWords(offset) : clock(run.startedAt));

/* ---------- undo ---------- */

export function undoSummary(p: UndoPreview): string {
  if (p.undone.length === 0 && p.skipped.length === 0) return "This run changed nothing that can be undone.";
  const parts = [`${plural(p.undone.length, "change")} will be reversed`];
  if (p.skipped.length) parts.push(`${p.skipped.length} cannot be`);
  return `${parts.join(", ")}.`;
}
export const SKIP_WORDS: Readonly<Record<UndoPreview["skipped"][number]["reason"], string>> = {
  changed_since: "Changed since the run",
  not_undoable: "Cannot be undone",
  sent: "Already sent",
  deployed: "Already deployed",
};
export function undoResult(p: UndoPreview): string {
  const done = p.undone.length, left = p.skipped.length;
  return left ? `Undid ${plural(done, "change")}. ${plural(left, "change")} could not be undone.` : `Undid ${plural(done, "change")}.`;
}

/* ---------- keyboard order ---------- */

/** Ids in the order they are on screen; used by the arrow keys. */
export function nextId(order: readonly string[], current: string | null, dir: 1 | -1): string | null {
  if (order.length === 0) return null;
  if (current === null) return dir === 1 ? order[0]! : order[order.length - 1]!;
  const i = order.indexOf(current);
  if (i < 0) return order[0]!;
  return order[Math.min(order.length - 1, Math.max(0, i + dir))]!;
}
