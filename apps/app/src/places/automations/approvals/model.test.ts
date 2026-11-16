// An Automation that waits for a person's approval (rc.32 lane r32-auto, item 6): the card says what is asked, who may answer, and what happens on Allow and on Deny, in the one approval vocabulary.
import test from "node:test";
import assert from "node:assert/strict";
import { approvalCard, answerFor } from "./model.ts";

const task = {
  id: "tsk_1",
  title: "Send the invoices",
  kind: "approve",
  state: "awaiting_approval",
  createdBy: "usr_run",
  assigned: { kind: "person", id: "usr_me" },
  approver: { kind: "person", id: "usr_me" },
  actions: [
    { key: "approve", label: "Allow", note: "optional" },
    { key: "reject", label: "Deny", note: "required" },
  ],
};
const say = (id: string): string | undefined =>
  ({ post: "Post in #billing", stop: "Stop: not approved" })[id as "post"];

test("the person who may answer gets a card with the question and what each answer does", () => {
  const c = approvalCard({ task, me: "usr_me", node: { id: "ask", next: ["post"] }, say });
  assert.ok(c);
  assert.equal(c.taskId, "tsk_1");
  assert.equal(c.title, "Send the invoices");
  assert.equal(c.allow, "It goes on: Post in #billing.");
  assert.equal(c.deny, "It goes on with your no: Post in #billing.");
});

test("a Denied path of its own is named, and the last step says it finishes", () => {
  const c = approvalCard({
    task,
    me: "usr_me",
    node: {
      id: "ask",
      branches: [
        { label: "approved", to: "post" },
        { label: "rejected", to: "stop" },
      ],
    },
    say,
  })!;
  assert.equal(c.allow, "It goes on: Post in #billing.");
  assert.equal(c.deny, "It goes to: Stop: not approved.");
  const last = approvalCard({ task, me: "usr_me", node: { id: "ask" }, say })!;
  assert.equal(last.allow, "It finishes.");
  assert.equal(last.deny, "It finishes with your no.");
});

test("nobody else is offered the card, and a decided task is not offered at all", () => {
  assert.equal(approvalCard({ task, me: "usr_other", node: { id: "ask" }, say }), null);
  assert.equal(approvalCard({ task: { ...task, state: "done" }, me: "usr_me", node: { id: "ask" }, say }), null);
});

test("Allow is one answer on the task, Deny needs a reason and says so in a sentence", () => {
  assert.deepEqual(answerFor("tsk_1", "allow"), { cap: "tasks.act", input: { taskId: "tsk_1", action: "approve" } });
  assert.deepEqual(answerFor("tsk_1", "deny", "Not this month"), {
    cap: "tasks.act",
    input: { taskId: "tsk_1", action: "reject", note: "Not this month" },
  });
  assert.throws(() => answerFor("tsk_1", "deny", "  "), /Say why/);
});
