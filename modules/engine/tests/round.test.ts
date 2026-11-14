// engine.round.get: who is on each message, read from the queue (chat gap G56). Real queue rows in the harness's SQLite.
import test from "node:test";
import assert from "node:assert/strict";
import { harness } from "../fixtures/harness.ts";
import type { EngineCtx } from "../projections.ts";
import { roundGet } from "../handlers/round.ts";
import { ensure } from "../projections.ts";

const T = "thr_round";
const AGENTS: Record<string, { kind?: string; ownerId?: string }> = {
  agt_dex: {},
  agt_nova: {},
  agt_sol: {},
  agt_assist_dana: { kind: "assistant", ownerId: "usr_dana" },
};
/** The harness's ctx, reading agents.get from the table above and acting as `who`. */
const as = (h: ReturnType<typeof harness>, who: string): EngineCtx => ({
  ...h.ctx,
  principal: { kind: "person", id: who },
  async call(cap: string, input: unknown) {
    if (cap !== "agents.get") throw new Error(`unexpected ${cap}`);
    const a = AGENTS[String((input as { agentId: string }).agentId)];
    if (!a) throw new Error("no such agent");
    return { agent: a };
  },
});
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

// Rewritten 14 Nov 2026 (ARCH 6.2 changed: one turn per agent per thread). Two agents asked in one message run together, so both read working; a row waits only behind an earlier turn of its own agent,
// and then there is no one else to name ("Next after Dex" was true only while agents queued behind each other).
test("a message that asked two agents reads working for both; a later row of the same agent waits without naming another agent", async () => {
  const h = harness();
  ensure(h.ctx.db);
  put(h, 1, "msg_a", "agt_dex", "running");
  put(h, 2, "msg_a", "agt_nova", "running");
  put(h, 3, "msg_c", "agt_nova", "queued");
  const r = await roundGet(as(h, "usr_dana"), { threadId: T, messageIds: ["msg_a"] });
  assert.deepEqual(r.rounds, [
    {
      messageId: "msg_a",
      agents: [
        { agentId: "agt_dex", state: "working" },
        { agentId: "agt_nova", state: "working" },
      ],
    },
  ]);
  const later = await roundGet(as(h, "usr_dana"), { threadId: T, messageIds: ["msg_c"] });
  assert.deepEqual(later.rounds, [{ messageId: "msg_c", agents: [{ agentId: "agt_nova", state: "waiting" }] }]);
});

test("replied, stopped, and a row dropped unrun (no reason) is left out; a message nobody was asked by is absent", async () => {
  const h = harness();
  ensure(h.ctx.db);
  put(h, 1, "msg_b", "agt_dex", "done");
  put(h, 2, "msg_b", "agt_nova", "cancelled", "stop");
  put(h, 3, "msg_b", "agt_sol", "cancelled");
  const r = await roundGet(as(h, "usr_dana"), { threadId: T, messageIds: ["msg_b", "msg_none"] });
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
  assert.deepEqual((await roundGet(as(h, "usr_dana"), { threadId: T, messageIds: ["msg_c"] })).rounds, []);
});

test("a person's private Assistant is shown to its owner only: another member and a guest do not learn it is working", async () => {
  const h = harness();
  ensure(h.ctx.db);
  put(h, 1, "msg_d", "agt_assist_dana", "running");
  put(h, 2, "msg_d", "agt_dex", "running");
  const seen = async (who: string) =>
    (await roundGet(as(h, who), { threadId: T, messageIds: ["msg_d"] })).rounds[0]?.agents.map((a) => a.agentId);
  assert.deepEqual(await seen("usr_dana"), ["agt_assist_dana", "agt_dex"], "its owner sees it");
  assert.deepEqual(await seen("usr_maya"), ["agt_dex"], "a second member does not");
  assert.deepEqual(await seen("usr_guest"), ["agt_dex"], "a guest does not");
  // a round of the Assistant alone is not there for others at all
  put(h, 3, "msg_e", "agt_assist_dana", "running");
  assert.deepEqual((await roundGet(as(h, "usr_maya"), { threadId: T, messageIds: ["msg_e"] })).rounds, []);
  // an agent that cannot be read is left out, never named
  put(h, 4, "msg_f", "agt_unknown", "running");
  assert.deepEqual((await roundGet(as(h, "usr_dana"), { threadId: T, messageIds: ["msg_f"] })).rounds, []);
});
