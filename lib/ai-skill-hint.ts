// An AI step in Answer mode is one reply with no tools (r40 audit, gap 7), so it cannot load a skill or open a file. A prompt that asks for one is told so when the Flow is saved and in the builder, and
// the way to get it is named: switch the step to Task, an agent turn with its tools.

/** Does this prompt ask the model to use a skill? */
export const asksForSkill = (prompt: unknown): boolean => typeof prompt === "string" && /\bskills?\b/i.test(prompt);

export const SKILL_NEEDS_TASK =
  "This AI step answers in one turn with no tools, so it cannot load a skill. Switch the step to Task: an agent with its tools can.";
