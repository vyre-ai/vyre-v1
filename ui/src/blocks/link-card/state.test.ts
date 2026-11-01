// @tsx
// What a work card reads from its target: which read, how the answer is worded, and what hides a card from someone who may not open it.
import test from "node:test";
import assert from "node:assert/strict";
import { HIDDEN_TITLE, doneByState, heldTaskOf, probeOf, stateOf } from "./state.ts";
import type { LinkCardData } from "./model.ts";

const card = (type: string, id: string, via?: string): LinkCardData => ({ icon: "x", lead: "Made", title: "Thing", target: { type, id }, ...(via ? { via } : {}) });

test("each target is read with the capability that says what it is and whether the reader may see it", () => {
  assert.deepEqual(probeOf(card("task", "tsk_1")), { cap: "tasks.get", input: { taskId: "tsk_1" } });
  assert.deepEqual(probeOf(card("run", "run_1")), { cap: "runs.get", input: { runId: "run_1" } });
  assert.deepEqual(probeOf(card("record", "rec_1", "contact")), { cap: "records.get", input: { type: "contact", recordId: "rec_1" } });
  assert.equal(probeOf(card("record", "rec_1")), null, "a record with no type cannot be read");
  assert.equal(probeOf(card("fact", "f")), null);
  assert.equal(probeOf({ icon: "x", lead: "l", title: "t" }), null);
});

test("a Run reads running, waiting on you, done or failed; a task reads its own words; a file or record has no state", () => {
  const run = (status: string) => stateOf(card("run", "r"), { run: { status } });
  assert.deepEqual(run("running"), { text: "Running", tone: "live", live: true });
  assert.equal(run("waiting")!.text, "Waiting on you");
  assert.deepEqual(run("succeeded"), { text: "Done", tone: "ok", live: false });
  assert.equal(run("failed")!.tone, "bad");
  assert.equal(stateOf(card("task", "t"), { task: { state: "awaiting_approval" } })!.text, "Waiting on you");
  assert.equal(stateOf(card("task", "t"), { task: { state: "done" } })!.live, false, "a finished thing is not read again");
  assert.equal(stateOf(card("file", "f"), { file: {} }), null);
  assert.equal(stateOf(card("run", "r"), {}), null);
  assert.equal(HIDDEN_TITLE, "Not shared with you");
});

test("a Flow card reads its Flow, and Turn on reads done once the Flow is on, wherever it was turned on", () => {
  const d = { icon: "flow", lead: "Flow drafted", title: "Weekly", target: { type: "automation", id: "aut_1" } };
  assert.deepEqual(probeOf(d), { cap: "automations.get", input: { automationId: "aut_1" } });
  assert.equal(stateOf(d, { automation: { status: "draft" } })?.text, "Draft");
  assert.equal(stateOf(d, { automation: { status: "draft" } })?.live, true, "a draft is still to be decided");
  assert.equal(stateOf(d, { automation: { status: "on" } })?.text, "On");
  assert.deepEqual(doneByState(d, stateOf(d, { automation: { status: "on" } }) ?? null), ["on"]);
  assert.deepEqual(doneByState(d, stateOf(d, { automation: { status: "draft" } }) ?? null), []);
});

test("a held work card names its task; any other card names nothing", () => {
  assert.equal(heldTaskOf({ icon: "approval", lead: "Approval", title: "records delete", target: { type: "task", id: "tsk_1" } }), "tsk_1");
  assert.equal(heldTaskOf({ icon: "task", lead: "Task", title: "x", target: { type: "task", id: "tsk_1" } }), null);
});
