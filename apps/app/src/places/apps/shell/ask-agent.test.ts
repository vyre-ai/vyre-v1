import test from "node:test";
import assert from "node:assert/strict";
import { askAgentOf, isAssistant } from "./ask-agent.ts";

const list = [{ id: "a1", role: "You edit email designs." }, { id: "a2", role: "assistant" }, { id: "a3" }];

test("the picked agent answers", () => { assert.equal(askAgentOf(list, "a3")?.id, "a3"); });
test("with no pick the assistant answers, whatever its place in the list", () => {
  assert.equal(askAgentOf(list, null)?.id, "a2");
  assert.equal(askAgentOf([...list].reverse(), "")?.id, "a2");
  assert.ok(isAssistant({ id: "x", role: "assistant" }) && !isAssistant({ id: "y" }));
});
test("with no assistant the first agent answers, and with none there is nobody", () => {
  assert.equal(askAgentOf([{ id: "b1" }, { id: "b2" }], null)?.id, "b1");
  assert.equal(askAgentOf([], null), null);
  assert.equal(askAgentOf(list, "gone")?.id, "a2", "a pick that no longer exists falls back to the assistant");
});
