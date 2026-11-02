import test from "node:test";
import assert from "node:assert/strict";
import { kindLabel } from "./pages-a.tsx";

test("a notification kind reads as words, with no template left in it", () => {
  assert.equal(kindLabel("Approval needed: {{title}}"), "Approval needed");
  assert.equal(kindLabel("{{from}} mentioned you in {{where}}"), "Someone mentioned you in a chat");
  assert.equal(kindLabel("{{from}} asks for {{level}} access to {{title}}"), "Someone asks for more access to something");
  assert.equal(kindLabel("While you were away"), "While you were away");
});
