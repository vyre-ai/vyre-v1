// Agents start on any task they hold (l-tasks): an Answer, Review, Approve or Unblock given to an agent wakes it with the request's own finish, a task that moves from one agent to
// another stops the first, and an outside agent (its tasks wait in its queue) is nudged once, then the task goes to a person.
import test from "node:test";
import assert from "node:assert/strict";
import { harness } from "../fixtures/harness.ts";
import { finishOf, onTaskEvent, sweepBaton } from "../handlers/task-baton.ts";
import type { BatonTask } from "../handlers/task-baton.ts";
import { taskSection } from "../context.ts";
import { scriptedProvider } from "../../../agent/src/turn-engine/scripted-session.ts";

const DOER = "agt_doer", CHECK = "agt_check", OWNER = "usr_owner";
const agent = (id: string) => ({ kind: "agent", id });

function scene(tasks: Record<string, BatonTask>, extra: Record<string, (input: any) => unknown> = {}) {   // eslint-disable-line @typescript-eslint/no-explicit-any
  const h = harness({ threads: [{ threadId: "thr_t1", kind: "thread", starter: "svc_host", agents: [{ agentId: DOER, mode: "listen" }, { agentId: CHECK, mode: "listen" }] }] });
  const provider = scriptedProvider({ script: [{ type: "text", text: "ok" }, { type: "done" }] });
  const engine = h.runtime({ openSession: provider.openSession });
  const base = h.ctx.call;
  h.ctx.call = async (cap, input) => {
    const i = input as Record<string, any>;   // eslint-disable-line @typescript-eslint/no-explicit-any
    h.called.push({ cap, input: i });
    if (extra[cap]) return extra[cap]!(i);
    if (cap === "tasks.get") { const t = tasks[String(i.taskId)]; if (!t) throw new Error("no such task"); return { task: t }; }
    if (cap === "access.principals.get") return { principal: { owner: OWNER } };
    return base(cap, input);
  };
  const host = { call: async (cap: string, input: unknown) => h.ctx.call(cap, input), now: () => h.ctx.now() };
  const run = (name: string, taskId: string): Promise<string[]> => onTaskEvent(h.ctx, host, engine, { name, id: `evt_${name}_${taskId}_${Math.random()}`, payload: { taskId } });
  return { h, provider, engine, host, run };
}
const request = (over: Partial<BatonTask> = {}): BatonTask => ({
  id: "tsk_r1", kind: "answer", title: "Which date is right?", state: "todo", assigned: agent(DOER), createdBy: OWNER, reviewLoops: 0, workingNotes: {}, threadId: "thr_t1",
  actions: [{ key: "answer", label: "Answer" }, { key: "dismiss", label: "Dismiss" }, { key: "delegate", label: "Hand over" }], ...over,
});

test("probe 5: an Answer given to an agent wakes it, and its turn is told to answer with tasks_act", async () => {
  const s = scene({ tsk_r1: request() });
  assert.deepEqual(await s.run("task.created", "tsk_r1"), [DOER]);
  await s.engine.idle("thr_t1");
  assert.equal(s.provider.specs.length, 1);
  assert.equal(s.h.called.some((c) => c.cap === "tasks.transition"), false, "a request is not marked started");
  assert.equal(finishOf(request(), "assigned"), "tasks_act {taskId, action: answer | dismiss, note}");
  assert.match(taskSection(request() as never, DOER, {}), /tasks_act \{taskId, action, note\} with action one of: answer \("Answer"\), dismiss \("Dismiss"\)/);
});

test("an agent given a Review task is woken to review it", async () => {
  const s = scene({ tsk_r2: request({ id: "tsk_r2", kind: "review", state: "in_review", assigned: agent(DOER), reviewer: agent(CHECK), actions: [{ key: "approve", label: "Looks good" }, { key: "send_back", label: "Send back" }] }) });
  assert.deepEqual(await s.run("task.created", "tsk_r2"), [CHECK]);
});

test("a task handed from one agent to another stops the first one's turn", async () => {
  const t: BatonTask = { id: "tsk_w1", kind: "work", title: "Draft", state: "todo", assigned: agent(DOER), createdBy: OWNER, reviewLoops: 0, workingNotes: {}, threadId: "thr_t1" };
  const s = scene({ tsk_w1: t });
  const stopped: Array<{ thread: string; agent: string | undefined }> = [];
  const real = s.engine.stop.bind(s.engine);
  (s.engine as { stop: typeof s.engine.stop }).stop = async (threadId, opts) => { stopped.push({ thread: threadId, agent: opts?.agentId }); return real(threadId, opts); };
  assert.deepEqual(await s.run("task.created", "tsk_w1"), [DOER]);
  t.assigned = agent(CHECK);
  assert.deepEqual(await s.run("task.assigned", "tsk_w1"), [CHECK]);
  assert.deepEqual(stopped, [{ thread: "thr_t1", agent: DOER }]);
});

test("an outside agent that sits on its task is nudged once, then a person gets it", async () => {
  const t: BatonTask = { id: "tsk_o1", kind: "work", title: "Fix the CSS", state: "doing", assigned: agent(DOER), createdBy: OWNER, reviewLoops: 0, workingNotes: { "baton.nudge_minutes": "10" }, threadId: "thr_t1" };
  const queued: unknown[] = [], posted: string[] = [], made: Array<Record<string, unknown>> = [];
  const s = scene({ tsk_o1: t }, {
    "agents.get": () => ({ agent: { runtime: "outside" } }),
    "agents.outside.enqueue": (i: unknown) => { queued.push(i); return { queued: true }; },
    "chat.post": (i: { body: string }) => { posted.push(i.body); return { message: {} }; },
    "tasks.create": (i: Record<string, unknown>) => { made.push(i); return { task: { id: "tsk_esc1" } }; },
  });
  assert.deepEqual(await s.run("task.created", "tsk_o1"), [DOER]);
  assert.equal(queued.length, 1, "the task waits in the agent's queue");
  assert.deepEqual(await sweepBaton(s.h.ctx, s.host, s.engine), [], "not yet");
  s.h.advance(10 * 60_000);
  assert.deepEqual(await sweepBaton(s.h.ctx, s.host, s.engine), [], "the first time it is nudged, not escalated");
  assert.equal(queued.length, 2, "the queue gets it again");
  assert.match(posted.join("\n"), /Still waiting on this/);
  s.h.advance(10 * 60_000);
  assert.deepEqual(await sweepBaton(s.h.ctx, s.host, s.engine), ["tsk_o1"]);
  assert.equal(made[0]!.kind, "unblock");
  assert.deepEqual(made[0]!.assigned, { kind: "person", id: OWNER });
});

test("an agent that hands its work in is not stopped: the baton moved because of its own call, which is still finishing", async () => {
  const t: BatonTask = { id: "tsk_w2", kind: "work", title: "Draft", state: "doing", assigned: agent(DOER), reviewer: agent(CHECK), createdBy: OWNER, reviewLoops: 0, workingNotes: {}, threadId: "thr_t1" };
  const s = scene({ tsk_w2: t });
  const stopped: string[] = [];
  const real = s.engine.stop.bind(s.engine);
  (s.engine as { stop: typeof s.engine.stop }).stop = async (threadId, opts) => { stopped.push(opts?.agentId ?? ""); return real(threadId, opts); };
  assert.deepEqual(await s.run("task.created", "tsk_w2"), [DOER]);
  t.state = "in_review";
  assert.deepEqual(await s.run("task.transitioned", "tsk_w2"), [CHECK]);
  assert.deepEqual(stopped, [], "the doer's turn ends by itself");
});
