// Projects at risk (spec 3.1 Rules): overdue, blocked or slipped, the counting rule the section menu shows, and who is listed.
import test from "node:test";
import assert from "node:assert/strict";
import { harness } from "../fixtures/db.ts";
import type { Harness } from "../fixtures/db.ts";
import { alice, hex, NOW, DAY } from "../fixtures/seed.ts";
import { AT_RISK_RULE, reasonsOf } from "../impl.ts";

interface P { n: number; title: string; status?: string; due?: number; lead?: string; blocked?: number; overdue?: number; lateMilestones?: number }
const proj = (p: P) => ({ projectId: hex("prj", p.n), recordId: hex("rec", p.n), type: "project", title: p.title, status: p.status ?? "active", due: p.due, lead: p.lead });

/** projects.list (in pages), tasks.list per project record and projects.plan per project, from a table of facts. */
function world(h: Harness, ps: P[], pageSize = 100): void {
  const byRecord = new Map(ps.map((p) => [hex("rec", p.n), p]));
  const byProject = new Map(ps.map((p) => [hex("prj", p.n), p]));
  h.callee("projects.list", (i) => {
    assert.equal(i.mine, true);
    const start = i.cursor ? Number(i.cursor) : 0;
    const rows = ps.slice(start, start + pageSize);
    return { projects: rows.map(proj), ...(start + rows.length < ps.length ? { next: String(start + rows.length) } : {}) };
  });
  h.callee("tasks.list", (i) => {
    assert.equal(i.scope, "record");
    assert.deepEqual(i.states, ["todo", "doing", "in_review", "awaiting_approval"]);
    const p = byRecord.get(i.recordId)!;
    const tasks = [
      ...Array.from({ length: p.blocked ?? 0 }, () => ({ blocked: true, due: NOW + DAY })),
      ...Array.from({ length: p.overdue ?? 0 }, () => ({ blocked: false, due: NOW - DAY })),
      { blocked: false, due: NOW + 5 * DAY }, { blocked: false },
    ];
    return { tasks };
  });
  h.callee("projects.plan", (i) => {
    const p = byProject.get(i.projectId)!;
    return {
      tasks: [
        { milestone: true, due: NOW - DAY, status: "done" }, { milestone: false, due: NOW - DAY, status: "todo" },
        ...Array.from({ length: p.lateMilestones ?? 0 }, () => ({ milestone: true, due: NOW - 2 * DAY, status: "doing" })),
        { milestone: true, due: NOW + DAY, status: "todo" },
      ],
    };
  });
}
const summary = (r: { projects: { title: string; reasons: string[] }[] }): string[] => r.projects.map((p) => `${p.title}:${p.reasons.join("+")}`);

test("the rule text is the spec's, so the section menu and the list agree", async () => {
  const h = harness();
  world(h, []);
  const r = await h.call("home.at_risk", {}, alice);
  assert.equal(r.rule, AT_RISK_RULE);
  assert.ok(r.rule.startsWith("Projects at risk = overdue, blocked or slipped."));
  assert.deepEqual(r.projects, []);
});

test("overdue, blocked and slipped are found; a healthy, a done and a paused project are not listed", async () => {
  const h = harness();
  world(h, [
    { n: 1, title: "Smith estate", due: NOW - 2 * DAY, lead: "usr_maya" },
    { n: 2, title: "Jones trust", due: NOW + 10 * DAY, blocked: 1 },
    { n: 3, title: "Lee intake", due: NOW + 10 * DAY, lateMilestones: 1 },
    { n: 4, title: "Kim retainer", due: NOW + 10 * DAY },
    { n: 5, title: "Old matter", status: "done", due: NOW - 30 * DAY, blocked: 2 },
    { n: 6, title: "On hold", status: "paused", due: NOW - 30 * DAY },
    { n: 7, title: "Late task only", due: NOW + 10 * DAY, overdue: 2 },
  ]);
  const r = await h.call("home.at_risk", {}, alice);
  assert.deepEqual(summary(r), ["Smith estate:overdue", "Jones trust:blocked", "Late task only:overdue", "Lee intake:slipped"]);
  const smith = r.projects[0];
  assert.deepEqual(smith, { recordId: hex("rec", 1), type: "project", title: "Smith estate", reasons: ["overdue"], dueAt: NOW - 2 * DAY, lead: "usr_maya", blockedTasks: 0, overdueTasks: 0 });
  assert.equal(r.projects[1].blockedTasks, 1);
  assert.equal(r.projects[2].overdueTasks, 2);
});

test("a project with several reasons comes first; the reasons always read overdue, blocked, slipped", async () => {
  const h = harness();
  world(h, [
    { n: 1, title: "Alpha", due: NOW - DAY },
    { n: 2, title: "Beta", due: NOW + DAY, lateMilestones: 1, blocked: 1 },
    { n: 3, title: "Gamma", due: NOW - 5 * DAY, blocked: 1, lateMilestones: 2, overdue: 1 },
  ]);
  const r = await h.call("home.at_risk", {}, alice);
  assert.deepEqual(summary(r), ["Gamma:overdue+blocked+slipped", "Beta:blocked+slipped", "Alpha:overdue"]);
});

test("ties go to the earlier due date, then the title; the limit cuts the list", async () => {
  const h = harness();
  world(h, [{ n: 1, title: "Zed", due: NOW - DAY }, { n: 2, title: "Abe", due: NOW - DAY }, { n: 3, title: "Cy", due: NOW - 3 * DAY }, { n: 4, title: "Di", due: NOW - 2 * DAY }]);
  assert.deepEqual(summary(await h.call("home.at_risk", {}, alice)), ["Cy:overdue", "Di:overdue", "Abe:overdue", "Zed:overdue"]);
  assert.deepEqual(summary(await h.call("home.at_risk", { limit: 2 }, alice)), ["Cy:overdue", "Di:overdue"]);
});

test("the default limit is ten; every page of projects.list is read", async () => {
  const h = harness();
  const many = Array.from({ length: 14 }, (_, i) => ({ n: i + 1, title: `Project ${String(i + 1).padStart(2, "0")}`, due: NOW - (i + 1) * DAY }));
  world(h, many, 5);
  const r = await h.call("home.at_risk", {}, alice);
  assert.equal(r.projects.length, 10);
  assert.equal(r.projects[0].title, "Project 14", "the oldest due date first, though it was on the last page");
  assert.equal(h.calls.filter((c) => c.cap === "projects.list").length, 3);
  assert.equal((await h.call("home.at_risk", { limit: 100 }, alice)).projects.length, 14);
});

test("reasonsOf: the project's own date and its tasks each make it overdue; the boundary is strictly before now", () => {
  assert.deepEqual(reasonsOf({ overdueTasks: 0, blockedTasks: 0, lateMilestones: 0 }, NOW), []);
  assert.deepEqual(reasonsOf({ projectDue: NOW, overdueTasks: 0, blockedTasks: 0, lateMilestones: 0 }, NOW), [], "due right now is not overdue yet");
  assert.deepEqual(reasonsOf({ projectDue: NOW - 1, overdueTasks: 0, blockedTasks: 0, lateMilestones: 0 }, NOW), ["overdue"]);
  assert.deepEqual(reasonsOf({ overdueTasks: 1, blockedTasks: 0, lateMilestones: 0 }, NOW), ["overdue"]);
});
