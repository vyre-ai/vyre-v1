// The one held card (held-card.tsx) for a message to a person, an email, a text, a post: who and how in plain words, only a real schedule, the body drawn by the chat's renderer in full or cut at twelve lines,
// Edit in place with Save and Cancel (saving keeps it held and says Edited by you, and gives the agent the lesson), Send and Don't send with a reason, and no internal field name on screen.
import test from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "test-renderer";
import { TextInput } from "react-native";
import { find, flush, installDom, mount, press, textOf, typeInto } from "../../../../../../ui/src/testing/dom.ts";
import { ApprovalCard } from "./approval.tsx";
import { BODY_LINES, linesOf } from "./held-card.tsx";

installDom();

type Call = { cap: string; input: any };   // eslint-disable-line @typescript-eslint/no-explicit-any
const block = (cap: string, input: Record<string, unknown>, outward: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({ type: "approval_preview", v: 1, data: { act: "send", cap, input, holdId: "hld_1", outward, ...extra } });
const DM = block("chat.message_person", { to: "usr_aliza", body: "Hi **Aliza**,\n\n- the deed is ready\n- call me", timing: "online" }, { channel: "message", to: [{ kind: "person", id: "usr_aliza" }], body: "Hi **Aliza**,\n\n- the deed is ready\n- call me", bodyField: "body", schedule: { kind: "online" } });

function world(blocks: unknown[], o: { state?: string; onGet?: () => unknown } = {}) {
  const calls: Call[] = [];
  let current = blocks;
  const d = {
    call: async (cap: string, input: unknown) => {
      calls.push({ cap, input });
      if (cap === "tasks.get") return { task: { id: "tsk_1", kind: "approve", title: "Approve: Send a message", state: o.state ?? "awaiting_approval", blocks: current, updatedAt: Date.UTC(2026, 10, 4, 4, 38) } };
      if (cap === "access.principals.get") return { principal: { name: "Aliza Rizvi" } };
      if (cap === "gate.holds.revise") { const b = (input as { body: string }).body; current = [block("chat.message_person", { to: "usr_aliza", body: b }, { channel: "message", to: [{ kind: "person", id: "usr_aliza" }], body: b, bodyField: "body", edited: { by: "usr_me", at: 1 } })]; return { ok: true }; }
      return {};
    },
    nav: { openBeside: () => undefined },
  } as never;
  return { d, calls };
}
const card = (d: never) => <ApprovalCard taskId="tsk_1" agent="Dex" agentId="agt_dex" data={d} />;
// a browser's TipTap cannot be typed into under test: the card's editor seam gets a plain field that stands for the shared editor's text
const typed = (d: never) => <ApprovalCard taskId="tsk_1" agent="Dex" agentId="agt_dex" data={d} editor={({ value, onChange, label }) => <TextInput testID="stub-editor" accessibilityLabel={label} value={value} onChangeText={onChange} multiline />} />;

test("a message to a person: the recipient and the channel in plain words, the schedule only when it is not now, the body rendered, no internal field names", async () => {
  const w = world([DM]);
  const root = await mount(createRoot, card(w.d));
  const t = textOf(root);
  assert.match(t, /Dex wants to message Aliza Rizvi/);
  assert.match(t, /Sends when they are next online/);
  assert.ok(t.includes("Hi") && t.includes("Aliza") && t.includes("the deed is ready"), "the body");
  assert.ok(!t.includes("**"), "Markdown is drawn, not shown raw");
  for (const raw of ["Timing", "timing", "Body", "bodyField", "usr_aliza", "hld_1", "channel", "chat.message_person"]) assert.ok(!t.includes(raw), `${raw} is not on the card`);
  assert.ok(find(root, "approval-tsk_1-send") && find(root, "approval-tsk_1-edit") && find(root, "approval-tsk_1-drop"));
  assert.equal(find(root, "approval-tsk_1-schedule") !== null, true);
  const now = world([block("chat.message_person", { to: "usr_aliza", body: "x", timing: "now" }, { channel: "message", to: [{ kind: "person", id: "usr_aliza" }], body: "x", bodyField: "body" })]);
  assert.equal(find(await mount(createRoot, card(now.d)), "approval-tsk_1-schedule"), null, "now: no timing line");
});

test("email, text and a post each read in their own words", async () => {
  const mail = world([block("mail.send", { to: [{ address: "aliza@example.com" }], subject: "The deed", text: "Hi" }, { channel: "email", to: [{ kind: "address", address: "aliza@example.com" }], subject: "The deed", body: "Hi", bodyField: "text" })]);
  const m = textOf(await mount(createRoot, card(mail.d)));
  assert.match(m, /Dex wants to email aliza@example\.com/);
  assert.match(m, /Subject/); assert.match(m, /The deed/);
  const sms = world([block("telephony.send_sms", { to: "+14155550123", body: "On my way" }, { channel: "text", to: [{ kind: "phone", address: "+14155550123" }], body: "On my way", bodyField: "body" })]);
  assert.match(textOf(await mount(createRoot, card(sms.d))), /Dex wants to text \+14155550123/);
  const post = world([block("chat.post", { threadId: "thr_1", body: "Update" }, { channel: "post", to: [{ kind: "thread", id: "thr_1" }], body: "Update", bodyField: "body" })]);
  assert.match(textOf(await mount(createRoot, card(post.d))), /Dex wants to post in this chat/);
  // a hold parked before the Gate wrote the words is read from its call the same way
  const old = world([{ type: "approval_preview", v: 1, data: { act: "send", cap: "chat.message_person", input: { to: "usr_aliza", body: "Hello there", timing: "online" } } }]);
  const o = textOf(await mount(createRoot, card(old.d)));
  assert.match(o, /Dex wants to message Aliza Rizvi/); assert.ok(!o.includes("Timing"));
});

test("a long body is cut after twelve lines with Show all, and shown in full when asked", async () => {
  const long = Array.from({ length: 30 }, (_, i) => `Line ${i + 1} of the message`).join("\n\n");
  assert.ok(linesOf(long) > BODY_LINES);
  assert.equal(linesOf("one\ntwo"), 2);
  const w = world([block("chat.message_person", { to: "usr_aliza", body: long }, { channel: "message", to: [{ kind: "person", id: "usr_aliza" }], body: long, bodyField: "body" })]);
  const root = await mount(createRoot, card(w.d));
  assert.match(textOf(find(root, "approval-tsk_1-all")), /Show all/);
  await press(find(root, "approval-tsk_1-all"));
  assert.match(textOf(find(root, "approval-tsk_1-all")), /Show less/);
  assert.ok(textOf(root).includes("Line 30 of the message"), "all of it is there");
  assert.equal(find(await mount(createRoot, card(world([DM]).d)), "approval-tsk_1-all"), null, "a short one has no Show all");
});

test("Edit opens the editor in place; Save keeps it held, says Edited by you and gives the agent the lesson; Cancel puts it back", async () => {
  const w = world([DM]);
  const root = await mount(createRoot, card(w.d));
  await press(find(root, "approval-tsk_1-edit"));
  assert.ok(find(root, "approval-tsk_1-editor"), "the editor is in the card");
  assert.ok(find(root, "approval-tsk_1-save") && find(root, "approval-tsk_1-cancel"));
  assert.equal(find(root, "approval-tsk_1-send"), null, "Send waits for Save or Cancel");
  await press(find(root, "approval-tsk_1-cancel"));
  assert.equal(find(root, "approval-tsk_1-editor"), null);
  assert.ok(find(root, "approval-tsk_1-send"));
});

test("Save sends the edited words to the Gate, keeps it held, says Edited by you, and keeps the way the person changed it as a lesson for the agent", async () => {
  const w = world([DM]);
  const root = await mount(createRoot, typed(w.d));
  assert.equal(find(root, "approval-tsk_1-edited"), null, "not edited yet");
  await press(find(root, "approval-tsk_1-edit"));
  const field = find(root, "stub-editor");
  assert.ok(field, "the editor is in the card");
  await typeInto(field!, "Hi Aliza, the deed is ready. Call me.");
  await press(find(root, "approval-tsk_1-save"));
  await flush();
  assert.deepEqual(w.calls.find((c) => c.cap === "gate.holds.revise")!.input, { holdId: "hld_1", taskId: "tsk_1", body: "Hi Aliza, the deed is ready. Call me." });
  assert.deepEqual(w.calls.find((c) => c.cap === "memory.corrections.record")!.input, { agentId: "agt_dex", how: "edit", was: "Hi **Aliza**,\n\n- the deed is ready\n- call me", now: "Hi Aliza, the deed is ready. Call me." });
  assert.equal(find(root, "approval-tsk_1-editor"), null, "back to the card");
  assert.match(textOf(find(root, "approval-tsk_1-edited")), /Edited by you/);
  assert.ok(textOf(root).includes("Call me."), "the card shows the edited words");
  assert.ok(find(root, "approval-tsk_1-send"), "still held");
  assert.equal(w.calls.some((c) => c.cap === "tasks.act"), false, "nothing was sent by saving");
});

test("a Save the Gate refuses says so and keeps the editor open", async () => {
  const w = world([DM]);
  const orig = (w.d as { call: (c: string, i: unknown) => Promise<unknown> }).call;
  (w.d as { call: unknown }).call = async (cap: string, input: unknown) => { if (cap === "gate.holds.revise") throw new Error("That is decided already."); return orig(cap, input); };
  const root = await mount(createRoot, typed(w.d));
  await press(find(root, "approval-tsk_1-edit"));
  await typeInto(find(root, "stub-editor")!, "new words");
  await press(find(root, "approval-tsk_1-save"));
  await flush();
  assert.match(textOf(find(root, "approval-tsk_1-error")), /decided already/);
  assert.ok(find(root, "approval-tsk_1-editor"), "the editor stays");
});

test("Send approves the held message and the card reads Sent to Aliza with the time; the buttons are gone", async () => {
  const w = world([DM]);
  const root = await mount(createRoot, card(w.d));
  await press(find(root, "approval-tsk_1-send"));
  await flush();
  assert.deepEqual(w.calls.find((c) => c.cap === "tasks.act")!.input, { taskId: "tsk_1", action: "approve" });
  assert.match(textOf(find(root, "approval-done-tsk_1")).trim(), /^Sent to Aliza Rizvi · \d\d:\d\d$/);
  assert.equal(find(root, "approval-tsk_1-send"), null);
});

test("Don't send asks for a reason that goes back to the agent, and the card reads Not sent", async () => {
  const w = world([DM]);
  const root = await mount(createRoot, card(w.d));
  await press(find(root, "approval-tsk_1-drop"));
  await typeInto(find(root, "approval-tsk_1-reason"), "Wait until Monday");
  await press(find(root, "approval-tsk_1-drop-go"));
  await flush();
  assert.deepEqual(w.calls.find((c) => c.cap === "tasks.act")!.input, { taskId: "tsk_1", action: "reject", note: "Wait until Monday" });
  assert.match(textOf(find(root, "approval-done-tsk_1")).trim(), /^Not sent$/);
  const none = world([DM]);
  const r2 = await mount(createRoot, card(none.d));
  await press(find(r2, "approval-tsk_1-drop")); await press(find(r2, "approval-tsk_1-drop-go")); await flush();
  assert.deepEqual(none.calls.find((c) => c.cap === "tasks.act")!.input, { taskId: "tsk_1", action: "reject", note: "Not allowed." }, "no reason: the plain default");
});

test("a hold already answered shows the one line at once; a failed answer says so and keeps the buttons", async () => {
  assert.match(textOf(find(await mount(createRoot, card(world([DM], { state: "done" }).d)), "approval-done-tsk_1")), /Sent to Aliza Rizvi/);
  assert.match(textOf(find(await mount(createRoot, card(world([DM], { state: "canceled" }).d)), "approval-done-tsk_1")), /Not sent/);
  const failing = { call: async (cap: string) => { if (cap === "tasks.act") throw new Error("down"); if (cap === "tasks.get") return { task: { id: "tsk_1", kind: "approve", title: "t", state: "awaiting_approval", blocks: [DM] } }; return { principal: { name: "Aliza Rizvi" } }; }, nav: { openBeside: () => undefined } } as never;
  const root = await mount(createRoot, card(failing));
  await press(find(root, "approval-tsk_1-send"));
  await flush();
  assert.match(textOf(find(root, "approval-tsk_1-error")), /down/);
  assert.ok(find(root, "approval-tsk_1-send"), "still answerable");
});
