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
