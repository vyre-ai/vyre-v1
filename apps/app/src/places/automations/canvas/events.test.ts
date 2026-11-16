// rc.32 lane r32-auto, item 2: a Wait picks its event from the events the Space really has (events.types), by the words of its summary, and narrows it with the fields that event carries.
import test from "node:test";
import assert from "node:assert/strict";
import { eventChoices, payloadFields } from "./events.ts";

const types = [
  { name: "task.completed", summary: "A task reached Done.", payload: { taskId: {}, kind: {}, recordId: {} } },
  { name: "record.updated", summary: "A record changed", payload: { properties: { recordId: {}, fields: {} } } },
  { name: "wait.matched", summary: "", payload: {} },
];

test("each event is offered by its summary in words, sorted, and the one the step holds is kept even if the catalogue lacks it", () => {
  assert.deepEqual(
    eventChoices(types, "task.completed").map((c) => [c.name, c.label]),
    [
      ["task.completed", "A task reached Done"],
      ["record.updated", "A record changed"],
      ["wait.matched", "Wait matched"],
    ].sort((a, b) => a[1]!.localeCompare(b[1]!)),
  );
  assert.deepEqual(
    eventChoices([], "legacy.thing_done").map((c) => [c.name, c.label]),
    [["legacy.thing_done", "Legacy thing done"]],
  );
});

test("the fields an event carries are named in words, ids as the thing, and a bare list or a schema both read", () => {
  assert.deepEqual(payloadFields(types, "task.completed"), [
    { key: "taskId", label: "Task" },
    { key: "kind", label: "Kind" },
    { key: "recordId", label: "Record" },
  ]);
  assert.deepEqual(
    payloadFields(types, "record.updated").map((f) => f.key),
    ["recordId", "fields"],
  );
  assert.deepEqual(payloadFields(types, "nothing.here"), []);
});
