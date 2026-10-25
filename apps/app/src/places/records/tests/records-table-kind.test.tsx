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
import { NO_PICK, TableView, isPickedRow, pickCount, toggleHeader, togglePick } from "../table/index.ts";

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

test("the scrolling cells of a row are plain elements with the same test ids and words (the scroll budget)", () => {
  const out = render(<TableView type="clients" />, "clients");
  assert.ok(has(out, 'data-testid="recb-'), "each row's scrolling part is there");
  assert.ok(has(out, 'data-testid="rec-'), "and its frozen part");
  assert.ok(has(out, "Active") || has(out, "Lead"), "a choice cell shows its option's words");
});

test("one continuous list: the footer keeps its count, the header checkbox is a real checkbox, and Go to row is there (ruling 51)", () => {
  const out = render(<TableView type="clients" />, "clients");
  assert.ok(has(out, 'data-testid="records-count"') && has(out, 'data-testid="records-select-all"') && has(out, 'role="checkbox"') && has(out, 'aria-checked="false"'));
  assert.ok(has(out, 'data-testid="records-goto"') && has(out, 'aria-label="Go to row"'));
  assert.ok(!has(out, 'data-testid="records-pick-bar"'), "no selection bar until the checkbox is ticked");
  assert.ok(!has(out, "Page 1") && !has(out, "Next page"), "no pagination");
});

test("a person's face in a cell is a plain disc in the shared marble's colours", () => {
  const out = render(<TableView type="clients" />, "clients");
  assert.ok(has(out, 'data-testid="face-'), "faces are there");
  assert.ok(!has(out, "feGaussianBlur"), "no blurred svg per cell");
});

test("picking rows: Cmd-click adds and removes, the header checkbox takes the loaded rows or clears, Select all N is every row", () => {
  const one = togglePick(NO_PICK, "a");
  const two = togglePick(one, "b");
  assert.deepEqual([...two.ids], ["a", "b"]);
  assert.deepEqual([...togglePick(two, "a").ids], ["b"]);
  const head = toggleHeader(NO_PICK, ["a", "b", "c"]);
  assert.deepEqual([...head.ids], ["a", "b", "c"]);
  assert.equal(toggleHeader(head, ["a", "b", "c"]), NO_PICK, "ticking again clears");
  const every = { ids: new Set<string>(), every: true };
  assert.ok(isPickedRow(every, "zzz") && !isPickedRow(NO_PICK, "zzz"));
  assert.equal(pickCount(every, 100014), 100014);
  assert.equal(pickCount(two, 100014), 2);
  assert.deepEqual([...togglePick(every, "x").ids], ["x"], "picking one by one after all starts again");
});
