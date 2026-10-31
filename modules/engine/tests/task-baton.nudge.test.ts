// No silent stops (work baton, item 5): a woken agent whose turn ends with the baton where it was is nudged once in the thread and woken again; a failed turn starts the clock without a nudge; after
// nudgeMinutes the task goes to a person in Needs you, once; a baton that moved, a task parked on a question, a turn a person stopped and a group member that did not take the task are not silent stops.
import test from "node:test";
import assert from "node:assert/strict";
import { harness } from "../fixtures/harness.ts";
import { batonRow, onTaskEvent, onTurnEnded, sweepBaton } from "../handlers/task-baton.ts";
import type { BatonTask } from "../handlers/task-baton.ts";
import { scriptedProvider } from "../../../agent/src/turn-engine/scripted-session.ts";
import type { DriverEvent } from "../../../agent/src/turn-engine/types.ts";

const DOER = "agt_doer", OWNER = "usr_owner", MIN = 60_000;
const task = (over: Partial<BatonTask & { blocked: boolean }> = {}): BatonTask => ({
  id: "tsk_t1", kind: "work", title: "Draft the letter", state: "todo", assigned: { kind: "agent", id: DOER }, createdBy: OWNER, reviewLoops: 0, workingNotes: {}, threadId: "thr_t1", ...over,
});
const said: DriverEvent[] = [{ type: "text", text: "I looked at it." }, { type: "done" }];

function scene(t: BatonTask, script: readonly DriverEvent[] = said) {
  const h = harness({ threads: [{ threadId: "thr_t1", kind: "thread", starter: "svc_host", agents: [{ agentId: DOER, mode: "listen" }, { agentId: "agt_b", mode: "listen" }] }] });
  const provider = scriptedProvider({ script });
  const engine = h.runtime({ openSession: provider.openSession });
  const sent: Array<{ cap: string; input: Record<string, any> }> = [];   // eslint-disable-line @typescript-eslint/no-explicit-any
  const host = {
    call: async (cap: string, input: unknown, as?: string) => {
      const i = input as Record<string, any>;   // eslint-disable-line @typescript-eslint/no-explicit-any
      if (cap === "tasks.get") return { task: t };
      if (cap === "chat.post" || cap === "tasks.create") { sent.push({ cap, input: { ...i, as } }); return {}; }
      if (cap === "access.principals.get") return { principal: {} };
      if (cap === "access.groups.get") return { group: { members: [{ kind: "agent", id: DOER }, { kind: "agent", id: "agt_b" }] } };
      return h.ctx.call(cap, input);
    },
    now: () => h.clock.t,
    log: () => undefined,
  };
  // what the runtime does: every turn that ends is looked at
  const pending: Promise<unknown>[] = [];
  engine.subscribe((ev) => {
    if (ev.type === "turn.completed" || ev.type === "turn.failed" || ev.type === "turn.cancelled") pending.push(onTurnEnded(h.ctx, host, engine, ev).catch(() => undefined));
  });
  const settle = async (): Promise<void> => { await engine.idle("thr_t1"); await Promise.all(pending.splice(0)); await engine.idle("thr_t1"); await Promise.all(pending.splice(0)); };
  const wake = () => onTaskEvent(h.ctx, host, engine, { name: "task.created", payload: { taskId: t.id } });
  return { h, provider, engine, host, sent, settle, wake, task: t };
}
const nudges = (s: ReturnType<typeof scene>) => s.sent.filter((c) => c.cap === "chat.post" && /Finish with exactly one baton call/.test(String(c.input.body)));

test("a turn that ends without a baton call is nudged once, and the agent is woken again", async () => {
  const s = scene(task());
  await s.wake();
  await s.settle();
  assert.equal(nudges(s).length, 1);
  assert.match(String(nudges(s)[0]!.input.body), /task_submit when the work is done, task_ask[^\n]*task_block/);
  assert.equal(nudges(s)[0]!.input.as, undefined, "the line is the server's, not a person's");
  assert.equal(s.provider.specs.length, 2, "woken once at the start and once after the nudge");
  const row = batonRow(s.h.ctx.db, "tsk_t1")!;
  assert.ok(row.nudgedAt !== undefined && row.turnEndedAt !== undefined);
  assert.equal(nudges(s).length, 1, "the second silent end is not nudged again");
});

test("the nudge names the tool of the seat: a reviewer is told to review", async () => {
  const s = scene(task({ state: "in_review", reviewer: { kind: "agent", id: DOER } }));
  await s.wake();
  await s.settle();
  assert.match(String(nudges(s)[0]!.input.body), /task_review: approve, or send_back with numbered fixes/);
});

test("a baton that moved during the turn is not a silent stop", async () => {
  const t = task();
  const s = scene(t);
  await s.wake();
  t.state = "in_review"; t.reviewer = { kind: "person", id: "usr_boss" };
  await s.settle();
  assert.equal(nudges(s).length, 0);
  assert.equal(s.provider.specs.length, 1);
});

test("a task waiting on a question it asked is not a silent stop", async () => {
  const s = scene(task({ blocked: true }));
  await s.wake();
  await s.settle();
  assert.equal(nudges(s).length, 0);
  assert.equal(batonRow(s.h.ctx.db, "tsk_t1")!.turnEndedAt, undefined);
});

test("a failed turn is not nudged, and starts the clock", async () => {
  const s = scene(task(), [{ type: "error", code: "provider.overloaded", message: "busy" }]);
  await s.wake();
  await s.settle();
  assert.equal(nudges(s).length, 0);
  assert.equal(s.provider.specs.length, 1);
  assert.ok(batonRow(s.h.ctx.db, "tsk_t1")!.turnEndedAt !== undefined);
});

test("a turn a person stopped starts nothing", async () => {
  const s = scene(task());
  await s.wake();
  await onTurnEnded(s.h.ctx, s.host, s.engine, { type: "turn.cancelled", threadId: "thr_t1", agentId: DOER });
  const row = batonRow(s.h.ctx.db, "tsk_t1")!;
  assert.ok(row.escalatedAt !== undefined, "nothing will be escalated for it");
  await s.settle();
  assert.deepEqual(await sweepBaton(s.h.ctx, s.host, s.engine), []);
});

test("a group member that did not take the task is not nudged; the one that took it is", async () => {
  const t = task({ assigned: { kind: "group", id: "grp_desk" } });
  const s = scene(t);
  assert.deepEqual(await s.wake(), [DOER, "agt_b"], "offered to both");
  await s.engine.idle("thr_t1");
  t.takenBy = "agt_b";
  assert.equal(await onTurnEnded(s.h.ctx, s.host, s.engine, { type: "turn.completed", threadId: "thr_t1", agentId: DOER }), "moved", "the one that did not take it stopped rightly");
  assert.equal(nudges(s).length, 0);
  assert.equal(await onTurnEnded(s.h.ctx, s.host, s.engine, { type: "turn.completed", threadId: "thr_t1", agentId: "agt_b" }), "nudged");
  assert.equal(nudges(s).length, 1);
});

test("after nudgeMinutes without a hand-over the task goes to the person who asked, once", async () => {
  const s = scene(task());
  await s.wake();
  await s.settle();
  assert.deepEqual(await sweepBaton(s.h.ctx, s.host, s.engine), [], "not yet");
  s.h.advance(31 * MIN);
  assert.deepEqual(await sweepBaton(s.h.ctx, s.host, s.engine), ["tsk_t1"]);
  const made = s.sent.find((c) => c.cap === "tasks.create")!.input;
  assert.equal(made.kind, "unblock");
  assert.deepEqual(made.assigned, { kind: "person", id: OWNER });
  assert.equal(made.parentTaskId, "tsk_t1");
  assert.match(String(made.title), /An agent stopped on "Draft the letter"/);
  assert.ok(s.sent.some((c) => c.cap === "chat.post" && /went to a person/.test(String(c.input.body))));
  assert.deepEqual(await sweepBaton(s.h.ctx, s.host, s.engine), [], "only once");
});

test("the step's nudgeMinutes and escalateTo are the clock and the person", async () => {
  const s = scene(task({ workingNotes: { "baton.nudge_minutes": "5", "baton.escalate_to": JSON.stringify({ kind: "person", id: "usr_lead" }) } }));
  await s.wake();
  await s.settle();
  s.h.advance(4 * MIN);
  assert.deepEqual(await sweepBaton(s.h.ctx, s.host, s.engine), []);
  s.h.advance(2 * MIN);
  assert.deepEqual(await sweepBaton(s.h.ctx, s.host, s.engine), ["tsk_t1"]);
  assert.deepEqual(s.sent.find((c) => c.cap === "tasks.create")!.input.assigned, { kind: "person", id: "usr_lead" });
});

test("a baton that moved by itself is never escalated, and a finished task is forgotten", async () => {
  const t = task();
  const s = scene(t);
  await s.wake();
  await s.settle();
  t.state = "in_review"; t.reviewer = { kind: "person", id: "usr_boss" };
  s.h.advance(60 * MIN);
  assert.deepEqual(await sweepBaton(s.h.ctx, s.host, s.engine), []);
  t.state = "done";
  await sweepBaton(s.h.ctx, s.host, s.engine);
  assert.equal(batonRow(s.h.ctx.db, "tsk_t1"), undefined);
});
