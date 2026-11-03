// The turn worker's system capabilities and the turn reads (engine.turn.*, engine.turns.list, lease, queue, health), on a real SQLite.
// Outputs are checked against the frozen contract and every event against its frozen schema.
import test from "node:test";
import assert from "node:assert/strict";
import { extraHandlers } from "../handlers/extra/index.ts";
import { assertEventsConform, codeOf, contractErrors, harness } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";
import type { EngineCtx } from "../projections.ts";

const T = "thr_intake";
const A = "agt_intake";
const H = extraHandlers;

/** The harness ctx with extra scripted capabilities (settings.get answers; the rest falls through to the harness). */
function withRoutes(h: Harness, routes: Record<string, (input: unknown) => unknown>): EngineCtx {
  return { ...h.ctx, call: async (cap: string, input: unknown) => (routes[cap] ? routes[cap](input) : h.ctx.call(cap, input)) };
}

async function startTurn(h: Harness, ctx: EngineCtx = h.ctx) {
  const { qseq } = H["engine.turn.enqueue"](ctx, { threadId: T, agentId: A, kind: "message", messageId: "msg_one", from: "usr_dana" });
  const { turn } = H["engine.turn.start"](ctx, { threadId: T, agentId: A, qseq, placement: "host", accountRef: "#Dana_Anthropic", engine: "anthropic", model: "claude-sonnet-5-5" });
  return { qseq, turn };
}

test("enqueue queues once per message, then start, append, wait and finish run a turn end to end", async () => {
  const h = harness();
  const ctx = withRoutes(h, { "settings.get": () => ({ row: { value: { percent: 100, labels: [] } } }) });
  const first = H["engine.turn.enqueue"](ctx, { threadId: T, agentId: A, kind: "message", messageId: "msg_one", from: "usr_dana" });
  assert.deepEqual(first, { qseq: 1 });
  assert.deepEqual(H["engine.turn.enqueue"](ctx, { threadId: T, agentId: A, kind: "message", messageId: "msg_one", from: "usr_dana" }), { qseq: 1 }, "a repeated call returns the same row");
  assert.equal(h.named("turn.queued").length, 1);
  assert.equal(H["engine.turn.enqueue"](ctx, { threadId: T, agentId: A, kind: "interrupt", from: "usr_dana" }).qseq, 2);
  assert.equal(h.rows("SELECT priority FROM engine_thread_queue WHERE qseq = 2")[0]?.["priority"], 10, "an interrupt goes first");

  const { turn } = H["engine.turn.start"](ctx, { threadId: T, agentId: A, qseq: 1, placement: "host", accountRef: "#Dana_Anthropic", engine: "anthropic", model: "claude-sonnet-5-5" });
  assert.equal(turn.state, "running");
  assert.deepEqual(contractErrors("engine.turn.start", "out", { turn }), []);
  assert.deepEqual(H["engine.turn.start"](ctx, { threadId: T, agentId: A, qseq: 1, placement: "host", engine: "anthropic", model: "x" }).turn.turnId, turn.turnId, "start is natural-idempotent");
  assert.equal(h.named("turn.started").length, 1);

  assert.deepEqual(H["engine.turn.append"](ctx, { turnId: turn.turnId, kind: "text", data: { text: "Looking." } }), { idx: 0 });
  h.advance(40);
  assert.deepEqual(H["engine.turn.append"](ctx, { turnId: turn.turnId, kind: "tool_call", data: { name: "records_get" } }), { idx: 1 });
  assert.equal(h.named("turn.block").length, 2);

  assert.deepEqual(H["engine.turn.wait"](ctx, { turnId: turn.turnId, taskId: "tsk_gate1" }), { ok: true });
  assert.equal(h.named("turn.waiting")[0]?.payload["taskId"], "tsk_gate1");
  assert.throws(() => H["engine.turn.wait"](ctx, { turnId: turn.turnId }), (e) => codeOf(e) === "validation.bad_input");

  h.advance(500);
  const done = await H["engine.turn.finish"](ctx, { turnId: turn.turnId, outcome: "completed", tokensIn: 120, tokensOut: 30, costMicros: 900 });
  assert.equal(done.turn.state, "completed");
  assert.deepEqual([done.turn.tokensIn, done.turn.tokensOut, done.turn.costMicros], [120, 30, 900]);
  assert.deepEqual(contractErrors("engine.turn.finish", "out", done), []);
  assert.equal(h.named("turn.completed").length, 1);
  assert.equal(h.named("agent.task_finished").length, 0, "a short turn is not a long task");
  assert.equal(h.rows("SELECT state FROM engine_thread_queue WHERE qseq = 1")[0]?.["state"], "done");
  assert.equal(h.rows("SELECT * FROM engine_review").length, 1, "sampling at 100 percent puts it in review");
  assert.equal((await H["engine.turn.finish"](ctx, { turnId: turn.turnId, outcome: "completed" })).turn.state, "completed", "finishing twice with the same outcome is the same answer");
  await assert.rejects(H["engine.turn.finish"](ctx, { turnId: turn.turnId, outcome: "failed" }), (e) => codeOf(e) === "validation.precondition_failed");
  assert.throws(() => H["engine.turn.append"](ctx, { turnId: turn.turnId, kind: "text", data: "late" }), (e) => codeOf(e) === "validation.precondition_failed");
  assert.deepEqual(assertEventsConform(h), []);
});

test("a long turn raises agent.task_finished and finish releases the lease it held", async () => {
  const h = harness();
  assert.equal(H["engine.lease.acquire"](h.ctx, { threadId: T, holder: "host:spc_enginetest", kind: "turn" }).acquired, true);
  const { turn } = await startTurn(h);
  assert.equal(h.rows("SELECT turn_id FROM engine_thread_lease")[0]?.["turn_id"], turn.turnId);
  h.advance(61_000);
  await H["engine.turn.finish"](h.ctx, { turnId: turn.turnId, outcome: "completed" });
  assert.equal(h.named("agent.task_finished")[0]?.payload["durationMs"], 61_000);
  assert.equal(h.rows("SELECT * FROM engine_thread_lease").length, 0);
  assert.deepEqual(assertEventsConform(h), []);
});

test("a sign-in failure fails the turn, opens an Unblock task and raises agent.blocked; a plain failure does neither", async () => {
  const h = harness();
  const { turn } = await startTurn(h);
  const error = { code: "provider.auth_failed", message: "Sign in again.", next: [{ kind: "reconnect", label: "Sign in again" }], traceId: "0123456789abcdef0123456789abcdef" };
  const out = await H["engine.turn.finish"](h.ctx, { turnId: turn.turnId, outcome: "failed", error });
  assert.equal(out.turn.state, "failed");
  assert.deepEqual(out.turn.error, error);
  assert.deepEqual(contractErrors("engine.turn.finish", "out", out), []);
  assert.equal(h.named("turn.failed")[0]?.payload["code"], "provider.auth_failed");
  assert.equal(h.named("agent.blocked")[0]?.payload["taskId"], "tsk_card1");
  assert.deepEqual(assertEventsConform(h), []);

  const h2 = harness();
  const { turn: t2 } = await startTurn(h2);
  await H["engine.turn.finish"](h2.ctx, { turnId: t2.turnId, outcome: "failed", error: { ...error, code: "provider.unavailable" } });
  assert.equal(h2.named("agent.blocked").length, 0);
});

test("cancel ends the turn and its queue row; fallback records the model or key the turn ended on", async () => {
  const h = harness();
  const { turn, qseq } = await startTurn(h);
  assert.deepEqual(H["engine.turn.fallback"](h.ctx, { turnId: turn.turnId, kind: "switch_model", to: "gpt-5" }), { ok: true });
  assert.deepEqual(H["engine.turn.fallback"](h.ctx, { turnId: turn.turnId, kind: "backup_key", to: "#Team_Key" }), { ok: true });
  assert.equal(h.named("turn.fallback_used").length, 2);
  const out = await H["engine.turn.finish"](h.ctx, { turnId: turn.turnId, outcome: "cancelled" });
  assert.equal(out.turn.state, "cancelled");
  assert.equal(out.turn.model, "gpt-5");
  assert.equal(out.turn.accountRef, "#Team_Key");
  assert.equal(h.rows("SELECT state FROM engine_thread_queue WHERE qseq = ?", qseq)[0]?.["state"], "cancelled");
  assert.equal(h.named("turn.cancelled")[0]?.payload["by"], "usr_dana");
  assert.deepEqual(assertEventsConform(h), []);
});

test("turn.get shows steps with durations, the machine, the key and the denials; turns.list pages newest first and filters by state", async () => {
  const h = harness();
  const { turn } = await startTurn(h);
  h.advance(100);
  H["engine.turn.append"](h.ctx, { turnId: turn.turnId, kind: "tool_call", data: { name: "mail_send" } });
  h.advance(250);
  H["engine.turn.append"](h.ctx, { turnId: turn.turnId, kind: "tool_result", data: { denied: true, cap: "mail.send", reason: "Held for approval" } });
  H["engine.turn.fallback"](h.ctx, { turnId: turn.turnId, kind: "switch_model", to: "gpt-5" });
  const got = H["engine.turn.get"](h.ctx, { turnId: turn.turnId });
  assert.deepEqual(contractErrors("engine.turn.get", "out", got), []);
  assert.deepEqual(got.what.steps.map((s) => [s.kind, s.title, s.durationMs, s.ok]), [["tool_call", "mail_send", 100, true], ["tool_result", "tool_result", 250, false]]);
  assert.deepEqual(got.what.denials, [{ cap: "mail.send", reason: "Held for approval" }]);
  assert.equal(got.what.machine, "host");
  assert.equal(got.what.keyUsed, "#Dana_Anthropic");
  assert.equal(got.what.fallbacks[0]?.to, "gpt-5");
  assert.throws(() => H["engine.turn.get"](h.ctx, { turnId: "trn_nope" }), (e) => codeOf(e) === "validation.not_found");

  await H["engine.turn.finish"](h.ctx, { turnId: turn.turnId, outcome: "completed" });
  h.advance(10);
  H["engine.turn.enqueue"](h.ctx, { threadId: T, agentId: A, kind: "message", messageId: "msg_two", from: "usr_dana" });
  H["engine.turn.start"](h.ctx, { threadId: T, agentId: A, qseq: 2, placement: "device", engine: "claude_code", model: "claude-sonnet-5-5" });
  const all = H["engine.turns.list"](h.ctx, { threadId: T });
  assert.deepEqual(contractErrors("engine.turns.list", "out", all), []);
  assert.deepEqual(all.turns.map((t) => t.state), ["running", "completed"], "newest first");
  assert.deepEqual(H["engine.turns.list"](h.ctx, { threadId: T, state: ["completed"] }).turns.length, 1);
  const p1 = H["engine.turns.list"](h.ctx, { threadId: T, limit: 1 });
  assert.equal(p1.next, "1");
  assert.equal(H["engine.turns.list"](h.ctx, { threadId: T, limit: 1, cursor: p1.next ?? "" }).turns[0]?.state, "completed");
});

test("retry queues a failed turn again on another model, once; a policy-blocked model or a paused Space refuses", async () => {
  const h = harness();
  const { turn } = await startTurn(h);
  await assert.rejects(H["engine.turn.retry"](h.ctx, { turnId: turn.turnId }), (e) => codeOf(e) === "validation.precondition_failed");
  await H["engine.turn.finish"](h.ctx, { turnId: turn.turnId, outcome: "failed", error: { code: "provider.unavailable", message: "Down", next: [], traceId: "0123456789abcdef0123456789abcdef" } });

  const retried = await H["engine.turn.retry"](h.ctx, { turnId: turn.turnId, model: "gpt-5", accountRef: "#Team_OpenAI" });
  assert.equal(retried.turn.state, "queued");
  assert.equal(retried.turn.model, "gpt-5");
  assert.deepEqual(contractErrors("engine.turn.retry", "out", retried), []);
  assert.equal((await H["engine.turn.retry"](h.ctx, { turnId: turn.turnId })).turn.turnId, retried.turn.turnId, "a second click is the same retry");
  assert.equal(h.named("turn.queued").length, 2);

  const started = H["engine.turn.start"](h.ctx, { threadId: T, agentId: A, qseq: 2, placement: "host", accountRef: "#Team_OpenAI", engine: "openai", model: "gpt-5" });
  assert.equal(started.turn.turnId, retried.turn.turnId, "starting the queued row promotes the retry's own turn");
  assert.equal(started.turn.state, "running");

  await H["engine.turn.finish"](h.ctx, { turnId: started.turn.turnId, outcome: "failed", error: { code: "provider.unavailable", message: "Down", next: [], traceId: "0123456789abcdef0123456789abcdef" } });
  await H["engine.policy.set"](h.ctx, { allowedModels: ["claude-sonnet-5-5"] });
  await assert.rejects(H["engine.turn.retry"](h.ctx, { turnId: turn.turnId, model: "gpt-5" }), (e) => codeOf(e) === "permission.provider_label");
  h.ctx.db.run("INSERT OR REPLACE INTO engine_spend_state (id, paused, paused_by, reason, at) VALUES ('space', 1, 'usr_dana', NULL, 0)");
  await assert.rejects(H["engine.turn.retry"](h.ctx, { turnId: started.turn.turnId }), (e) => codeOf(e) === "permission.limit");
  assert.deepEqual(assertEventsConform(h), []);
});

test("the lease is compare-and-set: a live holder keeps it, a heartbeat extends it, a release frees it", () => {
  const h = harness();
  const a = H["engine.lease.acquire"](h.ctx, { threadId: T, holder: "host:a", kind: "turn" });
  assert.equal(a.acquired, true);
  assert.deepEqual(contractErrors("engine.lease.acquire", "out", a), []);
  const b = H["engine.lease.acquire"](h.ctx, { threadId: T, holder: "device:b", kind: "turn" });
  assert.deepEqual(b, { acquired: false, expiresAt: a.expiresAt }, "the other holder is told when to try again");
  h.advance(5_000);
  assert.equal(H["engine.lease.heartbeat"](h.ctx, { threadId: T, holder: "host:a" }).expiresAt, a.expiresAt + 5_000);
  assert.throws(() => H["engine.lease.heartbeat"](h.ctx, { threadId: T, holder: "device:b" }), (e) => codeOf(e) === "validation.precondition_failed");
  assert.deepEqual(H["engine.lease.release"](h.ctx, { threadId: T, holder: "device:b" }), { ok: true });
  assert.equal(H["engine.lease.acquire"](h.ctx, { threadId: T, holder: "device:b", kind: "wait" }).acquired, false, "a non-holder cannot release it");
  H["engine.lease.release"](h.ctx, { threadId: T, holder: "host:a" });
  assert.equal(H["engine.lease.acquire"](h.ctx, { threadId: T, holder: "device:b", kind: "wait" }).acquired, true);
  h.advance(25_000);
  assert.equal(H["engine.lease.acquire"](h.ctx, { threadId: T, holder: "host:a", kind: "turn" }).acquired, true, "an expired lease is taken");
});

test("queue.list shows waiting and running rows by priority; queue.peek returns steering messages oldest first", () => {
  const h = harness();
  H["engine.turn.enqueue"](h.ctx, { threadId: T, agentId: A, kind: "message", messageId: "msg_a", from: "usr_dana" });
  H["engine.turn.enqueue"](h.ctx, { threadId: T, agentId: A, kind: "interrupt", messageId: "msg_b", from: "usr_dana" });
  H["engine.turn.enqueue"](h.ctx, { threadId: T, agentId: A, kind: "wake", from: "usr_dana" });
  const list = H["engine.queue.list"](h.ctx, { threadId: T });
  assert.deepEqual(contractErrors("engine.queue.list", "out", list), []);
  assert.deepEqual(list.items.map((i) => [i.qseq, i.kind, i.priority]), [[2, "interrupt", 10], [1, "message", 0], [3, "wake", 0]]);
  assert.deepEqual(H["engine.queue.peek"](h.ctx, { threadId: T }), { messages: [] }, "nothing was sent as steering");
  h.ctx.db.run("UPDATE engine_thread_queue SET steer = 1 WHERE qseq IN (1)");
  assert.deepEqual(H["engine.queue.peek"](h.ctx, { threadId: T }), { messages: ["msg_a"] });
});

test("health is healthy with an empty queue, degraded when a turn waits a minute or a running turn lost its worker, down after five", () => {
  const h = harness();
  assert.deepEqual(H["engine.health"](h.ctx, {}), { state: "healthy", oldestQueuedMs: 0 });
  H["engine.turn.enqueue"](h.ctx, { threadId: T, agentId: A, kind: "message", messageId: "msg_a", from: "usr_dana" });
  h.advance(30_000);
  assert.equal(H["engine.health"](h.ctx, {}).state, "healthy");
  h.advance(31_000);
  const slow = H["engine.health"](h.ctx, {});
  assert.equal(slow.state, "degraded");
  assert.equal(slow.oldestQueuedMs, 61_000);
  assert.deepEqual(contractErrors("engine.health", "out", slow), []);
  h.advance(300_000);
  assert.equal(H["engine.health"](h.ctx, {}).state, "down");

  const h2 = harness();
  H["engine.turn.enqueue"](h2.ctx, { threadId: T, agentId: A, kind: "message", from: "usr_dana" });
  h2.ctx.db.run("UPDATE engine_thread_queue SET state = 'running'");
  assert.match(H["engine.health"](h2.ctx, {}).detail ?? "", /no worker/);
});

