import { test } from "node:test";
import assert from "node:assert/strict";
import { agentOfName, assistantName, markedAgent, namesItsPerson } from "./agent-name.ts";

test("a person's Assistant is named by their first name, the way the agents module names it; an outside agent is credited to its person", () => {
  assert.equal(assistantName("Maya Lin"), "Maya’s Assistant");
  assert.equal(assistantName("james Moss"), "James’ Assistant");
  assert.equal(assistantName(""), "Assistant");
  assert.equal(agentOfName("Maya Lin", "assistant"), "Maya’s Assistant");
  assert.equal(agentOfName("Maya Lin", "outside"), "Maya Lin (Agent)");
});

test("an agent is marked once: a name that already says whose agent it is gets nothing more", () => {
  assert.equal(markedAgent("Dex"), "Dex (Agent)");
  assert.equal(markedAgent("Maya’s Assistant"), "Maya’s Assistant");
  assert.equal(markedAgent("Maya Lin (Agent)"), "Maya Lin (Agent)");
  assert.ok(namesItsPerson("Assistant"));
  assert.ok(!namesItsPerson("Dex"));
});
