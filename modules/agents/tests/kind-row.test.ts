// What a client reads to tell the assistant from an agent: the kind, and only on a server from before the column the old role word.
import test from "node:test";
import assert from "node:assert/strict";
import { isAssistantRow } from "../../../lib/agent-kind.ts";

test("the kind decides; a name or a role line does not", () => {
  assert.equal(isAssistantRow({ kind: "assistant", role: "Runs my week" }), true);
  assert.equal(isAssistantRow({ kind: "agent", role: "assistant" }), false);
  assert.equal(isAssistantRow({ kind: "teammate" }), false);
  assert.equal(isAssistantRow({ role: "assistant" }), true, "an older server sends no kind");
  assert.equal(isAssistantRow({ role: "Research Assistant" }), false);
});
