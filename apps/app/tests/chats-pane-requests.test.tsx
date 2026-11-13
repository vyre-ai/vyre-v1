// A (review, 13 Nov 2026), mounted: in a one-to-one chat whose pane is CLOSED, a request for a tab (Skills from an install card, Hooks from a hook line) opens the pane on that tab, not on the other person.
// The pane picks the person for a one-to-one chat by itself; a request settles the chat first (ChatsMounted: onTab, openSkills, openHooks), so the pane's own choice stands aside. The unit test of `paneAction`
// cannot see a call site that forgets to settle; this one presses the real doors of the mounted place. (The Knows pin is not wired through ChatsMounted: no memory store reaches the pane there.)
import test from "node:test";
import assert from "node:assert/strict";
import { act } from "react";
import { createRoot } from "test-renderer";
import { installDom, find, flush } from "../../../ui/src/testing/dom.ts";
import { createMountSample } from "../src/places/chats/mounts/sample.ts";
import { ChatsMounted } from "../src/places/chats/mounts/ChatsMounted.tsx";
import { START, step } from "../src/places/chats/mounts/route.ts";
import type { ConversationNav } from "../src/places/chats/conversation/data.tsx";
import type { ShellRuntime } from "../src/shell/providers/runtime.tsx";

const WINDOW = { start: 0, end: 500 };

async function mountDm(): Promise<{ root: Parameters<typeof find>[0]; nav: () => ConversationNav; maya: string }> {
  const s = createMountSample();
  const maya = "usr_maya";
  // the chat is a one-to-one: the viewer and Maya, no agent beside them
  const dm = { threadId: "c1", kind: "chat", title: "Maya Chen", listed: true, planMode: false, members: [{ kind: "person", id: s.rt.me.id }, { kind: "person", id: maya }], agents: [{ agentId: "agt_intake", mode: "lead" }], createdAt: 1 };   // the sample's agent plays the Space assistant sitting in the chat, which does not make it a group
  const ready = { status: "ready", data: { thread: dm } };   // one object: a snapshot that is new on every read would loop the store
  const screens: ShellRuntime["screens"] = { query: (id, name, state) => (id === "chats.conversation" && name === "thread" ? ({ subscribe: () => () => undefined, getSnapshot: () => ready } as never) : s.rt.screens.query(id, name, state)) };
  const rt = { ...s.rt, screens, assistant: { ...s.rt.assistant, id: "agt_intake", name: "Intake" } } as ShellRuntime;
  let nav: ConversationNav | null = null;
  const r = createRoot();
  await act(async () => { r.render(<ChatsMounted rt={rt} initial={step(START, { t: "chat", threadId: "c1" })} window={WINDOW} onNav={(n) => { nav = n; }} />); });
  await flush(); await flush();
  return { root: r.container as unknown as Parameters<typeof find>[0], nav: () => nav!, maya };
}

test("a one-to-one chat with its pane closed: the pane does not open by itself", async () => {
  const restore = installDom();
  try {
    const { root } = await mountDm();
    assert.equal(find(root, "chats-right-pane"), null, "the pane is closed");
  } finally { restore(); }
});

test("Skills asked for on a card opens the closed pane on Skills, not on the other person", async () => {
  const restore = installDom();
  try {
    const { root, nav, maya } = await mountDm();
    await act(async () => { nav().openSkills!("Write a brief"); });
    await flush(); await flush();
    assert.ok(find(root, "chats-right-pane"), "the request opened the pane");
    assert.ok(find(root, "pane-body-skills"), "and it shows Skills");
    assert.equal(find(root, `profile-${maya}`), null, "the other person's profile is not what shows");
    assert.equal(find(root, "right-tab-body"), null, "no profile tab is in front of the pane's own body");
  } finally { restore(); }
});

test("a hook line's Details opens the closed pane on Hooks, not on the other person", async () => {
  const restore = installDom();
  try {
    const { root, nav, maya } = await mountDm();
    await act(async () => { nav().openHooks!("c1", "hook_1"); });
    await flush(); await flush();
    assert.ok(find(root, "pane-body-hooks"), "the pane shows Hooks");
    assert.equal(find(root, `profile-${maya}`), null);
    assert.equal(find(root, "right-tab-body"), null);
  } finally { restore(); }
});

test("with no request, opening the pane in a one-to-one chat shows the other person: the request is what changes the outcome", async () => {
  const restore = installDom();
  try {
    const { root, nav, maya } = await mountDm();
    await act(async () => { nav().togglePane(); });
    await flush(); await flush();
    assert.ok(find(root, `profile-${maya}`), "the pane opened on the other person");
  } finally { restore(); }
});
