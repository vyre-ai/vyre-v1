// The speed half of records-views-a.test.tsx (split out so only this file is a perf file, ruling 46); its functional tests stay in the original file and run on every PR.
// @reads ../../../../../../scripts/shots/mounts/P-L9d_02.tsx
// Records views, part A: Board, Gallery and List. Lanes from a status field with their own cached counts, a card dropped on a lane written through records.update, a gallery whose every card
// has a fixed box and whose covers load lazily, a list of shared Rows, and the switch between them and the table.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import { RecordsDataProvider, RecordsStateProvider, pointOf } from "../sidebar/index.ts";
import type { RecordsState } from "../sidebar/index.ts";
import { PLAIN, countSpec } from "../table/index.ts";
import {
  BODY_H, CARD_GAP, CARD_H, COVER_H, GALLERY_PAD, GALLERY_PAGE, KIND_ORDER, LANE_PAGE, NONE_KEY, RecordViews, badgeFieldOf, cardFields, coverHue, coverOf, galleryLayout, initialsOf, isLaneField, kindOf,
  laneClause, laneCountSpec, laneFieldOf, laneOfRow, laneSpec, lanesOf, moveCard, moveError, movePatch, neighbour, noteOf, pageSpec,
} from "../views-a/index.ts";
import type { RecordRow, TableViewState } from "../views-a/index.ts";
import { SAMPLE_NOW, createViewsSample, harbor, northRich, northwind, project } from "../views-a/sample.ts";
import type { ViewsSample } from "../views-a/sample.ts";

const wrap = (s: ViewsSample, child: ReactElement, initial: Partial<RecordsState> = {}): string =>
  renderToStaticMarkup(<RecordsDataProvider value={s.data}><RecordsStateProvider initial={initial}>{child}</RecordsStateProvider></RecordsDataProvider>).replaceAll("<!-- -->", "");
const views = (kind: string, initial: Partial<RecordsState> = { type: "projects" }, s: ViewsSample = createViewsSample(), view?: Partial<TableViewState>): string =>
  wrap(s, <RecordViews kind={kind} {...(view ? { view } : {})} />, initial);
const has = (s: string, needle: string): boolean => s.includes(needle);
const at = (s: string, needle: string): number => {
  const i = s.indexOf(needle);
  assert.ok(i >= 0, `expected ${needle}`);
  return i;
};
const count = (s: string, needle: string): number => s.split(needle).length - 1;
const laneCount = (out: string, key: string): number => Number(new RegExp(`data-testid="lane-count-${key}"[^>]*>([^<]*)<`).exec(out)?.[1]?.replaceAll(",", "") ?? Number.NaN);
const cardsIn = (out: string, key: string): string[] => {
  const from = out.indexOf(`data-testid="lane-${key}"`);
  if (from < 0) return [];
  const next = out.indexOf('data-testid="drop-', from + 10);
  const part = out.slice(from, next < 0 ? out.length : next);
  return [...part.matchAll(/data-testid="card-([^"]+)"/g)].map((m) => m[1]!);
};
const status = northwind.types.find((t) => t.key === "projects")!.fields.find((f) => f.key === "status")!;
const projects = (s: ViewsSample): RecordRow[] => s.replica.rows("records:projects") as unknown as RecordRow[];
const projectsDef = northRich.types.find((t) => t.key === "projects")!;
const cardsCount = (out: string): number => count(out, 'data-testid="card-');

// ---------------------------------------------------------------- the kinds

test("table100k for the board: 100,014 clients open by asking each lane for forty cards and its cached count", () => {
  const s = createViewsSample(northwind, { bulk: 100_000 });
  const lanes = lanesOf(northwind.types[0]!.fields.find((f) => f.key === "stage")!);
  const stage = northwind.types[0]!.fields.find((f) => f.key === "stage")!;
  const t0 = performance.now();
  let cards = 0, total = 0;
  for (const lane of lanes) {
    const q = s.data.live("records.query", laneSpec("clients", PLAIN, "name", stage, lane, LANE_PAGE)).getSnapshot();
    const n = s.data.live("records.counts", laneCountSpec("clients", PLAIN, "name", stage, lane)).getSnapshot();
    assert.equal(q.status, "ready");
    assert.equal(n.status, "ready");
    cards += (q as { data: { rows: unknown[] } }).data.rows.length;
    total += (n as { data: { count: number } }).data.count;
  }
  const ms = performance.now() - t0;
  console.log(`METRIC ${JSON.stringify({ name: "board100k", rows: 100_014, data_ms: +ms.toFixed(1), budget_ms: 1000, ok: ms < 1000 })}`);
  assert.equal(total, 100_014);
  assert.equal(cards, 4 * LANE_PAGE);
  assert.ok(ms < 1000, `the data a 100,000 record board opens on arrives in ${ms.toFixed(1)} ms`);
});
