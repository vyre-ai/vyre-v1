import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { filterObjectRows, moveObjectSelection, ObjectList } from "../objects/ObjectList.tsx";

const rows = [
  { id: "a", title: "Claude Code", note: "anthropic · active", search: "external", filters: ["active"], actions: [{ label: "Revoke", onSelect: () => undefined }] },
  { id: "b", title: "Codex", note: "openai · revoked", search: "cli", filters: ["revoked"], actions: [] },
];

test("object list searches across title, note and adapter search text and applies checked filters", () => {
  assert.deepEqual(filterObjectRows(rows, "anthropic", new Set()).map((row) => row.id), ["a"]);
  assert.deepEqual(filterObjectRows(rows, "cli", new Set(["revoked"])).map((row) => row.id), ["b"]);
  assert.deepEqual(filterObjectRows(rows, "", new Set(["active"])).map((row) => row.id), ["a"]);
});

test("object list keyboard movement is bounded and starts at the first visible object", () => {
  assert.equal(moveObjectSelection(rows, null, "ArrowDown"), "a");
  assert.equal(moveObjectSelection(rows, "a", "ArrowDown"), "b");
  assert.equal(moveObjectSelection(rows, "b", "ArrowDown"), "b");
  assert.equal(moveObjectSelection(rows, "b", "ArrowUp"), "a");
  assert.equal(moveObjectSelection(rows, "a", "Home"), "a");
  assert.equal(moveObjectSelection(rows, "a", "End"), "b");
});

test("object list renders shared rows, search, checked filters and bulk actions", () => {
  const html = renderToStaticMarkup(<ObjectList rows={rows} selectedId="a" onOpen={() => undefined} filters={[{ id: "active", label: "Active" }, { id: "revoked", label: "Revoked" }]} activeFilters={new Set(["active"])} onFilters={() => undefined} picked={new Set(["a"])} onPicked={() => undefined} bulkActions={[{ label: "Revoke selected", onSelect: () => undefined }]} empty="No actors" testID="actor-list" />);
  assert.match(html, /Search/);
  assert.match(html, /Claude Code/);
  assert.match(html, /1 selected/);
  assert.match(html, /Revoke selected/);
  assert.match(html, /actor-list/);
});
