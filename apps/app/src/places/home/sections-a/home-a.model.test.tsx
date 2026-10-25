// Home sections A: the rules behind the screen, without a renderer. Dates and groups, the top 3, the wording of what is at risk, the digest limits, the face menu, the
// keyboard order across sections.
import test from "node:test";
import assert from "node:assert/strict";
import {
  DIGEST_MAX_ITEMS, GROUPS, clockTime, dateLine, digestLimit, dueCount, dueLabel, givenSub, greeting, groupOf, monthDay, needsRow, orderMyWork, plural, recordTypeLabel,
  riskRow, riskWhy, routineRows, routineSub, seatLabel, statusIcon, summaryBits, topNeeds, whenLabel, workGroups,
} from "./model.ts";
import type { Digest, NeedsItem, RiskProject, Routine, Task } from "./model.ts";
import { nextKey } from "./data.tsx";
import { assignMenu } from "./MyWork.tsx";
import { needsMenu } from "./NeedsYouTop3.tsx";
import { SAMPLE_NOW, northwind } from "./sample.ts";
import { isItem, isHead, isSeparator } from "../../../../../../ui/src/Menu/props.ts";

const C = { now: SAMPLE_NOW, offsetMin: 0 };   // Friday 24 October 2025, 10:00
const day = (m: number, d: number, h = 12): number => Date.UTC(2025, m - 1, d, h);
const task = (id: string, o: Partial<Task> = {}): Task => ({
  id, kind: "work", title: id, state: "todo", blocked: false, blocks: [], actions: [], assigned: { kind: "person", id: "usr_me" }, fileIds: [], dependsOn: [], followers: [], workingNotes: {},
  reviewLoops: 0, createdBy: "usr_me", createdAt: 1, updatedAt: 1, ...o,
} as Task);

test("date words: greeting by hour, the date line, and the person's day (an offset moves the edge of the day)", () => {
  assert.equal(greeting(C), "Good morning");
  assert.equal(greeting({ now: day(10, 24, 13), offsetMin: 0 }), "Good afternoon");
  assert.equal(greeting({ now: day(10, 24, 19), offsetMin: 0 }), "Good evening");
  assert.equal(dateLine(C), "Friday, October 24");
  assert.equal(monthDay(day(11, 3), 0), "Nov 3");
  assert.equal(clockTime(day(10, 24, 0), 0), "12:00 am");
  assert.equal(clockTime(day(10, 24, 12), 0), "12:00 pm");
  assert.equal(clockTime(Date.UTC(2025, 9, 24, 8, 5), 0), "8:05 am");
  const late = Date.UTC(2025, 9, 24, 23, 30);   // 23:30 UTC is already Saturday 05:00 in Karachi
  assert.equal(dateLine({ now: late, offsetMin: 300 }), "Saturday, October 25");
  assert.equal(dateLine({ now: late, offsetMin: 0 }), "Friday, October 24");
});

test("due labels: Today, Tomorrow, Yesterday, a weekday inside the week, the date outside it", () => {
  assert.equal(dueLabel(day(10, 24, 17), C), "Today");
  assert.equal(dueLabel(day(10, 25), C), "Tomorrow");
  assert.equal(dueLabel(day(10, 23), C), "Yesterday");
  assert.equal(dueLabel(day(10, 22), C), "Wed Oct 22");
  assert.equal(dueLabel(day(10, 27), C), "Mon");
  assert.equal(dueLabel(day(10, 30), C), "Thu");
  assert.equal(dueLabel(day(11, 12), C), "Nov 12");
  assert.equal(whenLabel(day(10, 24, 8), C), "8:00 am");
  assert.equal(whenLabel(day(10, 23, 16), C), "Yesterday 4:00 pm");
  assert.equal(whenLabel(day(10, 20, 16), C), "Oct 20");
});

test("groups: Overdue, Today, This week (inside seven days), Later; no date is Later", () => {
  assert.deepEqual(GROUPS, ["Overdue", "Today", "This week", "Later"]);
  assert.equal(groupOf(day(10, 23), C), "Overdue");
  assert.equal(groupOf(day(10, 24, 1), C), "Today", "earlier today is still today");
  assert.equal(groupOf(day(10, 25), C), "This week");
  assert.equal(groupOf(day(10, 31), C), "This week");
  assert.equal(groupOf(day(11, 1), C), "Later");
  assert.equal(groupOf(undefined, C), "Later");
});

test("My work: earliest due first, no date last; six shown, group totals count them all", () => {
  const tasks = [
    task("late", { due: day(11, 20) }), task("none"), task("a", { due: day(10, 28) }), task("b", { due: day(10, 22) }), task("c", { due: day(10, 24) }), task("d", { due: day(10, 24), updatedAt: 9 }),
    task("e", { due: day(10, 27) }), task("f", { due: day(10, 29) }),
  ];
  assert.deepEqual(orderMyWork(tasks).map((t) => t.id), ["b", "d", "c", "e", "a", "f", "late", "none"]);
  const g = workGroups(tasks, C, 6);
  assert.deepEqual(g.map((x) => [x.name, x.rows.length, x.total]), [["Overdue", 1, 1], ["Today", 2, 2], ["This week", 3, 3]]);
  assert.equal(g.reduce((n, x) => n + x.rows.length, 0), 6);
  assert.equal(dueCount(tasks, C), 3);
  assert.deepEqual(workGroups([], C), []);
});

test("seats and status: Review or Approve when the task waits on me, the circle by state", () => {
  const mine = task("m");
  assert.equal(seatLabel(mine, "usr_me"), null);
  assert.equal(seatLabel(task("r", { assigned: { kind: "agent", id: "agt_x" }, reviewer: { kind: "person", id: "usr_me" } }), "usr_me"), "Review");
  assert.equal(seatLabel(task("p", { assigned: { kind: "agent", id: "agt_x" }, approver: { kind: "person", id: "usr_me" } }), "usr_me"), "Approve");
  assert.equal(seatLabel(task("o", { assigned: { kind: "agent", id: "agt_x" } }), "usr_me"), null);
  assert.deepEqual(["todo", "doing", "in_review", "awaiting_approval", "done"].map((state) => statusIcon({ state: state as Task["state"], blocked: false })), ["todo", "doing", "review", "review", "done"]);
  assert.equal(statusIcon({ state: "doing", blocked: true }), "blocked");
});

test("the line under a task I handed on: a person's My work, or what the agent is doing", () => {
  const names = (id: string) => ({ usr_maya: "Maya Chen", usr_chris: "Chris Ross", agt_b: "Billing" })[id] ?? id;
  const kindOf = (r: { kind: string; id: string }) => (r.id.startsWith("agt_") ? "agent" : "person");
  assert.equal(givenSub(task("1", { assigned: { kind: "person", id: "usr_maya" } }), names, kindOf), "In Maya's My work now");
  assert.equal(givenSub(task("2", { assigned: { kind: "person", id: "usr_chris" } }), names, kindOf), "In Chris' My work now");
  const agent = { kind: "agent", id: "agt_b" } as const;
  assert.equal(givenSub(task("3", { assigned: agent, state: "doing" }), names, kindOf), "Working");
  assert.equal(givenSub(task("4", { assigned: agent, state: "in_review" }), names, kindOf), "Done, waiting on review");
  assert.equal(givenSub(task("5", { assigned: agent, state: "awaiting_approval" }), names, kindOf), "Paused, needs your approval to send");
  assert.equal(givenSub(task("6", { assigned: agent }), names, kindOf), "Starts now");
});

test("Needs you: the first three as returned; Approve acts in place, the others open; a stuck task warns", () => {
  const item = (id: string, kind: Task["kind"], extra: Partial<Task> = {}): NeedsItem => ({ task: task(id, { kind, createdBy: "agt_billing", ...extra }), reason: "ready" });
  const items = [item("a", "approve", { actions: [{ key: "approve", label: "Approve" }] }), item("b", "review", { actions: [{ key: "review", label: "Review" }] }), item("c", "unblock"), item("d", "approve"), item("e", "answer")];
  assert.deepEqual(topNeeds(items).map((i) => i.task.id), ["a", "b", "c"]);
  const name = (id: string) => (id === "agt_billing" ? "Billing" : id);
  const a = needsRow(items[0]!, name), b = needsRow(items[1]!, name), c = needsRow(items[2]!, name);
  assert.deepEqual([a.kind, a.actionLabel, a.inline, a.tone], ["Approve", "Approve", true, "accent"]);
  assert.deepEqual([b.kind, b.actionLabel, b.inline], ["Review", "Review", false]);
  assert.deepEqual([c.kind, c.actionLabel, c.inline, c.tone], ["Blocked", "Unblock", false, "warn"]);
  assert.equal(needsRow(item("n", "approve", { actions: [{ key: "approve", label: "Approve", note: "required" }] }), name).inline, false, "an action that needs a note opens instead of firing");
  assert.equal(needsRow({ ...items[0]!, handledBy: "grp_billing" }, (id) => (id === "grp_billing" ? "Billing team" : id)).sub, " · Handled by Billing team");
});

test("Needs you menu: the task's own actions, then Open in Needs you", () => {
  const ran: string[] = [];
  const it: NeedsItem = { task: task("a", { kind: "approve", actions: [{ key: "approve", label: "Approve" }, { key: "send_back", label: "Send back", note: "required" }] }), reason: "ready" };
  const entries = needsMenu(it, needsRow(it, (x) => x), (k) => ran.push(k), () => ran.push("open"));
  assert.deepEqual(entries.filter(isItem).map((e) => e.label), ["Approve", "Send back", "Open in Needs you"]);
  for (const e of entries.filter(isItem)) e.onSelect?.();
  assert.deepEqual(ran, ["approve", "send_back", "open"]);
});

test("Projects at risk: the reason in words, red for blocked and amber otherwise, a record type that reads", () => {
  const p = (o: Partial<RiskProject>): RiskProject => ({ recordId: "rec_1", type: "project", title: "P", reasons: [], blockedTasks: 0, overdueTasks: 0, ...o });
  assert.equal(riskWhy(p({ reasons: ["overdue"], overdueTasks: 1 })), "1 task overdue");
  assert.equal(riskWhy(p({ reasons: ["overdue"], overdueTasks: 0 })), "Overdue");
  assert.equal(riskWhy(p({ reasons: ["blocked"], blockedTasks: 3 })), "3 blocked tasks");
  assert.equal(riskWhy(p({ reasons: ["blocked"] })), "Blocked");
  assert.equal(riskWhy(p({ reasons: ["overdue", "blocked", "slipped"], overdueTasks: 2, blockedTasks: 1 })), "2 tasks overdue, 1 blocked task, Plan slipped");
  assert.equal(riskRow(p({ reasons: ["blocked"] }), C).health, "block");
  assert.equal(riskRow(p({ reasons: ["slipped"] }), C).health, "risk");
  assert.equal(riskRow(p({ reasons: ["overdue"], dueAt: day(11, 14), lead: "usr_x" }), C).due, "Nov 14");
  assert.deepEqual(["atp", "project", "hire_plan"].map(recordTypeLabel), ["ATP", "Project", "Hire plan"]);
});

test("the digest: three lines and seven items at most; a seen or missing digest is not shown", () => {
  const item = (i: number): Digest["items"][number] => ({ kind: "finished", title: `t${i}`, line: `l${i}` });
  const d: Digest = { id: "dgs_1", person: "usr_me", periodStart: 1, periodEnd: 2, builtBy: "agt_a", headline: ["1", "2", "3", "4"], items: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(item) };
  const shown = digestLimit(d);
  assert.deepEqual([shown.show, shown.headline.length, shown.items.length], [true, 3, DIGEST_MAX_ITEMS]);
  assert.equal(digestLimit({ ...d, seenAt: 5 }).show, false);
  assert.equal(digestLimit(null).show, false);
});

test("routines: by time of day, with the result and tone", () => {
  const r = (routineId: string, o: Partial<Routine>): Routine => ({ agentId: "agt_a", routineId, title: routineId, at: day(10, 24, 9), state: "scheduled", ...o });
  assert.deepEqual(routineSub(r("a", { state: "scheduled", at: day(10, 24, 16) }), C), { sub: "Today 4:00 pm", tone: "plain" });
  assert.deepEqual(routineSub(r("b", { state: "running", at: day(10, 24, 6) }), C), { sub: "Running since 6:00 am", tone: "live" });
  assert.deepEqual(routineSub(r("c", { state: "done", at: day(10, 24, 7), resultLine: "3 lines" }), C), { sub: "Ran 7:00 am · 3 lines", tone: "plain" });
  assert.deepEqual(routineSub(r("d", { state: "failed", at: day(10, 24, 7) }), C), { sub: "Failed 7:00 am", tone: "warn" });
  assert.deepEqual(routineRows([r("late", { at: day(10, 24, 17) }), r("early", { at: day(10, 24, 6) })], C).map((x) => x.id), ["early", "late"]);
});

test("the greeting line leaves out what is zero", () => {
  assert.deepEqual(summaryBits(0, 0, 0), []);
  assert.deepEqual(summaryBits(1, 0, 2), ["1 thing needs you", "2 tasks overdue"]);
  assert.deepEqual(summaryBits(5, 1, 0), ["5 things need you", "1 task due today"]);
  assert.equal(plural(1, "task"), "1 task");
  assert.equal(plural(2, "thing needs", "things need"), "2 things need");
});

test("the face menu lists People, Agents, Groups and Roles, checks the current one and ends with No one", () => {
  const picked: unknown[] = [];
  const entries = assignMenu(northwind.principals, { kind: "agent", id: "agt_docs" }, (to) => picked.push(to));
  const heads = entries.filter(isHead).map((e) => e.head);
  assert.deepEqual(heads, ["People", "Agents", "Groups", "Roles"]);
  assert.ok(entries.filter(isSeparator).length >= 3);
  const items = entries.filter(isItem);
  assert.equal(items.at(-1)!.label, "No one");
  assert.deepEqual(items.filter((e) => e.checked).map((e) => e.label), ["Docs"]);
  items.find((e) => e.label === "Maya Chen")!.onSelect?.();
  items.at(-1)!.onSelect?.();
  assert.deepEqual(picked, [{ kind: "person", id: "usr_maya" }, null]);
  const none = assignMenu(northwind.principals, undefined, () => undefined).filter(isItem);
  assert.deepEqual(none.filter((e) => e.checked).map((e) => e.label), ["No one"]);
  assert.deepEqual(assignMenu([], undefined, () => undefined).filter(isItem).map((e) => e.label), ["No one"]);
});

test("arrow keys cross sections and stop at the ends", () => {
  const order = ["need:1", "need:2", "work:1", "risk:1"];
  assert.equal(nextKey(order, null, 1), "need:1");
  assert.equal(nextKey(order, null, -1), "risk:1");
  assert.equal(nextKey(order, "need:2", 1), "work:1");
  assert.equal(nextKey(order, "work:1", -1), "need:2");
  assert.equal(nextKey(order, "need:1", -1), "need:1");
  assert.equal(nextKey(order, "risk:1", 1), "risk:1");
  assert.equal(nextKey(order, "gone", 1), "need:1");
  assert.equal(nextKey([], "x", 1), null);
});
<<<<<<< HEAD

// rerun for evidence on the final commit (lead request)
=======
>>>>>>> origin/build/P-L9b_02
