import test from "node:test";
import assert from "node:assert/strict";
import { askAgentOf, isAssistant, readLastAskAgent, writeLastAskAgent } from "./ask-agent.ts";

const assistant = { id: "asst", role: "assistant", status: "awake" };
const designer = { id: "designer", role: "You edit email designs.", status: "awake" };
const sleeper = { id: "sleeper", role: "Reviews", status: "asleep" };

test("the picked agent answers, then the one picked last time", () => {
  assert.equal(askAgentOf([assistant, designer], "asst")?.id, "asst");
  assert.equal(askAgentOf([assistant, designer], null, "asst")?.id, "asst");
  assert.equal(askAgentOf([assistant, designer], "gone", "gone-too")?.id, "designer", "picks that no longer exist fall through");
});

test("with no pick a work agent answers, whatever the list order; the assistant is the fallback", () => {
  assert.equal(askAgentOf([assistant, designer], null)?.id, "designer", "the assistant sorting first does not make it the default");
  assert.equal(askAgentOf([designer, assistant], null)?.id, "designer");
  assert.equal(askAgentOf([assistant, sleeper, designer], null)?.id, "designer", "an agent that is asleep is passed over");
  assert.equal(askAgentOf([assistant], null)?.id, "asst");
  assert.equal(askAgentOf([assistant, sleeper], null)?.id, "asst", "no work agent is awake, so the assistant");
  assert.equal(askAgentOf([], null), null, "nobody to ask: the picker shows and nothing runs");
  assert.ok(isAssistant(assistant) && !isAssistant(designer));
});

test("the last pick is kept per Space", () => {
  const store = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); } };
  try {
    assert.equal(readLastAskAgent("spc_1"), null);
    writeLastAskAgent("spc_1", "a1"); writeLastAskAgent("spc_2", "b1");
    assert.equal(readLastAskAgent("spc_1"), "a1"); assert.equal(readLastAskAgent("spc_2"), "b1");
  } finally { delete (globalThis as { localStorage?: unknown }).localStorage; }
});
