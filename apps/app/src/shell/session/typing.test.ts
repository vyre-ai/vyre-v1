// Who is typing: a frame names a person for 5 seconds of silence; the person's own typing is told to the server at most every 2 seconds per chat; one's own name never shows.
import test from "node:test";
import assert from "node:assert/strict";
import { createTyping, TYPING_GONE_MS, TYPING_SEND_MS } from "./typing.ts";

test("a typing frame shows the person, goes after 5 s of silence, and the same person typing again keeps them", async () => {
  let t = 0;
  const ty = createTyping({ send: () => true, now: () => t, me: () => "usr_me" });
  let told = 0;
  ty.subscribe(() => told++);
  ty.onFrame({ t: "typing", threadId: "thr_1", person: "usr_mia" });
  assert.deepEqual(ty.who("thr_1"), ["usr_mia"]);
  assert.deepEqual(ty.who("thr_2"), []);
  assert.equal(told, 1);
  ty.onFrame({ t: "typing", threadId: "thr_1", person: "usr_me" });
  assert.deepEqual(ty.who("thr_1"), ["usr_mia"], "my own name never shows");
  t += TYPING_GONE_MS - 100;
  ty.onFrame({ t: "typing", threadId: "thr_1", person: "usr_mia" });
  t += 200;
  await new Promise((r) => setTimeout(r, 120));
  assert.deepEqual(ty.who("thr_1"), ["usr_mia"], "heard again: still typing");
  t += TYPING_GONE_MS;
  await new Promise((r) => setTimeout(r, TYPING_GONE_MS + 200));
  assert.deepEqual(ty.who("thr_1"), []);
  ty.dispose();
});

test("my own typing is sent at most once every 2 s per chat, and only as the chat's id", () => {
  let t = 10_000;
  const sent: unknown[] = [];
  const ty = createTyping({ send: (f) => (sent.push(f), true), now: () => t });
  ty.say("thr_1");
  ty.say("thr_1");
  ty.say("thr_2");
  assert.deepEqual(sent, [
    { t: "typing", threadId: "thr_1" },
    { t: "typing", threadId: "thr_2" },
  ]);
  t += TYPING_SEND_MS;
  ty.say("thr_1");
  assert.equal(sent.length, 3);
  ty.dispose();
});
