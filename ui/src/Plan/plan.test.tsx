// ui/Plan: the timeline's logic (dates, geometry, drag, nudge, cascade, selection, arrows) and what it draws.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import {
  Plan, applyMoves, applySlipMoves, arrowTarget, blankTask, calendarWeeks, cascade, clickSelect, dragChanges, fmtDay, geomOf, isLate, itemOf, layoutOf, linkItems, moveToStage, nudgeChanges, orderOf, reassign, removeItems,
  roundedPath, setStatus, slipText, taskOf, toDay, toIso, unlinkItems,
} from "./index.tsx";
import type { PlanTask } from "./index.tsx";

const T = (id: string, start: string, end: string, o: Partial<PlanTask> = {}): PlanTask => ({ id, stage: "s1", kind: "task", title: id.toUpperCase(), start, end, ...o });
const TODAY = "2026-10-24";
const TASKS: PlanTask[] = [
  T("a", "2026-10-22", "2026-10-23", { status: "doing", assigned: { name: "Maya Chen", kind: "person" } }),
  T("b", "2026-10-24", "2026-10-27", { deps: ["a"], assigned: { name: "Intake", kind: "agent" }, status: "review" }),
  T("c", "2026-10-28", "2026-10-30", { deps: ["b"] }),
  { id: "m", stage: "s1", kind: "milestone", title: "Kickoff", start: "2026-10-31", deps: ["c"], fixed: true },
  T("d", "2026-10-25", "2026-10-26", { stage: "s2", status: "done" }),
];
const STAGES = [{ id: "s1", name: "Plan" }, { id: "s2", name: "Build" }];
const items = TASKS.map(itemOf);
let n = 0;
const uid = (): string => `u${++n}`;

test("dates are day numbers and come back as the same ISO string", () => {
  assert.equal(toIso(toDay("2026-10-24")), "2026-10-24");
  assert.equal(toDay("2026-10-25") - toDay("2026-10-24"), 1);
  assert.equal(toIso(toDay("2026-02-28") + 1), "2026-03-01");
  assert.equal(fmtDay(toDay("2026-10-24")), "24 Oct");
});

test("a task keeps everything the host sent when it comes back changed", () => {
  const raw = { ...(TASKS[1] as PlanTask), effort: "3d" };
  const back = taskOf({ ...itemOf(raw), s: toDay("2026-10-25"), e: toDay("2026-10-28") }, raw);
  assert.equal(back.start, "2026-10-25");
  assert.equal(back.end, "2026-10-28");
  assert.equal(back.effort, "3d");
  assert.deepEqual(back.deps, ["a"]);
  assert.equal(back.assigned?.name, "Intake");
});

test("the geometry fills the width with 28 to 44 px days and always shows today", () => {
  const g = geomOf(items, toDay(TODAY), 1000);
  assert.ok(g.dw >= 28 && g.dw <= 44);
  assert.ok(g.d0 <= toDay(TODAY) && g.d1 >= toDay(TODAY));
  assert.equal(g.cw, g.n * g.dw);
  assert.ok(g.d0 <= toDay("2026-10-22") - 3 + 0);
});

test("rows run stage by stage, a collapsed stage keeps only its row, and the filter narrows to late or waiting", () => {
  const lay = layoutOf(STAGES, items, {}, "all", toDay(TODAY));
  assert.deepEqual(orderOf(lay), ["a", "b", "c", "m", "d"]);
  const folded = layoutOf(STAGES, items, { s1: true }, "all", toDay(TODAY));
  assert.deepEqual(orderOf(folded), ["d"]);
  assert.deepEqual(orderOf(layoutOf(STAGES, items, {}, "wait", toDay(TODAY))), ["b"]);
  assert.deepEqual(orderOf(layoutOf(STAGES, items, {}, "late", toDay(TODAY))), ["a"]);
  assert.ok(isLate(items[0]!, toDay(TODAY)));
});

test("dragging the bar moves it and everything selected with it, whole days at a time; pinned dates stay", () => {
  const ch = dragChanges(items, "mv", "b", ["b", "m"], 2);
  assert.deepEqual(ch, [{ id: "b", s: toDay("2026-10-26"), e: toDay("2026-10-29") }]);
});

test("dragging an end resizes: the start never passes the end and the end never passes the start", () => {
  assert.deepEqual(dragChanges(items, "re", "b", ["b"], -10), [{ id: "b", s: toDay("2026-10-24"), e: toDay("2026-10-24") }]);
  assert.deepEqual(dragChanges(items, "rs", "b", ["b"], 10), [{ id: "b", s: toDay("2026-10-27"), e: toDay("2026-10-27") }]);
  assert.deepEqual(dragChanges(items, "re", "b", ["b"], 2), [{ id: "b", s: toDay("2026-10-24"), e: toDay("2026-10-29") }]);
});

test("a move says what it did, and a move that changes nothing is nothing", () => {
  assert.equal(applyMoves(items, [{ id: "b", s: toDay("2026-10-24"), e: toDay("2026-10-27") }], uid), null);
  assert.equal(applyMoves(items, [{ id: "b", s: toDay("2026-10-24"), e: toDay("2026-10-28") }], uid)?.text, "B now ends 28 Oct");
  assert.equal(applyMoves(items, [{ id: "b", s: toDay("2026-10-25"), e: toDay("2026-10-27") }], uid)?.text, "B now starts 25 Oct");
  assert.equal(applyMoves(items, [{ id: "b", s: toDay("2026-10-23"), e: toDay("2026-10-26") }], uid)?.text, "B moved 1 day earlier");
});

test("a task that ends later pushes what waits on it: later tasks move, a pinned milestone holds and is reported", () => {
  const r = applyMoves(items, [{ id: "b", s: toDay("2026-10-24"), e: toDay("2026-10-30") }], uid);
  assert.ok(r?.slip, "a slip to apply or keep");
  assert.equal(r?.slip?.cause, "b");
  assert.equal(r?.slip?.days, 3);
  assert.deepEqual(r?.slip?.moves.map((m) => m.id), ["c"]);
  assert.deepEqual(r?.slip?.moves[0], { id: "c", s: toDay("2026-10-31"), e: toDay("2026-11-02") });
  assert.deepEqual(r?.slip?.violated, ["m"], "the pinned date holds");
  // moving earlier never slips
  assert.equal(applyMoves(items, [{ id: "b", s: toDay("2026-10-23"), e: toDay("2026-10-26") }], uid)?.slip, null);
});

test("the cascade leaves done tasks alone", () => {
  const withDone = items.map((x) => (x.id === "c" ? { ...x, status: "done" as const } : x));
  assert.deepEqual(cascade(withDone, ["b"]).moves, []);
});

test("Alt-arrow nudges by one day, Shift by seven, Ctrl moves only the end, and pinned tasks stay", () => {
  assert.deepEqual(nudgeChanges(items, ["b"], 1, false), [{ id: "b", s: toDay("2026-10-25"), e: toDay("2026-10-28") }]);
  assert.deepEqual(nudgeChanges(items, ["b"], 7, false), [{ id: "b", s: toDay("2026-10-31"), e: toDay("2026-11-03") }]);
  assert.deepEqual(nudgeChanges(items, ["b"], 1, true), [{ id: "b", s: toDay("2026-10-24"), e: toDay("2026-10-28") }]);
  assert.deepEqual(nudgeChanges(items, ["m"], 1, false), []);
});

test("done and reassign change the list and say so", () => {
  const d = setStatus(items, ["a", "b"], "done");
  assert.equal(d?.text, "2 tasks marked done");
  assert.equal(setStatus(items, ["d"], "done"), null);
  assert.equal(setStatus(items, ["a"], "review")?.text, "A set to in review");
  const r = reassign(items, ["c"], { name: "Docs", kind: "agent" });
  assert.equal(r?.text, "Docs is now on C");
  assert.equal(r?.items.find((x) => x.id === "c")?.who?.name, "Docs");
  assert.equal(reassign(items, ["c"], null)?.text, "Cleared C");
});

test("click selects one, Cmd toggles, Shift takes the range", () => {
  const order = ["a", "b", "c", "m", "d"];
  const one = clickSelect(order, new Set(), null, "b", false, false);
  assert.deepEqual([...one.sel], ["b"]);
  const two = clickSelect(order, one.sel, one.anchor, "d", true, false);
  assert.deepEqual([...two.sel].sort(), ["b", "d"]);
  const range = clickSelect(order, one.sel, one.anchor, "m", false, true);
  assert.deepEqual([...range.sel], ["b", "c", "m"]);
});

test("arrow keys walk the rows; left goes to a dependency and right to what waits on this task", () => {
  const order = ["a", "b", "c", "m", "d"];
  assert.equal(arrowTarget(items, order, null, "ArrowDown"), "a");
  assert.equal(arrowTarget(items, order, null, "ArrowUp"), "d");
  assert.equal(arrowTarget(items, order, "b", "ArrowDown"), "c");
  assert.equal(arrowTarget(items, order, "b", "ArrowUp"), "a");
  assert.equal(arrowTarget(items, order, "b", "ArrowLeft"), "a");
  assert.equal(arrowTarget(items, order, "b", "ArrowRight"), "c");
  assert.equal(arrowTarget(items, order, "d", "ArrowRight"), "d");
});

test("the dependency arrow is a rounded path from the end of one bar to the start of the next", () => {
  const d = roundedPath([[10, 10], [19, 10], [19, 46], [60, 46]], 5);
  assert.match(d, /^M10 10L/);
  assert.ok(d.includes("Q19 10") && d.includes("Q19 46"), "both corners are rounded");
  assert.ok(d.endsWith("L60 46"));
});

test("the chart draws a bar per task, a diamond for the milestone, the stages, today and the faces", () => {
  const html = renderToStaticMarkup(<Plan today={TODAY} stages={STAGES} tasks={TASKS} />);
  for (const id of ["a", "b", "c", "m", "d"]) assert.ok(html.includes(`data-testid="plan-bar-${id}"`), id);
  assert.ok(html.includes('data-testid="plan-stage-s1"') && html.includes('data-testid="plan-stage-s2"'));
  assert.ok(html.includes(">Today<"), "the today marker");
  assert.ok(html.includes('data-dep="a&gt;b"') || html.includes('data-dep="a>b"'), "an arrow from a to b");
  assert.ok(html.includes('data-avatar="person"') && html.includes('data-avatar="agent"'), "assignee faces");
  assert.ok(html.includes('data-status="review"'), "a task waiting on review is marked");
  assert.ok(html.includes('data-testid="plan-today"') && html.includes('data-testid="plan-filter"'));
});

test("a link makes one task follow another and pushes it later when it starts too early; a loop or a repeat is refused", () => {
  const r = linkItems(items, "d", "a", uid);
  assert.ok(r, "d can come before a");
  assert.deepEqual(r?.items.find((x) => x.id === "a")?.deps, ["d"]);
  assert.equal(r?.text, "A now follows D");
  assert.ok(r?.slip, "a starts before d ends, so a and what follows it move");
  assert.equal(r?.slip?.why, "A now follows D.");
  assert.equal(linkItems(items, "a", "b", uid), null, "b already follows a");
  assert.equal(linkItems(items, "c", "a", uid), null, "a loop: c waits on b which waits on a");
  assert.equal(linkItems(items, "a", "a", uid), null);
});

test("removing a link and deleting tasks leave nothing waiting on what is gone", () => {
  assert.deepEqual(unlinkItems(items, "a", "b")?.items.find((x) => x.id === "b")?.deps, []);
  assert.equal(unlinkItems(items, "a", "b")?.text, "Removed the link from A to B");
  assert.equal(unlinkItems(items, "d", "b"), null);
  const r = removeItems(items, ["b"]);
  assert.equal(r?.text, "Deleted B");
  assert.deepEqual(r?.items.find((x) => x.id === "c")?.deps, []);
  assert.equal(removeItems(items, ["zzz"]), null);
  assert.equal(removeItems(items, ["a", "d"])?.text, "Deleted 2 tasks");
});

test("a card dropped on another stage moves there; the same stage is nothing", () => {
  assert.equal(moveToStage(items, ["a"], "s2", "Build")?.text, "Moved A to Build");
  assert.equal(moveToStage(items, ["a"], "s2", "Build")?.items.find((x) => x.id === "a")?.stage, "s2");
  assert.equal(moveToStage(items, ["a"], "s1", "Plan"), null);
});

test("a new task is New task, today for three days, in the stage it was added to", () => {
  const t = blankTask("s2", toDay(TODAY), "x1");
  assert.deepEqual([t.title, t.stage, t.start, t.end, t.status], ["New task", "s2", "2026-10-24", "2026-10-26", "todo"]);
});

test("the slip card says what slipped and what moves, and applying it moves exactly those", () => {
  const r = applyMoves(items, [{ id: "b", s: toDay("2026-10-24"), e: toDay("2026-10-30") }], uid);
  const sl = r?.slip;
  assert.ok(sl);
  const t = slipText(r?.items ?? [], sl!);
  assert.equal(t.title, "B slipped 3 days");
  assert.match(t.body, /^1 later task moves; the Saturday kickoff still holds\./);
  assert.match(t.body, /would end/);
  const applied = applySlipMoves(r?.items ?? [], sl!);
  assert.equal(applied.items.find((x) => x.id === "c")?.s, toDay("2026-10-31"));
  assert.equal(applied.text, "Moved 1 later task after B slipped");
});

test("the calendar is Monday-first weeks of the month with each task as a bar across its days, in lanes that never overlap", () => {
  const weeks = calendarWeeks(items, toDay(TODAY), 9);
  assert.equal(weeks[0]?.days.length, 7);
  assert.equal(new Date((weeks[0] as { start: number }).start * 86_400_000).getUTCDay(), 1, "a week starts on Monday");
  assert.ok(weeks.every((w) => w.days.length === 7));
  const week = weeks.find((w) => w.days.some((d) => d.today)) as { segs: { item: { id: string }; col: number; len: number; lane: number }[] };
  const b = week.segs.find((s) => s.item.id === "b");
  assert.ok(b && b.len >= 1);
  for (const x of week.segs) for (const y of week.segs) if (x !== y && x.lane === y.lane) assert.ok(x.col + x.len <= y.col || y.col + y.len <= x.col, "same lane, no overlap");
  assert.ok(weeks.some((w) => w.days.some((d) => d.other)), "the days of the next and last month are drawn quieter");
});

test("every view draws the tasks: board by stage, list with who and reviewer, calendar by month", () => {
  const board = renderToStaticMarkup(<Plan today={TODAY} stages={STAGES} tasks={TASKS} view="board" />);
  assert.ok(board.includes('data-testid="plan-board"') && board.includes('data-testid="plan-col-s1"') && board.includes('data-testid="plan-col-s2"') && board.includes('data-testid="plan-card-a"'));
  const list = renderToStaticMarkup(<Plan today={TODAY} stages={STAGES} tasks={TASKS} view="list" />);
  assert.ok(list.includes('data-testid="plan-list"') && list.includes('data-testid="plan-listrow-b"') && list.includes('data-testid="plan-reviewer-b"') && list.includes(">Reviewer<"));
  const cal = renderToStaticMarkup(<Plan today={TODAY} stages={STAGES} tasks={TASKS} view="calendar" />);
  assert.ok(cal.includes('data-testid="plan-calendar"') && cal.includes(">October<") && cal.includes('data-testid="plan-cal-b"'));
  assert.ok(cal.includes('data-testid="plan-cal-prev"') && cal.includes('data-testid="plan-cal-next"'));
});

test("the toolbar has the view switcher and New task; a host can take either away", () => {
  const full = renderToStaticMarkup(<Plan today={TODAY} stages={STAGES} tasks={TASKS} />);
  assert.ok(full.includes('data-testid="plan-view"') && full.includes('data-testid="plan-add"') && full.includes(">Timeline<"));
  const bare = renderToStaticMarkup(<Plan today={TODAY} stages={STAGES} tasks={TASKS} fixedView canAdd={false} />);
  assert.ok(!bare.includes('data-testid="plan-view"') && !bare.includes('data-testid="plan-add"') && !bare.includes('data-testid="plan-add-s1"'));
});
