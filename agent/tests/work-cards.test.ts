// The work a turn started becomes cards under its reply: one per thing, in the order made, only for calls that made something; a call waiting on a yes is a card too.
import test from "node:test";
import assert from "node:assert/strict";
import { heldCard, recordWork, takeWork, workBlocks, workCardOf } from "../src/tools/work-cards.ts";

test("each kind of work has a card that names it and points at it", () => {
  assert.deepEqual(workCardOf("tasks.create", {}, { task: { id: "tsk_1", title: "Call Dana" } }), { key: "task:tsk_1", icon: "task", lead: "Task", title: "Call Dana", target: { type: "task", id: "tsk_1" } });
  assert.equal(workCardOf("automations.run", { name: "Lead sweep" }, { runId: "run_1" })!.lead, "Run");
  assert.equal(workCardOf("automations.test", {}, { runId: "run_2" })!.lead, "Test");
  const rec = workCardOf("records.create", { type: "contact" }, { record: { id: "rec_1", type: "contact", fields: { name: "Dana Fox", email: "d@x.test" } } })!;
  assert.deepEqual([rec.lead, rec.title, rec.via, rec.target], ["Record", "Dana Fox", "contact", { type: "record", id: "rec_1" }]);
  assert.equal(workCardOf("records.update", {}, { record: { id: "rec_1", type: "contact", fields: { name: "Dana" } } })!.lead, "Record");
  assert.deepEqual(workCardOf("files.create", {}, { file: { fileId: "fil_1", name: "letter.docx" } })!.target, { type: "file", id: "fil_1" });
  assert.equal(workCardOf("agents.routine.save", { agentId: "agt_1" }, { routine: { routineId: "rtn_1", title: "Morning sweep" } })!.lead, "Routine");
  assert.equal(workCardOf("chat.handoff", {}, { thread: { threadId: "thr_2", title: "For Billing" } })!.lead, "Handoff");
  assert.equal(workCardOf("computers.provision", {}, { computer: { computerId: "cmt_1" } })!.lead, "Computer");
});

test("a call that made nothing, or a cap that is not work, makes no card", () => {
  assert.equal(workCardOf("records.query", {}, { rows: [] }), null);
  assert.equal(workCardOf("tasks.create", {}, {}), null);
  assert.equal(workCardOf("memory.remember", {}, { fact: { factId: "f" } }), null);
});

test("a send waiting on a yes is a card that says so", () => {
  assert.deepEqual(heldCard("mail.send", "tsk_9", { subject: "Your engagement letter", to: [{ address: "d@x.test" }] }), { key: "task:tsk_9", icon: "approval", lead: "Message", title: "Your engagement letter", target: { type: "task", id: "tsk_9" } });
  assert.equal(heldCard("mail.send", "tsk_9", { to: [{ address: "d@x.test" }] }).title, "To d@x.test", "no subject: the recipient");
  assert.equal(heldCard("mail.send", "tsk_9").title, "Message to send");
  assert.deepEqual([heldCard("records.delete", "tsk_8").lead, heldCard("records.delete", "tsk_8").title], ["Approval", "records delete"]);
});

test("a turn's cards come out in the order made, once each, and are gone once taken", () => {
  recordWork("trn_a", workCardOf("records.create", {}, { record: { id: "rec_1", type: "contact", fields: { name: "Dana" } } }));
  recordWork("trn_a", workCardOf("tasks.create", {}, { task: { id: "tsk_1", title: "Call" } }));
  recordWork("trn_a", workCardOf("records.update", {}, { record: { id: "rec_1", type: "contact", fields: { name: "Dana Fox" } } }));
  recordWork("trn_a", null);
  recordWork(undefined, workCardOf("tasks.create", {}, { task: { id: "tsk_2", title: "x" } }));
  const blocks = workBlocks("trn_a");
  assert.deepEqual(blocks.map((b) => (b.data as { lead: string; title: string }).lead + ":" + (b.data as { title: string }).title), ["Record:Dana Fox", "Task:Call"], "the record changed twice is one card, in its first place");
  assert.ok(blocks.every((b) => b.type === "link_card" && !("key" in (b.data as object))));
  assert.deepEqual(takeWork("trn_a"), []);
});
