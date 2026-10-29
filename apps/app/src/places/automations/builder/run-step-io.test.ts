// @tsx
import test from "node:test";
import assert from "node:assert/strict";
import { ioFrom } from "./RunStepIo.tsx";

test("a step log read keeps what the server sent and the count of hidden values", () => {
  assert.deepEqual(ioFrom({ step: "a", attempt: 1, input: { x: 1 }, output: { y: "[hidden]" }, hidden: 1, truncated: false }), { input: { x: 1 }, output: { y: "[hidden]" }, hidden: 1, truncated: false });
  assert.deepEqual(ioFrom({ hidden: 0, truncated: true }), { hidden: 0, truncated: true });
  assert.equal(ioFrom(null), null);
});
