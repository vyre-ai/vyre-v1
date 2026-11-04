// A task row's menu: the words follow the state (Mark Done or Reopen, Select or Deselect), danger last and alone, and every item does what it says.
import test from "node:test";
import assert from "node:assert/strict";
import { taskRowEntries } from "./row-menu.ts";
import type { TaskRowDo } from "./row-menu.ts";
import type { MenuEntry, MenuItem } from "../../../../../../ui/src/Menu/index.tsx";

const calls: string[] = [];
const d = Object.fromEntries(["open", "toggleSelect", "markDone", "reopen", "status", "assign", "due", "priority", "labels", "moveToProject", "snooze", "duplicate", "remove"].map((k) => [k, () => calls.push(k)])) as unknown as TaskRowDo;
const shape = (e: readonly MenuEntry[]): string[] => e.map((x) => ("separator" in x ? "-" : "head" in x ? "#" : x.label));

test("an open task: Open, Select, Mark Done, then Status, Assign, Due, Priority, Labels, Move, Snooze, then Duplicate and Delete last", () => {
  const e = taskRowEntries({ done: false, selected: false }, d);
  assert.deepEqual(shape(e), ["Open", "Select", "-", "Mark Done", "Status…", "Assign…", "Due…", "Priority…", "Labels…", "Move to a project…", "Snooze…", "-", "Duplicate", "Delete"]);
  const last = e.at(-1) as MenuItem;
  assert.equal(last.danger, true);
  assert.equal(e.filter((x) => "danger" in x && x.danger).length, 1);
});

test("a done task offers Reopen, a selected row Deselect", () => {
  const e = shape(taskRowEntries({ done: true, selected: true }, d));
  assert.ok(e.includes("Reopen") && !e.includes("Mark Done") && e.includes("Deselect") && !e.includes("Select"));
});

test("every item calls its own action", () => {
  calls.length = 0;
  for (const x of taskRowEntries({ done: false, selected: false }, d)) if ("onSelect" in x) x.onSelect?.();
  assert.deepEqual(calls, ["open", "toggleSelect", "markDone", "status", "assign", "due", "priority", "labels", "moveToProject", "snooze", "duplicate", "remove"]);
  calls.length = 0;
  for (const x of taskRowEntries({ done: true, selected: false }, d)) if ("onSelect" in x && x.label === "Reopen") x.onSelect?.();
  assert.deepEqual(calls, ["reopen"]);
});
