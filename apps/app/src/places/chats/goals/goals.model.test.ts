// Goals as the screens draw them: the row's words, the steady bar, the chart, the budget, the order of the Goals group, and the Goals entries in the Chats sidebar.
import test from "node:test";
import assert from "node:assert/strict";
import { budgetOf, byDay, chartOf, delta, fractionOf, goalBlockOf, leftWords, numberOf, partOf, rhythmWords, rowNote, sidebarGoals, statusOf, whenWords } from "./model.ts";
import type { Goal, GoalLine } from "./model.ts";
import { buildEntries } from "../sidebar/model.ts";

const NOW = Date.UTC(2026, 10, 3, 5, 0);   // Tue 3 Nov, 10:00 in Karachi
const PKT = 300;
const HOUR = 3_600_000, DAY = 24 * HOUR;
const line = (over: Partial<GoalLine> = {}): GoalLine => ({
  id: "gol_lab8", title: "300 registrations for Lab 8", status: "active", owner: "usr_irfad", leadAgentId: "agt_desk", threadId: "thr_g", deadline: NOW + 4 * DAY, nextCheckinAt: NOW + 23 * HOUR,
  progress: { value: 212, target: 300, start: 120, percent: 50, tasksDone: 2, tasks: 4 }, updatedAt: NOW, ...over,
});

test("a goal's row says what changes what you do first, else the number and the next check-in", () => {
  assert.deepEqual(rowNote(line(), NOW, PKT, "usr_irfad"), { text: "212 / 300 · Check-in Tomorrow 9:00" });
  assert.deepEqual(rowNote(line({ status: "waiting" }), NOW, PKT, "usr_irfad"), { lead: "Waiting on you", tone: "need", text: "212 / 300" });
  assert.deepEqual(rowNote(line({ status: "waiting" }), NOW, PKT, "usr_aliza"), { lead: "Waiting", tone: "need", text: "212 / 300" });
  assert.deepEqual(rowNote(line({ status: "stuck" }), NOW, PKT), { lead: "Stuck", tone: "stuck", text: "212 / 300" });
  assert.deepEqual(rowNote(line({ status: "done", progress: { value: 301, target: 300, percent: 100, tasksDone: 4, tasks: 4 } }), NOW, PKT), { lead: "Done", tone: "ok", text: "301 / 300" });
  assert.equal(numberOf({ target: 300, error: "Luma refused the key", tasksDone: 0, tasks: 0 }), "Can't read", "a number that cannot be read is never guessed");
  assert.equal(numberOf({ items: 5, itemsDone: 3, tasksDone: 0, tasks: 0 }), "3 of 5");
  assert.equal(statusOf({ status: "active", owner: "x" }).word, "On track");
});

test("the bar is steady: the share from the start to the target, else of the checklist, else of the plan", () => {
  assert.equal(fractionOf({ percent: 50, tasksDone: 0, tasks: 0 }), 0.5);
  assert.equal(fractionOf({ items: 4, itemsDone: 1, tasksDone: 0, tasks: 0 }), 0.25);
  assert.equal(fractionOf({ tasksDone: 1, tasks: 4 }), 0.25);
  assert.equal(fractionOf({ percent: 140, tasksDone: 0, tasks: 0 }), 1);
});

test("times as people say them, in the person's zone", () => {
  assert.equal(whenWords(NOW + HOUR, NOW, PKT), "11:00");
  assert.equal(whenWords(NOW + 23 * HOUR, NOW, PKT), "Tomorrow 9:00");
  assert.equal(whenWords(NOW + 3 * DAY, NOW, PKT), "Fri 10:00");
  assert.equal(whenWords(NOW + 20 * DAY, NOW, PKT), "23 Nov");
  assert.equal(leftWords(NOW + 4 * DAY, NOW), "4 days left");
  assert.equal(leftWords(NOW + 5 * HOUR, NOW), "5 hours left");
  assert.equal(leftWords(NOW - 1, NOW), "Past the deadline");
});

test("the Goals group: what needs you first, then by the next check-in; ended goals leave after a week", () => {
  const out = sidebarGoals([
    line({ id: "a", nextCheckinAt: NOW + 5 * HOUR }), line({ id: "b", status: "stuck" }), line({ id: "c", nextCheckinAt: NOW + HOUR }),
    line({ id: "d", status: "done", updatedAt: NOW - 8 * DAY }), line({ id: "e", status: "done", updatedAt: NOW - DAY }), line({ id: "f", status: "paused" }),
  ], NOW);
  assert.deepEqual(out.map((g) => g.id), ["b", "c", "a", "f", "e"]);
});

test("the Chats sidebar shows Goals under Tasks and Threads, five then N more, none when there are none", () => {
  const base = { faces: [], workingAgents: new Set<string>(), groups: [], channels: [], filter: "all" as const, closed: new Set<never>() };
  const none = buildEntries(base);
  assert.equal(none.some((e) => e.key === "h:goals"), false);
  const goals = Array.from({ length: 7 }, (_, i) => line({ id: `g${i}` }));
  const keys = buildEntries({ ...base, goals }).map((e) => e.key);
  assert.deepEqual(keys.slice(0, 9), ["nav:tasks", "nav:threads", "h:goals", "g:g0", "g:g1", "g:g2", "g:g3", "g:g4", "m:goals"]);
  assert.equal(buildEntries({ ...base, goals, moreGoals: true }).filter((e) => e.type === "goal").length, 7);
  assert.equal(buildEntries({ ...base, goals, closed: new Set(["goals" as const]) }).filter((e) => e.type === "goal").length, 0, "the group folds");
});

test("budget, rhythm and the activity by day", () => {
  assert.deepEqual(budgetOf({ budget: { spendMicros: 25_000_000, turns: 200 }, spentMicros: 4_100_000, turns: 38 }), { text: "$4.10 of $25 · 38 of 200 turns", used: 0.19, warn: false });
  assert.equal(budgetOf({ budget: { spendMicros: 25_000_000, turns: 200 }, spentMicros: 20_500_000, turns: 164 }).warn, true);
  assert.equal(rhythmWords({ rhythm: { every: "day", at: "09:00" }, quiet: { from: "22:00", to: "08:00" } }), "Daily 9:00, quiet 22:00 to 8:00");
  assert.equal(rhythmWords({ rhythm: { every: "hours", hours: 6 }, quiet: null }), "Every 6 hours");
  const days = byDay([{ at: NOW, kind: "reading", text: "a" }, { at: NOW - HOUR, kind: "checkin", text: "b" }, { at: NOW - DAY, kind: "plan", text: "c" }, { at: NOW - 3 * DAY, kind: "started", text: "d" }], NOW, PKT);
  assert.deepEqual(days.map((d) => [d.day, d.items.length]), [["Today", 2], ["Yesterday", 1], ["Sat 31 Oct", 1]]);
});

test("the chart draws only real readings, with the target, the pace and the deadline", () => {
  const g = { createdAt: NOW - 2 * DAY, deadline: NOW + 2 * DAY, finish: { kind: "number" as const, line: "x", target: 300 }, progress: { start: 120, tasksDone: 0, tasks: 0 } } as Pick<Goal, "createdAt" | "deadline" | "finish"> & { progress: Goal["progress"] };
  assert.equal(chartOf([{ at: NOW, ok: false, error: "x" }], g, 400, 100, NOW), null, "nothing read, nothing drawn");
  const c = chartOf([{ at: NOW - 2 * DAY, value: 120, ok: true }, { at: NOW - DAY, ok: false, error: "x" }, { at: NOW, value: 212, ok: true }], g, 400, 100, NOW)!;
  assert.equal(c.points.length, 2);
  assert.equal(c.deadlineX, 396);
  assert.ok(c.targetY < c.points[1]!.y, "the target sits above the number");
  assert.match(c.line, /^M4 \d+ H200 V\d+$/);
});

test("a goal card from a message block, the check-in's change, and Part of on a task", () => {
  assert.equal(goalBlockOf({ type: "goal", data: { goalId: "gol_1", kind: "update", title: "T", line: "L", status: "active", deadline: 1 } })?.kind, "update");
  assert.equal(goalBlockOf({ type: "plan", data: {} }), null);
  assert.equal(delta({ value: 212, prev: 194 }), "+18");
  assert.equal(delta({ value: 212, prev: 212 }), "no change");
  assert.deepEqual(partOf({ "goal.id": "gol_1", "goal.title": "300 registrations" }), { goalId: "gol_1", title: "300 registrations" });
  assert.equal(partOf({ "goal.id": "gol_1", "goal.title": "x", "goal.root": "1" }), null);
});

test("the finish line's date and the Due chip come from the one deadline; the chart's axis has round ticks", async () => {
  const { dueWords, lineWithDue, niceStep } = await import("./model.ts");
  const fri = Date.UTC(2026, 10, 7, 13, 0);   // 7 Nov 2026, 18:00 in Karachi (a Saturday)
  assert.equal(dueWords(fri, PKT), "Sat 7 Nov, 18:00");
  assert.equal(lineWithDue("Luma registrations for Lab 8 reach 300 by Friday", fri, PKT), `Luma registrations for Lab 8 reach 300 by ${dueWords(fri, PKT)}`);
  assert.equal(lineWithDue("Luma registrations reach 300 by Mon 10 Nov, 18:00", fri, PKT), `Luma registrations reach 300 by ${dueWords(fri, PKT)}`, "an old date in the words gives way to the real deadline");
  assert.equal(lineWithDue("Every onboarding task closed", fri, PKT), `Every onboarding task closed by ${dueWords(fri, PKT)}`);
  assert.deepEqual([niceStep(100), niceStep(120), niceStep(7), niceStep(0)], [100, 200, 10, 1]);
});
