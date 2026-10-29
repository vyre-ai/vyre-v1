// Going live runs admit() on the catalogue contract. Every step has one, the AI and Run code steps included.
import test from "node:test";
import assert from "node:assert/strict";
import { registry } from "../../../generated/registry.ts";
import { admit, contractOf } from "../val.ts";

test("every catalogue step admits as a stable action", () => {
  const failed: string[] = [];
  for (const step of registry.steps) {
    const verdict = admit(contractOf(step));
    if (!verdict.stable) failed.push(`${step.key}: ${verdict.issues.map((item) => item.message).join("; ")}`);
  }
  assert.deepEqual(failed, []);
});
