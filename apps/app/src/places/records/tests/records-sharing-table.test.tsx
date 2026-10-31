// Records sharing in the table (DESIGN-records-sharing): Share in the header for those who may share, Shared with me for a viewer given rows by name, a mark on the rows that differ from their type,
// and nothing at all in a Personal Space. Rendered against the sample Space with a stand-in answer for access.record_marks.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import type { LiveQuery } from "../../../../../../client/src/index.ts";
import { RecordsDataProvider, RecordsStateProvider } from "../sidebar/index.ts";
import type { RecordsData } from "../sidebar/index.ts";
import { TableView } from "../table/index.ts";
import { createSampleRecords, northwind } from "../table/sample.ts";

const NONE = { manage: false, share: false, export: false };
function page(opts: { team: boolean; marks?: unknown }): string {
  const s = createSampleRecords(northwind);
  const state = { status: "ready", data: opts.marks ?? { typeShared: false, audience: "space", can: NONE, rows: [] } } as never;
  const data = {
    ...s.data,
    ...(opts.team ? { share: { open: () => undefined } } : {}),
    live: (cap: string, input: unknown) => (cap === "access.record_marks" ? ({ subscribe: () => () => undefined, getSnapshot: () => state } as LiveQuery<unknown>) : s.data.live(cap as never, input as never)),
  } as unknown as RecordsData;
  return renderToStaticMarkup(<RecordsDataProvider value={data}><RecordsStateProvider initial={{}}><TableView /></RecordsStateProvider></RecordsDataProvider>).replaceAll("<!-- -->", "");
}
const has = (s: string, needle: string): boolean => s.includes(needle);

test("a Personal Space shows nothing about sharing", () => {
  const out = page({ team: false, marks: { typeShared: true, audience: "space", can: { manage: true, share: true, export: true }, rows: [{ id: "cl_0", audience: "me", direct: 0, mine: true }] } });
  assert.ok(!has(out, "records-share-btn") && !has(out, "records-shared") && !has(out, 'data-testid="mark-'));
});

test("the Share button is drawn for someone who may share, and not for a viewer", () => {
  assert.ok(has(page({ team: true, marks: { typeShared: false, audience: "space", can: { manage: true, share: true, export: true }, rows: [] } }), 'data-testid="records-share-btn"'));
  assert.ok(has(page({ team: true, marks: { typeShared: false, audience: "space", can: { manage: false, share: true, export: false }, rows: [] } }), 'data-testid="records-share-btn"'), "a person with the right to share it on");
  assert.ok(!has(page({ team: true }), "records-share-btn"));
});

test("Export is drawn for someone who may export and is not there for anyone else, disabled or not", () => {
  assert.ok(has(page({ team: true, marks: { typeShared: false, audience: "space", can: { manage: false, share: false, export: true }, rows: [] } }), 'data-testid="records-export-btn"'));
  assert.ok(!has(page({ team: true, marks: { typeShared: true, audience: "added", can: NONE, rows: [] } }), "records-export-btn"));
  assert.ok(!has(page({ team: true }), "records-export"));
  assert.ok(!has(page({ team: false, marks: { typeShared: false, audience: "space", can: { manage: true, share: true, export: true }, rows: [] } }), "records-export-btn"), "a Personal Space keeps the menu entries it had");
});

test("Shared with me is offered to a viewer who was given the type or a row by name, and to no one else", () => {
  assert.ok(has(page({ team: true, marks: { typeShared: true, audience: "added", can: NONE, rows: [] } }), 'data-testid="records-shared"'));
  assert.ok(has(page({ team: true, marks: { typeShared: false, audience: "space", can: NONE, rows: [{ id: "cl_1", audience: "space", direct: 0, mine: true }] } }), 'data-testid="records-shared"'));
  assert.ok(!has(page({ team: true }), "records-shared"));
});

test("a row set apart from its type shows a lock, a row given to people shows two people, the rest show nothing", () => {
  const out = page({ team: true, marks: { typeShared: false, audience: "space", can: NONE, rows: [{ id: "cl_0", audience: "me", direct: 0, mine: false }, { id: "cl_1", audience: "space", direct: 2, mine: false }] } });
  assert.ok(has(out, 'data-testid="mark-cl_0"') && has(out, "Set apart from its type"), "the lock");
  assert.ok(has(out, 'data-testid="mark-cl_1"') && has(out, "Shared with people"), "the people");
  assert.ok(!has(out, 'data-testid="mark-cl_2"'));
});
