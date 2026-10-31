// The checklist card: a title, a count and a row per item with a tick or an open circle; rows that are not words are dropped, and a thin payload never throws.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { ChecklistCard, checklistOf, isChecklist } from "./checklist.tsx";

const data = { title: "Read tests", items: [{ text: "List meetings: 200", done: true }, { text: "List teams: 401", done: false }, { text: "", done: true }, { nope: 1 }] };

test("rows come out of the block data and rows without words are dropped", () => {
  assert.deepEqual(checklistOf(data), { title: "Read tests", rows: [{ text: "List meetings: 200", done: true }, { text: "List teams: 401", done: false }] });
  assert.deepEqual(checklistOf(null), { title: "", rows: [] });
  assert.equal(isChecklist("checklist"), true);
  assert.equal(isChecklist("plan"), false);
});

test("the card shows the title, how many are done, and each row with its state", () => {
  const html = renderToStaticMarkup(<ChecklistCard id="b1" data={data} />).replaceAll("<!-- -->", "");
  assert.match(html, /Read tests/);
  assert.match(html, /1 of 2/);
  assert.match(html, /List meetings: 200/);
  assert.match(html, /List teams: 401/);
  assert.match(html, /aria-label="Done"/);
  assert.match(html, /aria-label="Not done"/);
  assert.doesNotThrow(() => renderToStaticMarkup(<ChecklistCard id="b2" data={undefined} />));
});
