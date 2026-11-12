// Waking on the baton (work baton, item 3): an agent that holds a work task is woken once per baton, in the task's thread, for the person who asked; people are not woken; a group is offered to its
// agent members; a finished question wakes the work it blocked. A real turn engine on a scripted provider proves the turn is queued and run for the right agent and asker.
import test from "node:test";
import assert from "node:assert/strict";
import { harness } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";
import { batonRow, holderOf, onTaskEvent, signatureOf, WAITING_LINE, WAITING_LINE_AGENT, WAITING_LINE_OTHER } from "../handlers/task-baton.ts";
import type { BatonTask } from "../handlers/task-baton.ts";
import { scriptedProvider } from "../../../agent/src/turn-engine/scripted-session.ts";

const DOER = "agt_doer", CHECK = "agt_check", BOSS = "usr_boss", OWNER = "usr_owner";
const agent = (id: string) => ({ kind: "agent", id });
const person = (id: string) => ({ kind: "person", id });

function scene(tasks: Record<string, BatonTask>, extra: Record<string, (input: any) => unknown> = {}, provider = scriptedProvider({ script: [{ type: "text", text: "ok" }, { type: "done" }] })) {   // eslint-disable-line @typescript-eslint/no-explicit-any
  const h = harness({ threads: [{ threadId: "thr_t1", kind: "thread", starter: "svc_host", agents: [{ agentId: DOER, mode: "listen" }, { agentId: CHECK, mode: "listen" }] }] });
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

test("a task made by a service acts for nobody: owning its agent or its run is not a yes; it waits with its line until a person starts it, who is then the asker (lead 12 Nov)", async () => {
  // before 12 Nov this woke the doer for the agent's owner (OWNER) and, for a run, for the run's owner: the rule changed, so this asserts the new behaviour in their place
  for (const over of [{ createdBy: "svc_host" }, { createdBy: "svc_0123456789abcdef0123456789abcdef", source: { kind: "run", id: "run_1" } }] as Partial<BatonTask>[]) {
    const t = task(over);
    const s = scene({ tsk_t1: t }, { "runs.get": () => ({ run: { owner: "usr_runner", startedBy: "usr_runner" } }), "agents.outside.usable": () => ({ usable: true }) });
    assert.deepEqual(await s.run("task.created", "tsk_t1"), [], `${JSON.stringify(over)}: nobody is woken`);
    assert.equal(s.provider.specs.length, 0, "no turn for the agent's owner or the run's owner");
    const line = s.h.called.find((c) => c.cap === "tasks.working_notes.set");
    assert.deepEqual([line?.input.key, line?.input.value], ["baton.waiting", over.source ? WAITING_LINE : WAITING_LINE_OTHER], "the task says why it waits");
    assert.equal(s.h.called.some((c) => c.cap === "access.principals.get" || c.cap === "runs.get"), false, "nobody's authority is even looked up");
    // a person starts it (tasks writes baton.owner for the person who pressed): the doer is woken for them
    t.workingNotes = { "baton.owner": BOSS };
    assert.deepEqual(await s.run("task.transitioned", "tsk_t1"), [DOER]);
    await s.engine.idle("thr_t1");
    assert.equal(s.provider.specs[0]!.asker, BOSS, "the person who started it");
  }
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

test("a request an agent holds wakes it like work does (l-tasks); a missing task wakes nobody", async () => {
  const s = scene({ tsk_a1: task({ id: "tsk_a1", kind: "approve" }) });
  assert.deepEqual(await s.run("task.created", "tsk_a1"), [DOER]);
  assert.deepEqual(await s.run("task.created", "tsk_a1"), [], "the same baton is not woken twice");
  assert.deepEqual(await s.run("task.created", "tsk_gone"), []);
});

test("with no thread yet, the thread is made first, in the asker's name", async () => {
  const s = scene({ tsk_t1: task({ threadId: undefined }) }, { "chat.start": () => ({ thread: { threadId: "thr_t1" } }), "tasks.update": () => ({}) });
  assert.deepEqual(await s.run("task.created", "tsk_t1"), [DOER]);
  const start = s.h.called.find((c) => c.cap === "chat.start")!;
  assert.deepEqual([start.input.scopeType, start.input.scopeId, start.input.as], ["task", "tsk_t1", OWNER]);
  const link = s.h.called.find((c) => c.cap === "tasks.update")!;
  assert.deepEqual([link.input.taskId, link.input.threadId], ["tsk_t1", "thr_t1"], "the task row gets the thread that was made");
});

test("a Space automation's task runs for the person who turned it on while they may ask the agent; otherwise it waits with the reason; never for the agent's owner (lead 12 Nov)", async () => {
  const auto = "aut_0123456789abcdef0123456789abcdef";
  const mk = () => task({ createdBy: `svc_${auto.slice(4)}`, source: { kind: "run", id: "run_1" }, workingNotes: { "automation.id": auto } });
  // runs as Boss, who may ask the doer
  const a = scene({ tsk_t1: mk() }, { "automations.runs_as.get": () => ({ kind: "space", runsAs: BOSS, name: "Bo Boss", trigger: "webhook", ok: true }), "agents.outside.usable": () => ({ usable: true }), "audit.append": () => ({ auditId: "aud_1" }) });
  assert.deepEqual(await a.run("task.created", "tsk_t1"), [DOER]);
  await a.engine.idle("thr_t1");
  assert.equal(a.provider.specs[0]!.asker, BOSS, "the runs-as person, not the agent's owner");
  const usable = a.host && a.h.called.find((c) => c.cap === "agents.outside.usable")!;
  assert.equal(usable.input.as, BOSS, "may they ask it is asked as them");
  const audited = a.h.called.find((c) => c.cap === "audit.append")!;
  assert.deepEqual([audited.input.action, audited.input.onBehalfOf, audited.input.detail.trigger], ["automation.acts_for", { kind: "person", id: BOSS }, "webhook"]);
  // they can no longer ask the agent: it waits, and says so
  const b = scene({ tsk_t1: mk() }, { "automations.runs_as.get": () => ({ kind: "space", runsAs: BOSS, name: "Bo Boss", ok: true }), "agents.outside.usable": () => ({ usable: false }), "agents.get": () => ({ agent: { name: "Scout" } }) });
  assert.deepEqual(await b.run("task.created", "tsk_t1"), []);
  const line = b.h.called.find((c) => c.cap === "tasks.working_notes.set")!;
  assert.equal(line.input.value, "Bo Boss turned this automation on and can no longer ask Scout. Open it to run it as yourself.");
  // a task another service made cannot borrow the automation's person
  const c = scene({ tsk_t1: { ...mk(), createdBy: "svc_ffffffffffffffffffffffffffffffff" } }, { "automations.runs_as.get": () => ({ kind: "space", runsAs: BOSS, ok: true }), "agents.outside.usable": () => ({ usable: true }) });
  assert.deepEqual(await c.run("task.created", "tsk_t1"), []);
  assert.equal(c.h.called.some((x) => x.cap === "automations.runs_as.get"), false);
});

test("a task an agent made runs for the person it was acting for; with nobody on record it waits, never for the agent's owner (lead 12 Nov)", async () => {
  const a = scene({ tsk_t1: task({ createdBy: CHECK, workingNotes: { "baton.acting_for": BOSS } }) });
  assert.deepEqual(await a.run("task.created", "tsk_t1"), [DOER]);
  await a.engine.idle("thr_t1");
  assert.equal(a.provider.specs[0]!.asker, BOSS);
  const b = scene({ tsk_t1: task({ createdBy: CHECK }) });
  assert.deepEqual(await b.run("task.created", "tsk_t1"), []);
  assert.equal(b.provider.specs.length, 0, "not the agent's owner");
  assert.equal(b.h.called.find((c) => c.cap === "tasks.working_notes.set")?.input.value, WAITING_LINE_AGENT);
});

test("the person who started a waiting automation task is asked again at the wake: once they cannot give the agent work, it waits (pass 2)", async () => {
  const mk = () => task({ createdBy: "svc_0123456789abcdef0123456789abcdef", source: { kind: "run", id: "run_1" }, workingNotes: { "baton.owner": BOSS } });
  const yes = scene({ tsk_t1: mk() }, { "agents.outside.usable": () => ({ usable: true }) });
  assert.deepEqual(await yes.run("task.created", "tsk_t1"), [DOER]);
  const no = scene({ tsk_t1: mk() }, { "agents.outside.usable": () => ({ usable: false }) });
  assert.deepEqual(await no.run("task.created", "tsk_t1"), [], "not woken for someone who can no longer give it work");
  assert.equal(no.provider.specs.length, 0);
  assert.match(String(no.h.called.find((c) => c.cap === "tasks.working_notes.set")?.input.value), /can no longer give this agent work/);
  assert.equal(no.h.called.find((c) => c.cap === "agents.outside.usable")?.input.as, BOSS, "asked as the starter");
});

test("a task a record change started is marked as holding outside content; one a schedule started is not (pass 3: every trigger but schedule, manual and button is outside)", async () => {
  const auto = "aut_0123456789abcdef0123456789abcdef";
  const mk = (trigger: string) => task({ createdBy: `svc_${auto.slice(4)}`, source: { kind: "run", id: "run_1" }, workingNotes: { "automation.id": auto, "automation.trigger": trigger } });
  const stubs = { "automations.runs_as.get": () => ({ kind: "space", runsAs: BOSS, name: "Bo Boss", ok: true }), "agents.outside.usable": () => ({ usable: true }), "audit.append": () => ({}), "gate.taint.mark": () => ({ ok: true }) };
  const changed = scene({ tsk_t1: mk("record_change") }, stubs);
  assert.deepEqual(await changed.run("task.created", "tsk_t1"), [DOER]);
  const mark = changed.h.called.find((c) => c.cap === "gate.taint.mark");
  assert.equal(mark?.input.source, `automation:${auto}:record_change:${BOSS}`);
  const timed = scene({ tsk_t1: mk("schedule") }, stubs);
  assert.deepEqual(await timed.run("task.created", "tsk_t1"), [DOER]);
  assert.equal(timed.h.called.some((c) => c.cap === "gate.taint.mark"), false);
});

test("a task the person cancels stops the turn its agent is working on it, through the durable Stop (the row says stopping before the Stop answers)", async () => {
  const t = task();
  let release = (): void => undefined;
  const held = new Promise<void>((r) => { release = r; });
  const slow = scriptedProvider({ script: [{ type: "text", text: "ok" }, { type: "done" }], beforeEvent: async (i) => { if (i === 0) await held; } });
  const s = scene({ tsk_t1: t }, {}, slow);
  assert.deepEqual(await s.run("task.created", "tsk_t1"), [DOER]);
  for (let i = 0; i < 100 && slow.sessions.length === 0; i++) await new Promise((r) => setTimeout(r, 5));
  t.state = "canceled";
  await s.run("task.transitioned", "tsk_t1");
  assert.equal(s.engine.queue("thr_t1").at(-1)?.state, "stopping", "on the row before anything else");
  release();
  await s.engine.idle("thr_t1");
  assert.equal(s.engine.events("thr_t1").filter((e) => e.type === "turn.cancelled").length, 1, "the doer's turn was stopped, once");
});
