// engine.thread_states: the latest turn of many chats in one call; a failed one says why in words (never a code or trace id); a chat the asker may not open is absent, like a chat with no turn.
import test from "node:test";
import assert from "node:assert/strict";
import { extraHandlers } from "../handlers/extra/index.ts";
import { GENERIC_FAILURE, failedLineOf } from "../handlers/extra/thread-states.ts";
import { contractErrors, harness } from "../fixtures/harness.ts";
import type { EngineCtx } from "../projections.ts";

const H = extraHandlers;
const A = "agt_intake";
let n = 0;
function turn(
  h: ReturnType<typeof harness>,
  threadId: string,
  finish?: { state: "completed" | "failed"; error?: unknown },
): void {
  const { qseq } = H["engine.turn.enqueue"](h.ctx, {
    threadId,
    agentId: A,
    kind: "message",
    messageId: `msg_${++n}`,
    from: "usr_dana",
  });
  const { turn: t } = H["engine.turn.start"](h.ctx, {
    threadId,
    agentId: A,
    qseq,
    placement: "host",
    accountRef: "#Dana_Anthropic",
    engine: "anthropic",
    model: "claude-sonnet-5-5",
  });
  if (finish) {
    h.ctx.db.run(
      "UPDATE engine_turns SET state = ?, error = ?, ended_at = ? WHERE turn_id = ?",
      finish.state,
      finish.error === undefined ? null : JSON.stringify(finish.error),
      5,
      t.turnId,
    );
  }
}

test("the latest turn of each chat, in one call; failed says why in words with no code or trace id", async () => {
  const h = harness();
  turn(h, "thr_run");
  turn(h, "thr_done", { state: "completed" });
  turn(h, "thr_bad", {
    state: "failed",
    error: {
      code: "provider.down",
      message: "The AI provider did not answer.",
      traceId: "0123456789abcdef0123456789abcdef",
      next: [],
    },
  });
  const out = H["engine.thread_states"](h.ctx, { threadIds: ["thr_run", "thr_done", "thr_bad", "thr_none"] });
  assert.deepEqual(contractErrors("engine.thread_states", "out", out), []);
  const by = Object.fromEntries(out.states.map((s) => [s.threadId, s]));
  assert.equal(by["thr_run"]!.state, "running");
  assert.equal(by["thr_done"]!.state, "done");
  assert.deepEqual(by["thr_bad"], {
    threadId: "thr_bad",
    state: "failed",
    failedLine: "The AI provider did not answer.",
  });
  assert.equal(by["thr_none"], undefined, "a chat with no turn is absent");
  assert.ok(!JSON.stringify(out).includes("provider.down") && !JSON.stringify(out).includes("0123456789abcdef"));
});

test("only the latest turn counts: a failure that was retried and finished is done", () => {
  const h = harness();
  turn(h, "thr_a", { state: "failed", error: { message: "x" } });
  turn(h, "thr_a", { state: "completed" });
  assert.equal(H["engine.thread_states"](h.ctx, { threadIds: ["thr_a"] }).states[0]!.state, "done");
});

test("a chat the asker may not open is absent, the same answer as a chat with no turn: two askers, two answers", () => {
  const h = harness();
  turn(h, "thr_open", { state: "failed", error: { message: "bad" } });
  turn(h, "thr_secret", { state: "failed", error: { message: "private words" } });
  const member = H["engine.thread_states"](h.ctx, { threadIds: ["thr_open", "thr_secret"] });
  assert.deepEqual(member.states.map((s) => s.threadId).sort(), ["thr_open", "thr_secret"]);
  const guest = {
    ...h.ctx,
    authorize: (_a: unknown, r: { id: string | null }) => ({ effect: r.id === "thr_secret" ? "deny" : "allow" }),
  } as unknown as EngineCtx;
  const seen = H["engine.thread_states"](guest, { threadIds: ["thr_open", "thr_secret"] });
  assert.deepEqual(
    seen.states.map((s) => s.threadId),
    ["thr_open"],
  );
  assert.ok(!JSON.stringify(seen).includes("private words"));
});

test("bounded and plain: at most 200 ids by the contract; a failure with no words says so plainly", () => {
  assert.ok(
    contractErrors("engine.thread_states", "in", { threadIds: Array.from({ length: 201 }, (_, i) => `thr_${i}`) })
      .length > 0,
  );
  assert.deepEqual(contractErrors("engine.thread_states", "in", { threadIds: [] }), []);
  assert.equal(failedLineOf(null), GENERIC_FAILURE);
  assert.equal(failedLineOf("{not json"), GENERIC_FAILURE);
  assert.equal(failedLineOf(JSON.stringify({ code: "x" })), GENERIC_FAILURE);
  assert.equal(failedLineOf(JSON.stringify({ message: "a".repeat(500) })).length, 160);
});
