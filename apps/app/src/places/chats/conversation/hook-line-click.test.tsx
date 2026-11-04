// The way forward on a hook line (lane l-hooks): "A hook stopped this" offers Details, Run once anyway and Ask an admin. Each is pressed and calls one capability; the server's refusal (a Space hook is an admin's
// to let go by) is said in its own words; an added hook offers Edit.
import test from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "test-renderer";
import { find, flush, installDom, mount, press, textOf } from "../../../../../../ui/src/testing/dom.ts";
import { HookLineActs } from "./hookline.tsx";

const blocked = { line: "A hook stopped this: the address isn't in Contacts", kind: "blocked", hookId: "hok_1", scope: "chat" };
function setup(fail?: string) {
  const calls: Array<{ cap: string; input: unknown }> = [];
  const opened: string[] = [];
  const call = async (cap: string, input: unknown) => { calls.push({ cap, input }); if (fail) throw new Error(fail); return {}; };
  return { calls, opened, el: (line = blocked) => <HookLineActs id="m1" line={line} threadId="thr_1" call={call} open={(h) => opened.push(h)} linkStyle={{}} quietStyle={{}} /> };
}

test("a block offers Details, Run once anyway and Ask an admin; Details opens the hook", async () => {
  const off = installDom();
  try {
    const s = setup();
    const root = await mount(createRoot, s.el());
    for (const a of ["details", "once", "ask"]) assert.ok(find(root, `hook-act-${a}-m1`), a);
    await press(find(root, "hook-act-details-m1"));
    assert.deepEqual(s.opened, ["hok_1"]);
  } finally { off(); }
});

test("Run once anyway calls hooks.allow_once and says what happens next; Ask an admin calls hooks.ask_admin", async () => {
  const off = installDom();
  try {
    const a = setup();
    const r1 = await mount(createRoot, a.el());
    await press(find(r1, "hook-act-once-m1"));
    await flush();
    assert.deepEqual(a.calls, [{ cap: "hooks.allow_once", input: { id: "hok_1", threadId: "thr_1" } }]);
    assert.match(textOf(find(r1, "hook-said-m1")), /Let through once\. Ask again/);
    const b = setup();
    const r2 = await mount(createRoot, b.el());
    await press(find(r2, "hook-act-ask-m1"));
    await flush();
    assert.deepEqual(b.calls, [{ cap: "hooks.ask_admin", input: { id: "hok_1", threadId: "thr_1" } }]);
    assert.match(textOf(find(r2, "hook-said-m1")), /Asked an admin/);
  } finally { off(); }
});

test("a refusal is said in the server's own words", async () => {
  const off = installDom();
  try {
    const s = setup("Only an admin can let a Space hook go by. You can ask one.");
    const root = await mount(createRoot, s.el({ ...blocked, scope: "space" }));
    await press(find(root, "hook-act-once-m1"));
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
    for (const a of ["details", "once", "ask"]) assert.ok(find(root, `hook-act-${a}-m1`), a);
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
