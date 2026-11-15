// The How you work talk: what the Assistant is told for the step, the lines of "Vyre knows" read back from memory, the next question and its picks, and the rule for done.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  QUESTIONS,
  answerOf,
  interviewAsk,
  interviewDone,
  loadKnown,
  removeKnown,
  savedFromFacts,
} from "./interview.ts";
import { ASK } from "./said.ts";
import type { CapCall } from "../shell/session/caps.ts";

const SKILLS = ["focus-onboarding", "focus-onboarding-member"].map((n) => [
  n,
  fs.readFileSync(new URL(`../../../../agent/skills/${n}/SKILL.md`, import.meta.url), "utf8"),
]);

test("the focus skills tell the Assistant to ask one question at a time, at most three, and to save each in the card's own fact shapes", () => {
  for (const [name, body] of SKILLS as [string, string][]) {
    assert.match(body, /one question at a time/, name);
    assert.match(body, /never more than three/, name);
    assert.match(body, /memory_propose/, name);
    assert.match(body, /sourceRef `onboarding`/, name);
    assert.match(body, /Never invent or guess/, name);
    for (const q of QUESTIONS)
      assert.ok(body.includes(`\`${q.fact("...")}\``), `${name} names the shape ${q.fact("...")}`);
  }
});

test("a saved fact gives its answer back; other text is not one of the three", () => {
  assert.equal(answerOf("work", "Works as: designer"), "designer");
  assert.equal(answerOf("tools", "Uses every day: Gmail, Sheets"), "Gmail, Sheets");
  assert.equal(answerOf("style", "Prefers answers that are: Full detail"), "Full detail");
  assert.equal(answerOf("work", "Works as: "), null);
  assert.equal(answerOf("work", "Likes tea"), null);
});

test("the list reads the newest current fact of each shape, however it was saved, and ignores closed ones", () => {
  const saved = savedFromFacts([
    { factId: "fct_old", text: "Works as: cook", status: "closed", learnedAt: 5 },
    { factId: "fct_a", text: "Works as: baker", status: "current", learnedAt: 10 },
    { factId: "fct_b", text: "Works as: pastry chef", status: "current", learnedAt: 20 },
    { factId: "fct_c", text: "Uses every day: Gmail", status: "current", learnedAt: 1 },
    { factId: "fct_d", text: "Prefers coffee", status: "current", learnedAt: 1 },
    { factId: "fct_e", text: "Prefers answers that are: x", status: "proposed", learnedAt: 1 },
  ]);
  assert.deepEqual(saved, {
    work: { factId: "fct_b", text: "pastry chef" },
    tools: { factId: "fct_c", text: "Gmail" },
  });
  assert.equal(interviewDone(saved), false, "two of three is not done");
  assert.equal(interviewDone({ ...saved, style: { factId: "fct_f", text: "Full detail" } }), true, "three is done");
});

test("the next question is the first one not saved, with the card's own picks; with all three there is nothing to ask", () => {
  const none = interviewAsk({});
  assert.equal(none.prompt, QUESTIONS[0]!.ask);
  assert.ok(none.suggestions.length >= 2 && none.suggestions.length <= 4);
  assert.equal(interviewAsk({ work: { factId: "f", text: "x" } }).prompt, QUESTIONS[1]!.ask);
  const third = interviewAsk({ work: { factId: "f", text: "x" }, tools: { factId: "g", text: "y" } });
  assert.equal(third.prompt, QUESTIONS[2]!.ask);
  assert.deepEqual(third.suggestions.slice(0, 2), ["Short and to the point", "Full detail"]);
  const all = interviewAsk({
    work: { factId: "f", text: "x" },
    tools: { factId: "g", text: "y" },
    style: { factId: "h", text: "z" },
  });
  assert.deepEqual(all.suggestions, []);
  assert.ok(ASK.interview, "the step has an Assistant line before the first answer");
});

test("the list is read from the person layer's current facts, and a line is removed by its fact", async () => {
  const calls: Array<[string, unknown]> = [];
  const call = (async (cap: string, input: unknown) => {
    calls.push([cap, input]);
    return cap === "memory.facts.list"
      ? { facts: [{ factId: "fct_1", text: "Works as: planner", status: "current", learnedAt: 1 }] }
      : { removed: 1 };
  }) as unknown as CapCall;
  assert.deepEqual(await loadKnown(call), { work: { factId: "fct_1", text: "planner" } });
  await removeKnown(call, "fct_1");
  assert.deepEqual(calls[0], ["memory.facts.list", { layer: "person", status: ["current"], limit: 200 }]);
  assert.deepEqual(calls[1], ["memory.facts.remove", { factIds: ["fct_1"] }]);
});
