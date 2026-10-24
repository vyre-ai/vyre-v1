// The engine's rows survive the host (ARCH 6.1, 6.2): messages, the thread queue, the thread lease and parked tool calls live in SQL, so a second host that
// takes a thread over with recover() has the message bodies, and a Gate answer reaches a turn that another host parked.
import test from "node:test";
import assert from "node:assert/strict";
import { sqlLeases, sqlMessages, sqlQueue, sqlWaits } from "../projections.ts";
import { harness, openRaw } from "../fixtures/harness.ts";
import { scopedDb } from "../../../host/src/ctx/db.ts";
import { scriptedProvider } from "../../../agent/src/turn-engine/scripted-session.ts";
import { toolRunnerFrom } from "../../../agent/src/turn-engine/tools.ts";
import { createMemoryLeases, createMemoryQueue, LEASE_TTL_MS } from "../../../agent/src/turn-engine/index.ts";
import { gate, until } from "../../../agent/src/turn-engine/harness.ts";
import type { DriverEvent, EngineAgent } from "../../../agent/src/turn-engine/types.ts";

const THREAD = "thr_estate";
const DANA = { kind: "person" as const, id: "usr_dana" };
const NO_BEAT = (): (() => void) => () => {};
const agents = (): EngineAgent[] => [{ id: "agt_intake", mode: "lead" }, { id: "agt_docs", mode: "listen" }];
const done: DriverEvent[] = [{ type: "text", text: "Done." }, { type: "usage", inputTokens: 10, outputTokens: 2 }, { type: "done" }];
const LETTER = "Please draft the closing letter for the Lee estate.";
const CHECK = "Docs, check the template.";

test("a second host that takes the thread over has the message bodies and finishes what the first host left", async () => {
  const a = harness();
  const stuck = gate();
  const pa = scriptedProvider({ script: done, beforeEvent: async () => { await stuck.wait; } });
  const ea = a.runtime({ openSession: pa.openSession, holder: "host:a", schedule: NO_BEAT });
  ea.openThread({ id: THREAD, kind: "chat", starter: "usr_dana", agents: agents() });
  ea.receive({ threadId: THREAD, author: DANA, body: LETTER });
  ea.receive({ threadId: THREAD, author: DANA, mentions: [{ kind: "agent", id: "agt_docs" }], body: CHECK });
  await until(() => ea.turns(THREAD).some((t) => t.state === "running"));

  // Host B shares the database. Host A still holds a live lease, so B must not take the thread.
  const b = harness({ raw: a.raw, clock: a.clock });
  const pb = scriptedProvider({ script: done });
  const eb = b.runtime({ openSession: pb.openSession, holder: "host:b", schedule: NO_BEAT });
  eb.openThread({ id: THREAD, kind: "chat", starter: "usr_dana", agents: agents() });
  assert.deepEqual(eb.messages(THREAD).map((m) => m.body), [LETTER, CHECK], "the bodies are there on the second host");
  assert.deepEqual(eb.messages(THREAD).map((m) => m.threadSeq), [1, 2]);
  assert.equal(eb.recover(THREAD), false, "a live lease is not taken over");

  // Host A dies: no heartbeat. After the lease expires B takes the thread and runs the turn A never finished, then the docs turn.
  // Docs answers without an @mention, so its reply goes to the lead: a third turn (one hop).
  a.advance(LEASE_TTL_MS + 1000);
  assert.equal(eb.recover(THREAD), true);
  await eb.idle(THREAD);
  assert.deepEqual(eb.turns(THREAD).map((t) => `${t.agentId}:${t.state}`), ["agt_intake:completed", "agt_docs:completed", "agt_intake:completed"]);
  assert.equal(pb.sessions[0]?.inputs[0]?.trigger?.body, LETTER, "the trigger was read from the shared store");
  assert.deepEqual(pb.sessions[0]?.inputs[0]?.history.map((m) => m.body), [LETTER, CHECK]);
  assert.equal(pb.sessions[1]?.inputs[0]?.trigger?.body, CHECK);
  assert.deepEqual(eb.queue(THREAD).map((q) => q.state), ["done", "done", "done"]);

  // Host A comes back late. Its lease is gone, so it ends its turn as lost and posts nothing.
  const before = b.rows("SELECT thread_seq FROM engine_messages WHERE thread_id = ? ORDER BY thread_seq", THREAD).map((r) => Number(r["thread_seq"]));
  stuck.open();
  await ea.idle(THREAD);
  assert.equal(ea.turns(THREAD)[0]?.state, "failed");
  assert.equal(ea.turns(THREAD)[0]?.error?.code, "lease_lost");
  const after = b.rows("SELECT thread_seq FROM engine_messages WHERE thread_id = ? ORDER BY thread_seq", THREAD).map((r) => Number(r["thread_seq"]));
  assert.deepEqual(after, before, "the late host wrote no message");
  assert.deepEqual(before, [1, 2, 3, 4, 5], "per-thread sequence has no gaps and no repeats across the two hosts");
  assert.equal(new Set(b.rows("SELECT id FROM engine_messages").map((r) => String(r["id"]))).size, 5, "ids are unique across hosts");
});

test("a turn parked on a held tool call on one host is continued by the host that gets the Gate answer", async () => {
  const a = harness();
  const held = toolRunnerFrom(async () => ({ kind: "held", result: { ok: false, content: { held: true } }, taskId: "tsk_gate9" }));
  const pa = scriptedProvider({ script: [{ type: "tool_call", id: "call_7", name: "mail_send", input: { to: "pat@acme.test" } }, { type: "done" }] });
  const ea = a.runtime({ openSession: pa.openSession, holder: "host:a", callTool: held, schedule: NO_BEAT });
  ea.openThread({ id: THREAD, kind: "chat", starter: "usr_dana", agents: agents() });
  ea.receive({ threadId: THREAD, author: DANA, body: LETTER });
  await ea.idle(THREAD);
  assert.equal(ea.turns(THREAD)[0]?.state, "waiting");

  const b = harness({ raw: a.raw, clock: a.clock });
  const pb = scriptedProvider({ script: [{ type: "text", text: "Sent." }, { type: "done" }] });
  const eb = b.runtime({ openSession: pb.openSession, holder: "host:b", schedule: NO_BEAT });
  eb.openThread({ id: THREAD, kind: "chat", starter: "usr_dana", agents: agents() });
  assert.deepEqual(eb.waiting(THREAD).map((w) => w.taskId), ["tsk_gate9"], "the parked call is visible to the second host");

  assert.notEqual(eb.resume("tsk_gate9", { approved: true }), null);
  await eb.idle(THREAD);
  const input = pb.sessions[0]?.inputs[0];
  assert.equal(input?.resumed?.callId, "call_7");
  assert.equal(input?.resumed?.toolName, "mail_send");
  assert.equal(input?.resumed?.approved, true);
  assert.equal(input?.asker, "usr_dana");
  assert.equal(eb.turns(THREAD)[0]?.state, "completed");
  assert.equal(ea.resume("tsk_gate9", { approved: true }), null, "the answer counts once");
  assert.equal(b.rows("SELECT task_id FROM engine_waits").length, 0);
});

test("the SQL queue orders and cancels like the memory queue", () => {
  const raw = openRaw();
  const sql = sqlQueue(scopedDb("engine", raw, "t".repeat(32)));
  const mem = createMemoryQueue();
  const row = (agentId: string, kind: "message" | "interrupt" | "wake", priority: number, steer = false) => ({
    threadId: THREAD, kind, messageId: null, agentId, from: "usr_dana", priority, enqueuedAt: 1, routine: false, steer,
  });
  for (const q of [sql, mem]) {
    q.enqueue(row("agt_a", "message", 0));
    q.enqueue(row("agt_b", "message", 0));
    q.enqueue(row("agt_a", "message", 0, true));
    q.enqueue(row("agt_c", "interrupt", 10));
  }
  const view = (q: typeof mem) => ({
    peek: q.peek(THREAD)?.agentId, list: q.list(THREAD).map((r) => `${r.qseq}:${r.agentId}:${r.state}`), steer: q.steerable(THREAD, "agt_a").map((r) => r.qseq),
  });
  assert.deepEqual(view(sql), view(mem));
  assert.equal(sql.peek(THREAD)?.agentId, "agt_c", "the interrupt is first");
  for (const q of [sql, mem]) { assert.equal(q.dequeue(THREAD)?.agentId, "agt_c"); }
  assert.deepEqual(sql.running(THREAD).map((r) => r.qseq), mem.running(THREAD).map((r) => r.qseq));
  for (const q of [sql, mem]) q.cancelQueued(THREAD, "agt_a");
  assert.deepEqual(view(sql), view(mem));
  assert.deepEqual(sql.list(THREAD).map((r) => r.state), ["cancelled", "queued", "cancelled", "running"]);
  for (const q of [sql, mem]) q.cancelQueued(THREAD);
  assert.deepEqual(view(sql), view(mem));
  assert.deepEqual(sql.list(THREAD).map((r) => r.state), ["cancelled", "cancelled", "cancelled", "running"]);
});

test("the SQL lease is a compare-and-set that matches the memory lease", () => {
  const raw = openRaw();
  const sql = sqlLeases(scopedDb("engine", raw, "t".repeat(32)));
  const mem = createMemoryLeases();
  for (const l of [sql, mem]) {
    assert.ok(l.acquire(THREAD, "host:a", 1000));
    assert.equal(l.acquire(THREAD, "host:b", 2000), null, "a live lease is not taken");
    assert.equal(l.renew(THREAD, "host:b", 2000), false);
    assert.equal(l.renew(THREAD, "host:a", 2000), true);
    l.setTurn(THREAD, "host:a", "trn_one");
    assert.equal(l.acquire(THREAD, "host:a", 3000)?.turnId, "trn_one", "re-acquire by the holder keeps the turn");
    assert.equal(l.get(THREAD, 3000)?.holder, "host:a");
    assert.equal(l.release(THREAD, "host:b"), false);
    assert.equal(l.get(THREAD, 3000 + LEASE_TTL_MS + 1), null, "expired");
    assert.equal(l.acquire(THREAD, "host:b", 3000 + LEASE_TTL_MS + 1)?.holder, "host:b", "an expired lease is taken");
    assert.equal(l.acquire(THREAD, "host:b", 3000 + LEASE_TTL_MS + 2)?.turnId, null, "a new holder starts with no turn");
    assert.equal(l.release(THREAD, "host:b"), true);
    assert.equal(l.get(THREAD, 0), null);
  }
});

test("the SQL waits and messages keep what the memory stores keep", () => {
  const raw = openRaw();
  const db = scopedDb("engine", raw, "t".repeat(32));
  const waits = sqlWaits(db);
  const w = { taskId: "tsk_a", threadId: THREAD, turnId: "trn_a", agentId: "agt_a", callId: "c1", toolName: "mail_send", asker: "usr_dana", runId: null, at: 5, resolution: null, wakeQseq: null };
  waits.put(w);
  assert.deepEqual(waits.get("tsk_a"), w);
  assert.equal(waits.resolve("tsk_a", { approved: true, result: { ok: true, content: { x: 1 } } }, 4), true);
  assert.equal(waits.resolve("tsk_a", { approved: false, result: { ok: false, content: {} } }, 5), false, "only the first answer counts");
  assert.equal(waits.forWake(THREAD, 4)?.resolution?.approved, true);
  assert.equal(waits.forWake(THREAD, 5), null);
  waits.remove("tsk_a");
  assert.equal(waits.get("tsk_a"), null);

  const messages = sqlMessages(db);
  const one = messages.append({ id: "msg_1", threadId: THREAD, author: DANA, mentions: [{ kind: "agent", id: "agt_docs" }], depth: 0, body: "one" });
  const two = messages.append({ id: "msg_2", threadId: THREAD, author: { kind: "agent", id: "agt_docs" }, mentions: [], depth: 1, body: "two" });
  messages.append({ id: "msg_3", threadId: "thr_other", author: DANA, mentions: [], depth: 0, body: "elsewhere" });
  assert.deepEqual([one.threadSeq, two.threadSeq], [1, 2]);
  assert.deepEqual(messages.get("msg_1"), one);
  assert.deepEqual(messages.recent(THREAD, 1).map((m) => m.id), ["msg_2"]);
  assert.deepEqual(messages.recent(THREAD, 10).map((m) => m.id), ["msg_1", "msg_2"]);
  assert.deepEqual(messages.get("msg_2")?.author, { kind: "agent", id: "agt_docs" });
  assert.equal(messages.get("msg_9"), null);
});
