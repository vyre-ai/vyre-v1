// The work baton as a page reads it (work baton, lane W2): the four steps of a work task, who holds each, whose turn it is, what was handed in and what was asked to change.
// Pure: the page passes the task and the person looking, and gets plain data back. Nothing here calls anything.
import type { TaskRef, TaskView } from "./model.ts";

export type StepKey = "assigned" | "review" | "approve" | "done";
export type StepLit = "past" | "now" | "next";
export interface BatonStep { key: StepKey; title: string; who?: TaskRef; lit: StepLit }
/** The move the person looking can make right now, if any. */
export type MyMove = "work" | "review" | "approve" | null;

const SLOT_OF: Record<Exclude<StepKey, "done">, "assigned" | "reviewer" | "approver"> = { assigned: "assigned", review: "reviewer", approve: "approver" };
const OPEN = new Set(["todo", "doing", "in_review", "awaiting_approval"]);

/** A baton task is work with someone to pass it to, or one the baton tools already touched. */
export function isBaton(task: TaskView): boolean {
  return task.kind === "work" && (task.reviewer !== undefined || task.approver !== undefined || task.workingNotes["brief"] !== undefined || task.workingNotes["outputs"] !== undefined);
}

/** Which step holds the baton: the work while it is To do or Doing, review, approval, then done. A canceled task holds it nowhere. */
export function nowStep(task: TaskView): StepKey | null {
  if (task.state === "todo" || task.state === "doing") return "assigned";
  if (task.state === "in_review") return "review";
  if (task.state === "awaiting_approval") return "approve";
  if (task.state === "done") return "done";
  return null;
}

/** The stepper: Assigned, then Review and Approve when the task has them, then Done. Steps before the holder are past, the holder is lit, the rest wait. */
export function stepsOf(task: TaskView): BatonStep[] {
  const keys: StepKey[] = ["assigned", ...(task.reviewer ? ["review" as const] : []), ...(task.approver ? ["approve" as const] : []), "done"];
  const here = nowStep(task);
  const at = here === null ? -1 : keys.indexOf(here);
  return keys.map((key, i) => {
    const who = key === "done" ? undefined : task[SLOT_OF[key]];
    return { key, title: key === "assigned" ? "Do" : key === "review" ? "Review" : key === "approve" ? "Approve" : "Done", ...(who ? { who } : {}), lit: here === "done" ? "past" : i < at ? "past" : i === at ? "now" : "next" };
  });
}

const isMine = (who: TaskRef | undefined, me: string, takenBy: string | undefined): boolean => who !== undefined && (who.id === me || ((who.kind === "group" || who.kind === "role") && takenBy === me));

/** What the person looking may do: the seat whose turn it is, when it is theirs. A group or role seat is theirs once they took the task. */
export function myMove(task: TaskView, me: string): MyMove {
  if (!OPEN.has(task.state) || task.blocked) return null;
  const here = nowStep(task);
  if (here === "assigned" && isMine(task.assigned, me, task.takenBy)) return "work";
  if (here === "review" && isMine(task.reviewer, me, task.takenBy)) return "review";
  if (here === "approve" && isMine(task.approver, me, task.takenBy)) return "approve";
  return null;
}

export interface Deliverable { summary?: string; fields: Array<{ name: string; value: string }> }
const text = (v: unknown): string => (typeof v === "string" ? v : JSON.stringify(v));
/** What the doer handed in: the summary and each output as a named field. Nothing when nothing was submitted. */
export function deliverableOf(task: TaskView): Deliverable | null {
  const summary = task.workingNotes["summary"];
  let outputs: Record<string, unknown> = {};
  try { const p = JSON.parse(task.workingNotes["outputs"] ?? "{}") as unknown; if (p && typeof p === "object" && !Array.isArray(p)) outputs = p as Record<string, unknown>; } catch { /* no fields */ }
  const fields = Object.entries(outputs).slice(0, 30).map(([name, value]) => ({ name, value: text(value).slice(0, 4_000) }));
  if (summary === undefined && fields.length === 0) return null;
  return { ...(summary ? { summary } : {}), fields };
}

/** The fixes a reviewer or approver asked for, in order. */
export function fixesOf(task: TaskView): string[] {
  try { const p = JSON.parse(task.workingNotes["fixes"] ?? "[]") as unknown; return Array.isArray(p) ? p.map(String).filter((f) => f.trim() !== "") : []; } catch { return []; }
}

/** The brief the step wrote, and what done means, from the task's notes. */
export function briefOf(task: TaskView): { text: string; doneMeans: string[] } | null {
  const brief = task.workingNotes["brief"] ?? task.why;
  if (!brief) return null;
  let doneMeans: string[] = [];
  try { const p = JSON.parse(task.workingNotes["done_means"] ?? "[]") as unknown; if (Array.isArray(p)) doneMeans = p.map(String); } catch { /* none */ }
  return { text: brief, doneMeans };
}

/** The fields the deliverable asks for, from the output schema the step recorded: name, whether required, type. Empty when the task has no schema. */
export function wantedFields(task: TaskView): Array<{ name: string; required: boolean; type: string }> {
  try {
    const s = JSON.parse(task.workingNotes["output_schema"] ?? "null") as { properties?: Record<string, { type?: string }>; required?: string[] } | null;
    const req = new Set(s?.required ?? []);
    return Object.entries(s?.properties ?? {}).slice(0, 20).map(([name, p]) => ({ name, required: req.has(name), type: typeof p?.type === "string" ? p.type : "value" }));
  } catch { return []; }
}

/** The numbered fixes a person types, one per line, as the list the tool takes. Blank lines and a leading number or dash are dropped. */
export function fixesFromText(raw: string): string[] {
  return raw.split("\n").map((l) => l.replace(/^\s*(?:\d+[.)]|[-*])\s*/, "").trim()).filter((l) => l !== "");
}
