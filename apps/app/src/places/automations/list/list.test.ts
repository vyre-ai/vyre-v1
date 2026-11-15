import test from "node:test";
import assert from "node:assert/strict";
import { listView } from "./model.ts";

const rows = [
  { id: "1", name: "Weekly report", state: "on" as const, scope: "Space" as const },
  { id: "2", name: "Invoice reminders", state: "needs" as const, scope: null },
  { id: "3", name: "Notes digest", state: "off" as const, scope: "Shared" as const },
  { id: "4", name: "Daily brief", state: "needs" as const, scope: "Space" as const },
];

test("one list, what needs him first, then by name; a dot for the state and a quiet scope word; the head carries the count", () => {
  const v = listView(rows, "");
  assert.deepEqual(v.head, { title: "Automations", count: 2 });
  assert.deepEqual(
    v.rows.map((r) => [r.name, r.dot, r.scope]),
    [
      ["Daily brief", "amber", "Space"],
      ["Invoice reminders", "amber", null],
      ["Notes digest", "grey", "Shared"],
      ["Weekly report", "green", "Space"],
    ],
  );
});

test("search filters the one list by name; nothing found says so", () => {
  assert.deepEqual(
    listView(rows, "rep").rows.map((r) => r.name),
    ["Weekly report"],
  );
  assert.deepEqual(listView(rows, "zzz").rows, []);
  assert.equal(listView(rows, "zzz").empty, "Nothing called “zzz”.");
  assert.equal(listView([], "").empty, "No automations yet.");
});

test("there are no places in the list: no Failed runs, Templates, Watching, Analytics or Packages", () => {
  const v = listView(rows, "");
  assert.deepEqual(Object.keys(v).sort(), ["empty", "head", "rows"]);
});
