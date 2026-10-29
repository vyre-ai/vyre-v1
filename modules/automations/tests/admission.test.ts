// Going live runs admit() on the catalogue contract. AI stays a preview. Every other step has a contract.
import test from "node:test";
import assert from "node:assert/strict";
import { registry } from "../../../generated/registry.ts";
import { admit, contractOf } from "../val.ts";

test("every catalogue step except AI admits as a stable action", () => {
  const failed: string[] = [];
  for (const step of registry.steps) {
    const verdict = admit(contractOf(step, step.key === "ai" ? "preview" : "live"));
    if (step.key === "ai") {
      assert.equal(verdict.stable, false);
      assert.ok(verdict.issues.some((item) => item.code === "capability.availability"));
      continue;
    }
    if (!verdict.stable) failed.push(`${step.key}: ${verdict.issues.map((item) => item.message).join("; ")}`);
  }
  assert.deepEqual(failed, []);
});
