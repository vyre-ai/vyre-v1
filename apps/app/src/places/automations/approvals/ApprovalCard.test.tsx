// The approval card (rc.32 lane r32-auto, item 6): Allow is one answer on the task; Deny asks why first and sends nothing until it is written; a refusal is one sentence under the card.
import test from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "test-renderer";
import { find, flush, installDom, mount, press, textOf, typeInto } from "../../../../../../ui/src/testing/dom.ts";
import { AutomationsDataProvider } from "../canvas/data.tsx";
import { createSampleAutomations, northwind } from "../sidebar/sample.ts";
import { ApprovalCard } from "./ApprovalCard.tsx";

installDom();
const card = {
  taskId: "tsk_1",
  title: "Send the invoices",
  allow: "It goes on: Post in #billing.",
  deny: "It finishes with your no.",
};
const open = async (answered: string[]) => {
  const s = createSampleAutomations(northwind);
  const root = await mount(
    createRoot,
    <AutomationsDataProvider value={s.data}>
      <ApprovalCard card={card} automation="Invoice reminders" onAnswered={() => answered.push("done")} />
    </AutomationsDataProvider>,
  );
  await flush();
  const acts = () => s.calls.filter((c) => c.cap === "tasks.act");
  return { root, acts };
};

test("the card says what is asked and what each answer does, in Allow and Deny", async () => {
  const { root } = await open([]);
  const text = textOf(find(root as never, "ap-card-tsk_1"));
  assert.match(text, /Invoice reminders/);
  assert.match(text, /Send the invoices/);
  assert.match(text, /Allow: It goes on: Post in #billing\./);
  assert.match(text, /Deny: It finishes with your no\./);
  assert.ok(find(root as never, "ap-allow-tsk_1") && find(root as never, "ap-deny-tsk_1"));
});

test("Allow answers the task once and tells the page", async () => {
  const done: string[] = [];
  const { root, acts } = await open(done);
  await press(find(root as never, "ap-allow-tsk_1"));
  await flush();
  assert.deepEqual(
    acts().map((c) => c.input),
    [{ taskId: "tsk_1", action: "approve" }],
  );
  assert.deepEqual(done, ["done"]);
});

test("Deny asks why first: nothing is sent without a reason, then the reason goes with the no", async () => {
  const done: string[] = [];
  const { root, acts } = await open(done);
  await press(find(root as never, "ap-deny-tsk_1"));
  await flush();
  assert.ok(find(root as never, "ap-reason-tsk_1"), "the reason is asked for");
  await press(find(root as never, "ap-deny-go-tsk_1"));
  await flush();
  assert.equal(acts().length, 0, "no reason, no call");
  assert.match(textOf(find(root as never, "ap-note-tsk_1")), /Say why/);
  await typeInto(find(root as never, "ap-reason-tsk_1"), "Not this month");
  await press(find(root as never, "ap-deny-go-tsk_1"));
  await flush();
  assert.deepEqual(
    acts().map((c) => c.input),
    [{ taskId: "tsk_1", action: "reject", note: "Not this month" }],
  );
  assert.deepEqual(done, ["done"]);
});
