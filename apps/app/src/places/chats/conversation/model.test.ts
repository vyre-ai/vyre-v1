// @tsx
import test from "node:test";
import assert from "node:assert/strict";

test("the same act has one wording: a send that did not go, and a stopped turn (review, 14 Nov)", async () => {
  const { NOT_SENT, TRY_AGAIN } = await import("./model.ts");
  assert.equal(NOT_SENT, "Not sent");
  assert.equal(TRY_AGAIN, "Try again");
});

test("the line above the composer names who is typing and who is working", async () => {
  const { presenceLine } = await import("./model.ts");
  assert.equal(presenceLine([], []), "");
  assert.equal(presenceLine(["Mia"], []), "Mia is typing…");
  assert.equal(presenceLine([], ["Helper"]), "Helper is working…");
  assert.equal(presenceLine(["Mia", "Omar"], ["Helper", "Scout"]), "Mia and Omar are typing, Helper and Scout are working…");
});
