// 5,000 tasks: building the ordered list, grouping it and changing one row each stay inside a frame, and the page mounts only what fits the window.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { buildEntries, DAY, NO_FILTER, sectionsOf, sortRows } from "./model.ts";
import type { TaskRow } from "./model.ts";
import { createTaskStore } from "./store.ts";
import { TaskLine } from "./parts.tsx";
import type { RowEnv } from "./parts.tsx";
import { VirtualList } from "../../../../../../ui/src/VirtualList/index.tsx";

const NOW = Date.UTC(2026, 10, 2, 10);
const me = "usr_me";
const COUNT = 5_000;
const FRAME_MS = 16;
/** A development server render of one window: the browser number comes from the real app. The point here is that the cost follows the window, not the 5,000 rows. */
const FIRST_WINDOW_MS = 250;
const rows: TaskRow[] = Array.from({ length: COUNT }, (_, i) => ({
  id: `tsk_${i}`, key: `VY-${i}`, kind: "work", title: `Task number ${i}`, state: (["todo", "doing", "in_review", "todo"] as const)[i % 4]!, blocked: i % 9 === 0,
  assigned: { kind: i % 3 === 0 ? "agent" : "person", id: i % 3 === 0 ? "agt_mira" : me }, reviewer: i % 5 === 0 ? { kind: "person", id: "usr_sara" } : undefined, due: i % 2 === 0 ? NOW + ((i % 40) - 10) * DAY : undefined,
  labels: i % 7 === 0 ? ["portal"] : [], dependsOn: [], createdBy: me, createdAt: NOW - i * 1000, updatedAt: NOW - i * 60_000, priority: i % 11 === 0 ? "high" : undefined,
} as unknown as TaskRow));
const names = { name: (id: string): string => id, project: (): string | undefined => undefined };
const env: RowEnv = { now: NOW, offsetMin: 0, me, nameOf: (id) => id, project: () => undefined, keyOf: () => undefined, open: () => undefined, openProfile: () => undefined, status: () => undefined, menu: () => undefined, pick: () => undefined, act: () => undefined };
const median = (f: () => void, n = 25): number => { const t: number[] = []; for (let i = 0; i < n; i++) { const a = performance.now(); f(); t.push(performance.now() - a); } t.sort((x, y) => x - y); return t[n >> 1]!; };

test("the ordered list of 5,000 tasks builds inside a frame", () => {
  const ms = median(() => buildEntries({ rows, needs: [], me, now: NOW, offsetMin: 0, scope: "mine", group: "smart", sort: "smart", filter: NO_FILTER, doneRows: null, doneCount: 0, names, quietOff: false }));
  console.log(`METRIC ${JSON.stringify({ name: "tasks_5000", metric: "tasks.build_entries", ms, budget_ms: FRAME_MS })}`);
  assert.ok(ms < FRAME_MS, `${ms} ms`);
  assert.ok(sectionsOf(rows, me, NOW, 0, new Set()).now.length > 0);
});

test("grouping and sorting 5,000 tasks stay inside two frames", () => {
  const ms = median(() => { buildEntries({ rows, needs: [], me, now: NOW, offsetMin: 0, scope: "mine", group: "label", sort: "priority", filter: { ...NO_FILTER, query: "9" }, doneRows: null, doneCount: 0, names, quietOff: false }); sortRows(rows, "title"); }, 9);
  console.log(`METRIC ${JSON.stringify({ name: "tasks_5000", metric: "tasks.group_sort", ms, budget_ms: FRAME_MS * 2 })}`);
  assert.ok(ms < FRAME_MS * 2, `${ms} ms`);
});

test("a status change on one of 5,000 rows shows inside a frame and keeps the other rows", async () => {
  const store = createTaskStore(async () => ({ rev: "1", unchanged: false, rows, doneThisWeek: 0, total: COUNT }), { scope: "mine" });
  store.refresh();
  await new Promise((r) => setTimeout(r, 0));
  const before = store.get().rows;
  const ms = median(() => { const back = store.patch(["tsk_4000"], (r) => ({ ...r, state: "done" })); back(); });
  console.log(`METRIC ${JSON.stringify({ name: "tasks_5000", metric: "tasks.status_patch", ms, budget_ms: FRAME_MS })}`);
  assert.ok(ms < FRAME_MS, `${ms} ms`);
  store.patch(["tsk_4000"], (r) => ({ ...r, state: "done" }));
  assert.equal(store.get().rows[10], before[10], "a row nobody touched is the same object, so it does not redraw");
});

test("the list of 5,000 draws what fits the window, not the rows it holds", () => {
  let html = "";
  const ms = median(() => { html = renderToStaticMarkup(<VirtualList data={rows} rowHeight={48} keyOf={(r) => r.id} renderItem={(r) => <TaskLine row={r} env={env} selected={false} current={false} />} />); }, 7);
  const drawn = (html.match(/data-testid="task-row-/g) ?? []).length;
  console.log(`METRIC ${JSON.stringify({ name: "tasks_5000", metric: "tasks.first_window", ms, rows: drawn, budget_ms: FIRST_WINDOW_MS })}`);
  assert.ok(drawn > 0 && drawn < 40, `${drawn} rows`);
  assert.ok(ms < FIRST_WINDOW_MS, `${ms} ms`);
});
