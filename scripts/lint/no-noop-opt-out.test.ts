import test from "node:test";
import assert from "node:assert/strict";
import { findOptOuts } from "./no-noop-opt-out.ts";

test("no-noop-opt-out: data-noop-ok is found with its line", () => {
  assert.deepEqual(findOptOuts("a.tsx", `const a = 1;\n<ul data-noop-ok="scroll" />`), [{ file: "a.tsx", line: 2 }]);
  assert.deepEqual(findOptOuts("a.tsx", `<ul role="list" />`), []);
});
