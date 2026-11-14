// ARCH 6.2 (one turn per agent per thread): the thread lease is host ownership of the whole chat. When one of two running turns ends, the lease stays for the other; it goes with the last one.
import test from "node:test";
import assert from "node:assert/strict";
import { turnEnqueue, turnFinish, turnStart } from "../handlers/extra/turns.ts";
import { harness } from "../fixtures/harness.ts";
import { ensure } from "../projections.ts";

test("a turn that ends does not drop the thread lease while another turn of the thread still runs", async () => {
  const h = harness();
  ensure(h.ctx.db);
  const start = (agentId: string, messageId: string): string => {
    const { qseq } = turnEnqueue(h.ctx as never, {
      threadId: "thr_l",
      agentId,
      kind: "message",
      messageId,
      from: "usr_dana",
    });
    return turnStart(h.ctx as never, {
      threadId: "thr_l",
      agentId,
      qseq,
      placement: "host",
      engine: "claude_code",
      model: "m",
    }).turn.turnId;
  };
  h.db.run(
    "INSERT INTO engine_thread_lease (thread_id, holder, expires_at, turn_id) VALUES ('thr_l', 'host:a', ?, NULL)",
    Date.now() + 60_000,
  );
  const first = start("agt_a", "msg_1");
  const second = start("agt_b", "msg_1");
  const leases = (): number => h.db.all("SELECT 1 FROM engine_thread_lease WHERE thread_id = 'thr_l'").length;
  await turnFinish(h.ctx as never, { turnId: first, outcome: "completed" });
  assert.equal(leases(), 1, "the other turn still runs: the lease stays");
  await turnFinish(h.ctx as never, { turnId: second, outcome: "completed" });
  assert.equal(leases(), 0, "the last turn releases it");
});
