// What a work card says now, read from the thing it points at as the person looking at it: running, done, failed, waiting on you. The read doubles as the access check: a card the reader may not open
// (the read is refused) hides the name it carries. Pure: which read to make and how to word the answer; the host makes the call.
import type { LinkCardData } from "./model.ts";

export interface CardState { text: string; tone: "live" | "ok" | "warn" | "bad" | "quiet"; /** worth reading again soon */ live: boolean }

/** The read that says what the target is and whether the reader may see it, or null when a card has nothing to read (a fact, a card with no target). */
export function probeOf(d: LinkCardData): { cap: string; input: Record<string, unknown> } | null {
  const t = d.target;
  if (!t) return null;
  switch (t.type) {
    case "task": return { cap: "tasks.get", input: { taskId: t.id } };
    case "run": return { cap: "runs.get", input: { runId: t.id } };
    case "record": return d.via ? { cap: "records.get", input: { type: d.via, recordId: t.id } } : null;
    case "file": return { cap: "files.get", input: { fileId: t.id } };
    case "thread": return { cap: "threads.get", input: { threadId: t.id } };
    case "computer": return { cap: "computers.get", input: { computerId: t.id } };
    case "automation": return { cap: "automations.get", input: { automationId: t.id } };
    default: return null;
  }
}

const RUN: Record<string, CardState> = {
  queued: { text: "Running", tone: "live", live: true }, running: { text: "Running", tone: "live", live: true }, waiting: { text: "Waiting on you", tone: "warn", live: true },
  succeeded: { text: "Done", tone: "ok", live: false }, failed: { text: "Failed", tone: "bad", live: false }, cancelled: { text: "Stopped", tone: "quiet", live: false },
};
const TASK: Record<string, CardState> = {
  backlog: { text: "To do", tone: "quiet", live: true }, todo: { text: "To do", tone: "quiet", live: true }, doing: { text: "Working", tone: "live", live: true },
  in_review: { text: "In review", tone: "live", live: true }, awaiting_approval: { text: "Waiting on you", tone: "warn", live: true }, blocked: { text: "Blocked", tone: "warn", live: true },
  done: { text: "Done", tone: "ok", live: false }, canceled: { text: "Stopped", tone: "quiet", live: false },
};

const FLOW: Record<string, CardState> = {
  draft: { text: "Draft", tone: "quiet", live: true }, on: { text: "On", tone: "ok", live: false }, off: { text: "Off", tone: "quiet", live: false }, paused: { text: "Paused", tone: "warn", live: false },
};

/** A card's button whose work the thing itself shows as done: Turn on, once the Flow is on, wherever it was turned on. */
export const doneByState = (d: LinkCardData, state: CardState | null): readonly string[] => (d.target?.type === "automation" && state?.text === "On" ? ["on"] : []);

/** The held call a work card names, when it is one: a held call has one card, the approval card, so the app draws that in its place. */
export const heldTaskOf = (d: LinkCardData): string | null => (d.icon === "approval" && d.target?.type === "task" ? d.target.id : null);

/** The state a read answers with, or null when the thing has none to show (a file, a record). */
export function stateOf(d: LinkCardData, answer: unknown): CardState | null {
  const a = (answer ?? {}) as Record<string, Record<string, unknown> | undefined>;
  const type = d.target?.type;
  if (type === "run") return RUN[String(a["run"]?.["status"])] ?? null;
  if (type === "task") return TASK[String(a["task"]?.["state"])] ?? null;
  if (type === "computer") return a["computer"]?.["state"] === "running" ? { text: "On", tone: "live", live: true } : null;
  if (type === "automation") return FLOW[String(a["automation"]?.["status"])] ?? null;
  return null;
}

/** What replaces the name when the reader may not open the thing. */
export const HIDDEN_TITLE = "Not shared with you";
