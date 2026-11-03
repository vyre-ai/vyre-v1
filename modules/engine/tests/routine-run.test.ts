// A routine's run makes its agent act, and ends with the agent's turn (owner report, rc.16). A schedule or Run Now wakes the agent in the routine's chat; a watcher wakes it in the thread the new
// message came in, with that message in its input; each run is acted on once; the turn's end finishes the run (succeeded, failed or stopped) with the turn named on its step log.
import test from "node:test";
import assert from "node:assert/strict";
import { harness } from "../fixtures/harness.ts";
import { finishRoutineRun, onRoutineRun, runStatusOf } from "../handlers/routine-run.ts";
import { takeHeldNotes } from "../held-notes.ts";
import type { TurnEngine } from "../../../agent/src/turn-engine/engine.ts";

const OWNER = "usr_dana";
const ROUTINE = { routineId: "rtn_watch1", agentId: "agt_greeter", title: "Greet new leads", prompt: "Say hello and ask for their phone number." };

function world(answers: Record<string, (input: Record<string, unknown>, as?: string) => unknown> = {}) {
  const calls: Array<{ cap: string; input: Record<string, unknown>; as?: string }> = [];
  const host = {
    async call(cap: string, input: unknown, as?: string) {
      calls.push({ cap, input: input as Record<string, unknown>, ...(as ? { as } : {}) });
      const f = answers[cap];
      if (!f) throw new Error(`${cap} is not available`);
      return f(input as Record<string, unknown>, as);
    },
  };
  const woken: Array<{ threadId: string; agentId: string; o?: unknown }> = [];
  const engaged: Array<{ threadId: string; id: string }> = [];
  let q = 0;
  const engine = {
    wake: (threadId: string, agentId: string, o?: unknown) => { woken.push({ threadId, agentId, o }); return ++q; },
    engage: (threadId: string, a: { id: string }) => { engaged.push({ threadId, id: a.id }); },
  } as unknown as TurnEngine;
  const opened: Array<{ threadId: string; person: string }> = [];
  return { host, calls, engine, woken, engaged, opened, open: async (threadId: string, person: string) => { opened.push({ threadId, person }); } };
}

const base = {
  "agents.routines.list": () => ({ routines: [ROUTINE] }),
  "runs.get": () => ({ run: { id: "run_w1", trigger: { messageId: "msg_lead1", threadId: "thr_intake", channelId: "chn_intake" } } }),
  "chat.message.get": () => ({ message: { body: "Hi, I was in a car accident last week.", author: { id: "usr_pat" } } }),
  "access.principals.get": () => ({ principal: { name: "Pat Lee" } }),
  "channels.get": () => ({ channel: { name: "intake", mainThreadId: "thr_intake" } }),
  "runs.record_step": () => ({ ok: true }),
  "runs.finish": () => ({ run: {} }),
};

test("a watcher's run wakes its agent in the thread the message came in, with that message in its input, once", async () => {
  const h = harness();
  const w = world(base);
  const event = { payload: { agentId: ROUTINE.agentId, routineId: ROUTINE.routineId, runId: "run_w1", ownerId: OWNER, requestedBy: "watch:msg_lead1" } };
  assert.deepEqual(await onRoutineRun(h.ctx, w.host, w.engine, w.open, event), ["run_w1"]);
  assert.deepEqual(w.opened, [{ threadId: "thr_intake", person: OWNER }], "opened as the person who set the watcher");
  assert.deepEqual(w.engaged, [{ threadId: "thr_intake", id: ROUTINE.agentId }], "the agent answers there even when it is not in the channel");
  assert.deepEqual(w.woken, [{ threadId: "thr_intake", agentId: ROUTINE.agentId, o: { routine: true, from: OWNER } }], "a routine's turn, for its owner");
  const notes = takeHeldNotes("thr_intake", ROUTINE.agentId);
  assert.equal(notes.length, 1);
  assert.match(notes[0]!, /Greet new leads/);
  assert.match(notes[0]!, /#intake from Pat Lee/);
  assert.match(notes[0]!, /car accident last week/, "the triggering message is in the input");
  assert.match(notes[0]!, /ask for their phone number/);
  assert.ok(!w.calls.some((c) => c.cap === "chat.post"), "nothing is posted in anyone's name");
  assert.deepEqual(await onRoutineRun(h.ctx, w.host, w.engine, w.open, event), [], "the same run read again is not acted on twice");
  assert.equal(w.woken.length, 1);
});

test("a schedule's run wakes the agent in the routine's own chat, made once and kept", async () => {
  const h = harness();
  const w = world({ ...base, "chat.start": () => ({ thread: { threadId: "thr_routinechat" } }), "threads.get": () => ({ thread: { threadId: "thr_routinechat" } }) });
  const ev = (runId: string) => ({ payload: { agentId: ROUTINE.agentId, routineId: ROUTINE.routineId, runId, ownerId: OWNER, requestedBy: "schedule" } });
  await onRoutineRun(h.ctx, w.host, w.engine, w.open, ev("run_s1"));
  await onRoutineRun(h.ctx, w.host, w.engine, w.open, ev("run_s2"));
  assert.equal(w.calls.filter((c) => c.cap === "chat.start").length, 1, "one chat for the routine");
  assert.deepEqual(w.woken.map((x) => x.threadId), ["thr_routinechat", "thr_routinechat"]);
  assert.match(takeHeldNotes("thr_routinechat", ROUTINE.agentId)[0]!, /is due now/);
});

test("the turn's end finishes the run the way the turn went, with the turn named on its step log; a turn no run woke is left alone", async () => {
  const h = harness();
  const w = world(base);
  await onRoutineRun(h.ctx, w.host, w.engine, w.open, { payload: { agentId: ROUTINE.agentId, routineId: ROUTINE.routineId, runId: "run_w1", ownerId: OWNER, requestedBy: "watch:msg_lead1" } });
  w.calls.length = 0;
  assert.equal(await finishRoutineRun(h.ctx, w.host, { type: "turn.completed", turnId: "trn_other", threadId: "thr_intake" }, () => 99), null, "another turn in the thread");
  assert.equal(await finishRoutineRun(h.ctx, w.host, { type: "turn.completed", turnId: "trn_1", threadId: "thr_intake" }, () => 1), "run_w1");
  assert.deepEqual(w.calls.map((c) => [c.cap, c.input]), [
    ["runs.record_step", { runId: "run_w1", step: "agent turn", attempt: 1, state: "succeeded", outputRef: "turn:trn_1" }],
    ["runs.finish", { runId: "run_w1", status: "succeeded", summary: "The agent answered" }],
  ]);
  assert.equal(await finishRoutineRun(h.ctx, w.host, { type: "turn.completed", turnId: "trn_1", threadId: "thr_intake" }, () => 1), null, "finished once");
  assert.deepEqual([runStatusOf("turn.completed"), runStatusOf("turn.failed"), runStatusOf("turn.cancelled")], ["succeeded", "failed", "stopped"]);
  // a failed turn fails its run with what went wrong
  await onRoutineRun(h.ctx, w.host, w.engine, w.open, { payload: { agentId: ROUTINE.agentId, routineId: ROUTINE.routineId, runId: "run_w2", ownerId: OWNER, requestedBy: "watch:msg_lead1" } });
  w.calls.length = 0;
  await finishRoutineRun(h.ctx, w.host, { type: "turn.failed", turnId: "trn_2", threadId: "thr_intake", code: "no_account", message: "No AI account" }, () => 2);
  assert.deepEqual(w.calls.find((c) => c.cap === "runs.finish")!.input, { runId: "run_w2", status: "failed", error: { code: "no_account", message: "No AI account", step: "agent turn" } });
});
