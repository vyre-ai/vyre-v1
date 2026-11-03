// The moves a person can make on a task from where they sit, as plain data (no React). The status menu, the row's menu and the keys offer only these, in the words of the move ("Hand in for
// review", "Send back", "Approve"), never the six states. It mirrors the server's table (modules/tasks/handlers/state.ts planMove and its actors), which still decides: a move offered here that the
// server refuses says why. Handing work in is one path from every door: tasks.submit with a one-line summary.
import type { TaskState } from "../../../../../../ui/src/TaskPage/model.ts";

export interface MoveTask {
  kind: string; state: TaskState | string; createdBy: string; takenBy?: string | undefined; yourTurn?: boolean | undefined;
  assigned: { kind: string; id: string }; reviewer?: { kind: string; id: string } | undefined; approver?: { kind: string; id: string } | undefined;
  actions?: ReadonlyArray<{ key: string; label: string; note?: string | undefined }> | undefined;
}
/** What a move needs typed before it goes: the one-line summary of a hand-in, the fixes of a send back, the reason of a reject, the note a request action requires. */
export type Ask = "summary" | "fixes" | "reason" | "note";
export interface Move { key: string; label: string; to: TaskState | null; cap: string; input: Record<string, unknown>; ask?: Ask; danger?: boolean }

const OPEN = new Set(["todo", "doing", "in_review", "awaiting_approval"]);
const shared = (k: string): boolean => k === "group" || k === "role";

/** Does the person sit in this slot? By id; or a group or role slot they took, or one of theirs nobody took yet (the server said it is their turn). */
export function sits(t: MoveTask, slot: "assigned" | "reviewer" | "approver", me: string): boolean {
  const w = t[slot];
  if (!w) return false;
  if (!shared(w.kind)) return w.id === me;
  return t.takenBy === me || (t.takenBy === undefined && t.yourTurn === true);
}

/** Where handing the work in leads: the reviewer, else the approver, else done. */
export const handInTo = (t: Pick<MoveTask, "reviewer" | "approver">): TaskState => (t.reviewer ? "in_review" : t.approver ? "awaiting_approval" : "done");
export const handInLabel = (t: Pick<MoveTask, "reviewer" | "approver">): string => (t.reviewer ? "Hand in for review" : t.approver ? "Hand in for approval" : "Mark done");

/** Every move this person can make on this task now, the likely one first. Empty when nothing is theirs to do. */
export function movesFor(t: MoveTask, me: string): Move[] {
  const out: Move[] = [];
  const open = OPEN.has(t.state);
  const doer = sits(t, "assigned", me), reviewer = sits(t, "reviewer", me), approver = sits(t, "approver", me), creator = t.createdBy === me;
  if (t.kind !== "work") {
    // a request is answered at its source, with the actions it carries
    if (open && (doer || reviewer || approver)) {
      for (const a of t.actions ?? []) if (a.key !== "delegate" && a.key !== "snooze") out.push({ key: a.key, label: a.label, to: null, cap: "tasks.act", input: { action: a.key }, ...(a.note === "required" ? { ask: "note" as const } : {}) });
    }
    return out;
  }
  if (t.state === "todo" && doer) out.push({ key: "start", label: "Start", to: "doing", cap: "tasks.transition", input: { to: "doing", expectedFrom: "todo" } });
  if ((t.state === "todo" || t.state === "doing") && doer) out.push({ key: "submit", label: handInLabel(t), to: handInTo(t), cap: "tasks.submit", input: {}, ask: "summary" });
  if (t.state === "in_review" && reviewer) {
    out.push({ key: "approve", label: t.approver ? "Looks good, on to approval" : "Approve", to: t.approver ? "awaiting_approval" : "done", cap: "tasks.review", input: { verdict: "approve" } });
    out.push({ key: "send_back", label: "Send back", to: "doing", cap: "tasks.review", input: { verdict: "send_back" }, ask: "fixes" });
  }
  if (t.state === "awaiting_approval" && approver) {
    out.push({ key: "approve", label: "Approve", to: "done", cap: "tasks.decide", input: { verdict: "approve" } });
    out.push({ key: "reject", label: "Send back", to: "doing", cap: "tasks.decide", input: { verdict: "reject" }, ask: "reason" });
  }
  if (open && (doer || reviewer || approver || creator)) out.push({ key: "cancel", label: "Cancel the task", to: "canceled", cap: "tasks.transition", input: { to: "canceled", expectedFrom: t.state }, danger: true });
  if (!open && (doer || creator)) out.push({ key: "reopen", label: "Reopen", to: "todo", cap: "tasks.transition", input: { to: "todo", expectedFrom: t.state } });
  return out;
}

/** A group or role task nobody took, offered to this person: they can Take it. */
export const canTake = (t: Pick<MoveTask, "assigned" | "takenBy" | "yourTurn" | "state">): boolean => OPEN.has(t.state) && shared(t.assigned.kind) && t.takenBy === undefined && t.yourTurn === true;
/** A task this person took from a group or role: they can give it back. */
export const canRelease = (t: Pick<MoveTask, "assigned" | "takenBy" | "state">, me: string): boolean => OPEN.has(t.state) && shared(t.assigned.kind) && t.takenBy === me;
