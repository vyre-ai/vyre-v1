// The Home sidebar: order, counts and search (pure), and the rows it draws.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { HomeSidebarItems, HomeSidebarProvider, SAMPLE_HOME_SIDEBAR, fixedRows, folderRows, visibleFolders } from "./index.ts";

const draw = (query = "", selected?: string): string => renderToStaticMarkup(
  <HomeSidebarProvider value={{ data: SAMPLE_HOME_SIDEBAR, go: () => undefined, ...(selected !== undefined ? { selected } : {}) }}><HomeSidebarItems query={query} /></HomeSidebarProvider>,
);

test("the fixed rows are Home, My work, Assigned by you and Runs, with the counts from the data; folders follow in the prototype's order", () => {
  assert.deepEqual(fixedRows(SAMPLE_HOME_SIDEBAR, "").map((r) => [r.id, r.title, r.count]), [["home", "Home", undefined], ["work", "My work", 5], ["assigned", "Assigned by you", 3], ["runs", "Runs", 3]]);
  assert.deepEqual(visibleFolders(SAMPLE_HOME_SIDEBAR, "").map((f) => f.key), ["starred", "following", "recent"]);
  assert.equal(folderRows(SAMPLE_HOME_SIDEBAR, "starred", "").length, 5);
});

test("search narrows the fixed rows and the folders; a folder with nothing left is not drawn", () => {
  assert.deepEqual(fixedRows(SAMPLE_HOME_SIDEBAR, "runs").map((r) => r.id), ["runs"]);
  assert.deepEqual(folderRows(SAMPLE_HOME_SIDEBAR, "starred", "briefing").map((r) => r.title), ["Morning briefing"]);
  assert.deepEqual(visibleFolders(SAMPLE_HOME_SIDEBAR, "pruitt").map((f) => f.key), ["following", "recent"]);
  assert.deepEqual(visibleFolders(SAMPLE_HOME_SIDEBAR, "zzz"), []);
});

test("it draws every fixed row with its count, three folders with their rows, and marks the selected row", () => {
  const html = draw("", "work");
  for (const id of ["row-hs-home", "row-hs-work", "row-hs-assigned", "row-hs-runs", "hs-folder-starred", "hs-folder-following", "hs-folder-recent", "row-hs-starred-s1", "row-hs-recent-r5"]) assert.ok(html.includes(`data-testid="${id}"`), id);
  assert.match(html, /Running · compiled \/intake in 412/);
  assert.match(html.match(/<[^>]*data-testid="row-hs-work"[^>]*>/)?.[0] ?? "", /aria-selected="true"|selected/);
  assert.ok(draw("zzz").includes("Nothing matches that."));
});
