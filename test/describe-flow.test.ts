// A Flow in plain words: how it starts, each step in the order it runs, and a step that sends marked as held for a yes unless the definition turned asking off.
import test from "node:test";
import assert from "node:assert/strict";
import { describeFlow as words } from "../lib/describe-flow.ts";
import { registry } from "../generated/registry.ts";

const describeFlow = (d: Parameters<typeof words>[0]): string[] => words(d, registry);

test("a lead flow reads as a story: when, then a task, then an email that goes out once it is on", () => {
  const lines = describeFlow({
    triggers: [{ key: "record_change" }],
    nodes: [
      { id: "a", key: "create_task", input: { title: "Call the lead" }, next: ["b"] },
      { id: "b", key: "send_email", title: "Email me the summary", input: {} },
    ],
  });
  assert.deepEqual(lines, ["When a record changes", "Then create a task", "Then email me the summary, goes out once you turn this on"]);
});

test("steps are told in the order they run, not the order they are listed", () => {
  const lines = describeFlow({
    triggers: [{ key: "schedule" }, { key: "webhook" }],
    start: ["z"],
    nodes: [{ id: "y", key: "wait", input: {} }, { id: "z", key: "send_sms", input: {}, askBeforeSending: false, next: ["y"] }],
  });
  assert.deepEqual(lines, ["When on a schedule or a webhook is received", "Then send a text message, goes out once you turn this on", "Then wait"]);
});

test("Turn on names what leaves: a step set to ask is held for a yes, and a code step that names hosts goes out", () => {
  const lines = describeFlow({
    triggers: [{ key: "schedule" }],
    nodes: [
      { id: "a", key: "send_email", title: "Email the client", input: {}, askBeforeSending: true, next: ["b"] },
      { id: "b", key: "code", title: "Post the numbers", input: { hosts: ["api.acme.test"] }, next: ["c"] },
      { id: "c", key: "code", title: "Add it up", input: {} },
    ],
  });
  assert.deepEqual(lines.slice(1), ["Then email the client, held for your yes", "Then post the numbers, goes out once you turn this on", "Then add it up"]);
});

test("a flow with no steps says so, and an unknown trigger or step is named by its key", () => {
  assert.deepEqual(describeFlow({ triggers: [], nodes: [] }), ["When you run it", "It has no steps yet"]);
  assert.deepEqual(describeFlow({ triggers: [{ key: "mystery" }], nodes: [{ id: "a", key: "odd", input: {} }] }), ["When mystery", "Then odd"]);
});
