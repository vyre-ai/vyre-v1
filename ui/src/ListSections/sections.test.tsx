// ui/ListSections: Personal, Shared with me, Space in that order; every row is a ui/Row; missing sections stay present.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { ListSections } from "./index.tsx";

test("sections render in order even when given out of order, and a missing one is present and empty", () => {
  const html = renderToStaticMarkup(
    <ListSections type="files" sections={[{ name: "Space", rows: [{ id: "s1", title: "Handbook" }] }, { name: "Personal", rows: [{ id: "p1", title: "Notes", note: "Today" }] }]} />,
  );
  const p = html.indexOf("section-Personal"), sh = html.indexOf("section-Shared with me"), sp = html.indexOf("section-Space");
  assert.ok(p >= 0 && p < sh && sh < sp, "order is Personal, Shared with me, Space");
  assert.match(html, /data-testid="row-p1"/);
  assert.match(html, /data-testid="row-s1"/);
});

test("the selected row is the only one painted as selected", () => {
  const html = renderToStaticMarkup(
    <ListSections type="records" selectedId="p2" sections={[{ name: "Personal", rows: [{ id: "p1", title: "A" }, { id: "p2", title: "B" }] }]} />,
  );
  assert.equal(html.match(/aria-selected="true"/g)?.length, 1);
});
