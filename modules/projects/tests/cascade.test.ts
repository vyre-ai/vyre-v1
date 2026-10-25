// Projects: the cascade (spec 3.4). A slip proposes which later tasks move and which dates hold; a person applies it or keeps the dates; nothing moves without that.
import test from "node:test";
import assert from "node:assert/strict";
import { DAY, NOW, BOT, DANA, harness, codeOf, reasonOf } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";
import { key, mkChain, mkProject, run } from "../fixtures/seed.ts";
import { planCascade } from "../impl.ts";

async function refused(p: Promise<unknown>, code: string, reason?: string): Promise<void> {
  await assert.rejects(p, (e) => { assert.equal(codeOf(e), code); if (reason) assert.equal(reasonOf(e), reason); return true; });
}
const dueOf = (h: Harness, id: string): number | undefined => h.world.tasks.get(id)?.due;
const startOf = (h: Harness, id: string): unknown => h.rows("SELECT start FROM projects_plan WHERE taskId = ?", id)[0]?.["start"];
const d = (n: number): number => n * DAY;
const task = (taskId: string, title: string, start: number | undefined, due: number | undefined, state: "todo" | "doing" | "done" | "canceled" = "todo") => ({ taskId, title, state, start, due });

// ---- the arithmetic ----

test("the tasks after the one that slipped move by the gap and keep their length, in order", () => {
  const tasks = [task("a", "A", d(1), d(3)), task("b", "B", d(3), d(5)), task("c", "C", d(5), d(8))];
  const plan = planCascade(tasks, [{ from: "a", to: "b" }, { from: "b", to: "c" }], { taskId: "a", due: d(5) });
  assert.deepEqual(plan.moves, [
    { taskId: "b", fromStart: d(3), toStart: d(5), fromDue: d(5), toDue: d(7) },
    { taskId: "c", fromStart: d(5), toStart: d(7), fromDue: d(8), toDue: d(10) },
  ]);
  assert.deepEqual(plan.holds, []);
  assert.equal(plan.summary, "2 later tasks move");
});

test("a later task with room to spare holds, and the summary names it", () => {
  const tasks = [task("a", "A", d(0), d(2)), task("b", "B", d(2), d(4)), task("t", "the Tuesday consult", d(10), d(11))];
  const plan = planCascade(tasks, [{ from: "a", to: "b" }, { from: "a", to: "t" }], { taskId: "a", due: d(3) });
  assert.deepEqual(plan.moves, [{ taskId: "b", fromStart: d(2), toStart: d(3), fromDue: d(4), toDue: d(5) }]);
  assert.deepEqual(plan.holds, [{ taskId: "t", reason: "Starts after A ends" }]);
  assert.equal(plan.summary, "1 later task moves, the Tuesday consult still holds");
});

test("several that hold are counted; done, canceled and undated tasks hold without being named", () => {
  const tasks = [
    task("a", "A", d(0), d(2)), task("x", "X", d(9), d(10)), task("y", "Y", d(9), d(10)), task("m", "M", d(2), d(3)),
    task("done", "Done", d(2), d(3), "done"), task("gone", "Gone", d(2), d(3), "canceled"), task("blank", "Blank", undefined, undefined),
  ];
  const links = ["x", "y", "m", "done", "gone", "blank"].map((to) => ({ from: "a", to }));
  const plan = planCascade(tasks, links, { taskId: "a", due: d(4) });
  assert.deepEqual(plan.moves.map((m) => m.taskId), ["m"]);
  assert.deepEqual(Object.fromEntries(plan.holds.map((h) => [h.taskId, h.reason])), {
    x: "Starts after A ends", y: "Starts after A ends", done: "Already done", gone: "Canceled", blank: "Has no dates yet",
  });
  assert.equal(plan.summary, "1 later task moves, 2 still hold");
});

test("a task that waits on two moves once, by the later of the two", () => {
  const tasks = [task("a", "A", d(0), d(2)), task("b", "B", d(2), d(3)), task("c", "C", d(2), d(6)), task("e", "E", d(6), d(7))];
  const links = [{ from: "a", to: "b" }, { from: "a", to: "c" }, { from: "b", to: "e" }, { from: "c", to: "e" }];
  const plan = planCascade(tasks, links, { taskId: "a", due: d(4) });
  const e = plan.moves.filter((m) => m.taskId === "e");
  assert.equal(e.length, 1);
  assert.equal(e[0]?.toStart, d(8), "C ends at day 8 after its own move of 2 days");
  assert.equal(plan.moves.length, 3);
});

test("moving a task earlier moves nothing; a change to a task nobody waits on moves nothing", () => {
  const tasks = [task("a", "A", d(0), d(2)), task("b", "B", d(2), d(4))];
  const earlier = planCascade(tasks, [{ from: "a", to: "b" }], { taskId: "a", due: d(1) });
  assert.deepEqual(earlier.moves, []);
  assert.equal(earlier.summary, "No later tasks move");
  const lone = planCascade(tasks, [], { taskId: "b", due: d(9) });
  assert.deepEqual(lone, { moves: [], holds: [], summary: "No later tasks move" });
  assert.deepEqual(planCascade(tasks, [], { taskId: "zzz", due: d(9) }).moves, [], "an unknown task is nothing to plan");
});

test("planning changes nothing it was given and gives the same answer every time", () => {
  const tasks = [task("a", "A", d(1), d(3)), task("b", "B", d(3), d(5)), task("c", "C", d(5), d(8))];
  const links = [{ from: "a", to: "b" }, { from: "b", to: "c" }];
  const copy = JSON.stringify({ tasks, links });
  const one = planCascade(tasks, links, { taskId: "a", due: d(6) });
  const two = planCascade(tasks, links, { taskId: "a", due: d(6) });
  assert.deepEqual(one, two);
  assert.equal(JSON.stringify({ tasks, links }), copy);
});

// ---- projects.cascade ----

test("cascade proposes and moves nothing: not the task, not the ones after it", async () => {
  const h = harness();
  const { p, a, b, c } = await mkChain(h);
  const out = await run(h, "projects.cascade", { projectId: p.projectId, taskId: a, due: NOW + 5 * DAY });
  assert.match(out.proposalId, /^csc_[a-z0-9]+$/);
  assert.equal(out.summary, "2 later tasks move");
  assert.deepEqual(out.moves.map((m: { taskId: string }) => m.taskId), [b, c]);
  assert.equal(dueOf(h, a), NOW + 3 * DAY);
  assert.equal(dueOf(h, b), NOW + 5 * DAY);
  assert.equal(dueOf(h, c), NOW + 8 * DAY);
  assert.equal(h.only("tasks.update").length, 0, "no task was written");
  assert.deepEqual(h.named("project.cascade_proposed").map((e) => e.payload), [{ projectId: p.projectId, proposalId: out.proposalId, moves: 2, by: DANA }]);
  assert.equal(h.rows("SELECT state FROM projects_proposal WHERE proposalId = ?", out.proposalId)[0]?.["state"], "open");
});

test("an agent may propose the same cascade", async () => {
  const h = harness();
  const { p, a } = await mkChain(h);
  const out = await run(h, "projects.cascade", { projectId: p.projectId, taskId: a, due: NOW + 5 * DAY }, h.agent(BOT, DANA));
  assert.equal(out.moves.length, 2);
  assert.equal(h.named("project.cascade_proposed")[0]?.payload["by"], DANA, "recorded as the person the agent acts for");
});

test("cascade needs a new date, a date that makes sense, and a task of this project", async () => {
  const h = harness();
  const { p, a } = await mkChain(h);
  await refused(run(h, "projects.cascade", { projectId: p.projectId, taskId: a }), "validation.bad_input");
  await refused(run(h, "projects.cascade", { projectId: p.projectId, taskId: a, start: NOW + 9 * DAY }), "validation.bad_input");
  await refused(run(h, "projects.cascade", { projectId: p.projectId, taskId: "tsk_none", due: NOW }), "validation.not_found");
  const other = await mkProject(h, { title: "Other" });
  await refused(run(h, "projects.cascade", { projectId: other.projectId, taskId: a, due: NOW }), "validation.not_found");
});

// ---- projects.apply_cascade ----

async function slipped(h: Harness) {
  const chain = await mkChain(h);
  const out = await run(h, "projects.reschedule", { projectId: chain.p.projectId, taskId: chain.a, due: NOW + 5 * DAY });
  h.clear();
  return { ...chain, proposalId: out.proposalId as string };
}

test("a cascade proposal never applies without approval: the slip alone moves only the task that slipped", async () => {
  const h = harness();
  const { b, c, a } = await slipped(h);
  assert.equal(dueOf(h, a), NOW + 5 * DAY);
  assert.equal(dueOf(h, b), NOW + 5 * DAY);
  assert.equal(dueOf(h, c), NOW + 8 * DAY);
  assert.equal(startOf(h, b), NOW + 3 * DAY);
  assert.equal(h.rows("SELECT state FROM projects_proposal")[0]?.["state"], "open", "it waits for a person");
});

test("a person applies the proposal: the later tasks move, in Tasks and in the plan, and the proposal is settled", async () => {
  const h = harness();
  const { p, b, c, proposalId } = await slipped(h);
  assert.deepEqual(await run(h, "projects.apply_cascade", { projectId: p.projectId, proposalId, decision: "apply" }), { moved: 2 });
  assert.equal(dueOf(h, b), NOW + 7 * DAY);
  assert.equal(dueOf(h, c), NOW + 10 * DAY);
  assert.equal(startOf(h, b), NOW + 5 * DAY);
  assert.equal(startOf(h, c), NOW + 7 * DAY);
  assert.deepEqual(h.named("project.cascade_applied").map((e) => e.payload), [{ projectId: p.projectId, proposalId, moved: 2 }]);
  assert.equal(h.rows("SELECT state FROM projects_proposal WHERE proposalId = ?", proposalId)[0]?.["state"], "applied");
  await refused(run(h, "projects.apply_cascade", { projectId: p.projectId, proposalId, decision: "apply" }), "validation.precondition_failed", "already_resolved");
  await refused(run(h, "projects.apply_cascade", { projectId: p.projectId, proposalId, decision: "keep" }), "validation.precondition_failed", "already_resolved");
});

test("the same key gives the same answer and moves nothing twice", async () => {
  const h = harness();
  const { p, proposalId } = await slipped(h);
  const k = key();
  const one = await run(h, "projects.apply_cascade", { projectId: p.projectId, proposalId, decision: "apply", idempotencyKey: k });
  const calls = h.only("tasks.update").length;
  const two = await run(h, "projects.apply_cascade", { projectId: p.projectId, proposalId, decision: "apply", idempotencyKey: k });
  assert.deepEqual(two, one);
  assert.equal(h.only("tasks.update").length, calls);
  assert.equal(h.named("project.cascade_applied").length, 1);
});

test("an agent or an automation cannot apply: it waits for a person", async () => {
  const h = harness();
  const { p, b, c, proposalId } = await slipped(h);
  await refused(run(h, "projects.apply_cascade", { projectId: p.projectId, proposalId, decision: "apply" }, h.agent(BOT, DANA)), "permission.no_grant", "person_applies");
  await refused(run(h, "projects.apply_cascade", { projectId: p.projectId, proposalId, decision: "apply" }, h.as({ kind: "service", id: "svc_engine" })), "permission.no_grant", "person_applies");
  assert.equal(dueOf(h, b), NOW + 5 * DAY);
  assert.equal(dueOf(h, c), NOW + 8 * DAY);
  assert.equal(h.rows("SELECT state FROM projects_proposal")[0]?.["state"], "open", "still open for a person");
  assert.equal(h.named("project.cascade_applied").length, 0);
});

test("keep dates settles the proposal and moves nothing", async () => {
  const h = harness();
  const { p, b, c, proposalId } = await slipped(h);
  assert.deepEqual(await run(h, "projects.apply_cascade", { projectId: p.projectId, proposalId, decision: "keep" }), { moved: 0 });
  assert.equal(dueOf(h, b), NOW + 5 * DAY);
  assert.equal(dueOf(h, c), NOW + 8 * DAY);
  assert.deepEqual(h.names(), ["project.dates_kept"]);
  assert.equal(h.only("tasks.update").length, 0);
});

test("a proposal goes stale when the plan changed under it: nothing moves", async () => {
  const h = harness();
  const { p, b, c, proposalId } = await slipped(h);
  h.world.tasks.get(b)!.due = NOW + 6 * DAY;   // someone moved B in Tasks after the proposal
  await refused(run(h, "projects.apply_cascade", { projectId: p.projectId, proposalId, decision: "apply" }), "validation.precondition_failed", "stale_proposal");
  assert.equal(dueOf(h, b), NOW + 6 * DAY);
  assert.equal(dueOf(h, c), NOW + 8 * DAY);
  assert.equal(h.only("tasks.update").length, 0);
});

test("a proposal that does not exist, or belongs to another project, is not found", async () => {
  const h = harness();
  const { p, proposalId } = await slipped(h);
  const other = await mkProject(h, { title: "Other" });
  await refused(run(h, "projects.apply_cascade", { projectId: p.projectId, proposalId: "csc_none", decision: "apply" }), "validation.not_found");
  await refused(run(h, "projects.apply_cascade", { projectId: other.projectId, proposalId, decision: "apply" }), "validation.not_found");
});
