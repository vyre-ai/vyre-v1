// The brief an AI step in Answer mode gets says it has no tools (r40 audit, gap 7); the Flow check that warns about it lives in modules/automations/tests/ai-skill.test.ts.
import test from "node:test";
import assert from "node:assert/strict";
import { buildBrief } from "../handlers/brief.ts";

test("the answer brief tells the model it has no tools; the task brief does not say so", () => {
  assert.match(buildBrief({ kind: "answer", goal: "x" }), /you cannot load a skill or open a file/);
  assert.doesNotMatch(buildBrief({ kind: "task", goal: "x" }), /you cannot load a skill/);
});
