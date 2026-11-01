// rc.9 chat flows on a booted daemon, over HTTP with real tokens for two people. Each flow is one test, started the way a person starts it.
import test from "node:test";
import assert from "node:assert/strict";
import { bootFlowSpace, expectStatus } from "./02-space.ts";

const LIVE = ["agents", "access", "devices", "chat", "engine", "files", "vault", "tasks", "runs", "memory"];

test("flow 1, turn that into a task: a message becomes a task for the person it @names, the task points back, and a card in the thread links to it", async () => {
  const s = await bootFlowSpace(LIVE);
  try {
    const olivia = s.d.token;
    const noah = s.signedIn("usr_noah");
    const dm = expectStatus(await s.call("chat.start", olivia, { idempotencyKey: "f1-dm", kind: "chat", agentIds: [], personId: "usr_noah" }), 200, "chat.start").thread.threadId as string;
    const said = expectStatus(await s.call("chat.post", olivia, { idempotencyKey: "f1-say", threadId: dm, body: "@Noah please send the Rivera letter by Friday\nthanks", mentions: [{ kind: "person", id: "usr_noah" }] }), 200, "chat.post").message.messageId as string;

    const out = expectStatus(await s.call("chat.make_task", olivia, { idempotencyKey: "f1-task", threadId: dm, messageId: said, assigneeId: "usr_noah" }), 200, "chat.make_task");
    // the same key again is the same task, not a second one
    const again = expectStatus(await s.call("chat.make_task", olivia, { idempotencyKey: "f1-task", threadId: dm, messageId: said, assigneeId: "usr_noah" }), 200, "chat.make_task replay");
    assert.equal(again.taskId, out.taskId);

    const task = expectStatus(await s.call("tasks.get", noah, { taskId: out.taskId }), 200, "tasks.get as Noah").task;
    assert.equal(task.title, "please send the Rivera letter by Friday");
    assert.deepEqual(task.assigned, { kind: "person", id: "usr_noah" });
    assert.deepEqual(task.source, { kind: "chat", id: dm });

    // both people see one card in the thread, linking to the task
    for (const who of [olivia, noah]) {
      const msgs = expectStatus(await s.call("chat.messages.list", who, { threadId: dm }), 200, "chat.messages.list").messages as Array<{ kind: string; blocks: Array<{ type: string; data: any }> }>;   // eslint-disable-line @typescript-eslint/no-explicit-any
      const cards = msgs.flatMap((m) => m.blocks).filter((b) => b.type === "link_card");
      assert.equal(cards.length, 1, "one card, even after the replay");
      assert.deepEqual(cards[0]!.data.target, { type: "task", id: out.taskId });
      assert.equal(cards[0]!.data.who, "usr_noah");
    }

    // someone outside the chat cannot have it made for them
    const refused = await s.call("chat.make_task", olivia, { idempotencyKey: "f1-out", threadId: dm, messageId: said, assigneeId: "usr_mia" });
    assert.equal(refused.status, 422);
  } finally { await s.stop(); }
});
