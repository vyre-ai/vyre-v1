import test from "node:test";
import assert from "node:assert/strict";
import { actionInput, taskDue } from "./model.ts";
import type { TaskView } from "./model.ts";
const task: TaskView = { id: "tsk_fixture", title: "Review the brief", kind: "review", state: "in_review", blocked: false, assigned: { kind: "person", id: "usr_owner" }, actions: [{ key: "send_back", label: "Send back", note: "required" }], followers: [], workingNotes: {}, fileIds: [], dependsOn: [], updatedAt: 1 };
test("task offered actions preserve required notes and never invent a decision", () => {
  assert.throws(() => actionInput(task, "approve", "", ""), /no longer offered/);
  assert.throws(() => actionInput(task, "send_back", "  ", ""), /Add a note/);
  assert.deepEqual(actionInput(task, "send_back", "  Check totals  ", ""), { taskId: task.id, action: "send_back", note: "Check totals" });
});
test("task due dates distinguish an explicit clear from invalid input", () => {
  assert.equal(taskDue(""), null); assert.throws(() => taskDue("later"), /valid due/);
  assert.equal(taskDue("2026-10-29T12:30:00Z"), Date.UTC(2026, 9, 29, 12, 30));
});
