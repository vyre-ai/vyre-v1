// "Working on" on the agent page (work baton): which tasks have the baton with this agent, what it is doing with each, and nothing drawn when it holds none.
import test from "node:test";
import assert from "node:assert/strict";
import { actionOf, heldBy } from "./WorkingOn.tsx";
import type { HeldTask } from "./WorkingOn.tsx";

const A = "agt_a";
const t = (id: string, o: Partial<HeldTask> = {}): HeldTask => ({ id, title: id, state: "todo", assigned: { kind: "agent", id: "agt_other" }, ...o });

test("the baton is with the doer in To do and Doing, the reviewer in review, the approver in approval", () => {
  assert.equal(actionOf(t("a", { assigned: { kind: "agent", id: A } }), A), "Doing");
  assert.equal(actionOf(t("b", { state: "doing", assigned: { kind: "agent", id: A } }), A), "Doing");
  assert.equal(actionOf(t("c", { state: "in_review", reviewer: { kind: "agent", id: A } }), A), "Reviewing");
  assert.equal(actionOf(t("d", { state: "awaiting_approval", approver: { kind: "agent", id: A } }), A), "Approving");
});

test("a task the agent is a seat on but does not hold now is not listed, and a group task the agent took is", () => {
  const rows = heldBy([
    t("later", { assigned: { kind: "agent", id: A }, state: "in_review", reviewer: { kind: "person", id: "usr_x" } }),
    t("past", { state: "awaiting_approval", assigned: { kind: "agent", id: A }, approver: { kind: "agent", id: "agt_z" } }),
    t("taken", { assigned: { kind: "group", id: "grp_1" }, takenBy: A }),
    t("mine", { assigned: { kind: "agent", id: A } }),
  ], A);
  assert.deepEqual(rows.map((r) => r.task.id), ["taken", "mine"]);
});
