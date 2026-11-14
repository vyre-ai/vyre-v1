// A routine that cannot run says so, once, in plain words (P1 step 4, the failure rule). Three failed tries or three failed Runs in a row for one cause pause the routine and make ONE Needs-you item for its owner
// and ONE line in its chat; a trouble that clears by itself tells nobody; the item goes away when a Run goes well. A server that was off across several times says so in the routine's chat when it runs once.
import test from "node:test";
import assert from "node:assert/strict";
import { consumers, handlers } from "../impl.ts";
import { harness } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";
import { routineBy } from "../projections.ts";
import { isSelfPaused } from "../routine-guard.ts";

const h = handlers as unknown as Record<string, (ctx: Harness["ctx"], input: any) => Promise<any>>; // eslint-disable-line @typescript-eslint/no-explicit-any
const svc = { kind: "service" as const, id: "svc_host" };
const MIN = 60_000;
const CHAN = `chn_${"a".repeat(32)}`;
let n = 0;

interface Told {
  tasks: any[]; // eslint-disable-line @typescript-eslint/no-explicit-any
  withdrawn: any[]; // eslint-disable-line @typescript-eslint/no-explicit-any
  chat: any[]; // eslint-disable-line @typescript-eslint/no-explicit-any
  runs: { keys: string[]; failWith?: string };
}
function world(hn: Harness): Told {
  const t: Told = { tasks: [], withdrawn: [], chat: [], runs: { keys: [] } };
  hn.world.answer("tasks.create", (i: any) => {
    t.tasks.push(i);
    return { task: { id: `tsk_${t.tasks.length}`, title: i.title } };
  });
  hn.world.answer("tasks.withdraw", (i: any) => {
    t.withdrawn.push(i);
    return { withdrawn: 1 };
  });
  hn.world.answer("channels.get", () => ({ channel: { mainThreadId: "thr_main" } }));
  hn.world.answer("chat.post", (i: any) => {
    t.chat.push(i);
    return { messageId: `msg_${t.chat.length}` };
  });
  hn.world.answer("runs.start", (i: { idempotencyKey: string }) => {
    if (t.runs.failWith)
      throw Object.assign(new Error(t.runs.failWith), {
        error: { code: "internal.unavailable", message: t.runs.failWith },
      });
    t.runs.keys.push(i.idempotencyKey);
    return { runId: `run_${t.runs.keys.length}` };
  });
  return t;
}
async function routineOf(hn: Harness, over: Record<string, unknown> = {}) {
  const agentId = (
    await h["agents.create"]!(hn.ctx, { name: `Pinger${++n}`, role: "Says hi.", idempotencyKey: `c${n}` })
  ).agent.agentId;
  return (
    await h["agents.routine.save"]!(hn.ctx, {
      agentId,
      title: "Digest",
      cron: "* * * * *",
      prompt: "Say hi.",
      channelId: CHAN,
      idempotencyKey: `r${++n}`,
      ...over,
    })
  ).routine;
}
const fire = (hn: Harness, routineId: string) =>
  h["agents.routine.fire"]!(hn.as(svc), { routineId, dueKey: String(routineBy(hn.db, routineId)!.nextRunAt) });
const outcome = (hn: Harness, name: string, runId: string, code?: string, message?: string) =>
  (consumers["agents.routine_outcome"]!.run as (c: Harness["ctx"], e: unknown) => Promise<string[]>)(hn.as(svc), {
    name,
    payload: { runId, ...(code ? { code } : {}), ...(message ? { message } : {}) },
  });
/** one due time: the clock moves a minute, the routine fires, its Run fails with the cause */
async function failedRun(hn: Harness, routineId: string, code: string, message: string): Promise<void> {
  hn.advance(MIN);
  const r = await fire(hn, routineId);
  assert.equal(r.started, true);
  await outcome(hn, "run.failed", r.runId, code, message);
}

test("three failed Runs for one cause: one Needs-you item for the owner and one line in the routine's chat, in plain words, no code", async () => {
  const hn = harness();
  const t = world(hn);
  const r = await routineOf(hn);
  const code = "provider.rate_limited";
  const message = "provider.rate_limited: 429 from api.example [account acc_123]";
  await failedRun(hn, r.routineId, code, message);
  await failedRun(hn, r.routineId, code, message);
  assert.deepEqual([t.tasks.length, t.chat.length], [0, 0], "two failures in a row tell nobody yet");
  await failedRun(hn, r.routineId, code, message);
  assert.equal(isSelfPaused(hn.db, r.routineId), true);
  assert.equal(t.tasks.length, 1, "ONE item");
  const item = t.tasks[0];
  assert.equal(item.kind, "unblock");
  assert.deepEqual(item.assigned, { kind: "person", id: r.ownerId });
  assert.equal(item.title, "Digest paused: the AI account reached its usage limit");
  assert.match(item.summary, /Digest paused after 3 failed runs because the AI account reached its usage limit/);
  assert.doesNotMatch(
    `${item.title} ${item.summary} ${item.why ?? ""}`,
    /provider\.|rate_limited|429|acc_123|\[account/,
  );
  assert.equal(t.chat.length, 1, "ONE line in the routine's chat");
  assert.equal(t.chat[0].threadId, "thr_main");
  assert.match(t.chat[0].body, /Paused "Digest" after 3 failed runs: the AI account reached its usage limit/);
  assert.doesNotMatch(t.chat[0].body, /provider\.|rate_limited|429|acc_123/);
});

test("a Run that goes well after the pause withdraws the item", async () => {
  const hn = harness();
  const t = world(hn);
  const r = await routineOf(hn);
  for (let i = 0; i < 3; i++) await failedRun(hn, r.routineId, "provider.auth_failed", "sign in again");
  assert.equal(t.tasks.length, 1);
  (consumers["agents.routine_resume"]!.run as (c: Harness["ctx"], e: unknown) => unknown)(hn.as(svc), {});
  assert.equal(isSelfPaused(hn.db, r.routineId), false);
  hn.advance(MIN);
  const ran = await fire(hn, r.routineId);
  assert.equal(ran.started, true);
  assert.equal(t.withdrawn.length, 0, "a Run that has only started changes nothing");
  await outcome(hn, "run.succeeded", ran.runId);
  assert.equal(t.withdrawn.length, 1);
  assert.equal(t.withdrawn[0].taskId, "tsk_1");
  await outcome(hn, "run.succeeded", ran.runId);
  assert.equal(t.withdrawn.length, 1, "once");
});

test("a Run that cannot start is tried three times; a trouble that clears on the second try tells nobody, one that stays pauses the routine and tells once", async () => {
  const hn = harness();
  const t = world(hn);
  const r = await routineOf(hn);
  hn.advance(MIN);
  t.runs.failWith = "the runs module did not answer";
  await assert.rejects(() => fire(hn, r.routineId), /did not answer/, "the scheduler is told, so it tries again");
  delete t.runs.failWith;
  const ok = await fire(hn, r.routineId);
  assert.equal(ok.started, true, "the second try went through");
  assert.deepEqual([t.tasks.length, t.chat.length, isSelfPaused(hn.db, r.routineId)], [0, 0, false]);
  await outcome(hn, "run.succeeded", ok.runId);

  hn.advance(MIN);
  t.runs.failWith = "the runs module did not answer";
  for (let i = 0; i < 3; i++) await assert.rejects(() => fire(hn, r.routineId), /did not answer/);
  assert.equal(isSelfPaused(hn.db, r.routineId), true);
  assert.equal(t.tasks.length, 1);
  assert.match(t.tasks[0].title, /^Digest paused: /);
  assert.doesNotMatch(t.tasks[0].title + t.tasks[0].summary, /internal\.|unavailable/);
  assert.equal(t.chat.length, 1);
});

test("a routine without a chat still makes its one Needs-you item and posts nowhere", async () => {
  const hn = harness();
  const t = world(hn);
  const r = await routineOf(hn, { channelId: undefined });
  for (let i = 0; i < 3; i++) await failedRun(hn, r.routineId, "turn_timeout", "it took too long");
  assert.equal(t.tasks.length, 1);
  assert.equal(t.chat.length, 0);
});

test("a server that was off across several times: the Run starts once and the routine's chat says how many came due", async () => {
  const hn = harness();
  const t = world(hn);
  const r = await routineOf(hn);
  hn.advance(5 * MIN); // five minute-times are due; the one fire is for the first
  const ran = await fire(hn, r.routineId);
  assert.equal(ran.started, true);
  assert.equal(t.runs.keys.length, 1, "once, never a burst");
  assert.equal(t.chat.length, 1);
  assert.equal(t.chat[0].threadId, "thr_main");
  assert.match(t.chat[0].body, /4 runs of "Digest" came due while Vyre's server was off\. It ran once, now\./);
  assert.match(t.chat[0].idempotencyKey, /^routine-missed:/);
});

test("a fire on time says nothing in the chat; one missed time says it in the singular", async () => {
  const hn = harness();
  const t = world(hn);
  const r = await routineOf(hn);
  hn.advance(MIN);
  await fire(hn, r.routineId);
  assert.equal(t.chat.length, 0);
  hn.advance(2 * MIN);
  await fire(hn, r.routineId);
  assert.equal(t.chat.length, 1);
  assert.match(t.chat[0].body, /1 run of "Digest" came due while Vyre's server was off\. It ran once, now\./);
});
