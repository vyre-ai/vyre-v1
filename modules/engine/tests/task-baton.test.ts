// Waking on the baton (work baton, item 3): an agent that holds a work task is woken once per baton, in the task's thread, for the person who asked; people are not woken; a group is offered to its
// agent members; a finished question wakes the work it blocked. A real turn engine on a scripted provider proves the turn is queued and run for the right agent and asker.
import test from "node:test";
import assert from "node:assert/strict";
import { harness } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";
import { batonRow, holderOf, onTaskEvent, signatureOf } from "../handlers/task-baton.ts";
import type { BatonTask } from "../handlers/task-baton.ts";
import { scriptedProvider } from "../../../agent/src/turn-engine/scripted-session.ts";

const DOER = "agt_doer", CHECK = "agt_check", BOSS = "usr_boss", OWNER = "usr_owner";
const agent = (id: string) => ({ kind: "agent", id });
const person = (id: string) => ({ kind: "person", id });

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
    if (cap === "access.principals.get") return { principal: { owner: i.principal.id === DOER ? OWNER : undefined } };
    return base(cap, input);
  };
  const logs: string[] = [];
  const host = {
    call: async (cap: string, input: unknown, as?: string) => { const i = input as Record<string, any>; h.called.push({ cap, input: { ...i, as } }); if (extra[cap]) return extra[cap]!(i); return h.ctx.call(cap, input); },   // eslint-disable-line @typescript-eslint/no-explicit-any
    now: () => h.ctx.now(),
    log: (m: string) => { logs.push(m); },
  };
  const event = (name: string, taskId: string) => ({ name, id: `evt_${name}_${taskId}`, payload: { taskId } });
  return { h, provider, engine, host, logs, event, run: (name: string, taskId: string) => onTaskEvent(h.ctx, host, engine, event(name, taskId)) };
}
const task = (over: Partial<BatonTask> = {}): BatonTask => ({
  id: "tsk_t1", kind: "work", title: "Draft the letter", state: "todo", assigned: agent(DOER), reviewer: agent(CHECK), approver: person(BOSS), createdBy: OWNER, reviewLoops: 0, workingNotes: {}, threadId: "thr_t1", ...over,
});

test("the doer is woken once for a new task, in the task thread, for the person who asked", async () => {
  const s = scene({ tsk_t1: task() });
  assert.deepEqual(await s.run("task.created", "tsk_t1"), [DOER]);
  await s.engine.idle("thr_t1");
  assert.equal(s.provider.specs.length, 1);
  assert.equal(s.provider.specs[0]!.agent.id, DOER);
  assert.equal(s.provider.specs[0]!.threadId, "thr_t1");
  assert.equal(s.provider.specs[0]!.asker, OWNER, "the turn runs for the person, not for the service that made the task");
  const share = s.h.called.find((c) => c.cap === "access.share")!;
  assert.deepEqual([share.input.resource, share.input.subject, share.input.level], [{ type: "task", id: "tsk_t1" }, { kind: "agent", id: DOER }, "use"], "the agent is given its task before it is woken");
  assert.deepEqual(await s.run("task.assigned", "tsk_t1"), [], "the same baton is not woken twice");
  assert.deepEqual(await s.run("task.transitioned", "tsk_t1"), []);
  await s.engine.idle("thr_t1");
  assert.equal(s.provider.specs.length, 1);
  assert.equal(batonRow(s.h.ctx.db, "tsk_t1")!.sig, signatureOf(task(), holderOf(task())!));
});

test("starting the work does not wake the doer again, but the reviewer and then a send back do", async () => {
  const t = task();
  const s = scene({ tsk_t1: t });
  await s.run("task.created", "tsk_t1");
  t.state = "doing";
  assert.deepEqual(await s.run("task.transitioned", "tsk_t1"), [], "todo to doing keeps the baton with the doer");
  t.state = "in_review";
  assert.deepEqual(await s.run("task.transitioned", "tsk_t1"), [CHECK]);
  t.state = "doing"; t.reviewLoops = 1;
  assert.deepEqual(await s.run("task.transitioned", "tsk_t1"), [DOER], "a send back wakes the doer for the fixes");
  t.state = "in_review";
  assert.deepEqual(await s.run("task.transitioned", "tsk_t1"), [CHECK]);
  t.state = "awaiting_approval";
  assert.deepEqual(await s.run("task.transitioned", "tsk_t1"), [], "the approver is a person: it is theirs in Needs you");
  await s.engine.idle("thr_t1");
  assert.deepEqual(s.provider.specs.map((x) => x.agent.id), [DOER, CHECK, DOER, CHECK]);
  t.state = "done";
  await s.run("task.transitioned", "tsk_t1");
  assert.equal(batonRow(s.h.ctx.db, "tsk_t1"), undefined, "a finished task keeps no baton");
});

test("an agent approver is woken too", async () => {
  const t = task({ state: "awaiting_approval", approver: agent("agt_boss") });
  const s = scene({ tsk_t1: t }, { "threads.add_agent": () => ({}) });
  assert.deepEqual(await s.run("task.transitioned", "tsk_t1"), ["agt_boss"]);
  assert.ok(s.h.called.some((c) => c.cap === "threads.add_agent" && c.input.agentId === "agt_boss"), "an agent chat does not know yet joins the thread first");
});

test("a task nobody can ask is not woken, and says so", async () => {
  const s = scene({ tsk_t1: task({ createdBy: "svc_host", approver: agent("agt_boss") }) }, { "access.principals.get": () => ({ principal: {} }) });
  assert.deepEqual(await s.run("task.created", "tsk_t1"), []);
  assert.match(s.logs.join("\n"), /nobody asked for/);
  assert.equal(s.provider.specs.length, 0);
  assert.equal(batonRow(s.h.ctx.db, "tsk_t1"), undefined, "not recorded, so it is woken when a person is found");
});

test("a task made by a service is asked for the owner of its agent, or the person behind its run", async () => {
  const a = scene({ tsk_t1: task({ createdBy: "svc_host" }) });
  assert.deepEqual(await a.run("task.created", "tsk_t1"), [DOER]);
  await a.engine.idle("thr_t1");
  assert.equal(a.provider.specs[0]!.asker, OWNER);

  const b = scene({ tsk_t1: task({ createdBy: "svc_host", source: { kind: "run", id: "run_1" } }) }, { "access.principals.get": () => ({ principal: {} }), "runs.get": () => ({ run: { owner: "usr_runner" } }) });
  assert.deepEqual(await b.run("task.created", "tsk_t1"), [DOER]);
  await b.engine.idle("thr_t1");
  assert.equal(b.provider.specs[0]!.asker, "usr_runner");
});

test("a group is offered to its agent members, once, and a taken task is nobody else's", async () => {
  const t = task({ assigned: { kind: "group", id: "grp_desk" } });
  const s = scene({ tsk_t1: t }, { "access.groups.get": () => ({ group: { members: [{ kind: "agent", id: DOER }, { kind: "person", id: BOSS }, { kind: "agent", id: CHECK }] } }) });
  assert.deepEqual(await s.run("task.created", "tsk_t1"), [DOER, CHECK]);
  t.takenBy = DOER;
  assert.deepEqual(await s.run("task.taken", "tsk_t1"), [], "the one who took it is already working");
  await s.engine.idle("thr_t1");
  assert.equal(s.provider.specs.length, 2);
});

test("a question that was answered wakes the work it blocked, once", async () => {
  const t = task({ state: "doing" });
  const q: BatonTask = { ...task(), id: "tsk_q1", kind: "answer", state: "done", parentTaskId: "tsk_t1", assigned: person(OWNER), reviewer: undefined, approver: undefined } as BatonTask;
  const s = scene({ tsk_t1: t, tsk_q1: q });
  await s.run("task.created", "tsk_t1");
  assert.deepEqual(await s.run("task.transitioned", "tsk_q1"), [DOER]);
  assert.deepEqual(await s.run("task.transitioned", "tsk_q1"), [], "the same answer is not delivered twice");
  q.id = "tsk_q2";
  const s2 = scene({ tsk_t1: t, tsk_q2: { ...q, id: "tsk_q2", state: "canceled" } });
  await s2.run("task.created", "tsk_t1");
  assert.deepEqual(await s2.run("task.transitioned", "tsk_q2"), [DOER], "a block that was canceled also gives the work back");
});

test("a request is not work: it wakes nobody, and neither does a missing task", async () => {
  const s = scene({ tsk_a1: task({ id: "tsk_a1", kind: "approve" }) });
  assert.deepEqual(await s.run("task.created", "tsk_a1"), []);
  assert.deepEqual(await s.run("task.created", "tsk_gone"), []);
  assert.equal(s.provider.specs.length, 0);
});

test("with no thread yet, the thread is made first, in the asker's name", async () => {
  const s = scene({ tsk_t1: task({ threadId: undefined }) }, { "chat.start": () => ({ thread: { threadId: "thr_t1" } }), "tasks.update": () => ({}) });
  assert.deepEqual(await s.run("task.created", "tsk_t1"), [DOER]);
  const start = s.h.called.find((c) => c.cap === "chat.start")!;
  assert.deepEqual([start.input.scopeType, start.input.scopeId, start.input.as], ["task", "tsk_t1", OWNER]);
  const link = s.h.called.find((c) => c.cap === "tasks.update")!;
  assert.deepEqual([link.input.taskId, link.input.threadId], ["tsk_t1", "thr_t1"], "the task row gets the thread that was made");
});
