// State-machine property test (ARCH 4.7). Random sequences may only cross edges in the table below.
// The allowed set is written here on purpose, so a change in step() cannot quietly widen it.

import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_POLICY,
  TASK_KINDS,
  TASK_STATES,
  TRANSITION_ACTIONS,
  actionForTarget,
  dependencyCycle,
  initialState,
  isBlocked,
  isOpen,
  responsiblePerson,
  sameParty,
  slotFill,
  step,
} from "../handlers/state.ts";
import type { Actor, Machine, Party, Policy, StepOk, StepResult, TaskState } from "../handlers/state.ts";

const EDGES: ReadonlyArray<readonly [TaskState, TaskState]> = [
  ["todo", "doing"],
  ["todo", "in_review"],
  ["todo", "awaiting_approval"],
  ["todo", "done"],
  ["todo", "canceled"],
  ["doing", "in_review"],
  ["doing", "awaiting_approval"],
  ["doing", "done"],
  ["doing", "canceled"],
  ["in_review", "awaiting_approval"],
  ["in_review", "done"],
  ["in_review", "doing"],
  ["in_review", "canceled"],
  ["awaiting_approval", "done"],
  ["awaiting_approval", "doing"],
  ["awaiting_approval", "canceled"],
  ["done", "todo"],
  ["canceled", "todo"],
];

const ALLOWED = new Set(EDGES.map(([from, to]) => `${from}>${to}`));

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rng: () => number, items: readonly T[]): T {
  const item = items[Math.floor(rng() * items.length)];
  if (item === undefined) throw new Error("pick from an empty list");
  return item;
}

interface MachineInit {
  state: TaskState;
  kind: Machine["kind"];
  assigned: Party;
  createdBy: string;
  reviewLoops?: number;
  reviewer?: Party;
  approver?: Party;
  takenBy?: string;
}

function machine(init: MachineInit): Machine {
  const task: Machine = {
    state: init.state,
    kind: init.kind,
    assigned: init.assigned,
    reviewLoops: init.reviewLoops ?? 0,
    createdBy: init.createdBy,
  };
  if (init.reviewer) task.reviewer = init.reviewer;
  if (init.approver) task.approver = init.approver;
  if (init.takenBy) task.takenBy = init.takenBy;
  return task;
}

function person(id: string): Actor {
  return { kind: "person", id };
}

/** The actor who holds the slot this action writes, so a refusal is about the table and not a stranger. */
function holder(task: Machine, action: string): Actor {
  if (action === "send_back" || (action === "approve" && task.state === "in_review")) {
    const id = task.reviewer?.id ?? task.assigned.id;
    const kind = task.reviewer?.kind === "agent" ? "agent" : "person";
    return { kind, id };
  }
  if (action === "reject" || (action === "approve" && task.state !== "in_review")) {
    const id = task.approver?.id ?? task.assigned.id;
    const kind = task.approver?.kind === "agent" ? "agent" : "person";
    return { kind, id };
  }
  if (action === "cancel" || action === "reopen") return { kind: "person", id: task.createdBy };
  if (task.assigned.kind === "person" || task.assigned.kind === "agent") {
    return { kind: task.assigned.kind === "agent" ? "agent" : "person", id: task.assigned.id };
  }
  return { kind: "person", id: task.takenBy ?? task.createdBy };
}

function check(before: Machine, action: string, actor: Actor, policy: Policy, result: StepResult): void {
  if (action === "send_back" && before.reviewer?.kind === "agent" && actor.kind === "agent" && before.reviewLoops >= policy.reviewLoopLimit) {
    assert.equal(result.ok, false);
  }
  if (!policy.allowSelfReview) {
    const reviewerClash = (action === "send_back" || (action === "approve" && before.state === "in_review"))
      && !!before.reviewer && sameParty(before.reviewer, before.assigned);
    const approverClash = (action === "reject" || (action === "approve" && before.state === "awaiting_approval"))
      && !!before.approver && sameParty(before.approver, before.assigned);
    if (reviewerClash || approverClash) assert.equal(result.ok, false);
  }
  if (policy.requireHumanApprover && action === "approve" && before.state === "awaiting_approval") {
    const approverNotPerson = !!before.approver && before.approver.kind !== "person";
    if (actor.kind !== "person" || approverNotPerson) assert.equal(result.ok, false);
  }
  if (!result.ok) {
    assert.equal(result.code, "validation.precondition_failed");
    return;
  }
  assert.notEqual(result.to, before.state);
  assert.ok(ALLOWED.has(`${before.state}>${result.to}`), `${before.state} ${action} -> ${result.to}`);
  if (action === "send_back") {
    assert.equal(result.to, "doing");
    assert.equal(result.reviewLoops, before.reviewLoops + 1);
    assert.ok(result.events.includes("task.sent_back"));
  }
  if (action === "reject") {
    assert.equal(result.to, "doing");
    assert.equal(result.reviewLoops, before.reviewLoops);
    assert.ok(result.events.includes("task.rejected"));
  }
  if (action === "reopen") {
    assert.equal(result.to, "todo");
    assert.equal(result.reviewLoops, 0);
  }
  if (action === "cancel") {
    assert.equal(isOpen(before.state), true);
    assert.equal(result.to, "canceled");
  }
  if (before.state === "done" || before.state === "canceled") {
    assert.equal(action, "reopen");
    assert.equal(result.to, "todo");
  }
  if (result.to === "in_review") {
    assert.ok(before.reviewer);
    assert.ok(before.state === "todo" || before.state === "doing");
    assert.equal(action, "submit");
  }
  if ((before.state === "todo" || before.state === "doing") && result.to === "awaiting_approval") {
    assert.equal(before.reviewer, undefined);
    assert.ok(before.approver);
    assert.equal(action, "submit");
  }
  if ((before.state === "todo" || before.state === "doing") && result.to === "done") {
    if (action !== "answer" && action !== "resolved") {
      assert.equal(before.reviewer, undefined);
      assert.equal(before.approver, undefined);
      assert.ok(action === "submit" || action === "complete");
    }
  }
  if (before.state === "in_review" && result.to === "awaiting_approval") {
    assert.equal(action, "approve");
    assert.ok(before.approver);
  }
  if (before.state === "in_review" && result.to === "done") {
    assert.equal(action, "approve");
    assert.equal(before.approver, undefined);
  }
  if (before.state === "in_review" && result.to === "doing") assert.equal(action, "send_back");
  if (before.state === "awaiting_approval" && result.to === "done") assert.equal(action, "approve");
  if (before.state === "awaiting_approval" && result.to === "doing") assert.equal(action, "reject");
  if (before.state === "todo" && result.to === "doing") assert.equal(action, "start");
  if (result.to === "canceled") {
    assert.equal(isOpen(before.state), true);
    assert.ok(action === "cancel" || action === "dismiss" || action === "cannot");
  }
  if (action === "approve") assert.ok(result.events.includes("task.approved"));
  if (result.to === "done") assert.ok(result.events.includes("task.completed"));
  else assert.equal(result.events.includes("task.completed"), false);
  if (result.takenBy !== undefined) {
    assert.equal(result.takenBy, actor.id);
    assert.ok(result.events.includes("task.handled"));
  }
  if (!policy.allowSelfReview) {
    if ((action === "send_back" || (action === "approve" && before.state === "in_review")) && before.reviewer) {
      assert.equal(sameParty(before.reviewer, before.assigned), false);
    }
    if ((action === "reject" || (action === "approve" && before.state === "awaiting_approval")) && before.approver) {
      assert.equal(sameParty(before.approver, before.assigned), false);
    }
  }
  if (policy.requireHumanApprover && action === "approve" && before.state === "awaiting_approval") {
    assert.equal(actor.kind, "person");
    assert.equal(before.approver?.kind, "person");
  }
}

function apply(task: Machine, action: string, actor: Actor, policy: Policy): Machine {
  const before = structuredClone(task);
  const result = step(task, action, { actor, policy, note: "noted" });
  assert.deepEqual(task, before);
  check(before, action, actor, policy, result);
  if (!result.ok) return task;
  const next: Machine = { ...task, state: result.to, reviewLoops: result.reviewLoops };
  if (result.takenBy !== undefined) next.takenBy = result.takenBy;
  return next;
}

function expectTo(task: Machine, action: string, actor: Actor, to: TaskState, policy: Policy = DEFAULT_POLICY, note?: string): StepOk {
  const result = step(task, action, { actor, policy, ...(note !== undefined ? { note } : {}) });
  if (!result.ok) assert.fail(result.reason);
  assert.equal(result.to, to);
  assert.ok(ALLOWED.has(`${task.state}>${result.to}`));
  return result;
}

function expectNo(task: Machine, action: string, actor: Actor, policy: Policy = DEFAULT_POLICY, note?: string): void {
  const before = structuredClone(task);
  const result = step(task, action, { actor, policy, ...(note !== undefined ? { note } : {}) });
  assert.equal(result.ok, false);
  assert.deepEqual(task, before);
}

function randomMachine(rng: () => number): { task: Machine; policy: Policy } {
  const group = rng() >= 0.8;
  const task: Machine = {
    state: pick(rng, TASK_STATES),
    kind: pick(rng, TASK_KINDS),
    assigned: group ? { kind: "group", id: "grp_1" } : { kind: "person", id: "usr_a" },
    reviewLoops: Math.floor(rng() * 4),
    createdBy: "usr_a",
  };
  if (group && rng() < 0.5) task.takenBy = "usr_a";
  if (rng() < 0.5) task.reviewer = rng() < 0.3 ? { kind: "agent", id: "agt_r" } : { kind: "person", id: "usr_b" };
  if (rng() < 0.5) task.approver = { kind: "person", id: "usr_c" };
  return {
    task,
    policy: {
      reviewLoopLimit: 2,
      allowSelfReview: rng() < 0.2,
      requireHumanApprover: rng() < 0.2,
    },
  };
}

test("kinds start in the state ARCH 4.7 names, and blocked is not stored", () => {
  assert.equal((TASK_STATES as readonly string[]).includes("blocked"), false);
  assert.equal(initialState("work"), "todo");
  assert.equal(initialState("approve"), "awaiting_approval");
  assert.equal(initialState("review"), "in_review");
  assert.equal(initialState("answer"), "todo");
  assert.equal(initialState("unblock"), "todo");
  assert.equal(initialState("signature"), "doing");
  assert.equal(slotFill({ kind: "person", id: "usr_a" }), "human");
  assert.equal(slotFill({ kind: "agent", id: "agt_a" }), "agent");
  assert.equal(slotFill({ kind: "group", id: "grp_1" }), "group_or_role");
  assert.equal(slotFill({ kind: "role", id: "role_1" }), "group_or_role");
  assert.equal(slotFill({ kind: "automation", id: "aut_1" }), "automation");
});

test("the responsible person is the taker, the current human slot, or the creator", () => {
  const assignee = { kind: "person" as const, id: "usr_a" };
  assert.deepEqual(responsiblePerson(machine({ state: "todo", kind: "work", assigned: assignee, createdBy: "usr_a" })), { personId: "usr_a", via: "assignee" });
  assert.deepEqual(responsiblePerson(machine({
    state: "in_review", kind: "review", assigned: { kind: "agent", id: "agt_w" }, reviewer: { kind: "person", id: "usr_b" }, createdBy: "usr_a",
  })), { personId: "usr_b", via: "reviewer" });
  assert.deepEqual(responsiblePerson(machine({
    state: "awaiting_approval", kind: "approve", assigned: { kind: "agent", id: "agt_w" }, approver: { kind: "person", id: "usr_c" }, createdBy: "usr_a",
  })), { personId: "usr_c", via: "approver" });
  assert.deepEqual(responsiblePerson(machine({
    state: "in_review", kind: "review", assigned: { kind: "agent", id: "agt_w" }, reviewer: { kind: "person", id: "usr_b" }, takenBy: "usr_t", createdBy: "usr_a",
  })), { personId: "usr_t", via: "taken" });
  assert.deepEqual(responsiblePerson(machine({
    state: "todo", kind: "work", assigned: { kind: "agent", id: "agt_w" }, createdBy: "usr_a",
  })), { personId: "usr_a", via: "creator" });
  assert.deepEqual(responsiblePerson(machine({
    state: "todo", kind: "work", assigned: { kind: "group", id: "grp_1" }, createdBy: "agt_bot",
  })), { personId: null, via: "none" });
});

test("blocked is an open Unblock child or a dependency that is not Done", () => {
  assert.equal(isBlocked({ id: "a", dependsOn: ["missing"] }, []), true);
  assert.equal(isBlocked({ id: "a", dependsOn: ["b"] }, [{ id: "b", state: "todo", kind: "work", dependsOn: [] }]), true);
  assert.equal(isBlocked({ id: "a", dependsOn: ["b"] }, [{ id: "b", state: "canceled", kind: "work", dependsOn: [] }]), true);
  assert.equal(isBlocked({ id: "a", dependsOn: ["b"] }, [{ id: "b", state: "done", kind: "work", dependsOn: [] }]), false);
  const child = { id: "c", state: "todo" as const, kind: "unblock" as const, dependsOn: [] as string[], parentTaskId: "a" };
  assert.equal(isBlocked({ id: "a", dependsOn: [] }, [child]), true);
  assert.equal(isBlocked({ id: "a", dependsOn: [] }, [{ ...child, state: "done" }]), false);
  assert.equal(dependencyCycle([{ id: "a", dependsOn: [] }, { id: "b", dependsOn: [] }], "a", "a"), true);
  assert.equal(dependencyCycle([{ id: "a", dependsOn: [] }, { id: "b", dependsOn: ["a"] }], "a", "b"), true);
  assert.equal(dependencyCycle([{ id: "a", dependsOn: [] }, { id: "b", dependsOn: [] }], "a", "b"), false);
});

test("ARCH 4.7 edges: review, approval, reject, cancel, reopen, and complete", () => {
  const assignee = person("usr_a");
  const reviewer = person("usr_b");
  const approver = person("usr_c");
  let task = machine({
    state: "todo",
    kind: "work",
    assigned: { kind: "person", id: "usr_a" },
    reviewer: { kind: "person", id: "usr_b" },
    approver: { kind: "person", id: "usr_c" },
    createdBy: "usr_a",
  });
  const seen: TaskState[] = [task.state];
  const moved = (result: StepOk): void => {
    task = { ...task, state: result.to, reviewLoops: result.reviewLoops };
    seen.push(task.state);
  };
  moved(expectTo(task, "start", assignee, "doing"));
  moved(expectTo(task, "submit", assignee, "in_review"));
  const back = expectTo(task, "send_back", reviewer, "doing", DEFAULT_POLICY, "tighten the summary");
  assert.equal(back.reviewLoops, 1);
  moved(back);
  moved(expectTo(task, "submit", assignee, "in_review"));
  moved(expectTo(task, "approve", reviewer, "awaiting_approval"));
  moved(expectTo(task, "approve", approver, "done"));
  assert.deepEqual(seen, ["todo", "doing", "in_review", "doing", "in_review", "awaiting_approval", "done"]);
  const refused = step(task, "start", { actor: assignee, policy: DEFAULT_POLICY });
  assert.equal(refused.ok, false);
  assert.equal(task.state, "done");
  assert.equal(expectTo(task, "reopen", assignee, "todo").reviewLoops, 0);

  const waiting = machine({
    state: "awaiting_approval",
    kind: "approve",
    assigned: { kind: "agent", id: "agt_w" },
    approver: { kind: "person", id: "usr_c" },
    createdBy: "usr_a",
    reviewLoops: 1,
  });
  const rejected = expectTo(waiting, "reject", approver, "doing", DEFAULT_POLICY, "not yet");
  assert.equal(rejected.reviewLoops, 1);
  assert.equal(rejected.events.includes("task.sent_back"), false);
  expectNo(waiting, "reject", approver);

  let open = machine({ state: "doing", kind: "work", assigned: { kind: "person", id: "usr_a" }, createdBy: "usr_a", reviewLoops: 2 });
  const canceled = expectTo(open, "cancel", assignee, "canceled");
  assert.equal(canceled.reviewLoops, 2);
  open = { ...open, state: canceled.to, reviewLoops: canceled.reviewLoops };
  assert.equal(expectTo(open, "reopen", assignee, "todo").reviewLoops, 0);

  const plain = machine({ state: "doing", kind: "work", assigned: { kind: "person", id: "usr_a" }, createdBy: "usr_a" });
  assert.ok(expectTo(plain, "complete", assignee, "done").events.includes("task.completed"));
  expectNo(machine({
    state: "doing", kind: "work", assigned: { kind: "person", id: "usr_a" }, reviewer: { kind: "person", id: "usr_b" }, createdBy: "usr_a",
  }), "complete", assignee);
  expectNo(machine({
    state: "doing", kind: "work", assigned: { kind: "person", id: "usr_a" }, approver: { kind: "person", id: "usr_c" }, createdBy: "usr_a",
  }), "complete", assignee);
});

test("answer, unblock, and signature close on their own verbs", () => {
  const assignee = person("usr_a");
  const work = machine({ state: "todo", kind: "work", assigned: { kind: "person", id: "usr_a" }, createdBy: "usr_a" });
  expectNo(work, "answer", assignee);
  expectNo(work, "dismiss", assignee);
  expectNo(work, "resolved", assignee);
  expectNo(work, "cannot", assignee, DEFAULT_POLICY, "no");
  expectNo(work, "leap", assignee);
  expectNo(work, "", assignee);
  expectNo(work, "block", assignee);
  const answer = machine({
    state: "todo", kind: "answer", assigned: { kind: "person", id: "usr_a" }, reviewer: { kind: "person", id: "usr_b" }, createdBy: "usr_a",
  });
  expectTo(answer, "answer", assignee, "done");
  expectTo(answer, "dismiss", assignee, "canceled");
  const unblock = machine({ state: "todo", kind: "unblock", assigned: { kind: "person", id: "usr_a" }, createdBy: "usr_a" });
  expectNo(unblock, "cannot", assignee);
  expectTo(unblock, "cannot", assignee, "canceled", DEFAULT_POLICY, "the site is down");
  expectTo(unblock, "resolved", assignee, "done");
  const signature = machine({ state: "doing", kind: "signature", assigned: { kind: "person", id: "usr_a" }, createdBy: "usr_a" });
  expectTo(signature, "complete", assignee, "done");
});

test("self-review, the human approver floor, and the agent review loop", () => {
  const same = machine({
    state: "in_review", kind: "work", assigned: { kind: "person", id: "usr_a" }, reviewer: { kind: "person", id: "usr_a" }, createdBy: "usr_a",
  });
  expectNo(same, "send_back", person("usr_a"), DEFAULT_POLICY, "no");
  expectTo(same, "send_back", person("usr_a"), "doing", { ...DEFAULT_POLICY, allowSelfReview: true }, "ok");

  const floor: Policy = { ...DEFAULT_POLICY, requireHumanApprover: true };
  const waiting = machine({
    state: "awaiting_approval", kind: "approve", assigned: { kind: "agent", id: "agt_w" }, approver: { kind: "person", id: "usr_c" }, createdBy: "usr_a",
  });
  expectNo(waiting, "approve", { kind: "agent", id: "usr_c" }, floor);
  expectTo(waiting, "approve", person("usr_c"), "done", floor);
  expectNo(machine({
    state: "awaiting_approval", kind: "approve", assigned: { kind: "person", id: "usr_a" }, approver: { kind: "agent", id: "agt_p" }, createdBy: "usr_a",
  }), "approve", person("agt_p"), floor);

  let loops = 0;
  const agent: Actor = { kind: "agent", id: "agt_r" };
  const current = (): Machine => machine({
    state: "in_review", kind: "work", assigned: { kind: "person", id: "usr_a" }, reviewer: { kind: "agent", id: "agt_r" }, createdBy: "usr_a", reviewLoops: loops,
  });
  for (let i = 0; i < 2; i++) {
    const sent = expectTo(current(), "send_back", agent, "doing", DEFAULT_POLICY, "again");
    assert.equal(sent.reviewLoops, i + 1);
    loops = sent.reviewLoops;
  }
  expectNo(current(), "send_back", agent, DEFAULT_POLICY, "third");
  const decided = expectTo(current(), "send_back", person("agt_r"), "doing", DEFAULT_POLICY, "a person decides");
  assert.equal(decided.reviewLoops, 3);
  const human = machine({
    state: "in_review", kind: "work", assigned: { kind: "person", id: "usr_a" }, reviewer: { kind: "person", id: "usr_b" }, createdBy: "usr_a", reviewLoops: 2,
  });
  assert.equal(expectTo(human, "send_back", person("usr_b"), "doing", DEFAULT_POLICY, "still open").reviewLoops, 3);
});

test("the first act on a group slot locks it", () => {
  const group = machine({ state: "todo", kind: "work", assigned: { kind: "group", id: "grp_1" }, createdBy: "usr_a" });
  const moved = expectTo(group, "start", person("usr_taker"), "doing");
  assert.equal(moved.takenBy, "usr_taker");
  assert.ok(moved.events.includes("task.handled"));
});

test("tasks.transition names the same destination step() reaches", () => {
  for (const state of TASK_STATES) {
    assert.equal(actionForTarget(machine({ state, kind: "work", assigned: { kind: "person", id: "usr_a" }, createdBy: "usr_a" }), state), null);
  }
  const reviewer: Party = { kind: "person", id: "usr_b" };
  const approver: Party = { kind: "person", id: "usr_c" };
  const at = (state: TaskState, slots: { reviewer?: Party; approver?: Party }): Machine => machine({
    state,
    kind: "work",
    assigned: { kind: "person", id: "usr_a" },
    createdBy: "usr_a",
    ...(slots.reviewer ? { reviewer: slots.reviewer } : {}),
    ...(slots.approver ? { approver: slots.approver } : {}),
  });
  const agree = (task: Machine): void => {
    for (const to of TASK_STATES) {
      const action = actionForTarget(task, to);
      if (action === null) continue;
      const result = step(task, action, { actor: holder(task, action), policy: DEFAULT_POLICY, note: "noted" });
      if (!result.ok) assert.fail(`${task.state} ${action} -> ${to}: ${result.reason}`);
      assert.equal(result.to, to);
    }
  };
  for (const state of ["todo", "doing", "in_review", "awaiting_approval", "done", "canceled"] as const) agree(at(state, { reviewer, approver }));
  for (const state of ["todo", "doing", "done", "canceled"] as const) agree(at(state, {}));
  for (const state of ["todo", "doing", "in_review", "done", "canceled"] as const) agree(at(state, { reviewer }));
  for (const state of ["todo", "doing", "awaiting_approval", "done", "canceled"] as const) agree(at(state, { approver }));
});

test("random event sequences never take an edge outside the table", () => {
  const rng = mulberry32(0x4C365F01);
  let sequences = 0;
  let steps = 0;
  for (let s = 0; s < 80; s++) {
    sequences += 1;
    const made = randomMachine(rng);
    let task = made.task;
    for (let n = 0; n < 16; n++) {
      const action = pick(rng, TRANSITION_ACTIONS);
      const actor = rng() < 0.15 ? person("usr_stranger") : holder(task, action);
      task = apply(task, action, actor, made.policy);
      steps += 1;
    }
  }
  assert.equal(sequences, 80);
  assert.equal(steps, 80 * 16);
});

test("every state and action either stays put or lands on a legal edge", () => {
  let grid = 0;
  for (const kind of TASK_KINDS) {
    for (const state of TASK_STATES) {
      for (const action of TRANSITION_ACTIONS) {
        const task = machine({
          state,
          kind,
          assigned: { kind: "person", id: "usr_a" },
          reviewer: { kind: "person", id: "usr_b" },
          approver: { kind: "person", id: "usr_c" },
          createdBy: "usr_a",
        });
        apply(task, action, holder(task, action), DEFAULT_POLICY);
        grid += 1;
      }
    }
  }
  assert.equal(grid, TASK_KINDS.length * TASK_STATES.length * TRANSITION_ACTIONS.length);
  assert.equal(TASK_KINDS.length, 6);
  assert.equal(TASK_STATES.length, 6);
  assert.equal(TRANSITION_ACTIONS.length, 12);
});
