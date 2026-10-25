// @reads ../../../../../../scripts/shots/mounts/P-L9d_03.tsx
// Records views, part B: Calendar, Timeline, Map and Charts. The month grid and the day a record falls on, a record dropped on another day, bars that move and resize with their dates written
// through records.update or, for a task of a project, through the plan with a cascade to Apply or Keep, pins fitted to a plain grid, and bars counted under a field's values.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import { RecordsDataProvider, RecordsStateProvider } from "../sidebar/index.ts";
import type { RecordsState } from "../sidebar/index.ts";
import { RecordViews } from "../views-a/index.ts";
import type { TableViewState } from "../views-a/index.ts";
import {
  BAR_H, CELL_EVENTS, DAY, DAY_W, EXTRA_KINDS, TodayProvider, VIEW_LIMIT, addMonths, bandsOf, barsOf, boundsOf, bucketByDay, cascadeLine, dateFieldOf, datePatch, dayKey, decideCascade, dragBar, dropOnDay,
  dropRecord, isGroupField, isMeasureField, measureText, monthGrid, monthTitle, moveBar, moveError, msOf, plot, pointOf, projectIdOf, rangeOf, spanOf, startOfDay, tally, total, valueText, widths, xOf,
} from "../views-b/index.tsx";
import type { RecordRow } from "../views-b/index.tsx";
import { doneOfTotal, isDoneRow } from "../views-b/model.ts";
import { shortTime } from "../views-b/CalendarView.tsx";
import { LOCATIONS_DEF, TASKS_DEF, TODAY, createBSample, harborRich, location, northRich, task } from "../views-b/sample.ts";
import type { BSample } from "../views-b/sample.ts";

const wrap = (s: BSample, child: ReactElement, initial: Partial<RecordsState> = {}): string =>
  renderToStaticMarkup(<TodayProvider value={TODAY}><RecordsDataProvider value={s.data}><RecordsStateProvider initial={initial}>{child}</RecordsStateProvider></RecordsDataProvider></TodayProvider>).replaceAll("<!-- -->", "");
const views = (kind: string, type: string, s: BSample = createBSample(), view?: Partial<TableViewState>, extra: Partial<RecordsState> = {}): string =>
  wrap(s, <RecordViews kind={kind} extraKinds={EXTRA_KINDS} {...(view ? { view } : {})} />, { type, ...extra });
const has = (s: string, needle: string): boolean => s.includes(needle);
const count = (s: string, needle: string): number => s.split(needle).length - 1;
const rows = (s: BSample, type: string): RecordRow[] => s.replica.rows(`records:${type}`) as unknown as RecordRow[];
const get = (s: BSample, type: string, id: string): RecordRow => rows(s, type).find((r) => r.id === id)!;
const projectsDef = northRich.types.find((t) => t.key === "projects")!;
const due = projectsDef.fields.find((f) => f.key === "due")!;
const at = (y: number, m: number, d: number): number => Date.UTC(y, m - 1, d);

// ---------------------------------------------------------------- calendar: the model

test("a month shows six weeks from the Sunday on or before the 1st, and says which days are in the month", () => {
  const grid = monthGrid(TODAY);
  assert.equal(grid.length, 42);
  assert.equal(grid[0]!.key, "2025-09-28", "Oct 1 2025 is a Wednesday, so the grid starts on Sunday Sep 28");
  assert.equal(grid.filter((c) => c.inMonth).length, 31);
  assert.deepEqual([grid[3]!.key, grid[3]!.inMonth, grid[2]!.inMonth], ["2025-10-01", true, false]);
  assert.equal(grid[41]!.key, "2025-11-08");
  assert.equal(monthTitle(TODAY), "October 2025");
  assert.equal(monthTitle(addMonths(TODAY, 1)), "November 2025");
  assert.equal(monthTitle(addMonths(TODAY, -10)), "December 2024");
  assert.equal(dayKey(at(2025, 10, 24)), "2025-10-24");
  assert.equal(startOfDay(TODAY + 5 * 3_600_000), TODAY);
});

test("records fall on the day of their date field, in time order, and records with no date are left out", () => {
  const s = createBSample();
  const by = bucketByDay(rows(s, "projects"), due);
  assert.deepEqual([...by.keys()].slice(0, 3), ["2025-10-12", "2025-10-17", "2025-10-22"]);
  assert.equal([...by.values()].reduce((n, l) => n + l.length, 0), 12);
  const odd = { ...get(s, "projects", "projects_0"), fields: { ...get(s, "projects", "projects_0").fields, due: undefined } };
  assert.equal([...bucketByDay([odd], due).keys()].length, 0);
  assert.equal(msOf("2025-10-24T10:00:00Z"), at(2025, 10, 24) + 10 * 3_600_000);
  assert.equal(msOf("not a date"), null);
  assert.equal(msOf(null), null);
  const date = dateFieldOf(projectsDef, "date");
  assert.equal(date?.key, "due");
  assert.equal(dateFieldOf(projectsDef, "date", { config: { date: "nope" } })?.key, "due", "a saved key that names no date field falls through");
  assert.equal(CELL_EVENTS, 3);
});

test("a record dropped on a day takes that day; a date and time field keeps its time of day", () => {
  const dt = { key: "when", type: "datetime", title: "When" };
  assert.equal(dropOnDay(due, at(2025, 10, 12) + 10 * 3_600_000, at(2025, 10, 20) + 5 * 3_600_000), at(2025, 10, 20));
  assert.equal(dropOnDay(dt, at(2025, 10, 12) + 14 * 3_600_000, at(2025, 10, 20)), at(2025, 10, 20) + 14 * 3_600_000);
  assert.equal(dropOnDay(dt, null, at(2025, 10, 20)), at(2025, 10, 20) + 9 * 3_600_000, "a record with no time starts at nine");
});

test("screen: a calendar draws the month, today lit, and a draggable chip on the day of each project", () => {
  const out = views("calendar", "projects");
  assert.ok(has(out, 'data-testid="records-calendar"') && has(out, 'aria-label="Projects calendar"'));
  assert.ok(has(out, ">October 2025<") && has(out, 'data-testid="cal-prev"') && has(out, 'data-testid="cal-next"') && has(out, 'data-testid="cal-today"'));
  assert.equal(count(out, 'data-testid="day-'), 42);
  assert.ok(has(out, 'data-testid="day-2025-10-24"'));
  for (const d of ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]) assert.ok(has(out, `>${d}<`), d);
  assert.equal(count(out, 'data-testid="ev-projects_'), 6, "six projects fall in the six weeks shown");
  assert.equal(count(out, 'draggable="true"'), 6);
  assert.ok(has(out, 'aria-label="Rivera engagement"') && has(out, "12 projects"));
  assert.ok(has(out, 'data-testid="records-date"') && has(out, ">Due<"), "the Date button names the field the chips are placed by");
  for (const id of ["records-head", "records-kind", "records-filter", "records-new"]) assert.ok(has(out, `data-testid="${id}"`), id);
  assert.ok(!has(out, String.fromCharCode(0x2014)), "no em dash in any copy");
});

test("a calendar of a type with no date field says so", () => {
  const out = views("calendar", "companies");
  assert.ok(has(out, "have no date field to place on a calendar."));
});

test("dropping a chip on another day writes the date field: one records.update with the card's version", async () => {
  const s = createBSample();
  const row = get(s, "projects", "projects_0");
  await dropRecord(s.data, "projects", row, due, dropOnDay(due, row.fields["due"], at(2025, 10, 20)));
  assert.deepEqual(s.calls[0]!.input, { type: "projects", recordId: "projects_0", patch: { due: at(2025, 10, 20) }, baseVersion: 1 });
  const out = wrap(s, <RecordViews kind="calendar" extraKinds={EXTRA_KINDS} />, { type: "projects" });
  assert.equal(count(out, 'data-testid="ev-projects_'), 6, "still six: it moved, it did not go");
  assert.equal(get(s, "projects", "projects_0").version, 2);
  const stale = createBSample({ ...northRich }, { fail: "You cannot edit projects" });
  await assert.rejects(dropRecord(stale.data, "projects", get(stale, "projects", "projects_0"), due, 1), /cannot edit/);
  assert.equal(moveError(new Error("x")), "Could not change the dates: x");
  assert.equal(moveError(undefined), "Could not change the dates.");
});

// ---------------------------------------------------------------- timeline: the model

test("a task's dates make its bar: start to end, never backwards, one day with no end, sorted by start", () => {
  const range = rangeOf(TASKS_DEF)!;
  assert.deepEqual([range.start.key, range.end?.key], ["start", "due"]);
  const bars = barsOf([task(2), task(0), task(1)], range, "name");
  assert.deepEqual(bars.map((b) => b.id), ["tasks_0", "tasks_1", "tasks_2"]);
  assert.deepEqual([bars[0]!.start, bars[0]!.end], [TODAY - 3 * DAY, TODAY - 1 * DAY]);
  const back = { ...task(0), fields: { ...task(0).fields, due: TODAY - 9 * DAY } };
  assert.equal(barsOf([back], range, "name")[0]!.end, TODAY - 3 * DAY, "an end before the start is the start");
  const single = rangeOf(projectsDef)!;
  assert.equal(single.end, null);
  const one = barsOf([{ ...task(0), fields: { due: TODAY } }], { start: due, end: null }, "name")[0]!;
  assert.deepEqual([one.start, one.end], [TODAY, TODAY]);
  assert.equal(barsOf([{ ...task(0), fields: { name: "x" } }], range, "name").length, 0, "no start, no bar");
});

test("the timeline spans every bar, today and a week either side; a pixel is a day", () => {
  const range = rangeOf(TASKS_DEF)!;
  const bars = barsOf([task(0), task(5)], range, "name");
  const { from, days } = spanOf(bars, TODAY);
  assert.equal(from, TODAY - 3 * DAY - 7 * DAY);
  assert.equal(from + (days - 1) * DAY, TODAY + 11 * DAY + 7 * DAY);
  assert.equal(xOf(TODAY - 3 * DAY, from), 7 * DAY_W);
  assert.equal(spanOf([], TODAY).days, 15);
});

test("a drag moves both ends or one, in whole days, and an edge never crosses the other", () => {
  const b = { start: TODAY, end: TODAY + 2 * DAY };
  assert.deepEqual(dragBar(b, 3 * DAY_W, "move"), { start: TODAY + 3 * DAY, end: TODAY + 5 * DAY });
  assert.deepEqual(dragBar(b, 3 * DAY_W + 10, "move"), { start: TODAY + 3 * DAY, end: TODAY + 5 * DAY }, "rounded to the nearest day");
  assert.deepEqual(dragBar(b, -DAY_W, "start"), { start: TODAY - DAY, end: TODAY + 2 * DAY });
  assert.deepEqual(dragBar(b, 9 * DAY_W, "start"), { start: TODAY + 2 * DAY, end: TODAY + 2 * DAY }, "the start stops at the end");
  assert.deepEqual(dragBar(b, 2 * DAY_W, "end"), { start: TODAY, end: TODAY + 4 * DAY });
  assert.deepEqual(dragBar(b, -9 * DAY_W, "end"), { start: TODAY, end: TODAY }, "the end stops at the start");
  assert.deepEqual(dragBar(b, 0, "move"), b);
});

test("a finished drag writes the start field and, if the bar has one, the end field", () => {
  const range = rangeOf(TASKS_DEF)!;
  const row = task(1);
  assert.deepEqual(datePatch(range, row, { start: TODAY, end: TODAY + 3 * DAY }), { start: TODAY, due: TODAY + 3 * DAY });
  assert.deepEqual(datePatch({ start: due, end: null }, row, { start: TODAY, end: TODAY }), { due: TODAY });
  const dt = { key: "when", type: "datetime", title: "When" };
  const timed = { ...row, fields: { when: TODAY + 15 * 3_600_000 } };
  assert.deepEqual(datePatch({ start: dt, end: null }, timed, { start: TODAY + DAY, end: TODAY + DAY }), { when: TODAY + DAY + 15 * 3_600_000 }, "the time of day stays");
});

test("bands group bars by status in the order of its options, and records of no status come last", () => {
  const range = rangeOf(TASKS_DEF)!;
  const bars = barsOf(rows(createBSample(), "tasks"), range, "name");
  const status = TASKS_DEF.fields.find((f) => f.key === "status")!;
  assert.deepEqual(bandsOf(bars, status).map((b) => [b.key, b.bars.length]), [["todo", 4], ["doing", 1], ["done", 1]]);
  assert.deepEqual(bandsOf(bars, undefined).map((b) => b.bars.length), [6]);
  const none = barsOf([{ ...task(0), fields: { ...task(0).fields, status: "" } }], range, "name");
  const nb = bandsOf(none, status);
  assert.equal(nb[nb.length - 1]!.title, "No status");
  assert.equal(projectIdOf(TASKS_DEF, task(1)), "projects_0");
  assert.equal(projectIdOf(projectsDef, get(createBSample(), "projects", "projects_0")), null);
});

// ---------------------------------------------------------------- timeline: the screen and the plan

test("screen: a timeline draws a bar per task in bands by status, today as a line, and a day count on the canvas", () => {
  const out = views("timeline", "tasks");
  assert.ok(has(out, 'data-testid="records-timeline"') && has(out, 'aria-label="Tasks timeline"'));
  assert.equal(count(out, 'data-testid="bar-tasks_'), 6);
  for (const k of ["todo", "doing", "done"]) assert.ok(has(out, `data-testid="band-${k}"`), k);
  assert.ok(has(out, 'data-testid="today-line"') && has(out, 'data-testid="timeline-canvas"'));
  assert.ok(has(out, "Collect documents") && has(out, "Draft engagement letter") && has(out, "6 tasks"));
  assert.ok(has(out, 'data-testid="bar-start-tasks_1"') && has(out, 'data-testid="bar-end-tasks_1"') && has(out, 'data-testid="bar-body-tasks_1"'), "a bar has two edges and a body to grab");
  assert.ok(has(out, 'data-testid="records-dates"') && has(out, "Start to Due") && has(out, 'aria-label="View as, Timeline"'));
  assert.ok(!has(out, 'data-testid="cascade"'), "no proposal until something slips");
  assert.equal(BAR_H, 26);
});

test("a timeline of a type with no dates says so, and a filter that matches nothing says so", () => {
  assert.ok(has(views("timeline", "companies"), "have no date field to draw bars from."));
  assert.ok(has(views("timeline", "tasks", createBSample(), { find: "zzzz" }), "Nothing matches these filters."));
});

test("timeline drag moves dates and shows the cascade: the plan reschedules the task and proposes the later tasks that would move", async () => {
  const s = createBSample();
  const range = rangeOf(TASKS_DEF)!;
  const row = get(s, "tasks", "tasks_1");
  const bar = barsOf([row], range, "name")[0]!;
  const moved = await moveBar(s.data, TASKS_DEF, range, row, dragBar(bar, 2 * DAY_W, "end"));
  assert.deepEqual(s.calls.map((c) => c.cap), ["projects.reschedule", "projects.cascade"], "a project task goes through the plan, not records.update");
  assert.deepEqual(s.calls[0]!.input, { projectId: "projects_0", taskId: "tasks_1", start: bar.start, due: bar.end + 2 * DAY });
  assert.equal(get(s, "tasks", "tasks_1").fields["due"], bar.end + 2 * DAY, "the dragged task moved");
  assert.equal(projectIdOf(TASKS_DEF, row), moved.projectId);
  const c = moved.cascade!;
  assert.deepEqual(c.moves.map((m) => m.taskId), ["tasks_2", "tasks_3", "tasks_4", "tasks_5"]);
  assert.equal(cascadeLine(c), "4 later tasks move, the consult on Friday still holds");
  assert.equal(get(s, "tasks", "tasks_2").fields["start"], TODAY + 3 * DAY, "nothing else has moved until it is applied");
});

test("Apply moves the later tasks by as much as the task slipped; Keep dates leaves them", async () => {
  const run = async (decision: "apply" | "keep"): Promise<{ s: BSample; moved: number }> => {
    const s = createBSample();
    const range = rangeOf(TASKS_DEF)!;
    const row = get(s, "tasks", "tasks_1");
    const bar = barsOf([row], range, "name")[0]!;
    const m = await moveBar(s.data, TASKS_DEF, range, row, dragBar(bar, 2 * DAY_W, "end"));
    return { s, moved: await decideCascade(s.data, m.projectId!, m.cascade!, decision) };
  };
  const applied = await run("apply");
  assert.equal(applied.moved, 4);
  assert.deepEqual(applied.s.decisions.map((d) => [d.decision, d.moved]), [["apply", 4]]);
  assert.equal(get(applied.s, "tasks", "tasks_2").fields["start"], TODAY + 3 * DAY + 2 * DAY, "two days later");
  assert.equal(get(applied.s, "tasks", "tasks_5").fields["due"], TODAY + 9 * DAY + 2 * DAY + 2 * DAY);
  const kept = await run("keep");
  assert.equal(kept.moved, 0);
  assert.equal(get(kept.s, "tasks", "tasks_2").fields["start"], TODAY + 3 * DAY, "Keep dates keeps them");
  assert.deepEqual(kept.s.decisions.map((d) => d.decision), ["keep"]);
});

test("a move that slips nothing proposes nothing; a record that is not in a project is updated in place", async () => {
  const s = createBSample();
  const range = rangeOf(TASKS_DEF)!;
  const row = get(s, "tasks", "tasks_5");
  const bar = barsOf([row], range, "name")[0]!;
  const last = await moveBar(s.data, TASKS_DEF, range, row, dragBar(bar, 2 * DAY_W, "move"));
  assert.equal(last.cascade, null, "nothing comes after the last task");
  assert.deepEqual(s.calls.map((c) => c.cap), ["projects.reschedule"], "no proposal, so no cascade call");
  const early = createBSample();
  const t1 = get(early, "tasks", "tasks_1");
  const pulled = await moveBar(early.data, TASKS_DEF, range, t1, dragBar(barsOf([t1], range, "name")[0]!, -DAY_W, "move"));
  assert.equal(pulled.cascade, null, "pulling a task earlier moves nothing else");
  const plain = createBSample();
  const p = get(plain, "projects", "projects_0");
  const single = rangeOf(projectsDef)!;
  const out = await moveBar(plain.data, projectsDef, single, p, { start: at(2025, 10, 14), end: at(2025, 10, 14) });
  assert.deepEqual(out, { cascade: null, projectId: null });
  assert.deepEqual(plain.calls.map((c) => [c.cap, (c.input as { patch: unknown }).patch]), [["records.update", { due: at(2025, 10, 14) }]]);
});

test("a refused reschedule says why and moves nothing", async () => {
  const s = createBSample(northRich, { fail: "You cannot edit tasks" });
  const range = rangeOf(TASKS_DEF)!;
  const row = get(s, "tasks", "tasks_1");
  await assert.rejects(moveBar(s.data, TASKS_DEF, range, row, { start: TODAY, end: TODAY + 9 * DAY }), /cannot edit tasks/);
  assert.equal(get(s, "tasks", "tasks_1").fields["due"], row.fields["due"]);
  assert.equal(cascadeLine({ proposalId: "p", moves: [], holds: [], summary: "" }), "Nothing else moves.");
  assert.equal(cascadeLine({ proposalId: "p", moves: [{ taskId: "a" }], holds: [], summary: "" }), "1 later task moves.");
});

// ---------------------------------------------------------------- map

test("a record has a place when it has latitude and longitude, as fields or inside an address; the box fits the pins and north is up", () => {
  const p = pointOf(LOCATIONS_DEF, location(0))!;
  assert.deepEqual([p.lat, p.lng], [37.7749, -122.4194]);
  assert.equal(pointOf(projectsDef, get(createBSample(), "projects", "projects_0")), null);
  const addr = { key: "where", type: "address", title: "Where" };
  const viaAddress = pointOf({ ...projectsDef, fields: [addr] }, { ...location(0), fields: { where: { lat: 10, lng: 20 } } });
  assert.deepEqual([viaAddress?.lat, viaAddress?.lng], [10, 20]);
  assert.equal(pointOf(LOCATIONS_DEF, { ...location(0), fields: { lat: 95, lng: 10 } }), null, "a latitude past the pole is no place");
  const points = [0, 1, 2, 3].map((i) => pointOf(LOCATIONS_DEF, location(i))!);
  const b = boundsOf(points);
  for (const q of points) assert.ok(q.lat > b.minLat && q.lat < b.maxLat && q.lng > b.minLng && q.lng < b.maxLng);
  const sf = plot(points[0]!, b, 640, 420), sj = plot(points[2]!, b, 640, 420), ber = plot(points[3]!, b, 640, 420);
  assert.ok(sj.y > sf.y, "San Jose is south of San Francisco, so lower on the map");
  assert.ok(ber.y < sf.y && ber.x > sf.x, "Berkeley is north and east of San Francisco");
  for (const q of [sf, sj, ber]) assert.ok(q.x >= 0 && q.x <= 640 && q.y >= 0 && q.y <= 420);
  assert.equal(boundsOf([]).minLng, -180);
  const one = boundsOf([points[0]!]);
  assert.ok(one.maxLat - one.minLat >= 0.099, "one pin still has a view");
});

test("screen: a map draws a pin per place on a plain grid and the same places in a list beside it", () => {
  const out = views("map", "locations");
  assert.ok(has(out, 'data-testid="records-map"') && has(out, 'data-testid="map-canvas"') && has(out, 'aria-label="8 places"'));
  assert.equal(count(out, 'data-testid="pin-locations_'), 8);
  assert.equal(count(out, 'data-testid="place-locations_'), 8);
  assert.ok(has(out, "San Francisco office") && has(out, "37.775, -122.419") && has(out, "8 of 8 locations on the map"));
  assert.ok(has(out, 'aria-label="View as, Map"'));
});

test("a map of records with no place says how to give them one", () => {
  const out = views("map", "clients");
  assert.ok(has(out, "have a place yet. Add latitude and longitude fields to see them here."));
  assert.ok(!has(out, 'data-testid="map-canvas"'));
});

// ---------------------------------------------------------------- charts

test("a tally counts records under each option of a field, in the option order; none is last", () => {
  const s = createBSample();
  const status = projectsDef.fields.find((f) => f.key === "status")!;
  const slices = tally(rows(s, "projects"), status, { kind: "count" }, (id) => id);
  assert.deepEqual(slices.map((x) => [x.key, x.label, x.value]), [["planning", "Planning", 3], ["active", "Active", 6], ["done", "Done", 3]]);
  assert.deepEqual(widths(slices), [50, 100, 50]);
  assert.equal(total(slices), 12);
  assert.deepEqual(widths([]), []);
  assert.deepEqual(widths([{ key: "a", label: "A", value: 0, hue: 1 }]), [0], "a chart of nothing is all zeros");
  const blank = tally([{ ...task(0), fields: { status: "" } }, task(1)], TASKS_DEF.fields.find((f) => f.key === "status")!, { kind: "count" }, (id) => id);
  assert.deepEqual(blank.map((x) => x.label), ["Doing", "None"]);
  assert.equal(blank[blank.length - 1]!.hue, -1);
});

test("a tally can sum a money field, group people by name and dates by month in time order", () => {
  const s = createBSample();
  const status = projectsDef.fields.find((f) => f.key === "status")!;
  const sum = tally(rows(s, "projects"), status, { kind: "sum", field: "budget" }, (id) => id);
  assert.deepEqual(sum.map((x) => x.value), [33000, 85250, 45250]);
  assert.equal(valueText(33000, { kind: "sum", field: "budget" }, projectsDef), "$33,000");
  assert.equal(valueText(1234567, { kind: "count" }, projectsDef), "1,234,567");
  assert.equal(measureText({ kind: "sum", field: "budget" }, projectsDef), "Sum of budget");
  assert.equal(measureText({ kind: "count" }, projectsDef), "Number of projects");
  const lead = projectsDef.fields.find((f) => f.key === "lead")!;
  const byLead = tally(rows(s, "projects"), lead, { kind: "count" }, (id) => northRich.people[id] ?? id);
  assert.deepEqual(byLead.map((x) => [x.label, x.value]), [["Irfad Imtiaz", 2], ["Lena Ortiz", 2], ["Maya Chen", 3], ["Omar Haddad", 3], ["Sam Patel", 2]], "people are in name order");
  const opened = LOCATIONS_DEF.fields.find((f) => f.key === "opened")!;
  const byMonth = tally(rows(s, "locations"), opened, { kind: "count" }, (id) => id);
  assert.deepEqual(byMonth.map((x) => x.key), [...byMonth.map((x) => x.key)].sort());
  assert.ok(byMonth.every((x) => /^[A-Z][a-z]{2} \d{4}$/.test(x.label)));
  assert.equal(total(byMonth), 8);
  assert.ok(isGroupField(status) && isGroupField(opened) && !isGroupField(projectsDef.fields[0]!));
  assert.ok(isMeasureField(projectsDef.fields.find((f) => f.key === "budget")!));
});

test("screen: a chart draws a bar per option, the longest full width, the value at its end and the total under it", () => {
  const out = views("charts", "projects");
  assert.ok(has(out, 'data-testid="records-charts"') && has(out, 'aria-label="Projects chart"'));
  assert.ok(has(out, ">Number of projects by status<"));
  for (const k of ["planning", "active", "done"]) assert.ok(has(out, `data-testid="slice-${k}"`), k);
  assert.ok(has(out, 'aria-label="Active, 6"') && has(out, 'aria-label="Planning, 3"'));
  assert.ok(has(out, "12 in total, from 12 of 12 projects"));
  assert.ok(has(out, 'data-testid="records-chart-group"') && has(out, 'data-testid="records-chart-measure"') && has(out, 'aria-label="View as, Charts"'));
  assert.ok(has(out, "width:100%") && has(out, "width:50%"), "the longest bar is full width");
});

test("a saved chart view keeps its group and measure, and a filter charts just what it matches", () => {
  const out = views("table", "projects", createBSample(), undefined, { viewId: "vw_charts" });
  assert.ok(has(out, 'data-testid="records-charts"') && has(out, "Budget by status"));
  assert.ok(has(out, ">Sum of budget by status<") && has(out, "$85,250") && has(out, "$163,500 in total"));
  const done = views("charts", "projects", createBSample(), { clauses: [{ field: "status", op: "eq", value: "done" }] });
  assert.ok(has(done, "3 in total, from 3 of 3 projects") && !has(done, 'data-testid="slice-active"'));
  assert.ok(has(views("charts", "companies"), ">Number of companies by industry<"));
  assert.ok(has(views("charts", "orders"), "have no field to group a chart by."));
});

// ---------------------------------------------------------------- all views

test("the four kinds join part A's switch and each opens as its own kind from a saved view or the kind prop", () => {
  assert.deepEqual(EXTRA_KINDS.map((k) => k.kind), ["calendar", "timeline", "map", "charts"]);
  assert.ok(has(views("table", "projects", createBSample(), undefined, { viewId: "vw_board" }), 'data-testid="records-board"'), "part A's kinds still work beside them");
  for (const [kind, id] of [["calendar", "records-calendar"], ["timeline", "records-timeline"], ["charts", "records-charts"]] as const) assert.ok(has(views(kind, "projects"), `data-testid="${id}"`), kind);
  assert.equal(VIEW_LIMIT, 1000);
});

test("harbor studio draws its three projects on the calendar, timeline and chart", () => {
  const s = createBSample(harborRich);
  assert.ok(has(views("calendar", "projects", s), 'data-testid="records-calendar"'));
  const tl = views("timeline", "projects", s);
  assert.equal(count(tl, 'data-testid="bar-projects_'), 3);
  assert.ok(has(views("charts", "projects", s), "3 in total, from 3 of 3 projects"));
});

test("before data arrives the views draw a frame, never a blank page", () => {
  assert.ok(has(renderToStaticMarkup(<RecordViews kind="timeline" extraKinds={EXTRA_KINDS} />), "records-table-loading"));
});

test("the prototype's looks: Today pill over the line, names held at the left, group counts as done of total, round row rings", () => {
  const out = views("timeline", "tasks");
  assert.ok(has(out, 'data-testid="today-pill"') && has(out, ">Today<"), "the Today pill");
  assert.ok(has(out, 'data-testid="timeline-names"'), "the names column is held at the left");
  assert.ok(has(out, "To do  0/") || has(out, "To do  0/2") || /(To do|Doing|Done)\s+\d+\/\d+/.test(out), "a group counts done of total");
  assert.equal(doneOfTotal(0, 30), "0/30");
  assert.equal(isDoneRow({ fields: { status: "done" } }, "status"), true);
  assert.equal(isDoneRow({ fields: { status: "doing" } }, "status"), false);
  assert.equal(isDoneRow({ fields: { done: true } }, undefined), true);
});

test("calendar chip times read 9:30a and 9a", () => {
  assert.equal(shortTime("9:30 AM"), "9:30a");
  assert.equal(shortTime("9:00 AM"), "9a");
  assert.equal(shortTime("12:30 PM"), "12:30p");
  assert.equal(shortTime("noon"), "noon");
});
