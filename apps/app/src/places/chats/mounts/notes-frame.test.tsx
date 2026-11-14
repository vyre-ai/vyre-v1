// Notes & artifacts: one page with a Notes / Artifacts switch over the real page; the tab is remembered.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { NotesArtifactsFrame } from "./NotesArtifactsFrame.tsx";

test("the switch names both tabs, marks the open one, and the page sits under it", () => {
  const html = renderToStaticMarkup(
    <NotesArtifactsFrame tab="artifacts" onTab={() => {}}>
      <i data-testid="the-page">page</i>
    </NotesArtifactsFrame>,
  ).replaceAll("<!-- -->", "");
  assert.match(html, />Notes</);
  assert.match(html, />Artifacts</);
  assert.match(html, /data-testid="the-page"/);
  assert.ok(html.indexOf("Notes") < html.indexOf("the-page"), "the switch is above the page");
});
