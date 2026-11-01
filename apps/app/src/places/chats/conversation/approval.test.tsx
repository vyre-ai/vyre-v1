// The approval card in a chat (rc.8): a parked turn is answered in the chat. It says what the agent wants to do with an excerpt, Allow approves the task, Deny asks for an optional reason and sends it
// back, and an answered card collapses to one line. Words and excerpt are in approval-model.ts.
import test from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "test-renderer";
import { find, flush, installDom, mount, press, textOf, typeInto } from "../../../../../../ui/src/testing/dom.ts";
import { ApprovalCard } from "./approval.tsx";
import { denyNote, diffLines, doneLine, excerptLines, heldOf, outcomeOf, verbPhrase, wantsLine, wantsPhrase } from "./approval-model.ts";

installDom();

const task = (state = "awaiting_approval") => ({
  task: { id: "tsk_1", kind: "approve", title: "Approve: Allow this step", state, blocks: [{ type: "doc_excerpt", v: 1, data: { act: "approve", cap: "files.write", input: { fileId: "fil_1", content: { text: "Q4 pricing\nBasic 49" }, reason: "Agent edit", idempotencyKey: "k" } } }], actions: [{ key: "approve", label: "Approve" }, { key: "reject", label: "Send back", note: "required" }] },
});

function data(calls: { cap: string; input: unknown }[], state?: string) {
  return {
    call: async (cap: string, input: unknown) => {
      calls.push({ cap, input });
      if (cap === "tasks.get") return task(state);
      if (cap === "files.get") return { file: { name: "Q4 pricing.docx" } };
      if (cap === "files.read") return { text: "Q4 pricing\nBasic 39 a month\nPro 99 a month" };
      return {};
    },
    nav: { openBeside: () => undefined },
  } as never;
}

test("the words: who wants what, the excerpt without ids and keys, the done line, the default deny note", () => {
  const held = heldOf(task().task.blocks);
  assert.equal(held.cap, "files.write");
  assert.equal(wantsLine("Intake", held.cap, "Q4 pricing.docx"), "Intake wants to edit Q4 pricing.docx");
  assert.equal(wantsLine("Intake", "mail.send"), "Intake wants to send an email");
  assert.equal(wantsLine("Intake", "crm.sync_all"), "Intake wants to sync all in crm");
  assert.deepEqual(excerptLines(held.input), [{ label: "New text", text: "Q4 pricing\nBasic 49" }]);
  assert.equal(doneLine("allowed", "files.write", "Q4 pricing.docx"), "Allowed · edit Q4 pricing.docx");
  assert.equal(doneLine("denied", "mail.send"), "Denied · send an email");
  assert.equal(denyNote("  "), "Not allowed.");
  assert.equal(denyNote(" too early "), "too early");
  assert.equal(outcomeOf("done"), "allowed");
  assert.equal(outcomeOf("canceled"), "denied");
  assert.equal(outcomeOf("awaiting_approval"), null);
});

test("Allow approves the task and the card collapses to one line", async () => {
  const calls: { cap: string; input: unknown }[] = [];
  const root = await mount(createRoot, <ApprovalCard taskId="tsk_1" agent="Intake" agentId="agt_1" data={data(calls)} />);
  assert.match(textOf(root), /Intake wants to edit Q4 pricing\.docx/);
  assert.match(textOf(find(root, "approval-diff-tsk_1")), /Basic 49/);
  await press(find(root, "approval-allow-tsk_1"));
  await flush();
  assert.deepEqual(calls.find((c) => c.cap === "tasks.act")?.input, { taskId: "tsk_1", action: "approve" });
  assert.match(textOf(find(root, "approval-done-tsk_1")), /Allowed · edit Q4 pricing\.docx/);
  assert.equal(find(root, "approval-allow-tsk_1"), null, "no buttons after the answer");
});

test("Deny asks for an optional reason and sends it back with the task", async () => {
  const calls: { cap: string; input: unknown }[] = [];
  const root = await mount(createRoot, <ApprovalCard taskId="tsk_1" agent="Intake" agentId="agt_1" data={data(calls)} />);
  await press(find(root, "approval-deny-tsk_1"));
  await typeInto(find(root, "approval-reason-tsk_1"), "Wait for Maya");
  await press(find(root, "approval-deny-go-tsk_1"));
  await flush();
  assert.deepEqual(calls.find((c) => c.cap === "tasks.act")?.input, { taskId: "tsk_1", action: "reject", note: "Wait for Maya" });
  assert.match(textOf(find(root, "approval-done-tsk_1")), /Denied/);
});

test("a hold already answered somewhere else shows the one-line row at once, and a failed answer says so and keeps the buttons", async () => {
  const calls: { cap: string; input: unknown }[] = [];
  const done = await mount(createRoot, <ApprovalCard taskId="tsk_1" agent="Intake" agentId="agt_1" data={data(calls, "done")} />);
  assert.match(textOf(find(done, "approval-done-tsk_1")), /Allowed/);
  const failing = { call: async (cap: string) => { if (cap === "tasks.act") throw new Error("down"); if (cap === "tasks.get") return task(); return { file: { name: "x" } }; }, nav: { openBeside: () => undefined } } as never;
  const root = await mount(createRoot, <ApprovalCard taskId="tsk_1" agent="Intake" agentId="agt_1" data={failing} />);
  await press(find(root, "approval-allow-tsk_1"));
  await flush();
  assert.match(textOf(root), /Failed/);
  assert.ok(find(root, "approval-allow-tsk_1"), "still answerable");
});

test("an edit of an existing file shows what is taken out and put in", async () => {
  assert.deepEqual(diffLines("a\nb\nc", "a\nB\nc\nd"), { lines: [{ kind: "del", text: "b" }, { kind: "add", text: "B" }, { kind: "add", text: "d" }], more: 0 });
  assert.deepEqual(diffLines("x", "x"), { lines: [], more: 0 });
  assert.equal(diffLines("", Array.from({ length: 12 }, (_, i) => `l${i}`).join("\n"), 8).more, 4);
  const root = await mount(createRoot, <ApprovalCard taskId="tsk_1" agent="Intake" agentId="agt_1" data={data([])} />);
  const diff = textOf(find(root, "approval-diff-tsk_1"));
  assert.match(diff, /Basic 39 a month/);
  assert.match(diff, /Basic 49/);
  assert.equal(find(root, "approval-excerpt-tsk_1"), null, "the diff replaces the new-text excerpt");
});

test("a change through an outside hub reads as the app and the action, with where it runs", () => {
  const input = { agentId: "agt_1", server: "composio", tool: "SLACK_SEND_MESSAGE", input: { channel: "general", text: "hello" } };
  assert.equal(wantsLine("Ops", "engine.mcp.call", undefined, input), "Ops wants to send a message in Slack");
  assert.deepEqual(excerptLines(input, 5, "engine.mcp.call"), [{ label: "Channel", text: "general" }, { label: "Text", text: "hello" }, { label: "Runs through", text: "Composio" }]);
  assert.equal(doneLine("allowed", "engine.mcp.call", undefined, input), "Allowed · send a message in Slack");
});

test("a name with no wording of its own never reaches the person as a raw capability or tool name", () => {
  assert.equal(verbPhrase("send message"), "send a message");
  assert.equal(verbPhrase("create contact"), "create a contact");
  assert.equal(verbPhrase("add reaction"), "add a reaction");
  assert.equal(verbPhrase("update pages"), "update pages");
  assert.equal(verbPhrase("add to list"), "add to list");
  assert.equal(verbPhrase("foo bar"), "foo bar");
  assert.equal(wantsPhrase("tasks.create"), "create a task");
  assert.equal(wantsPhrase("calendar.add_guest"), "add a guest in calendar");
  assert.doesNotMatch(wantsPhrase("engine.mcp.call"), /engine/);
  assert.doesNotMatch(wantsLine("Ops", "records.merge_duplicates"), /records\./);
});

/** The Space's live tick, as the session gives it to a card. */
function stream() {
  const ears = new Set<() => void>();
  return { changes: { subscribe: (l: () => void) => { ears.add(l); return () => { ears.delete(l); }; } }, tick: () => { for (const l of [...ears]) l(); }, listening: () => ears.size };
}

test("decided in Needs you, the open card follows on the next tick and takes its buttons away, with no timer", async () => {
  const s = stream();
  let state = "awaiting_approval";
  let reads = 0;
  const live = { ...(data([]) as object), call: async (cap: string) => { if (cap === "tasks.get") { reads += 1; return task(state); } return cap === "files.get" ? { file: { name: "Q4 pricing.docx" } } : { text: "x" }; }, changes: s.changes } as never;
  const root = await mount(createRoot, <ApprovalCard taskId="tsk_1" agent="Intake" agentId="agt_1" data={live} />);
  assert.ok(find(root, "approval-allow-tsk_1"));
  state = "done";
  s.tick();
  await flush();
  assert.match(textOf(find(root, "approval-done-tsk_1")), /Allowed/);
  assert.equal(find(root, "approval-allow-tsk_1"), null, "no Allow left to press");
  assert.equal(s.listening(), 0, "a decided card stops reading");
  const after = reads;
  s.tick();
  await flush();
  assert.equal(reads, after);
});

test("a held call sent back reads as denied, in Needs you's words or the chat's", async () => {
  const root = await mount(createRoot, <ApprovalCard taskId="tsk_1" agent="Intake" agentId="agt_1" data={data([], "doing")} />);
  assert.match(textOf(find(root, "approval-done-tsk_1")), /Denied/);
});

test("a press that comes too late hears it was decided, and the card shows the decision", async () => {
  let state = "awaiting_approval";
  const late = { call: async (cap: string) => { if (cap === "tasks.act") { state = "done"; throw Object.assign(new Error("Already decided."), { code: "validation.precondition_failed" }); } if (cap === "tasks.get") return task(state); return { file: { name: "x" } }; }, nav: { openBeside: () => undefined } } as never;
  const root = await mount(createRoot, <ApprovalCard taskId="tsk_1" agent="Intake" agentId="agt_1" data={late} />);
  await press(find(root, "approval-allow-tsk_1"));
  await flush();
  assert.match(textOf(find(root, "approval-done-tsk_1")), /Allowed/);
  assert.doesNotMatch(textOf(root), /Failed/);
});
