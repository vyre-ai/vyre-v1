// The .tsx test path (ruling 21): this file runs through the tsx loader with react-native mapped to react-native-web.
// A React Native component renders to markup in plain node, no jest, no device.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { SampleList, SAMPLE_ROWS } from "./app/src/SampleList.tsx";

test("a React Native component renders every row and marks the selected one", () => {
  const html = renderToStaticMarkup(<SampleList selected="r2" />);
  for (const r of SAMPLE_ROWS) {
    assert.ok(html.includes(r.title), `row title ${r.title}`);
    assert.ok(html.includes(r.note), `row note ${r.note}`);
  }
  assert.match(html, /aria-label="sample list"/);
  assert.equal(html.match(/data-testid="row-r\d(-selected)?"/g)?.length, 3);
  assert.match(html, /data-testid="row-r2-selected"/, "row r2 is the selected one");
});

test("exactly one row is selected", () => {
  const html = renderToStaticMarkup(<SampleList selected="r3" />);
  assert.equal(html.match(/-selected"/g)?.length, 1);
  assert.match(html, /data-testid="row-r3-selected"/);
});
