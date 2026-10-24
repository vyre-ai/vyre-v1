// State-machine property test (ARCH 4.7): across random sequences of transitions by random people, no illegal transition is ever accepted and every legal one lands
// where the table says. The oracle below is written out from the table in ARCH 4.7, separate from planMove, so the two can disagree.
import test from "node:test";
import assert from "node:assert/strict";
import { harness, codeOf } from "../fixtures/db.ts";
import { alice, bob, cara, owner, newTask } from "../fixtures/seed.ts";
import { planMove, submitTarget, afterReview } from "../handlers/state.ts";
import type { TaskState } from "../projections.ts";

const STATES: TaskState[] = ["todo", "doing", "in_review", "awaiting_approval", "done", "canceled"];
const OPEN = (s: TaskState): boolean => s !== "done" && s !== "canceled";

function rng(seed: number) {
  let a = (seed * 2654435761) >>> 0;
  const next = (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (n: number): number => Math.floor(next() * n);
  return { int, pick: <T>(xs: readonly T[]): T => xs[int(xs.length)]!, chance: (p: number): boolean => next() < p };
}

interface Cfg { assigned: string; creator: string; reviewer?: string; approver?: string }

/** What the table of 4.7 allows. Returns the next state, or null when the move is illegal for this actor. */
function oracle(cfg: Cfg, from: TaskState, to: TaskState, actor: string, note: string | undefined): TaskState | null {
  const isAssigned = actor === cfg.assigned, isReviewer = actor === cfg.reviewer, isApprover = actor === cfg.approver, isCreator = actor === cfg.creator;
  if (from === to) return null;
  if (to === "canceled") return OPEN(from) && (isAssigned || isReviewer || isApprover || isCreator) ? "canceled" : null;
  if (!OPEN(from)) return to === "todo" && (isAssigned || isCreator) ? "todo" : null;
  if (from === "todo" || from === "doing") {
    if (to === "doing") return from === "todo" && isAssigned ? "doing" : null;
    const target: TaskState = cfg.reviewer ? "in_review" : cfg.approver ? "awaiting_approval" : "done";
    return to === target && isAssigned ? target : null;
  }
  if (from === "in_review") {
    if (to === "doing") return isReviewer && note ? "doing" : null;
    const after: TaskState = cfg.approver ? "awaiting_approval" : "done";
    return to === after && isReviewer ? after : null;
  }
  // awaiting_approval
  if (to === "done") return isApprover ? "done" : null;
  if (to === "doing") return isApprover && note ? "doing" : null;
  return null;
}

test("planMove allows exactly the edges of the table, for every reviewer and approver combination", () => {
  for (const hasReviewer of [false, true]) for (const hasApprover of [false, true]) {
    const slots = { ...(hasReviewer ? { reviewer: bob } : {}), ...(hasApprover ? { approver: cara } : {}) };
    const submit: TaskState = hasReviewer ? "in_review" : hasApprover ? "awaiting_approval" : "done";
    const after: TaskState = hasApprover ? "awaiting_approval" : "done";
    assert.equal(submitTarget(slots), submit);
    assert.equal(afterReview(slots), after);
    const expected = new Set<string>([
      "todo>doing", `todo>${submit}`, `doing>${submit}`, "in_review>doing", `in_review>${after}`, "awaiting_approval>done", "awaiting_approval>doing",
      "todo>canceled", "doing>canceled", "in_review>canceled", "awaiting_approval>canceled", "done>todo", "canceled>todo",
    ]);
    const got = new Set<string>();
    for (const from of STATES) for (const to of STATES) if (planMove({ state: from, ...slots }, to).ok) got.add(`${from}>${to}`);
    assert.deepEqual([...got].sort(), [...expected].sort(), `reviewer ${hasReviewer} approver ${hasApprover}`);
  }
});

test("random event sequences never reach a state the table forbids", async () => {
  const people = [alice, bob, cara, owner, { kind: "person" as const, id: "usr_dave" }];
  for (let seed = 1; seed <= 80; seed++) {
    const r = rng(seed);
    const h = harness();
    const hasReviewer = seed % 4 === 1 || seed % 4 === 2, hasApprover = seed % 4 === 2 || seed % 4 === 3;
    const cfg: Cfg = { assigned: alice.id, creator: owner.id, ...(hasReviewer ? { reviewer: bob.id } : {}), ...(hasApprover ? { approver: cara.id } : {}) };
    const made = await h.call("tasks.create", newTask({ ...(hasReviewer ? { reviewer: bob } : {}), ...(hasApprover ? { approver: cara } : {}) }), { id: owner.id });
    const taskId = made.task.id as string;
    let state: TaskState = made.task.state;
    let loops = 0;
    assert.equal(state, "todo");
    for (let step = 0; step < 30; step++) {
      const to = r.pick(STATES), actor = r.pick(people), note = r.chance(0.5) ? "because" : undefined;
      const want = oracle(cfg, state, to, actor.id, note);
      const label = `seed ${seed} step ${step}: ${state} to ${to} by ${actor.id}${note ? " with note" : ""}`;
      let res: { task: { state: TaskState; reviewLoops: number } } | undefined;
      try { res = await h.call("tasks.transition", { taskId, to, ...(note ? { note } : {}) }, { id: actor.id }); }
      catch (e) { assert.equal(codeOf(e), "validation.precondition_failed", `${label}: refused with the wrong code`); }
      if (want === null) {
        assert.equal(res, undefined, `${label}: the table forbids it`);
        assert.equal(h.events.length, 0, `${label}: a refused move emits nothing`);
      } else {
        assert.ok(res, `${label}: the table allows it`);
        assert.equal(res.task.state, want, label);
        const names = h.events.map((e) => e.name);
        assert.equal(names[0], "task.transitioned", label);
        assert.equal(h.events[0]!.payload.from, state, label);
        assert.equal(h.events[0]!.payload.to, want, label);
        assert.equal(names.includes("task.completed"), want === "done", label);
        assert.equal(names.includes("task.sent_back"), state === "in_review" && want === "doing", label);
        assert.equal(names.includes("task.rejected"), state === "awaiting_approval" && want === "doing", label);
        assert.equal(names.includes("task.approved"), (state === "in_review" && want !== "doing" && want !== "canceled") || (state === "awaiting_approval" && want === "done"), label);
        if (state === "in_review" && want === "doing") loops += 1;
        if (state !== "todo" && want === "todo") loops = 0;   // reopen starts the loops again
        state = want;
      }
      const now = (await h.call("tasks.get", { taskId }, { id: owner.id })).task;
      assert.equal(now.state, state, `${label}: the stored status is what the table says`);
      assert.equal(now.reviewLoops, loops, `${label}: review loops`);
    }
  }
});

test("a stale expectedFrom is refused and changes nothing", async () => {
  const h = harness();
  const made = await h.call("tasks.create", newTask(), { id: owner.id });
  await assert.rejects(() => h.call("tasks.transition", { taskId: made.task.id, to: "doing", expectedFrom: "doing" }, { id: alice.id }), (e) => codeOf(e) === "validation.precondition_failed");
  const ok = await h.call("tasks.transition", { taskId: made.task.id, to: "doing", expectedFrom: "todo" }, { id: alice.id });
  assert.equal(ok.task.state, "doing");
});

// P-H_02 final run: this file shows its own ok line in the run on the last commit.
