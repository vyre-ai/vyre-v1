// An AI step in Answer mode has no tools, so a prompt that asks it to load a skill is told how to get that (r40 audit, gap 7): a warning when the Flow is checked, and the brief says so to the model.
import test from "node:test";
import assert from "node:assert/strict";
import { buildBrief } from "../modules/steps-core/handlers/brief.ts";
import { asksForSkill, SKILL_NEEDS_TASK } from "../lib/ai-skill-hint.ts";
import { validateDefinition } from "../modules/automations/handlers/defs.ts";
import type { Definition } from "../modules/automations/projections.ts";

const POLICY = {
  maxChainDepth: 8,
  defaultAlert: { when: "every", where: "needs_you" },
  runOnImport: false,
  personalSpace: false,
} as const;
const flow = (prompt: string, ai?: Definition["nodes"][number]["ai"]): Definition => ({
  triggers: [{ key: "manual" }],
  nodes: [{ id: "a", key: "ai", input: { prompt }, ...(ai ? { ai } : {}) }],
});
const warned = (d: Definition): string[] =>
  validateDefinition(d, POLICY as never)
    .filter((i) => i.severity === "warning" && i.message === SKILL_NEEDS_TASK)
    .map((i) => i.nodeId ?? "");

test("a prompt that names a skill is recognised", () => {
  assert.equal(asksForSkill("Load the intake skill and draft the letter"), true);
  assert.equal(asksForSkill("Use the Skills library"), true);
  assert.equal(asksForSkill("Draft the letter with great skillfulness"), false);
  assert.equal(asksForSkill(undefined), false);
});

test("an Answer step that asks for a skill gets a warning that says to switch to Task; a Task step does not", () => {
  assert.deepEqual(warned(flow("Load the probate skill, then summarise")), ["a"]);
  assert.deepEqual(warned(flow("Summarise the intake")), []);
  assert.deepEqual(warned(flow("Load the probate skill, then summarise", { mode: "task" })), []);
});

test("the answer brief tells the model it has no tools; the task brief does not say so", () => {
  assert.match(buildBrief({ kind: "answer", goal: "x" }), /you cannot load a skill or open a file/);
  assert.doesNotMatch(buildBrief({ kind: "task", goal: "x" }), /you cannot load a skill/);
});
