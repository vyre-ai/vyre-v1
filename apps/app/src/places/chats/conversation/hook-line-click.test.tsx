// The way forward on a hook line (lane l-hooks): "A hook stopped this" offers the one approval vocabulary: Details, Allow (this time only), Always allow (the hook is paused for its scope) and Deny (the stop stands) to a person who may change the hook, and Details and Ask an admin to one who may not. Each is pressed and calls one
// capability; the server's refusal is said in its own words; an added hook offers Edit.
import test from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "test-renderer";
import { find, flush, installDom, mount, press, textOf } from "../../../../../../ui/src/testing/dom.ts";
import { HookLineActs, HookSteps } from "./hookline.tsx";

const blocked = { line: "A hook stopped this: the address isn't in Contacts", kind: "blocked", hookId: "hok_1", scope: "chat" };
function setup(fail?: string, canChange = true) {
  const calls: Array<{ cap: string; input: unknown }> = [];
  const opened: string[] = [];
  // hooks.list tells whether this person may change the hook; it is not one of the presses, so it is not in `calls`
  const call = async (cap: string, input: unknown) => { if (cap === "hooks.list") return { hooks: [{ id: "hok_1", canChange }] }; calls.push({ cap, input }); if (fail) throw new Error(fail); return {}; };
  return { calls, opened, el: (line = blocked) => <HookLineActs id="m1" line={line} threadId="thr_1" call={call} open={(h) => opened.push(h)} linkStyle={{}} quietStyle={{}} /> };
}

test("a person who may change the hook is offered Details, Allow, Always allow and Deny; one who may not is offered Details and Ask an admin; Details opens the hook", async () => {
  const off = installDom();
  try {
    const s = setup();
    const root = await mount(createRoot, s.el());
    await flush();
    for (const a of ["details", "allow", "always", "deny"]) assert.ok(find(root, `hook-act-${a}-m1`), a);
    assert.equal(find(root, "hook-act-ask-m1"), null);
    assert.match(textOf(find(root, "hook-act-allow-m1")), /^Allow$/);
    assert.match(textOf(find(root, "hook-act-always-m1")), /^Always allow$/);
    await press(find(root, "hook-act-details-m1"));
    assert.deepEqual(s.opened, ["hok_1"]);
    const n = setup(undefined, false);
    const other = await mount(createRoot, n.el());
    await flush();
    for (const a of ["details", "ask"]) assert.ok(find(other, `hook-act-${a}-m1`), a);
    for (const a of ["allow", "always", "deny"]) assert.equal(find(other, `hook-act-${a}-m1`), null, a);
  } finally { off(); }
});

test("until it is known whether the person may decide, only Details shows", async () => {
  const off = installDom();
  try {
    const root = await mount(createRoot, <HookLineActs id="m1" line={blocked} threadId="thr_1" call={() => new Promise(() => undefined)} open={() => undefined} linkStyle={{}} quietStyle={{}} />);
    assert.ok(find(root, "hook-act-details-m1"));
    for (const a of ["allow", "always", "deny", "ask"]) assert.equal(find(root, `hook-act-${a}-m1`), null, a);
  } finally { off(); }
});

test("Allow calls hooks.allow_once, Always allow pauses the hook for its scope through hooks.pause, Deny closes the line and calls nothing, Ask an admin calls hooks.ask_admin", async () => {
  const off = installDom();
  try {
    const a = setup();
    const r1 = await mount(createRoot, a.el());
    await flush();
    await press(find(r1, "hook-act-allow-m1"));
    await flush();
    assert.deepEqual(a.calls, [{ cap: "hooks.allow_once", input: { id: "hok_1", threadId: "thr_1" } }]);
    assert.match(textOf(find(r1, "hook-said-m1")), /Allowed this time\. Ask again/);
    const b = setup();
    const r2 = await mount(createRoot, b.el());
    await flush();
    await press(find(r2, "hook-act-always-m1"));
    await flush();
    assert.deepEqual(b.calls, [{ cap: "hooks.pause", input: { id: "hok_1", paused: true, threadId: "thr_1" } }]);
    assert.match(textOf(find(r2, "hook-said-m1")), /Always allowed\./);
    const sp = setup();
    const r3 = await mount(createRoot, sp.el({ ...blocked, scope: "space" }));
    await flush();
    await press(find(r3, "hook-act-always-m1"));
    await flush();
    assert.match(textOf(find(r3, "hook-said-m1")), /Always allowed for the Space/);
    const c = setup();
    const r4 = await mount(createRoot, c.el());
    await flush();
    await press(find(r4, "hook-act-deny-m1"));
    await flush();
    assert.deepEqual(c.calls, [], "the stop stands; nothing is called");
    assert.match(textOf(find(r4, "hook-said-m1")), /Denied\. The stop stands/);
    const d = setup(undefined, false);
    const r5 = await mount(createRoot, d.el());
    await flush();
    await press(find(r5, "hook-act-ask-m1"));
    await flush();
    assert.deepEqual(d.calls, [{ cap: "hooks.ask_admin", input: { id: "hok_1", threadId: "thr_1" } }]);
    assert.match(textOf(find(r5, "hook-said-m1")), /Asked an admin/);
  } finally { off(); }
});

test("a refusal is said in the server's own words", async () => {
  const off = installDom();
  try {
    const s = setup("Only an admin can let a Space hook go by. You can ask one.");
    const root = await mount(createRoot, s.el({ ...blocked, scope: "space" }));
    await flush();
    await press(find(root, "hook-act-allow-m1"));
    await flush();
    assert.match(textOf(find(root, "hook-said-m1")), /Only an admin can let a Space hook go by/);
  } finally { off(); }
});

test("an added hook offers Edit, which opens it; a line with nothing to offer draws nothing", async () => {
  const off = installDom();
  try {
    const s = setup();
    const root = await mount(createRoot, s.el({ line: "Intake added a hook in this chat: x", kind: "added", hookId: "hok_2" }));
    await press(find(root, "hook-act-edit-m1"));
    assert.deepEqual(s.opened, ["hok_2"]);
    const none = await mount(createRoot, s.el({ line: "x", kind: "removed", hookId: "hok_2" }));
    assert.equal(find(none, "hook-act-edit-m1"), null);
  } finally { off(); }
});

test("the steps a check wrote are buttons: each sends its sentence to the assistant as the person's own message; the generic ones stay", async () => {
  const off = installDom();
  try {
    const s = setup();
    const line = { ...blocked, agentId: "agt_intake", next: [{ label: "Add them to Contacts", ask: "Please add Harbor Supply to Contacts" }, { label: "Send without adding", ask: "Send it once without adding them" }] };
    const root = await mount(createRoot, s.el(line));
    await flush();
    for (const a of ["details", "allow", "always", "deny"]) assert.ok(find(root, `hook-act-${a}-m1`), a);
    assert.match(textOf(find(root, "hook-next-0-m1")), /Add them to Contacts/);
    assert.match(textOf(find(root, "hook-next-1-m1")), /Send without adding/);
    await press(find(root, "hook-next-0-m1"));
    await flush();
    assert.equal(s.calls.length, 1);
    assert.deepEqual([s.calls[0]!.cap, (s.calls[0]!.input as Record<string, unknown>)["body"], (s.calls[0]!.input as Record<string, unknown>)["threadId"], (s.calls[0]!.input as { mentions: unknown[] }).mentions], ["chat.post", "Please add Harbor Supply to Contacts", "thr_1", [{ kind: "agent", id: "agt_intake" }]]);
    assert.match(textOf(find(root, "hook-said-m1")), /Sent\./);
    const none = await mount(createRoot, s.el({ ...blocked, next: line.next }));
    assert.equal(find(none, "hook-next-0-m1"), null, "no agent to send to, no step buttons");
  } finally { off(); }
});

test("with the steps below, the line keeps only the quiet verbs and the reply carries the step buttons; pressing one says it to the assistant", async () => {
  const off = installDom();
  try {
    const calls: Array<{ cap: string; input: unknown }> = [];
    const call = async (cap: string, input: unknown) => { if (cap === "hooks.list") return { hooks: [{ id: "hok_1", canChange: true }] }; calls.push({ cap, input }); return {}; };
    const line = { ...blocked, agentId: "agt_intake", next: [{ label: "Add them to Contacts", ask: "Please add them" }] };
    const root = await mount(createRoot, <HookLineActs id="m1" line={line} threadId="thr_1" call={call} open={() => undefined} linkStyle={{}} quietStyle={{}} stepsBelow />);
    await flush();
    assert.equal(find(root, "hook-next-0-m1"), null, "the line does not carry the steps");
    assert.ok(find(root, "hook-act-allow-m1") && find(root, "hook-act-always-m1") && find(root, "hook-act-deny-m1") && find(root, "hook-act-details-m1"));
    const reply = await mount(createRoot, <HookSteps id="m_reply" steps={line.next} agentId="agt_intake" threadId="thr_1" call={call} />);
    assert.match(textOf(find(reply, "hook-step-0-m_reply")), /Add them to Contacts/);
    await press(find(reply, "hook-step-0-m_reply"));
    await flush();
    assert.deepEqual([calls[0]!.cap, (calls[0]!.input as { body: string }).body], ["chat.post", "Please add them"]);
    assert.match(textOf(find(reply, "hook-steps-said-m_reply")), /Sent\./);
  } finally { off(); }
});
