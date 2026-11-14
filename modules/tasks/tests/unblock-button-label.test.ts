// The escalation text of a stopped agent task (modules/engine/handlers/task-baton.ts) tells the person to press "Done, continue". That must stay the real label of the unblock task's first action, the one that
// closes the task (tasks.act key "resolved") and lets the baton wake the stopped agent. If the label changes, change the sentence in task-baton.ts and the test beside it.
import test from "node:test";
import assert from "node:assert/strict";
import { KIND_ACTIONS } from "../handlers/state.ts";

test("the unblock task's first button is Done, continue, with the key the baton waits for", () => {
  assert.deepEqual(KIND_ACTIONS.unblock[0], { key: "resolved", label: "Done, continue", note: "optional" });
});
