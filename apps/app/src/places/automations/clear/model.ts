// Automations that explain themselves (rc.41): what the screens draw of the server's answers. Pure. The sentence, what is missing, last week and the reasons a run did not start are all worked out on the
// server (modules/automations/handlers/clear.ts); this file only shapes them for a row, a pane and a sheet, and adds no words of its own about what an Automation does.
import type { ConnectNeed } from "../../../shell/connect/model.ts";

/** What an Automation is missing before it can be turned on (automations.readiness). */
export interface Blocked {
  automationId?: string;
  nodeId?: string;
  /** a few words for a list row */ short: string;
  /** one sentence for the page */ line: string;
  button: "Connect" | "Fix";
  fix: { kind: "ai_account" | "mailbox" | "number" | "connection" | "file" | "step"; connector?: string };
}

/** The connect flow a Connect button opens in place; null when the fix is on a step (Fix opens the Automation there). */
export function connectNeedOf(b: Pick<Blocked, "fix">): ConnectNeed | null {
  switch (b.fix.kind) {
    case "ai_account":
      return { kind: "ai" };
    case "mailbox":
      return { kind: "mailbox" };
    case "number":
      return { kind: "number" };
    case "connection":
      return b.fix.connector ? { kind: "connector", service: b.fix.connector } : null;
    default:
      return null;
  }
}

export const blockedById = (rows: readonly Blocked[]): Map<string, Blocked> =>
  new Map(rows.flatMap((b) => (b.automationId ? [[b.automationId, b] as const] : [])));

/** One thing that happened last week, as automations.would_run names it. */
export interface WeekStart {
  eventId: string;
  at: number;
  starts: boolean;
  name: string;
  change: string;
  why?: string;
  recordId?: string;
  type?: string;
}
export interface WouldRun {
  supported: boolean;
  days: number;
  n: number;
  of: number;
  capped: boolean;
  what?: string;
  noun?: string;
  /** For "Find a customer": the record type to search and the field its records are named by. */
  recordType?: string;
  titleField?: string;
  starts: readonly WeekStart[];
}

/** The Last week row: the number that would have started, and what it is out of. */
export function weekHead(w: WouldRun): { n: string; title: string; sub: string } {
  return {
    n: `${w.n}${w.capped ? "+" : ""}`,
    title: "would have started",
    sub:
      w.of === 0
        ? "Nothing of its kind happened"
        : `of ${w.of}${w.capped ? "+" : ""} ${w.what ?? "things that happened"}`,
  };
}

/** What a test can be tried on: the newest things that really happened, each one once per record, then whatever a search finds. */
export function tryOn(w: WouldRun | null, limit = 3): WeekStart[] {
  const seen = new Set<string>();
  const out: WeekStart[] = [];
  for (const s of w?.starts ?? []) {
    const key = s.recordId ?? s.eventId;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
    if (out.length >= limit) break;
  }
  return out;
}

/** One step of a test as the pane and the page show it. */
export interface TraceStep {
  id: string;
  number: number;
  /** the step's sentence in plain words */ text: string;
  state: "pending" | "running" | "done" | "stopped" | "skipped";
  /** it sends or writes: the test held it */ held: boolean;
  /** why it stopped, in the server's words */ error?: string;
  /** what it was given, in words with the real values */ values: readonly (readonly [string, string])[];
}

export interface TraceSummary {
  state: "running" | "ok" | "stopped";
  /** "Step 2 of 3", "Ran to the end", "Stopped at step 2" */ head: string;
  /** "2 held" */ quiet: string;
  /** the server's reason when it stopped */ why: string;
  held: TraceStep[];
}

export function traceSummary(steps: readonly TraceStep[], finished: boolean): TraceSummary {
  const held = steps.filter((s) => s.state === "done" && s.held);
  const stopped = steps.find((s) => s.state === "stopped");
  const quiet = held.length > 0 ? `${held.length} held` : "";
  if (stopped)
    return { state: "stopped", head: `Stopped at step ${stopped.number}`, quiet, why: stopped.error ?? "", held };
  if (!finished) {
    const at = steps.find((s) => s.state === "running") ?? steps.find((s) => s.state === "pending");
    return { state: "running", head: at ? `Step ${at.number} of ${steps.length}` : "Starting", quiet, why: "", held };
  }
  return { state: "ok", head: "Ran to the end", quiet, why: "", held };
}

/** What became of an Automation for one record (automations.why_not). */
export interface WhyRow {
  automationId: string;
  name: string;
  status: "on" | "off" | "draft" | "paused";
  verdict: "not_started" | "stopped" | "failed" | "waiting" | "running" | "ran" | "off";
  line: string;
  checks: readonly { ok: boolean; line: string; detail?: string }[];
  runId?: string;
}
export interface WhyOut {
  record: { id: string; type?: string; typeName?: string; typePlural?: string; title?: string };
  changes: readonly { eventId: string; at: number; line: string; by?: string }[];
  eventId?: string;
  automations: readonly WhyRow[];
}

/** The tone of a verdict word: what did not go as asked is amber, what ran is green, off is quiet. */
export const verdictTone = (v: WhyRow["verdict"]): "warn" | "ok" | "quiet" =>
  v === "ran" || v === "running" ? "ok" : v === "off" ? "quiet" : "warn";

/** The one opened first: the first that did not do what was hoped, else nothing is open. */
export const firstOpen = (rows: readonly WhyRow[]): string | null =>
  rows.find((r) => verdictTone(r.verdict) === "warn")?.automationId ?? null;

/** "3 automations watch Customers", "1 automation watches this". `plural` is the record type's own plural, from the server. */
export function watchLine(count: number, plural?: string): string {
  const what = plural && plural !== "" ? plural : "this";
  if (count === 0) return `No automation watches ${what}`;
  return `${count} ${count === 1 ? "automation watches" : "automations watch"} ${what}`;
}
