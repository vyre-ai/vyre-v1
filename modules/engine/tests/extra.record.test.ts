// engine.turn.record: the turns the in-process engine runs for a chat are recorded under the engine's own turn id (the turn list, review sampling and the agent's Working status read them).
// Started, then completed, failed or cancelled; every call is safe to repeat; a finish with no recorded start records the start first, so Working goes up and down exactly once.
import test from "node:test";
import assert from "node:assert/strict";
import { extraHandlers } from "../handlers/extra/index.ts";
import { assertEventsConform, contractErrors, harness } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";
import type { EngineCtx } from "../projections.ts";

const T = "thr_intake", A = "agt_intake", TURN = "trn_live1";
const H = extraHandlers;
const withReview = (h: Harness, percent: number): EngineCtx => ({ ...h.ctx, call: async (cap: string, input: unknown) => (cap === "settings.get" ? { row: { value: { percent, labels: [] } } } : h.ctx.call(cap, input)) });

test("a started turn is one running row and one turn.started; a repeat changes nothing", async () => {
  const h = harness();
  const ctx = withReview(h, 100);
  const a = await H["engine.turn.record"](ctx, { threadId: T, turnId: TURN, agentId: A, phase: "started", qseq: 1, asker: "usr_dana", model: "claude-sonnet-5-5" });
  assert.deepEqual([a.turn.turnId, a.turn.state, a.turn.asker, a.turn.model], [TURN, "running", "usr_dana", "claude-sonnet-5-5"]);
  assert.deepEqual(contractErrors("engine.turn.record", "out", a), []);
  await H["engine.turn.record"](ctx, { threadId: T, turnId: TURN, agentId: A, phase: "started", qseq: 1 });
  assert.equal(h.named("turn.started").length, 1);
  assert.equal(h.rows("SELECT * FROM engine_turns").length, 1);
  assert.deepEqual(H["engine.turns.list"](ctx, { threadId: T }).turns.map((t) => [t.turnId, t.state]), [[TURN, "running"]], "it is in the turn list under the engine's id");
  assertEventsConform(h);
});

test("a completed turn holds its tokens, is sampled for review, ends once and leaves the engine's queue and lease alone", async () => {
  const h = harness();
  const ctx = withReview(h, 100);
  await H["engine.turn.record"](ctx, { threadId: T, turnId: TURN, agentId: A, phase: "started", qseq: 1, asker: "usr_dana" });
  h.db.run("INSERT INTO engine_thread_lease (thread_id, holder, expires_at, turn_id) VALUES (?, ?, ?, ?)", T, "host:spc", 9_999_999_999_999, TURN);
  h.advance(40);
  const done = await H["engine.turn.record"](ctx, { threadId: T, turnId: TURN, agentId: A, phase: "completed", qseq: 1, tokensIn: 120, tokensOut: 30 });
  assert.deepEqual([done.turn.state, done.turn.tokensIn, done.turn.tokensOut], ["completed", 120, 30]);
  assert.equal(h.named("turn.completed").length, 1);
  assert.deepEqual(h.named("turn.completed")[0]?.payload["tokensIn"], 120);
  assert.equal(h.rows("SELECT * FROM engine_review").length, 1, "sampling at 100 percent puts it in review");
  assert.equal((await H["engine.turn.record"](ctx, { threadId: T, turnId: TURN, agentId: A, phase: "completed", qseq: 1 })).turn.state, "completed");
  assert.equal((await H["engine.turn.record"](ctx, { threadId: T, turnId: TURN, agentId: A, phase: "failed", qseq: 1, code: "x" })).turn.state, "completed", "an ended turn is never ended twice");
  assert.equal(h.named("turn.completed").length + h.named("turn.failed").length, 1);
  assert.equal(h.rows("SELECT turn_id FROM engine_thread_lease WHERE thread_id = ?", T).length, 1, "the engine's own lease is not touched");
  assertEventsConform(h);
});

test("a failed turn and a cancelled turn end with their own event, and the error is only a code", async () => {
  const h = harness();
  const ctx = withReview(h, 0);
  await H["engine.turn.record"](ctx, { threadId: T, turnId: "trn_f", agentId: A, phase: "started", qseq: 1 });
  const failed = await H["engine.turn.record"](ctx, { threadId: T, turnId: "trn_f", agentId: A, phase: "failed", qseq: 1, code: "provider.auth_failed" });
  assert.equal(failed.turn.state, "failed");
  assert.equal(failed.turn.error?.code, "provider.auth_failed");
  assert.equal(failed.turn.error?.message, "The turn failed.", "what the engine knows of the failure is never stored");
  await H["engine.turn.record"](ctx, { threadId: T, turnId: "trn_c", agentId: A, phase: "started", qseq: 2 });
  assert.equal((await H["engine.turn.record"](ctx, { threadId: T, turnId: "trn_c", agentId: A, phase: "cancelled", qseq: 2 })).turn.state, "cancelled");
  assert.deepEqual([h.named("turn.started").length, h.named("turn.failed").length, h.named("turn.cancelled").length], [2, 1, 1]);
  assert.equal(h.rows("SELECT * FROM engine_review").length, 0, "only completed turns are sampled");
  assertEventsConform(h);
});

test("a finish that comes without a recorded start records the start first, so the start and the end are each heard once", async () => {
  const h = harness();
  const out = await H["engine.turn.record"](withReview(h, 0), { threadId: T, turnId: "trn_late", agentId: A, phase: "failed", qseq: 3, code: "no_account" });
  assert.equal(out.turn.state, "failed");
  assert.deepEqual([h.named("turn.started").length, h.named("turn.failed").length], [1, 1]);
  assert.ok(h.emitted.findIndex((e) => e.name === "turn.started") < h.emitted.findIndex((e) => e.name === "turn.failed"));
});
