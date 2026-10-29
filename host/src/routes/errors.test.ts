// A step failure the engine named keeps its code. The words that came from a step's own output are replaced; the engine's own words stay.
import test from "node:test";
import assert from "node:assert/strict";
import { toVyreError } from "./errors.ts";

const T = "t".repeat(32);
/** The shape a step failure takes when it reaches the host (modules/steps-core stepError). */
const stepError = (code: string, message: string): Error => Object.assign(new Error(message), { error: { code, message, retryable: false } });

test("run.branch_failed and run.loop_failed never carry a child Run's reason", () => {
  const leak = "provider said: Bearer sk_live_LEAK customer 4242";
  for (const code of ["run.branch_failed", "run.loop_failed"]) {
    const { error, unexpected } = toVyreError(stepError(code, `lane x did not finish: ${leak}`), T);
    assert.equal(unexpected, false);
    assert.equal(error.code, code);
    assert.equal(error.message.includes("LEAK"), false, error.message);
    assert.equal(error.message.includes("provider said"), false, error.message);
    assert.equal(error.message.includes("4242"), false, error.message);
  }
});

test("a failed lane keeps its name and loses the reason", () => {
  assert.equal(toVyreError(stepError("run.branch_failed", "The lane Bad did not finish: the mailbox is gone"), T).error.message, "The lane Bad did not finish.");
  assert.equal(toVyreError(stepError("run.loop_failed", "Item 3 of 4 failed: no address"), T).error.message, "Item 3 of 4 failed.");
});

test("a run error the engine worded itself keeps its words, and anything else stays internal", () => {
  const own = toVyreError(stepError("run.loop_too_large", "A loop allows at most 1000 iterations."), T);
  assert.equal(own.error.message, "A loop allows at most 1000 iterations.");
  assert.equal(toVyreError(stepError("run.stopped", "Stopped by the author."), T).error.message, "Stopped by the author.");
  assert.equal(toVyreError(stepError("run.stopped", "two\nlines"), T).unexpected, true);
  assert.equal(toVyreError(stepError("provider.error", "raw provider text"), T).unexpected, true);
});
