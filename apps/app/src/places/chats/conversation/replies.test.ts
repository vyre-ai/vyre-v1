// The line under a message that has a thread (audit Threads 3): read from the threads hanging off the chat, by the message each hangs off; how many, when the last came, bold while new.
import test from "node:test";
import assert from "node:assert/strict";
import { replySummaries, replyWords } from "./replies.ts";

const c = { now: Date.UTC(2026, 10, 3, 15, 0), offsetMin: 0 };

test("one line per message with a thread anyone wrote in; helpers and empty threads draw none", () => {
  const m = replySummaries([
    { threadId: "thr_a", kind: "thread", parentMessageId: "msg_1", replyCount: 3, lastMessageAt: Date.UTC(2026, 10, 3, 14, 5), repliers: [{ kind: "person", id: "usr_leo" }, { kind: "agent", id: "agt_intake" }], unread: 2 },
    { threadId: "thr_b", kind: "thread", parentMessageId: "msg_2", replyCount: 0 },
    { threadId: "thr_c", kind: "helper", parentMessageId: "msg_3", replyCount: 4 },
    { threadId: "thr_d", kind: "thread", parentMessageId: "msg_4", replyCount: 1, unread: 1, muted: true },
  ]);
  assert.deepEqual([...m.keys()], ["msg_1", "msg_4"]);
  assert.deepEqual(m.get("msg_1")!.people, [{ id: "usr_leo", kind: "person" }, { id: "agt_intake", kind: "agent" }]);
  assert.deepEqual(replyWords(m.get("msg_1")!, c), { count: "3 replies", when: "Last reply 14:05", bold: true, label: "3 replies, 2 new, Last reply 14:05" });
  assert.deepEqual(replyWords(m.get("msg_4")!, c), { count: "1 reply", when: null, bold: false, label: "1 reply" }, "a muted thread is never bold");
});
