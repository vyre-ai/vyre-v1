// @tsx
// The Tasks page as data: sections, grouping, quick add, status marks. Pure, so every rule is checked without a screen.
import test from "node:test";
import assert from "node:assert/strict";
import { barOf, batonMarks, buildEntries, cardHeight, DAY, dueLabel, filterRows, groupRows, holderOf, monthCells, NO_FILTER, QUIET_MS, sectionsOf, sortRows } from "./model.ts";
import type { BuildIn, NeedItem, TaskRow } from "./model.ts";
import { activityOf } from "./activity.ts";
import { parseQuick } from "./quick.ts";
import { createTaskStore } from "./store.ts";

const NOW = Date.UTC(2026, 10, 2, 10);   // a Monday
const me = "usr_me";
const row = (over: Partial<TaskRow> & { id: string }): TaskRow => ({ kind: "work", title: over.id, state: "todo", blocked: false, assigned: { kind: "person", id: me }, labels: [], dependsOn: [], createdBy: me, createdAt: NOW, updatedAt: NOW, ...over } as TaskRow);
const names = { name: (id: string): string => id, project: (id: string): string => `Project ${id}` };
const base: Omit<BuildIn, "rows"> = { needs: [], me, now: NOW, offsetMin: 0, scope: "mine", group: "smart", sort: "smart", filter: NO_FILTER, doneRows: null, doneCount: 0, names, quietOff: false };

test("the list is ordered for you: Now, Next, Waiting on others, with quiet tasks folded", () => {
  const rows = [
    row({ id: "late", due: NOW - 2 * DAY }), row({ id: "today", due: NOW + 3_600_000 }), row({ id: "under-way", state: "doing" }), row({ id: "later", due: NOW + 5 * DAY }),
    row({ id: "old", updatedAt: NOW - QUIET_MS - 1 }), row({ id: "theirs", assigned: { kind: "agent", id: "agt_mira" } }),
  ];
  const s = sectionsOf(rows, me, NOW, 0, new Set());
  assert.deepEqual(s.now.map((r) => r.id), ["late", "today", "under-way"]);
  assert.deepEqual(s.next.map((r) => r.id), ["later"]);
  assert.deepEqual(s.quiet.map((r) => r.id), ["old"]);
  assert.deepEqual(s.waiting.map((r) => r.id), ["theirs"]);
});

test("a reviewer's turn is theirs: the holder moves with the status", () => {
  const t = row({ id: "t", state: "in_review", reviewer: { kind: "person", id: "usr_sara" } });
  assert.equal(holderOf(t)?.id, "usr_sara");
  assert.equal(holderOf({ ...t, state: "todo" })?.id, me);
  assert.equal(holderOf({ ...t, state: "done" }), undefined);
  assert.deepEqual(batonMarks(t), ["p", "c", ""]);
  assert.equal(batonMarks(row({ id: "x" })), null);
});

test("the flat list has Needs you first, then the sections, then add and the count of what is done", () => {
  const need = { task: { id: "n", kind: "answer", title: "Q" } } as unknown as NeedItem;
  const entries = buildEntries({ ...base, rows: [row({ id: "a", due: NOW }), row({ id: "b", updatedAt: NOW - QUIET_MS - 1 })], needs: [need], doneCount: 12 });
  assert.deepEqual(entries.map((e) => e.key), ["h:needs", "n:n", "h:now", "now:a", "quiet", "add", "done"]);
});

test("work due today stays in Now even though tasks.needs_you lists it", () => {
  const work = { task: { id: "a", kind: "work", title: "A" } } as unknown as NeedItem;
  const entries = buildEntries({ ...base, rows: [row({ id: "a", due: NOW })], needs: [work] });
  assert.ok(entries.some((e) => e.key === "now:a"));
  assert.ok(!entries.some((e) => e.key === "h:needs"));
});

test("group, sort and filter", () => {
  const rows = [row({ id: "a", labels: ["x", "y"], priority: "low" }), row({ id: "b", priority: "urgent", state: "doing" }), row({ id: "c", blocked: true, title: "Omar" })];
  assert.deepEqual(groupRows(rows, "label", names, NOW, 0).map((g) => [g.title, g.rows.length]), [["#x", 1], ["#y", 1], ["No label", 2]]);
  assert.deepEqual(groupRows(rows, "status", names, NOW, 0).map((g) => g.title), ["Doing", "To do"]);
  assert.deepEqual(sortRows(rows, "priority").map((r) => r.id), ["b", "c", "a"]);
  assert.deepEqual(filterRows(rows, { ...NO_FILTER, waiting: true }).map((r) => r.id), ["c"]);
  assert.deepEqual(filterRows(rows, { ...NO_FILTER, query: "om" }).map((r) => r.id), ["c"]);
});

test("a due date reads as a person says it", () => {
  assert.deepEqual(dueLabel(NOW, NOW, 0), { text: "Today", late: false });
  assert.deepEqual(dueLabel(NOW + DAY, NOW, 0), { text: "Tomorrow", late: false });
  assert.deepEqual(dueLabel(NOW - DAY, NOW, 0), { text: "Yesterday", late: true });
  assert.equal(dueLabel(NOW + 4 * DAY, NOW, 0).text, "Friday");
  assert.equal(dueLabel(NOW + 40 * DAY, NOW, 0).text, "12 Dec");
});

test("quick add reads plain words", () => {
  const people = [{ id: "usr_sara", name: "Sara Malik", kind: "person" }, { id: "agt_mira", name: "Mira", kind: "agent" }];
  const q = parseQuick("Call Omar friday @sara #portal !high", people, NOW, 0);
  assert.equal(q.title, "Call Omar");
  assert.equal(q.assignee?.id, "usr_sara");
  assert.deepEqual(q.labels, ["portal"]);
  assert.equal(q.priority, "high");
  assert.equal(dueLabel(q.due, NOW, 0).text, "Friday");
  assert.equal(parseQuick("Send it to @nobody", people, NOW, 0).title, "Send it to @nobody");
  assert.equal(dueLabel(parseQuick("Ship tomorrow", people, NOW, 0).due, NOW, 0).text, "Tomorrow");
  assert.equal(parseQuick("Fix #VY-12", people, NOW, 0).title, "Fix #VY-12");
  assert.equal(dueLabel(parseQuick("In 3 days do it", [], NOW, 0).due, NOW, 0).text, "Thursday");
});

test("a bar sits between its start and its due date, and a month lays out Monday first", () => {
  const first = NOW;
  assert.deepEqual(barOf({ start: first + DAY, due: first + 2 * DAY, createdAt: 0 }, first, 14), { left: 1 / 14, width: 2 / 14 });
  assert.equal(barOf({ createdAt: 0 } as never, first, 14), null);
  assert.equal(barOf({ due: first - 30 * DAY, createdAt: 0 }, first, 14), null);
  const cells = monthCells([row({ id: "a", due: NOW })], { year: 2026, month: 10 }, 0);
  assert.equal(cells.length, 42);
  assert.equal(new Date(cells[0]!.date).getUTCDay(), 1);
  assert.equal(cells.find((c) => c.rows.length > 0)?.day, 2);
});

test("the store shows a change at once, puts it back when asked, and reads only a new revision", async () => {
  const calls: unknown[] = [];
  const out = { rev: "1", unchanged: false, rows: [row({ id: "a" })], doneThisWeek: 0, total: 1 };
  const store = createTaskStore(async (_c, input) => { calls.push(input); return out; }, { scope: "mine" });
  store.refresh("1");
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(store.get().rows.length, 1);
  store.refresh("1");
  assert.equal(calls.length, 1, "the same revision is not read again");
  const back = store.patch(["a"], (r) => ({ ...r, state: "doing" }));
  assert.equal(store.byId("a")?.state, "doing");
  back();
  assert.equal(store.byId("a")?.state, "todo");
});

test("Activity reads in the order it happened, says where a status went, and leaves out who a task was born with", () => {
  const names = (id: string): string => (id === "u" ? "You" : "Mira");
  const lines = activityOf([
    { at: 9000, type: "completed", by: "m", eventId: "e6" },
    { at: 9000, type: "transitioned:done", by: "m", eventId: "e5" },
    { at: 8000, type: "transitioned:in_review", by: "m", eventId: "e4" },
    { at: 7000, type: "assigned", by: "u", eventId: "e3" },
    { at: 1000, type: "assigned", by: "u", eventId: "e2" },
    { at: 1000, type: "created", by: "u", eventId: "e1" },
  ], "thr", names);
  assert.deepEqual(lines.map((m) => m.body), ["You created this", "You changed who is on this", "Mira handed this in for review", "Mira marked this Done"]);
});

test("a card's height is known before it draws", () => {
  assert.equal(cardHeight({ title: "Short", state: "todo", assigned: { kind: "person", id: "u" } }, false), 75);
  assert.equal(cardHeight({ title: "A title that runs to two lines", state: "doing", assigned: { kind: "agent", id: "a" } }, false), 113);
});
