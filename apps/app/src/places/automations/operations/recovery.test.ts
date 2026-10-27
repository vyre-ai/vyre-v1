import test from "node:test";
import assert from "node:assert/strict";
import { choiceStartsRuns, readChoiceResult, scheduleRequestFromTask } from "./recovery.ts";

test("a schedule Needs You task keeps its automation id and its choices", () => {
  const parsed = scheduleRequestFromTask({
    source: { kind: "manual", id: "automation-schedule:aut_1" },
    blocks: [{ type: "checklist", data: { choices: [{ key: "keep_paused", label: "Keep paused" }, { key: "nope", label: "Nope" }] } }],
  });
  assert.deepEqual(parsed, { automationId: "aut_1", choices: [{ key: "keep_paused", label: "Keep paused" }] });
  assert.equal(scheduleRequestFromTask({ source: { id: "other" } }), null);
  assert.equal(choiceStartsRuns("run_latest_n"), true);
  assert.equal(choiceStartsRuns("keep_paused"), false);
});

test("a choice result counts started runs and keeps an error", () => {
  assert.deepEqual(readChoiceResult({ ok: true, started: [{ runId: "run_a" }], paused: false }), { ok: true, started: 1, paused: false });
  assert.equal(readChoiceResult({ ok: false }) , null);
  assert.equal(readChoiceResult({ ok: false, started: [], paused: true, error: "This automation has no schedule." })?.error, "This automation has no schedule.");
});
