// ui/Row: hover and selection span the full width, the height is fixed, the note sits under the title.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { Row, ROW_HEIGHT, ROW_HEIGHT_WITH_NOTE, rowHeight } from "./index.tsx";

test("a selected row paints the selection token on the row itself, full width", () => {
  const html = renderToStaticMarkup(<Row id="a" title="Weekly sync" selected />);
  assert.match(html, /data-testid="row-a"/);
  assert.match(html, /background-color:var\(--sel\)/);
  assert.match(html, /r-width-/, "the row carries a width style");
  assert.doesNotMatch(html, /margin-(left|right|inline)/i, "no horizontal margin that would inset the paint");
});

test("a hovered row paints the hover token and an unselected row does not paint selection", () => {
  const hov = renderToStaticMarkup(<Row id="b" title="Inbox" hovered />);
  assert.match(hov, /background-color:var\(--hover\)/);
  const plain = renderToStaticMarkup(<Row id="c" title="Inbox" />);
  assert.doesNotMatch(plain, /var\(--sel\)|var\(--hover\)/);
});

test("the height is fixed: 28 for one line, 44 with a note", () => {
  assert.equal(rowHeight(), ROW_HEIGHT);
  assert.equal(rowHeight("Updated yesterday"), ROW_HEIGHT_WITH_NOTE);
  assert.match(renderToStaticMarkup(<Row title="One" />), /height:28px/);
  assert.match(renderToStaticMarkup(<Row title="One" note="Two" />), /height:44px/);
});

test("the note renders after the title in the same text column", () => {
  const html = renderToStaticMarkup(<Row title="Launch checklist" note="Updated yesterday" />);
  assert.ok(html.indexOf("Launch checklist") < html.indexOf("Updated yesterday"));
});
