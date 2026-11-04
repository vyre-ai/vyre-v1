// A chat tab follows its chat (lane l-chrome2a): "New chat" while empty, the first message once it arrives, the chat's name once it is renamed; it stops when the tab goes.
import test from "node:test";
import assert from "node:assert/strict";
import { followTitle, titleAsk } from "./titles.ts";
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
  const stop = followTitle(session, { subject }, titleAsk(subject)!, (t) => shown.push(t));
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
  followTitle(session, { subject }, titleAsk(subject, { type: "contact" })!, (t) => shown.push(t));
  await flush();
  assert.deepEqual(shown, ["Elena Rivera"]);
  assert.equal(subscribed, 0);
});
