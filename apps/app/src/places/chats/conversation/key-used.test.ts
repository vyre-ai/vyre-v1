// @tsx
import test from "node:test";
import assert from "node:assert/strict";
import { keyAlreadyUsed } from "./model.ts";

test("a send whose key the server says was used before is already in the thread, so its Not sent bubble goes; any other failure stays", () => {
  assert.equal(keyAlreadyUsed({ code: "validation.precondition_failed", details: { reason: "idempotency_conflict", cap: "chat.post" } }), true);
  assert.equal(keyAlreadyUsed(new TypeError("fetch failed")), false);
  assert.equal(keyAlreadyUsed({ code: "validation.precondition_failed", details: { reason: "other" } }), false);
  assert.equal(keyAlreadyUsed(null), false);
});
