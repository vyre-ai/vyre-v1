// Run threads (spec 2.5; ARCH 6.1, 7.7; golden flows 1 and 7): one chat per Run, a thread of kind run. When the Run's subject record has a channel, the Run posts one line there and its chat
// hangs under that line. Agent steps are real turns in the run thread; people steer it like any chat.
import test from "node:test";
import assert from "node:assert/strict";
import { handlers } from "../impl.ts";
import { lastMessages } from "../projections.ts";
import { INTAKE, MAYA, assertEventsConform, failure, harness } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";

const h = handlers as unknown as Record<string, (ctx: Harness["ctx"], input: any) => Promise<any>>;
let n = 0;
const startRun = (hn: Harness, runId: string, extra: Record<string, unknown> = {}) =>
  h["chat.start"]!(hn.ctx, { kind: "chat", agentIds: [INTAKE], scopeType: "run", scopeId: runId, title: "Welcome sequence", idempotencyKey: `r${++n}`, ...extra });
const projectChannel = async (hn: Harness, recordId = "rec_proj1") =>
  (await h["channels.create"]!(hn.ctx, { name: "Smith matter", visibility: "invite", memberIds: [MAYA], recordId, idempotencyKey: `c${++n}` })).channel;

test("a Run gets one thread of kind run, named by the Run, kept out of Recent", async () => {
  const hn = harness();
  const { thread } = await startRun(hn, "run_abc123");
  assert.equal(thread.kind, "run");
  assert.equal(thread.scopeType, "run");
  assert.equal(thread.scopeId, "run_abc123");
  assert.equal(thread.listed, false);
  assert.equal(thread.title, "Welcome sequence");
  assert.deepEqual(thread.agents.map((a: any) => [a.agentId, a.mode]), [[INTAKE, "lead"]]);
  assert.equal(thread.parentThreadId, undefined, "no channel for the record, no line posted");
  assert.deepEqual(hn.names(), ["thread.started", "agent.engaged"]);
  assert.equal(hn.named("thread.started")[0]!.payload["kind"], "run");
  assert.deepEqual(assertEventsConform(hn), []);
});

test("starting the chat of the same Run again opens the one that exists and announces nothing", async () => {
  const hn = harness();
  const a = (await startRun(hn, "run_abc123")).thread;
  hn.clear();
  const b = (await startRun(hn, "run_abc123")).thread;
  assert.equal(b.threadId, a.threadId);
  assert.deepEqual(hn.names(), []);
  const c = (await startRun(hn, "run_other")).thread;
  assert.notEqual(c.threadId, a.threadId);
  assert.equal(hn.rows("SELECT id FROM chat_thread WHERE kind = 'run'").length, 2);
  // the database holds the rule too: a second run thread for one Run cannot be stored
  assert.throws(() => hn.raw.run("INSERT INTO chat_thread (id, kind, scopeType, scopeId, listed, modePlan, createdAt, version) VALUES ('thr_dupe', 'run', 'run', 'run_abc123', 0, 0, 1, 0)"));
});

test("a Run on a record with a channel posts one line there, and its chat hangs under that line", async () => {
  const hn = harness();
  const ch = await projectChannel(hn);
  hn.clear();
  const { thread } = await startRun(hn, "run_abc123", { recordId: "rec_proj1" });
  assert.equal(thread.parentThreadId, ch.mainThreadId);
  assert.equal(thread.recordId, "rec_proj1");

  const line = lastMessages(hn.db, ch.mainThreadId).pop()!;
  assert.equal(thread.parentMessageId, line.id);
  assert.equal(line.kind, "system");
  assert.match(line.body, /Welcome sequence/);
  assert.equal(line.thread, ch.mainThreadId);
  assert.equal(line.seq, 1);

  assert.deepEqual(hn.names(), ["message.received", "thread.started", "agent.engaged"]);
  assert.equal(hn.named("message.received")[0]!.payload["threadId"], ch.mainThreadId);
  assert.equal(hn.named("thread.started")[0]!.payload["parentThreadId"], ch.mainThreadId);
  assert.deepEqual(assertEventsConform(hn), []);

  // the line opens the Run's chat: the thread under that message is the run thread, not a second one
  const under = await h["chat.thread"]!(hn.ctx, { threadId: ch.mainThreadId, messageId: line.id });
  assert.equal(under.thread.threadId, thread.threadId);
  assert.equal(under.thread.kind, "run");
  hn.clear();
  await startRun(hn, "run_abc123", { recordId: "rec_proj1" });
  assert.equal(lastMessages(hn.db, ch.mainThreadId).length, 1, "starting it again posts no second line");
});

test("a record without a live channel gets no line: an archived channel does not count", async () => {
  const hn = harness();
  const ch = await projectChannel(hn, "rec_old");
  hn.raw.run("UPDATE chat_channel SET archived = 1 WHERE id = ?", ch.channelId);
  const { thread } = await startRun(hn, "run_x1", { recordId: "rec_old" });
  assert.equal(thread.parentThreadId, undefined);
  assert.equal(lastMessages(hn.db, ch.mainThreadId).length, 0);
});

test("people steer a run thread like any chat, and the agent's step lines are numbered with it", async () => {
  const hn = harness();
  const ch = await projectChannel(hn);
  const { thread } = await startRun(hn, "run_abc123", { recordId: "rec_proj1", first: "Starting step 1" });
  assert.equal(lastMessages(hn.db, thread.threadId).length, 1);
  const step = await h["chat.post"]!(hn.agent(INTAKE), { threadId: thread.threadId, body: "Drafted the email", idempotencyKey: "p1" });
  assert.equal(step.message.threadSeq, 2);
  assert.equal(step.message.enc, 0, "a run thread is not a private chat");
  const steer = await h["chat.post"]!(hn.person(MAYA), { threadId: thread.threadId, body: "Use the short version", idempotencyKey: "p2" });
  assert.equal(steer.message.threadSeq, 3);
  assert.equal(lastMessages(hn.db, ch.mainThreadId).length, 1, "the channel keeps its single line");
});

test("a Run is named by its Run id, belongs to the Run and is never an Ask pane", async () => {
  const hn = harness();
  assert.equal(await failure(() => startRun(hn, "abc123")), "validation.bad_input");
  assert.equal(await failure(() => startRun(hn, "run_a1", { personId: MAYA })), "validation.bad_input");
  assert.equal(await failure(() => startRun(hn, "run_a1", { kind: "ask" })), "validation.bad_input");
  assert.equal(await failure(() => h["chat.start"]!(hn.ctx, { kind: "chat", agentIds: [INTAKE], scopeType: "run", idempotencyKey: "k" })), "validation.bad_input");
  assert.equal(hn.rows("SELECT id FROM chat_thread").length, 0);
});
