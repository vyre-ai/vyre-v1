// @tsx
import test from "node:test";
import assert from "node:assert/strict";

test("the same act has one wording: a send that did not go, and a stopped turn (review, 14 Nov)", async () => {
  const { NOT_SENT, TRY_AGAIN } = await import("./model.ts");
  assert.equal(NOT_SENT, "Not sent");
  assert.equal(TRY_AGAIN, "Try again");
});
