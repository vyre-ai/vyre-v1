// Projects: the plan (spec 3.4). The payload for Timeline, Board, List and Calendar, bars moved and resized, arrows made and removed, stages, and the task thread. Dates respect dependencies.
import test from "node:test";
import assert from "node:assert/strict";
import { DAY, NOW, harness, codeOf, reasonOf } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";
import { mkChain, mkProject, run } from "../fixtures/seed.ts";
import { planCascade } from "../impl.ts";

async function refused(p: Promise<unknown>, code: string, reason?: string): Promise<void> {
  await assert.rejects(p, (e) => { assert.equal(codeOf(e), code); if (reason) assert.equal(reasonOf(e), reason); return true; });
}
const dueOf = (h: Harness, id: string): number | undefined => h.world.tasks.get(id)?.due;

// ---- projects.plan ----

test("plan carries stages, tasks with who is on them and the ring, milestones, arrows and a today marker", async () => {
  const h = harness();
  const p = await mkProject(h);
  await run(h, "projects.stages.set", { projectId: p.projectId, stages: [{ title: "Draft" }, { title: "Review" }] });
  const a = h.task(p, { title: "Write brief", start: NOW + DAY, due: NOW + 3 * DAY, stage: "draft", assigned: "usr_maya" });
  const b = h.task(p, { title: "Counsel signs", start: NOW + 4 * DAY, due: NOW + 4 * DAY, stage: "review", state: "awaiting_approval", assigned: "agt_helper" });
  const c = h.task(p, { title: "Looking at it", state: "in_review", stage: "review" });
  await run(h, "projects.link_tasks", { projectId: p.projectId, fromTaskId: a, toTaskId: b });
  const out = await run(h, "projects.plan", { projectId: p.projectId });
  assert.deepEqual(out.stages, [{ key: "draft", title: "Draft", order: 0 }, { key: "review", title: "Review", order: 1 }]);
  assert.equal(out.today, NOW);
  assert.deepEqual(out.links, [{ from: a, to: b }]);
  const byId = Object.fromEntries(out.tasks.map((t: { taskId: string }) => [t.taskId, t]));
  assert.equal(byId[a].assigned, "usr_maya");
  assert.equal(byId[a].milestone, false);
  assert.equal(byId[a].stage, "draft");
  assert.equal(byId[a].start, NOW + DAY);
  assert.equal(byId[a].ring, undefined);
  assert.equal(byId[b].milestone, true, "start equals due: a diamond");
  assert.equal(byId[b].ring, "approval");
  assert.equal(byId[c].ring, "review");
  assert.equal(byId[c].start, undefined);
  assert.deepEqual(out.tasks.map((t: { taskId: string }) => t.taskId), [a, b, c], "dated tasks in date order, undated last");
});

test("plan filters by stage and by who is on the task, and shows an arrow only when both ends are in view", async () => {
  const h = harness();
  const p = await mkProject(h);
  await run(h, "projects.stages.set", { projectId: p.projectId, stages: [{ title: "Draft" }, { title: "Review" }] });
  const a = h.task(p, { title: "A", stage: "draft", assigned: "usr_maya", due: NOW + DAY });
  const b = h.task(p, { title: "B", stage: "review", assigned: "usr_leo", due: NOW + 2 * DAY });
  await run(h, "projects.link_tasks", { projectId: p.projectId, fromTaskId: a, toTaskId: b });
  const draft = await run(h, "projects.plan", { projectId: p.projectId, stage: "draft" });
  assert.deepEqual(draft.tasks.map((t: { taskId: string }) => t.taskId), [a]);
  assert.deepEqual(draft.links, []);
  const leo = await run(h, "projects.plan", { projectId: p.projectId, assigned: "usr_leo" });
  assert.deepEqual(leo.tasks.map((t: { taskId: string }) => t.taskId), [b]);
  const both = await run(h, "projects.plan", { projectId: p.projectId });
  assert.equal(both.links.length, 1);
});

test("a project nobody can see, or that does not exist, answers the same way", async () => {
  const h = harness();
  const p = await mkProject(h);
  await refused(run(h, "projects.plan", { projectId: "prj_nope" }), "validation.not_found");
  h.allowOnly(() => false);
  await refused(run(h, "projects.plan", { projectId: p.projectId }), "validation.not_found");
});

// ---- reschedule ----

test("reschedule writes the due date to the task and the start to the plan, and says what it did", async () => {
  const h = harness();
  const p = await mkProject(h);
  const a = h.task(p, { title: "Brief", start: NOW + DAY, due: NOW + 3 * DAY });
  const out = await run(h, "projects.reschedule", { projectId: p.projectId, taskId: a, start: NOW + 2 * DAY, due: NOW + 2 * DAY });
  assert.deepEqual(out, { taskId: a, start: NOW + 2 * DAY, due: NOW + 2 * DAY });
  assert.equal(dueOf(h, a), NOW + 2 * DAY);
  assert.equal(h.rows("SELECT start FROM projects_plan WHERE taskId = ?", a)[0]?.["start"], NOW + 2 * DAY);
  assert.deepEqual(h.named("project.task_rescheduled").map((e) => e.payload), [{ projectId: p.projectId, taskId: a, start: NOW + 2 * DAY, due: NOW + 2 * DAY, slipped: false }]);
  assert.equal(h.only("tasks.update").length, 1);
});

test("a task cannot start after it is due, and the stage must exist", async () => {
  const h = harness();
  const p = await mkProject(h);
  const a = h.task(p, { title: "Brief", start: NOW, due: NOW + DAY });
  h.clear();
  await refused(run(h, "projects.reschedule", { projectId: p.projectId, taskId: a, start: NOW + 5 * DAY }), "validation.bad_input");
  await refused(run(h, "projects.reschedule", { projectId: p.projectId, taskId: a, stage: "nowhere" }), "validation.bad_input");
  assert.equal(h.only("tasks.update").length, 0, "nothing was written");
  assert.equal(h.emitted.length, 0);
});

test("a task of another project, or no task, is not found", async () => {
  const h = harness();
  const p = await mkProject(h);
  const q = await mkProject(h, { title: "Other" });
  const foreign = h.task(q, { title: "Not ours", due: NOW });
  await refused(run(h, "projects.reschedule", { projectId: p.projectId, taskId: foreign, due: NOW + DAY }), "validation.not_found");
  await refused(run(h, "projects.reschedule", { projectId: p.projectId, taskId: "tsk_none", due: NOW + DAY }), "validation.not_found");
});

test("a slip proposes the cascade and moves nothing else; moving earlier proposes nothing", async () => {
  const h = harness();
  const { p, a, b, c } = await mkChain(h);
  const out = await run(h, "projects.reschedule", { projectId: p.projectId, taskId: a, due: NOW + 5 * DAY });
  assert.match(out.proposalId, /^csc_[a-z0-9]+$/);
  assert.equal(dueOf(h, a), NOW + 5 * DAY);
  assert.equal(dueOf(h, b), NOW + 5 * DAY, "B did not move");
  assert.equal(dueOf(h, c), NOW + 8 * DAY, "C did not move");
  assert.deepEqual(h.names(), ["project.cascade_proposed", "project.task_rescheduled"]);
  assert.deepEqual(h.named("project.cascade_proposed")[0]?.payload, { projectId: p.projectId, proposalId: out.proposalId, moves: 2, by: "usr_dana" });
  assert.equal(h.named("project.task_rescheduled")[0]?.payload["slipped"], true);
  h.clear();
  const early = await run(h, "projects.reschedule", { projectId: p.projectId, taskId: a, due: NOW + 2 * DAY });
  assert.equal(early.proposalId, undefined);
  assert.deepEqual(h.names(), ["project.task_rescheduled"]);
});

test("a slip that moves nothing later makes no proposal", async () => {
  const h = harness();
  const p = await mkProject(h);
  const a = h.task(p, { title: "Alone", start: NOW, due: NOW + DAY });
  const slack = h.task(p, { title: "Plenty of time", start: NOW + 30 * DAY, due: NOW + 31 * DAY });
  await run(h, "projects.link_tasks", { projectId: p.projectId, fromTaskId: a, toTaskId: slack });
  h.clear();
  const out = await run(h, "projects.reschedule", { projectId: p.projectId, taskId: a, due: NOW + 2 * DAY });
  assert.equal(out.proposalId, undefined);
  assert.equal(h.rows("SELECT * FROM projects_proposal").length, 0);
  assert.deepEqual(h.names(), ["project.task_rescheduled"]);
});

// ---- arrows ----

test("link_tasks makes the arrow in the plan and in Tasks, once, and says so", async () => {
  const h = harness();
  const p = await mkProject(h);
  const a = h.task(p, { title: "A" });
  const b = h.task(p, { title: "B" });
  h.clear();
  assert.deepEqual(await run(h, "projects.link_tasks", { projectId: p.projectId, fromTaskId: a, toTaskId: b }), { ok: true });
  assert.deepEqual(h.only("tasks.dependencies.add")[0]?.input, { taskId: b, dependsOnId: a }, "B waits on A");
  assert.deepEqual(h.world.tasks.get(b)?.dependsOn, [a]);
  assert.deepEqual(h.named("project.tasks_linked").map((e) => e.payload), [{ projectId: p.projectId, fromTaskId: a, toTaskId: b }]);
  await run(h, "projects.link_tasks", { projectId: p.projectId, fromTaskId: a, toTaskId: b });
  assert.equal(h.named("project.tasks_linked").length, 1, "the same arrow again says nothing");
});

test("an arrow cannot point at itself, close a loop, or reach a task outside the project", async () => {
  const h = harness();
  const { p, a, c } = await mkChain(h);
  const q = await mkProject(h, { title: "Other" });
  const foreign = h.task(q, { title: "Elsewhere" });
  await refused(run(h, "projects.link_tasks", { projectId: p.projectId, fromTaskId: a, toTaskId: a }), "validation.precondition_failed", "self_link");
  await refused(run(h, "projects.link_tasks", { projectId: p.projectId, fromTaskId: c, toTaskId: a }), "validation.precondition_failed", "loop");
  await refused(run(h, "projects.link_tasks", { projectId: p.projectId, fromTaskId: a, toTaskId: foreign }), "validation.not_found");
});

test("unlink_tasks removes the arrow; one that is not there changes nothing", async () => {
  const h = harness();
  const { p, a, b } = await mkChain(h);
  h.world.tasks.get(b)!.dependsOn.push(a);
  assert.deepEqual(await run(h, "projects.unlink_tasks", { projectId: p.projectId, fromTaskId: a, toTaskId: b }), { ok: true });
  assert.deepEqual(h.world.tasks.get(b)?.dependsOn, []);
  assert.equal(h.named("project.tasks_unlinked").length, 1);
  h.clear();
  assert.deepEqual(await run(h, "projects.unlink_tasks", { projectId: p.projectId, fromTaskId: a, toTaskId: b }), { ok: false });
  assert.equal(h.emitted.length, 0);
});

// ---- stages ----

test("stages are made from titles, renamed by key, reordered, and mirrored to the record", async () => {
  const h = harness();
  const p = await mkProject(h);
  const made = await run(h, "projects.stages.set", { projectId: p.projectId, stages: [{ title: "Draft" }, { title: "Client review" }, { title: "Draft" }] });
  assert.deepEqual(made.stages.map((s: { key: string }) => s.key), ["draft", "client_review", "draft_2"]);
  assert.deepEqual(h.world.records.get(p.recordId)?.fields["stages"], ["draft", "client_review", "draft_2"]);
  const again = await run(h, "projects.stages.set", { projectId: p.projectId, stages: [{ key: "client_review", title: "Client sign-off" }, { key: "draft", title: "Draft" }, { key: "draft_2", title: "Draft again" }] });
  assert.deepEqual(again.stages, [{ key: "client_review", title: "Client sign-off", order: 0 }, { key: "draft", title: "Draft", order: 1 }, { key: "draft_2", title: "Draft again", order: 2 }]);
  assert.deepEqual(h.named("project.stages_changed").map((e) => e.payload["stages"]), [["draft", "client_review", "draft_2"], ["client_review", "draft", "draft_2"]]);
});

test("a stage with tasks in it cannot be removed until they move; two stages cannot share a key", async () => {
  const h = harness();
  const p = await mkProject(h);
  await run(h, "projects.stages.set", { projectId: p.projectId, stages: [{ title: "Draft" }, { title: "Review" }] });
  const t = h.task(p, { title: "In review", stage: "review" });
  await refused(run(h, "projects.stages.set", { projectId: p.projectId, stages: [{ key: "draft", title: "Draft" }] }), "validation.precondition_failed", "stage_in_use");
  await refused(run(h, "projects.stages.set", { projectId: p.projectId, stages: [{ key: "x", title: "One" }, { key: "x", title: "Two" }] }), "validation.bad_input");
  await refused(run(h, "projects.stages.set", { projectId: p.projectId, stages: [{ key: "Bad Key", title: "One" }] }), "validation.bad_input");
  await run(h, "projects.reschedule", { projectId: p.projectId, taskId: t, stage: "draft" });
  const out = await run(h, "projects.stages.set", { projectId: p.projectId, stages: [{ key: "draft", title: "Draft" }] });
  assert.deepEqual(out.stages.map((s: { key: string }) => s.key), ["draft"]);
});

// ---- task thread ----

test("a task gets its thread in the project channel when someone first speaks, and only once", async () => {
  const h = harness();
  const p = await mkProject(h);
  const t = h.task(p, { title: "Call the client" });
  h.clear();
  const out = await run(h, "projects.open_task_thread", { projectId: p.projectId, taskId: t });
  assert.match(out.threadId, /^thr_/);
  assert.equal(h.only("chat.post")[0]?.input.threadId, h.world.channels.get(p.channelId)?.mainThreadId, "the card goes in the project channel");
  assert.deepEqual(h.named("project.task_thread_opened").map((e) => e.payload), [{ projectId: p.projectId, taskId: t, threadId: out.threadId }]);
  h.clear();
  assert.deepEqual(await run(h, "projects.open_task_thread", { projectId: p.projectId, taskId: t }), out);
  assert.equal(h.only("chat.post").length + h.only("chat.thread").length, 0, "no second card");
  const plan = await run(h, "projects.plan", { projectId: p.projectId });
  assert.equal(plan.tasks[0].threadId, out.threadId);
});

// ---- dates respect dependencies ----

const day = (n: number): number => n * DAY;
test("a cascade lets every later task start after the task it waits on is due, however the chain is cut", () => {
  let seed = 7;
  const rnd = (n: number): number => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
  for (let round = 0; round < 60; round++) {
    // a chain of 3 to 8 tasks with gaps of 0 to 3 days and lengths of 1 to 4 days; a branch hangs off a random task
    const n = 3 + rnd(6);
    const tasks: Array<{ taskId: string; title: string; state: "todo"; start: number; due: number }> = [];
    const links: Array<{ from: string; to: string }> = [];
    let at = 0;
    for (let i = 0; i < n; i++) {
      const start = at + day(rnd(4));
      const due = start + day(1 + rnd(4));
      tasks.push({ taskId: `t${i}`, title: `T${i}`, state: "todo", start, due });
      if (i > 0) links.push({ from: `t${i - 1}`, to: `t${i}` });
      at = due;
    }
    const branchFrom = rnd(n);
    tasks.push({ taskId: "br", title: "Branch", state: "todo", start: at + day(rnd(10)), due: at + day(12) });
    links.push({ from: `t${branchFrom}`, to: "br" });
    const first = tasks[0]!;
    const newDue = first.due + day(1 + rnd(6));
    const plan = planCascade(tasks, links, { taskId: "t0", due: newDue });
    const after = new Map(tasks.map((t) => [t.taskId, { start: t.start, due: t.due }]));
    after.get("t0")!.due = newDue;
    for (const m of plan.moves) after.set(m.taskId, { start: m.toStart ?? 0, due: m.toDue ?? 0 });
    for (const l of links) {
      const from = after.get(l.from)!, to = after.get(l.to)!;
      assert.ok(to.start >= from.due, `round ${round}: ${l.to} starts at ${to.start} before ${l.from} is due at ${from.due}`);
    }
    for (const m of plan.moves) {
      const t = tasks.find((x) => x.taskId === m.taskId)!;
      assert.equal(m.toDue! - m.toStart!, t.due - t.start, "a task keeps its length when it moves");
    }
  }
});
