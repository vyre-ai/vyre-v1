// A chat tab follows its chat (lane l-chrome2a): "New chat" while empty, the first message once it arrives, the chat's name once it is renamed; it stops when the tab goes.
import test from "node:test";
import assert from "node:assert/strict";
import { followTitle, screenAsk, titleAsk } from "./titles.ts";
import { screenTitle } from "./store.ts";
import type { TitleSession } from "./titles.ts";

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

test("a chat tab starts as New chat, takes the first message, then follows a rename", async () => {
  let title: string | null = null;
  let messages: { body: string }[] = [];
  const listeners = new Set<() => void>();
  const session: TitleSession = {
    call: async (cap) => (cap === "threads.get" ? { thread: title === null ? {} : { title } } : { messages }),
    hooks: { capQuery: () => ({ subscribe: (l) => { listeners.add(l); return () => { listeners.delete(l); }; } }) },
  };
  const shown: string[] = [];
  const subject = { type: "thread", id: "thr_1" };
  const stop = followTitle(session, titleAsk(subject)!, (t) => shown.push(t));
  await flush();
  assert.deepEqual(shown, ["New chat"], "empty chat");
  messages = [{ body: "Can you draft the renewal letter for the Rivera account before Friday?" }];
  listeners.forEach((l) => l());
  await flush();
  assert.equal(shown.at(-1), "Can you draft the renewal lette…", "first message, cut short");
  title = "Rivera renewal";
  listeners.forEach((l) => l());
  await flush();
  assert.equal(shown.at(-1), "Rivera renewal", "the chat's name wins");
  stop();
  assert.equal(listeners.size, 0, "stopped: no longer listening");
  title = "Later";
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
