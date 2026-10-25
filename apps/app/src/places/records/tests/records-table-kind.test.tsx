// @reads ../../../../../../scripts/shots/mounts/P-L9d_01b.tsx
// The table's header carries the view-kind switch: the same button and menu as the Board, Gallery and List, so a person can go from the table to a board and back from either side.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import { RecordsDataProvider, RecordsStateProvider } from "../sidebar/index.ts";
import { KIND_LABEL, KIND_ORDER, RecordViews, kindEntries } from "../views-a/index.ts";
import type { ViewCtx } from "../views-a/index.ts";
import { createViewsSample } from "../views-a/sample.ts";
import { TableView } from "../table/index.ts";
import { FaceImage, marbleUri } from "../table/FaceImage.tsx";

const render = (child: ReactElement, type = "projects"): string => {
  const s = createViewsSample();
  return renderToStaticMarkup(<RecordsDataProvider value={s.data}><RecordsStateProvider initial={{ type }}>{child}</RecordsStateProvider></RecordsDataProvider>).replaceAll("<!-- -->", "");
};
const has = (s: string, needle: string): boolean => s.includes(needle);

test("the table header has the kind switch before New, labelled with the open kind", () => {
  const out = render(<RecordViews kind="table" />);
  assert.ok(has(out, 'data-testid="records-table"') && has(out, 'data-testid="records-kind"') && has(out, 'aria-label="View as, Table"'));
  assert.ok(out.indexOf('data-testid="records-kind"') < out.indexOf('data-testid="records-new"'), "the switch sits before New, as in the other kinds");
  assert.ok(out.indexOf('data-testid="records-colour"') < out.indexOf('data-testid="records-kind"'), "after the quiet Filter, Sort, Group, Fields and Colour buttons");
  assert.ok(!has(out, String.fromCharCode(0x2014)), "no em dash in any copy");
});

test("every kind has the same switch, and the table alone (no host) has none", () => {
  for (const [kind, label] of [["board", "Board"], ["gallery", "Gallery"], ["list", "List"]] as const) assert.ok(has(render(<RecordViews kind={kind} />), `aria-label="View as, ${label}"`), kind);
  assert.ok(!has(render(<TableView type="projects" />), 'data-testid="records-kind"'), "a table drawn on its own has no switch to show");
});

test("switching from the table to a board and back: the menu lists the kinds, checks the open one, and each choice asks for its kind", () => {
  const asked: string[] = [];
  const ctx = (kind: string): ViewCtx => ({ type: "projects", def: { key: "projects", title: "Project", plural: "Projects", icon: "project", label: "internal", system: false, titleField: "name", fields: [], version: 1 }, views: [], saved: undefined,
    base: { clauses: [], sort: [], group: null, hidden: [], colour: null, find: "" }, kind, kinds: KIND_ORDER.map((k) => ({ kind: k, label: KIND_LABEL[k] })), onKind: (k) => void asked.push(k) });
  const fromTable = kindEntries(ctx("table"));
  const labels = fromTable.filter((e) => "label" in e).map((e) => ("label" in e ? e.label : ""));
  assert.deepEqual(labels, ["Table", "Board", "Gallery", "List"]);
  assert.deepEqual(fromTable.filter((e) => "label" in e).map((e) => ("checked" in e ? e.checked === true : false)), [true, false, false, false]);
  const board = fromTable.find((e) => "label" in e && e.label === "Board");
  if (board && "onSelect" in board) board.onSelect?.();
  const fromBoard = kindEntries(ctx("board"));
  assert.deepEqual(fromBoard.filter((e) => "label" in e).map((e) => ("checked" in e ? e.checked === true : false)), [false, true, false, false], "the board is the open kind now");
  const table = fromBoard.find((e) => "label" in e && e.label === "Table");
  if (table && "onSelect" in table) table.onSelect?.();
  assert.deepEqual(asked, ["board", "table"]);
  assert.ok(has(render(<RecordViews kind="board" />), 'data-testid="records-board"') && has(render(<RecordViews kind="table" />), 'data-testid="records-table"'), "and each opens as its own screen");
});

test("a person cell draws its face as a cached image, not a blurred inline svg per row (the scroll budget)", () => {
  const out = renderToStaticMarkup(<FaceImage name="Maya Chen" size={18} />);
  assert.ok(has(out, 'data-face="image"') && has(out, 'src="data:image/svg+xml;charset=utf-8,') && has(out, 'data-testid="face-Maya Chen"'));
  assert.ok(!has(out, "<svg") && !has(out, "<filter"), "no inline svg and no filter element in the row");
  assert.equal(marbleUri("Maya Chen"), marbleUri("Maya Chen"), "the same name gives the same address, built once");
  assert.notEqual(marbleUri("Maya Chen"), marbleUri("Omar Haddad"));
  assert.ok(decodeURIComponent(marbleUri("Maya Chen")).includes("feGaussianBlur"), "it is the shared marble artwork, blur included, rasterised once");
});
