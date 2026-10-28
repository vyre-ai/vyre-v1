export type TaskState = "todo" | "doing" | "in_review" | "awaiting_approval" | "done" | "canceled";
export type TaskRef = { kind: "person" | "agent" | "group" | "role" | "automation"; id: string };
export interface TaskView {
  id: string; title: string; kind: string; state: TaskState; blocked: boolean;
  summary?: string; why?: string; assigned: TaskRef; reviewer?: TaskRef; approver?: TaskRef;
  actions: readonly { key: string; label: string; note?: "required" | "optional" }[];
  due?: number; effort?: number; takenBy?: string; snoozedUntil?: number;
  followers: readonly string[]; workingNotes: Record<string, string>; fileIds: readonly string[];
  recordId?: string; dependsOn: readonly string[]; threadId?: string;
  source?: { kind: string; id: string }; updatedAt: number;
}
export const TASK_STATES: readonly { key: TaskState; title: string }[] = [
  { key: "todo", title: "To do" }, { key: "doing", title: "Doing" }, { key: "in_review", title: "In review" },
  { key: "awaiting_approval", title: "Awaiting approval" }, { key: "done", title: "Done" }, { key: "canceled", title: "Canceled" },
];
export type TaskCap = "tasks.act" | "tasks.transition" | "tasks.update" | "tasks.assign" | "tasks.delegate" | "tasks.take" | "tasks.release" | "tasks.snooze" | "tasks.followers.add" | "tasks.followers.remove" | "tasks.working_notes.set" | "tasks.working_notes.delete";
export function actionInput(task: TaskView, key: string, note: string, answer: string): Record<string, unknown> {
  const action = task.actions.find((item) => item.key === key);
  if (!action) throw new Error("This action is no longer offered. Refresh the task.");
  if (action.note === "required" && !note.trim()) throw new Error("Add a note before continuing.");
  return { taskId: task.id, action: key, ...(note.trim() ? { note: note.trim() } : {}), ...(answer.trim() ? { answer: answer.trim() } : {}) };
}
export function taskDue(value: string): number | null {
  if (!value.trim()) return null;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) throw new Error("Choose a valid due date and time.");
  return timestamp;
}
