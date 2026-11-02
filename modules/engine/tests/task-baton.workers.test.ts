// Tasks are how agents coordinate: what the baton does with a plan. A parent sleeps until its children need it, a task that waits starts when told, a planned crew child starts its job, a helper's answer is its hand-in, and a restart picks up what was left.
import test from "node:test";
import assert from "node:assert/strict";
import { harness } from "../fixtures/harness.ts";
import { batonRow, onTaskEvent, onTurnEnded, resumeTasks } from "../handlers/task-baton.ts";
import type { BatonTask } from "../handlers/task-baton.ts";
import { scriptedProvider } from "../../../agent/src/turn-engine/scripted-session.ts";
import type { DriverEvent } from "../../../agent/src/turn-engine/types.ts";

const DOER = "agt_doer", OWNER = "usr_owner";
const task = (over: Partial<BatonTask> = {}): BatonTask => ({ id: "tsk_t1", kind: "work", title: "Draft the letter", state: "todo", assigned: { kind: "agent", id: DOER }, createdBy: OWNER, reviewLoops: 0, workingNotes: {}, threadId: "thr_t1", ...over });
const said: DriverEvent[] = [{ type: "text", text: "Done." }, { type: "done" }];

function scene(t: BatonTask, list: readonly BatonTask[] = [t]) {
  const h = harness({ threads: [{ threadId: "thr_t1", kind: "thread", starter: "svc_host", agents: [{ agentId: DOER, mode: "listen" }] }] });
  const provider = scriptedProvider({ script: said });
  const engine = h.runtime({ openSession: provider.openSession });
  const sent: Array<{ cap: string; input: Record<string, any>; as: string | undefined }> = [];   // eslint-disable-line @typescript-eslint/no-explicit-any
  const host = {
    call: async (cap: string, input: unknown, as?: string) => {
      const i = input as Record<string, any>;   // eslint-disable-line @typescript-eslint/no-explicit-any
      if (cap === "tasks.get") return { task: t };
      if (cap === "tasks.list") return { tasks: list };
      if (cap === "chat.post" || cap === "tasks.create" || cap === "tasks.transition" || cap === "tasks.submit" || cap === "engine.crew.start") { sent.push({ cap, input: i, as }); return {}; }
      if (cap === "access.principals.get") return { principal: {} };
      return h.ctx.call(cap, input);
    },
    now: () => h.clock.t,
    log: () => undefined,
  };
  const settle = async (): Promise<void> => { await engine.idle("thr_t1"); };
  const event = (name: string, payload: Record<string, unknown> = {}) => onTaskEvent(h.ctx, host, engine, { name, payload: { taskId: t.id, ...payload } });
  return { h, provider, engine, host, sent, settle, event };
}
const caps = (s: ReturnType<typeof scene>, cap: string) => s.sent.filter((c) => c.cap === cap);

test("a task that waits starts nothing when made, and task.ready starts it as new", async () => {
  const t = task({ blocked: true });
  const s = scene(t);
  assert.deepEqual(await s.event("task.created"), []);
  assert.equal(batonRow(s.h.ctx.db, t.id), undefined);
  t.blocked = false;
  assert.deepEqual(await s.event("task.ready"), [DOER]);
  await s.settle();
  assert.equal(s.provider.specs.length, 1);
  assert.deepEqual(caps(s, "tasks.transition").map((c) => c.input), [{ taskId: t.id, to: "doing", expectedFrom: "todo" }]);
});

test("the parent of a plan sleeps through the plan and wakes once per reason and child", async () => {
  const t = task({ workingNotes: { "plan.parent": "1" } });
  const s = scene(t);
  assert.deepEqual(await s.event("task.created"), []);
  assert.deepEqual(await s.event("task.assigned"), []);
  assert.deepEqual(await s.event("task.children_settled", { reason: "blocked", childId: "tsk_a" }), [DOER]);
  await s.settle();
  assert.deepEqual(await s.event("task.children_settled", { reason: "blocked", childId: "tsk_a" }), []);
  assert.deepEqual(await s.event("task.children_settled", { reason: "asked", childId: "tsk_b" }), [DOER]);
  await s.settle();
  assert.deepEqual(await s.event("task.children_settled", { reason: "finished" }), [DOER]);
});

test("a planned crew child starts its job as the person who asked, bound to the task, once", async () => {
  const t = task({ source: { kind: "chat", id: "thr_t1" }, workingNotes: { "worker.kind": "crew", "worker.project": "prj_1", brief: "Build it" } });
  const s = scene(t);
  assert.deepEqual(await s.event("task.created"), [DOER]);
  const start = caps(s, "engine.crew.start");
  assert.equal(start.length, 1);
  assert.equal(start[0]!.input.taskId, t.id);
  assert.equal(start[0]!.input.teammateId, DOER);
  assert.equal(start[0]!.input.brief, "Build it");
  assert.equal(start[0]!.input.idempotencyKey, `task-crew:${t.id}`);
  assert.equal(s.provider.specs.length, 0, "the job runs the work, not a second turn in the task's thread");
});

test("a helper already bound gets a baton row and no second turn, and its answer is its hand-in", async () => {
  const t = task({ workerThread: "thr_t1", workingNotes: { "worker.kind": "helper" } });
  const s = scene(t);
  assert.deepEqual(await s.event("task.created"), []);
  assert.equal(s.provider.specs.length, 0);
  assert.deepEqual(batonRow(s.h.ctx.db, t.id)!.woken, [DOER]);
  assert.equal(await onTurnEnded(s.h.ctx, s.host, s.engine, { type: "turn.completed", threadId: "thr_t1", turnId: "trn_1", agentId: DOER }), "moved");
  assert.deepEqual(caps(s, "tasks.submit").map((c) => c.input.taskId), [t.id]);
});

test("after a restart a task nobody started is started, and one that waits or is a person's is left", async () => {
  const t = task();
  const waits = task({ id: "tsk_wait", blocked: true }), persons = task({ id: "tsk_person", assigned: { kind: "person", id: OWNER } });
  const s = scene(t, [t, waits, persons]);
  assert.deepEqual(await resumeTasks(s.h.ctx, s.host, s.engine), [DOER]);
  await s.settle();
  assert.equal(s.provider.specs.length, 1);
  assert.equal(batonRow(s.h.ctx.db, "tsk_wait"), undefined);
  assert.equal(batonRow(s.h.ctx.db, "tsk_person"), undefined);
});

test("after a restart a turn cut off mid-way is woken again, and a turn that finished is not", async () => {
  const t = task();
  const s = scene(t);
  await s.event("task.created");
  await s.settle();
  const before = s.provider.specs.length;
  assert.deepEqual(await resumeTasks(s.h.ctx, s.host, s.engine), [DOER]);
  await s.settle();
  assert.equal(s.provider.specs.length, before + 1);
  await onTurnEnded(s.h.ctx, s.host, s.engine, { type: "turn.failed", threadId: "thr_t1", turnId: "trn_1", agentId: DOER, code: "provider.overloaded" });
  assert.deepEqual(await resumeTasks(s.h.ctx, s.host, s.engine), []);
});
