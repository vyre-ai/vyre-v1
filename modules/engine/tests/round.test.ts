// engine.round.get: who is on each message, read from the queue (chat gap G56). Real queue rows in the harness's SQLite.
import test from "node:test";
import assert from "node:assert/strict";
import { harness } from "../fixtures/harness.ts";
import { roundGet } from "../handlers/round.ts";
import { ensure } from "../projections.ts";

const T = "thr_round";
function put(
  h: ReturnType<typeof harness>,
  qseq: number,
  message: string,
  agent: string,
  state: string,
  stop?: string,
) {
  h.ctx.db.run(
    "INSERT INTO engine_thread_queue (thread_id, qseq, kind, message_id, agent_id, from_principal, priority, state, enqueued_at, routine, steer, stop_reason) VALUES (?, ?, 'message', ?, ?, 'usr_dana', 0, ?, 1, 0, 0, ?)",
    T,
    qseq,
    message,
    agent,
    state,
    stop ?? null,
  );
}

test("a message that asked two agents reads working for the first and waiting on it for the second", async () => {
  const h = harness();
  ensure(h.ctx.db);
  put(h, 1, "msg_a", "agt_dex", "running");
  put(h, 2, "msg_a", "agt_nova", "queued");
  const r = await roundGet(h.ctx, { threadId: T, messageIds: ["msg_a"] });
  assert.deepEqual(r.rounds, [
    {
      messageId: "msg_a",
      agents: [
        { agentId: "agt_dex", state: "working" },
        { agentId: "agt_nova", state: "waiting", on: "agt_dex" },
      ],
    },
  ]);
});

test("replied, stopped, and a row dropped unrun (no reason) is left out; a message nobody was asked by is absent", async () => {
  const h = harness();
  ensure(h.ctx.db);
  put(h, 1, "msg_b", "agt_dex", "done");
  put(h, 2, "msg_b", "agt_nova", "cancelled", "stop");
  put(h, 3, "msg_b", "agt_sol", "cancelled");
  const r = await roundGet(h.ctx, { threadId: T, messageIds: ["msg_b", "msg_none"] });
  assert.deepEqual(r.rounds, [
    {
      messageId: "msg_b",
      agents: [
        { agentId: "agt_dex", state: "replied" },
        { agentId: "agt_nova", state: "stopped" },
      ],
    },
  ]);
});

test("another chat's rows are never read", async () => {
  const h = harness();
  ensure(h.ctx.db);
  h.ctx.db.run(
    "INSERT INTO engine_thread_queue (thread_id, qseq, kind, message_id, agent_id, from_principal, priority, state, enqueued_at, routine, steer) VALUES ('thr_other', 1, 'message', 'msg_c', 'agt_dex', 'usr_x', 0, 'running', 1, 0, 0)",
  );
  assert.deepEqual((await roundGet(h.ctx, { threadId: T, messageIds: ["msg_c"] })).rounds, []);
});
