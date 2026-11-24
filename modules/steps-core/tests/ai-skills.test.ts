// An AI step is given the Space's skills (rc.41): "draft the welcome email with the intake skill" works in an Automation. The named skills are read as the step's agent (or the Automation's person), their instructions go in the brief
// of an answer step and of a task, and a skill that is not there stops the step with a line that names it instead of running without it.
import test from "node:test";
import assert from "node:assert/strict";
import { harness } from "../fixtures/db.ts";
import { runStep } from "../handlers/control.ts";
import { aiStep } from "../handlers/ai-step.ts";
import type { StepCall, StepNode } from "../handlers/control.ts";

type H = ReturnType<typeof harness>;
const run = (h: H, node: StepNode, c: StepCall) =>
  runStep({ ...h.env, ai: (n, i, cl) => aiStep(h.env, n, i, cl) }, node, c);
const call = (over: Partial<StepCall> = {}): StepCall =>
  ({ attempt: 1, key: "run_t1:ask:1", outputs: {}, resumed: false, trigger: {}, ...over }) as StepCall;
const ask = (input: Record<string, unknown>, ai?: Record<string, unknown>, key = "ai"): StepNode => ({
  id: "ask",
  key,
  input,
  ...(ai ? { ai } : {}),
});
const messageOf = (e: unknown): string => (e as { error?: { message?: string } } | null)?.error?.message ?? "";
const INTAKE = {
  skill: {
    name: "intake",
    description: "How we take on a new client",
    body: "Greet the client by first name. Never quote a fee in the first email.",
    files: [{ path: "tone.md", text: "Warm, brief, no jargon." }],
  },
};
const turn = { text: "Hi Dana.", keyUsed: "#k", modelUsed: "m", tokensIn: 1, tokensOut: 1 };

test("an answer step loads the skills it names and puts their instructions in the brief, after the goal", async () => {
  const h = harness({
    "skills.load": (i) =>
      i.name === "intake"
        ? INTAKE
        : (() => {
            throw { error: { message: "no" } };
          })(),
    "engine.step_turn": () => turn,
  });
  await run(h, ask({ prompt: "Draft the welcome email." }, { skills: ["intake"] }), call());
  assert.deepEqual(h.only("skills.load")[0]!.input, { name: "intake" });
  const prompt = String(h.only("engine.step_turn")[0]!.input.prompt);
  assert.match(
    prompt,
    /## Goal\nDraft the welcome email\.\n\n## Skills: your instructions for this work\n### intake: How we take on a new client\nGreet the client by first name\./,
  );
  assert.match(prompt, /File tone\.md:\nWarm, brief, no jargon\./);
  assert.match(prompt, /the skills above are written here for you to follow/);
  assert.doesNotMatch(prompt, /you cannot load a skill/);
});

test("the step's agent is asked for the skill, so the agent's own skills win over the Space's", async () => {
  const h = harness({ "skills.load": () => INTAKE, "engine.step_turn": () => turn });
  await run(h, ask({ prompt: "Draft it." }, { skills: ["intake"], agentId: "agt_writer" }), call());
  assert.deepEqual(h.only("skills.load")[0]!.input, { name: "intake", agentId: "agt_writer" });
});

test("a skill that is not there stops the step with its name and nothing is asked of the model", async () => {
  const h = harness({
    "skills.load": () => {
      throw { error: { code: "validation.not_found", message: "There is no skill called intake." } };
    },
    "engine.step_turn": () => turn,
  });
  await assert.rejects(run(h, ask({ prompt: "Draft it." }, { skills: ["intake"] }), call()), (e) => {
    assert.match(
      messageOf(e),
      /the skill "intake" is not available \(There is no skill called intake\)\. Choose another skill, or ask an admin to add it to the Space\./,
    );
    return true;
  });
  assert.equal(h.only("engine.step_turn").length, 0);
});

test("a step with no skills asks nothing of the skills library and keeps the no-tools rule as it was", async () => {
  const h = harness({ "engine.step_turn": () => turn });
  await run(h, ask({ prompt: "Draft it." }), call());
  assert.equal(h.only("skills.load").length, 0);
  assert.match(String(h.only("engine.step_turn")[0]!.input.prompt), /you cannot load a skill or open a file/);
});

test("the same skill named twice is loaded once, at most five are taken, and a long skill is cut to a size a brief can carry", async () => {
  const big = { skill: { name: "big", body: "x".repeat(40_000) } };
  const h = harness({ "skills.load": (i) => (i.name === "big" ? big : INTAKE), "engine.step_turn": () => turn });
  await run(h, ask({ prompt: "Go." }, { skills: ["intake", "intake", "big", "a", "b", "c", "d"] }), call());
  assert.deepEqual(
    h.only("skills.load").map((c) => c.input.name),
    ["intake", "big", "a", "b", "c"],
  );
  const prompt = String(h.only("engine.step_turn")[0]!.input.prompt);
  assert.ok(prompt.length < 60_000, "the skills are cut");
  assert.match(prompt, /xxx\.\.\./);
});

test("a task step puts the skills in its brief too, and the agent keeps its own tools under the Gate", async () => {
  const taskState = { id: "tsk_w1", state: "todo", workingNotes: {} as Record<string, string> };
  const h = harness({
    "skills.load": () => INTAKE,
    "tasks.create": () => ({ task: { id: taskState.id, threadId: "thr_w1" } }),
    "tasks.get": () => ({ task: { ...taskState } }),
    "threads.set_mode": () => ({}),
    "chat.post": () => ({ message: {} }),
    "access.principals.list": () => ({ principals: [] }),
    "tasks.working_notes.set": (i) => {
      Object.assign(taskState.workingNotes, i.notes ?? {});
      return { ok: true };
    },
  });
  const node = ask(
    { prompt: "Draft the welcome email with the intake skill." },
    { mode: "task", agentId: "agt_doer", skills: ["intake"] },
  );
  await run(h, node, call()).catch(() => undefined);
  assert.deepEqual(h.only("skills.load")[0]!.input, { name: "intake", agentId: "agt_doer" });
  const made = JSON.stringify(h.log.map((c) => c.input));
  assert.match(made, /Skills: your instructions for this work/);
  assert.match(made, /Never quote a fee in the first email\./);
  assert.doesNotMatch(made, /you cannot load a skill/);
});
