// A chat tab follows its chat (lane l-chrome2a): "New chat" while blank, then the chat's one name (lib/chat-name.ts) as people join and it is named; never a message's first line; it stops when the tab goes.
import test from "node:test";
import assert from "node:assert/strict";
import { followTitle, screenAsk, titleAsk } from "./titles.ts";
import { screenTitle } from "./store.ts";
import type { TitleSession } from "./titles.ts";

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

test("a chat tab starts as New chat, takes the chat's one name as the chat fills, then follows a rename; a message never names it", async () => {
  let thread: Record<string, unknown> = { kind: "chat", agents: [], members: [{ kind: "person", id: "usr_me" }] };
  let messagesRead = 0;
  const listeners = new Set<() => void>();
  const session: TitleSession = {
    me: { id: "usr_me" },
    call: async (cap) => (cap === "threads.get" ? { thread } : cap === "agents.list" ? { agents: [{ agentId: "agt_dex", name: "Dex" }] } : cap === "access.principals.list" ? { principals: [] } : (messagesRead++, { messages: [{ body: "Can you draft the renewal letter?" }] })),
    hooks: { capQuery: () => ({ subscribe: (l) => { listeners.add(l); return () => { listeners.delete(l); }; } }) },
  };
  const shown: string[] = [];
  const subject = { type: "thread", id: "thr_1" };
  const stop = followTitle(session, titleAsk(subject)!, (t) => shown.push(t));
  await flush();
  assert.deepEqual(shown, ["New chat"], "blank chat");
  thread = { ...thread, agents: [{ agentId: "agt_dex" }] };
  listeners.forEach((l) => l());
  await flush();
  assert.equal(shown.at(-1), "Dex", "untitled: who is in it, the same as the list and the header");
  thread = { ...thread, title: "Rivera renewal" };
  listeners.forEach((l) => l());
  await flush();
  assert.equal(shown.at(-1), "Rivera renewal", "the chat's name wins");
  assert.equal(messagesRead, 0, "the messages are never read to name the tab");
  stop();
  assert.equal(listeners.size, 0, "stopped: no longer listening");
  thread = { ...thread, title: "Later" };
  await flush();
  assert.equal(shown.at(-1), "Rivera renewal");
});

test("a record tab is read once and is not live", async () => {
  let subscribed = 0;
  const session: TitleSession = { call: async () => ({ record: { fields: { name: "Elena Rivera" } } }), hooks: { capQuery: () => { subscribed++; return { subscribe: () => () => undefined }; } } };
  const subject = { type: "record", id: "r1" };
  const shown: string[] = [];
  followTitle(session, titleAsk(subject, { type: "contact" })!, (t) => shown.push(t));
  await flush();
  assert.deepEqual(shown, ["Elena Rivera"]);
  assert.equal(subscribed, 0);
});

test("an agent's page and its form follow the agent's name, and a rename shows on the tab", async () => {
  let name = "Scout";
  const listeners = new Set<() => void>();
  const asked: string[] = [];
  const session: TitleSession = {
    call: async (cap, input) => { asked.push(cap); void input; return { agent: { name } }; },
    hooks: { capQuery: (cap) => { asked.push(`live:${cap}`); return { subscribe: (l) => { listeners.add(l); return () => { listeners.delete(l); }; } }; } },
  };
  const page = screenAsk("chats.agent-page", { agentId: "agt_scout" })!;
  const shown: string[] = [];
  const stop = followTitle(session, page, (t) => shown.push(t));
  await flush();
  assert.deepEqual(shown, ["Scout"], "the page is named for the agent");
  name = "Scout Prime";
  listeners.forEach((l) => l());
  await flush();
  assert.equal(shown.at(-1), "Scout Prime", "the rename shows");
  stop();
  const form: string[] = [];
  followTitle(session, screenAsk("chats.agent-form", { agentId: "agt_scout" })!, (t) => form.push(t));
  await flush();
  assert.deepEqual(form, ["Edit Scout Prime"]);
  assert.deepEqual(screenAsk("chats.agent-form", {}), null, "a new agent's form has no agent to name it yet");
  assert.equal(titleAsk({ type: "agent", id: "agt_scout" })?.name({ agent: { name: "Scout" } }), "Scout");
  assert.equal(screenTitle("screen=chats.agent-page&agentId=agt_scout"), "Agent");
  assert.equal(screenTitle("screen=chats.agent-form&agentId=agt_scout"), "Edit agent");
  assert.equal(screenTitle("screen=chats.agent-form"), "New agent", "a new agent's form");
});

// ---- rc.22 bug 19: a tab has no title of its own ----

test("every chat tab follows its chat, the selected one or not: a chat named while another tab is selected renames its tab; a closed tab is let go", async () => {
  const { followAllTabs } = await import("./titles.ts");
  const titles: Record<string, string | null> = { thr_a: null, thr_b: null, thr_c: null };
  const listeners = new Set<() => void>();
  const session: TitleSession = {
    me: { id: "usr_me" },
    call: async (cap, input) => (cap === "threads.get" ? { thread: { kind: "chat", agents: [], members: [{ kind: "person", id: "usr_me" }], ...(titles[(input as { threadId: string }).threadId] ? { title: titles[(input as { threadId: string }).threadId] } : {}) } } : {}),
    hooks: { capQuery: () => ({ subscribe: (l) => { listeners.add(l); return () => { listeners.delete(l); }; } }) },
  };
  let tabs = [
    { key: "chats:subject=thread:thr_a", place: "chats", hash: "subject=thread:thr_a" },
    { key: "chats:subject=thread:thr_b", place: "chats", hash: "subject=thread:thr_b" },
    { key: "chats:subject=thread:thr_c", place: "chats", hash: "screen=chats.conversation&threadId=thr_c" },   // the other spelling of a chat
    { key: "chats", place: "chats" },
    { key: "new:1", place: "chats", isNew: true },
  ];
  const shown = new Map<string, string>();
  const tabListeners = new Set<() => void>();
  const stop = followAllTabs(session, { tabs: () => tabs, subscribe: (l) => { tabListeners.add(l); return () => { tabListeners.delete(l); }; } }, (k, t) => shown.set(k, t));
  await flush();
  assert.deepEqual([...shown.keys()].sort(), ["chats:subject=thread:thr_a", "chats:subject=thread:thr_b", "chats:subject=thread:thr_c"], "all three chats, not a place tab or a + tab");
  assert.ok([...shown.values()].every((t) => t === "New chat"), "untitled: New chat, only while it truly has no title");
  titles["thr_a"] = "Landing page"; titles["thr_b"] = "Onboarding goal"; titles["thr_c"] = "Retainer letters";
  listeners.forEach((l) => l());      // the chats are named while the person is on some other tab
  await flush();
  assert.deepEqual([...shown.values()], ["Landing page", "Onboarding goal", "Retainer letters"]);
  tabs = tabs.filter((t) => t.key !== "chats:subject=thread:thr_b");   // a tab closed
  tabListeners.forEach((l) => l());
  const before = listeners.size;
  assert.equal(before, 2, "the closed tab's chat is no longer listened to");
  stop();
  assert.equal(listeners.size, 0);
});

test("a chat is one tab whichever way it was opened: the subject hash, the conversation hash and an opaque id of the same chat share a key", async () => {
  const { tabKey } = await import("./store.ts");
  assert.equal(tabKey("chats", "screen=chats.conversation&threadId=thr_1&m=msg_9&side=thr_r"), tabKey("chats", "subject=thread:thr_1"));
  assert.notEqual(tabKey("chats", "screen=chats.conversation&threadId=thr_1"), tabKey("chats", "screen=chats.conversation&threadId=thr_2"));
});
