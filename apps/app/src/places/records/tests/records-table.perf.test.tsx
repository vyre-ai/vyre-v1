// The speed half of records-table.test.tsx (split out so only this file is a perf file, ruling 46); its functional tests stay in the original file and run on every PR.
// Records sidebar and table: the screen. Types in their groups with counts, saved views, the sheet with its columns and rows drawn from a window, the header menus' model, and the
// 100,000 row Space that opens under the table100k budget. The table draws only the rows and columns that meet the screen; the foot count is the cached count.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import { RecordsDataProvider, RecordsSidebar, RecordsStateProvider, SidebarLoading, compact, effectiveType, reduce, sortedViews, typeGroups, INITIAL_STATE } from "../sidebar/index.ts";
import type { RecordsState } from "../sidebar/index.ts";
import {
  FLING_OVERSCAN, GUTTER, PLAIN, ROW_H, TableLoading, TableView, cellText, chosen, clearClauses, colourOf, columnWindow, columnsOf, countSpec, cycleSort, filterOf, fromSaved, groupItems, isEdited,
  optionsOf, queryOffset, querySpec, rowWindow, setSort, toSaved, toggleHidden, toggleOption, totalWidth,
} from "../table/index.ts";
import type { RecordRow, TableViewState } from "../table/index.ts";
import { SAMPLE_NOW, client, createSampleRecords, harbor, northwind } from "../table/sample.ts";
import type { SampleRecords, SampleSpace } from "../table/sample.ts";

const wrap = (s: SampleRecords, child: ReactElement, initial: Partial<RecordsState> = {}): string =>
  renderToStaticMarkup(<RecordsDataProvider value={s.data}><RecordsStateProvider initial={initial}>{child}</RecordsStateProvider></RecordsDataProvider>).replaceAll("<!-- -->", "");
const table = (view?: Partial<TableViewState>, initial: Partial<RecordsState> = {}, space: SampleSpace = northwind, o: { online?: boolean; bulk?: number } = {}): string =>
  wrap(createSampleRecords(space, o), <TableView {...(view ? { view } : {})} />, initial);
const side = (initial: Partial<RecordsState> = {}, space: SampleSpace = northwind): string => wrap(createSampleRecords(space), <RecordsSidebar />, initial);
const has = (s: string, needle: string): boolean => s.includes(needle);
const at = (s: string, needle: string): number => {
  const i = s.indexOf(needle);
  assert.ok(i >= 0, `expected ${needle}`);
  return i;
};
const recs = (out: string): string[] => [...out.matchAll(/data-testid="rec-([^"]+)"/g)].map((m) => m[1]!).filter((k) => !k.startsWith("pending"));
const name = (i: number): string => String(client(i).fields["name"]);

test("table100k: a 100,000 row Space opens by asking for a window, and the foot says how many", () => {
  const s = createSampleRecords(northwind, { bulk: 100_000 });
  wrap(createSampleRecords(), <TableView />);
  // what scales with the rows is the data path: the type, the cached count and the first 200 rows
  const t0 = performance.now();
  const kind = s.data.live("schema.describe", { type: "clients" }).getSnapshot();
  const count = s.data.live("records.counts", countSpec("clients", PLAIN, "name")).getSnapshot();
  const first = s.data.live("records.query", querySpec("clients", PLAIN, "name", 0)).getSnapshot();
  const dataMs = performance.now() - t0;
  const t1 = performance.now();
  const out = wrap(s, <TableView />);
  const renderMs = performance.now() - t1;
  console.log(`METRIC ${JSON.stringify({ name: "table100k", rows: 100_014, data_ms: +dataMs.toFixed(1), render_ms: +renderMs.toFixed(1), budget_ms: 100, ok: dataMs < 100 })}`);
  assert.deepEqual([kind.status, count.status, first.status], ["ready", "ready", "ready"]);
  assert.equal((count as { data: { count: number } }).data.count, 100_014);
  assert.equal((first as { data: { rows: unknown[] } }).data.rows.length, 200);
  assert.ok(dataMs < 100, `the data a 100,000 row table opens on arrives in ${dataMs.toFixed(1)} ms, under the 100 ms budget`);
  assert.ok(renderMs < 1000, `drawing the window took ${renderMs.toFixed(1)} ms`);
  assert.ok(has(out, "100,014 clients"));
  assert.ok(has(out, `height:${100_014 * ROW_H}px`), "the body reserves the full height so scrolling never shifts the layout");
  assert.equal(out.split("position:sticky").length - 1 <= 8, true, "no sticky element per row: the frozen left is one layer, so a scroll does not re-resolve a sticky offset for every drawn row");
  assert.ok(has(out, 'data-testid="records-frozen"'), "the row numbers and titles sit in one frozen layer");
  const drawn = recs(out).length;
  assert.ok(drawn > 10 && drawn <= 40, `draws a window of ${drawn} rows, not 100,014`);
  const deep = s.data.live("records.query", querySpec("clients", PLAIN, "name", queryOffset(60_000, 100_014))).getSnapshot();
  assert.equal(deep.status, "ready");
  assert.equal((deep as { data: { rows: unknown[] } }).data.rows.length, 200, "a deep window is 200 rows");
  assert.equal((deep as { data: { rows: { id: string }[] } }).data.rows[0]!.id, `cl_${queryOffset(60_000, 100_014)}`);
});
