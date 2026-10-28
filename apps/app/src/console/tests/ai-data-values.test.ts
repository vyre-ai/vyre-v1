import test from "node:test";
import assert from "node:assert/strict";
import { amountInMicros, limitDraft, policySelection, reviewSampling } from "../pages/ai-data-values.ts";

test("spend limits preserve exact six-decimal dollar values and reject unsafe values", () => {
  assert.equal(amountInMicros(" 12.000001 "), 12_000_001);
  assert.equal(amountInMicros("0"), 0);
  assert.equal(amountInMicros(""), undefined);
  for (const input of ["-1", "1e6", "NaN", "Infinity", "1.0000001", "9007199255"]) assert.throws(() => amountInMicros(input));
});

test("clearing a limit removes it without turning blank or invalid fields into zero", () => {
  assert.deepEqual(limitDraft({ run: "", day: "2.50", month: "", turns: "12", time: "30" }), { dayMicros: 2_500_000, turnsPerDay: 12, timeMinutesPerRun: 30 });
  assert.throws(() => limitDraft({ run: "", day: "", month: "", turns: "1.5", time: "" }));
});

test("selected-only policies cannot accidentally broaden access when their last choice is removed", () => {
  assert.deepEqual(policySelection("all", []), []);
  assert.deepEqual(policySelection("selected", ["openai", "openai", "anthropic"]), ["openai", "anthropic"]);
  assert.throws(() => policySelection("selected", []), /Choose at least one/);
});

test("review sampling accepts only a bounded percent and known labels", () => {
  assert.deepEqual(reviewSampling({ percent: 25, labels: ["confidential", "restricted"] }), { percent: 25, labels: ["confidential", "restricted"] });
  for (const value of [{ percent: -1, labels: [] }, { percent: 101, labels: [] }, { percent: 5.5, labels: [] }, { percent: 5, labels: ["secret"] }, null]) assert.throws(() => reviewSampling(value));
});
