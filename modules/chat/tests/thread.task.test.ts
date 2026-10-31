// Task threads (work baton): one thread per task, kind thread scoped to the task, kept out of Recent. Its agents listen, so a message runs nobody unless it mentions an agent.
import test from "node:test";
import assert from "node:assert/strict";
import { handlers } from "../impl.ts";
import { INTAKE, MAYA, assertEventsConform, failure, harness } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";

const h = handlers as unknown as Record<string, (ctx: Harness["ctx"], input: any) => Promise<any>>;
let n = 0;
const startTask = (hn: Harness, taskId: string, extra: Record<string, unknown> = {}) =>
  h["chat.start"]!(hn.ctx, { kind: "chat", agentIds: [], scopeType: "task", scopeId: taskId, title: "Draft the letter", idempotencyKey: `t${++n}`, ...extra });

test("a task gets one thread of kind thread, scoped to the task, unlisted, with its agents listening", async () => {
  const hn = harness();
  const { thread } = await startTask(hn, "tsk_abc123", { agentIds: [INTAKE] });
  assert.equal(thread.kind, "thread");
  assert.equal(thread.scopeType, "task");
  assert.equal(thread.scopeId, "tsk_abc123");
  assert.equal(thread.listed, false);
  assert.equal(thread.title, "Draft the letter");
  assert.deepEqual(thread.agents.map((a: any) => [a.agentId, a.mode]), [[INTAKE, "listen"]], "no agent leads a task thread, so only a wake or a mention runs one");
  assert.deepEqual(hn.names(), ["thread.started", "agent.engaged"]);
  assert.deepEqual(assertEventsConform(hn), []);
});

test("a task thread may start with nobody in it, and starting it again opens the same one", async () => {
  const hn = harness();
  const a = (await startTask(hn, "tsk_abc123")).thread;
  assert.deepEqual(a.agents, []);
  hn.clear();
  const b = (await startTask(hn, "tsk_abc123", { agentIds: [INTAKE] })).thread;
  assert.equal(b.threadId, a.threadId);
  assert.deepEqual(hn.names(), []);
  assert.notEqual((await startTask(hn, "tsk_other")).thread.threadId, a.threadId);
  assert.equal(hn.rows("SELECT id FROM chat_thread WHERE scopeType = 'task'").length, 2);
});

test("a message in a task thread runs no agent unless it mentions one", async () => {
  const hn = harness();
  const { thread } = await startTask(hn, "tsk_abc123", { agentIds: [INTAKE] });
  await h["threads.members.add"]!(hn.ctx, { threadId: thread.threadId, personId: MAYA });
  const plain = await h["chat.post"]!(hn.person(MAYA), { threadId: thread.threadId, body: "Use the short version", idempotencyKey: "p1" });
  assert.deepEqual(plain.message.mentions ?? [], []);
  const events = hn.named("message.received");
  assert.deepEqual((events[events.length - 1]!.payload as { mentions: unknown[] }).mentions, []);
});

test("a task thread is named by a task id and belongs to the task", async () => {
  const hn = harness();
  assert.equal(await failure(() => startTask(hn, "abc123")), "validation.bad_input");
  assert.equal(await failure(() => startTask(hn, "tsk_a1", { personId: MAYA })), "validation.bad_input");
  assert.equal(await failure(() => startTask(hn, "tsk_a1", { kind: "ask", agentIds: [INTAKE] })), "validation.bad_input");
  assert.equal(await failure(() => h["chat.start"]!(hn.ctx, { kind: "chat", agentIds: [], idempotencyKey: "k" })), "validation.bad_input", "outside a task a chat still needs somebody");
  assert.equal(hn.rows("SELECT id FROM chat_thread").length, 0);
});
