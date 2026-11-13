import test from "node:test";
import assert from "node:assert/strict";
import {
  amountInMicros,
  capsMatch,
  limitDraft,
  policyMatches,
  policyMode,
  policySelection,
  raiseAmount,
  retentionValue,
  reviewSampling,
} from "../pages/ai-data-values.ts";

test("spend limits preserve exact six-decimal dollar values and reject unsafe values", () => {
  assert.equal(amountInMicros(" 12.000001 "), 12_000_001);
  assert.equal(amountInMicros("0"), 0);
  assert.equal(amountInMicros(""), undefined);
  for (const input of ["-1", "1e6", "NaN", "Infinity", "1.0000001", "9007199255"])
    assert.throws(() => amountInMicros(input));
});

test("clearing a limit removes it without turning blank or invalid fields into zero", () => {
  assert.deepEqual(limitDraft({ run: "", day: "2.50", month: "", turns: "12", time: "30" }), {
    dayMicros: 2_500_000,
    turnsPerDay: 12,
    timeMinutesPerRun: 30,
  });
  assert.throws(() => limitDraft({ run: "", day: "", month: "", turns: "1.5", time: "" }));
});

test("selected-only policies cannot accidentally broaden access when their last choice is removed", () => {
  assert.deepEqual(policySelection("all", []), []);
  assert.deepEqual(policySelection("selected", ["openai", "openai", "anthropic"]), ["openai", "anthropic"]);
  assert.throws(() => policySelection("selected", []), /Choose at least one/);
});

test("review sampling accepts only a bounded percent and known labels", () => {
  assert.deepEqual(reviewSampling({ percent: 25, labels: ["confidential", "restricted"] }), {
    percent: 25,
    labels: ["confidential", "restricted"],
  });
  for (const value of [
    { percent: -1, labels: [] },
    { percent: 101, labels: [] },
    { percent: 5.5, labels: [] },
    { percent: 5, labels: ["secret"] },
    null,
  ])
    assert.throws(() => reviewSampling(value));
});

test("policy readback must match the applied provider, model, account and label rules", () => {
  const expected = {
    allowedAccounts: "company" as const,
    allowedProviders: ["openai"],
    allowedModels: ["gpt-5"],
    labelProviders: { restricted: [] },
  };
  assert.equal(policyMatches({ ...expected, hops: { agentHops: 4, reviewLoops: 2, ciFixLoops: 3 } }, expected), true);
  assert.equal(
    policyMatches(
      { ...expected, allowedProviders: [], hops: { agentHops: 4, reviewLoops: 2, ciFixLoops: 3 } },
      expected,
    ),
    false,
  );
});

test("policy mode follows refreshed policy until a person starts an explicit draft", () => {
  assert.equal(policyMode([], null), "all");
  assert.equal(policyMode(["openai"], null), "selected");
  assert.equal(policyMode(["openai"], "all"), "all");
});

test("raise amounts use dollars for money and whole native units for turns and time", () => {
  assert.equal(raiseAmount("day", "2.50"), 2_500_000);
  assert.equal(raiseAmount("turns", "12"), 12);
  assert.equal(raiseAmount("time", "30"), 30);
  assert.equal(raiseAmount("run", ""), undefined);
  assert.throws(() => raiseAmount("turns", "1.5"));
  assert.throws(() => raiseAmount("time", "0"));
});

test("cap readback must equal the immutable reviewed payload", () => {
  assert.equal(capsMatch({ dayMicros: 2_000_000, turnsPerDay: 12 }, { turnsPerDay: 12, dayMicros: 2_000_000 }), true);
  assert.equal(capsMatch({ dayMicros: 3_000_000, turnsPerDay: 12 }, { turnsPerDay: 12, dayMicros: 2_000_000 }), false);
});

test("retention accepts declared durations and rejects ambiguous policy text", () => {
  for (const value of ["30d", "12w", "2m", "1y", "forever", "per_policy"]) assert.equal(retentionValue(value), value);
  for (const value of ["30 days", "0.5y", "", "never"]) assert.throws(() => retentionValue(value));
});

test("Keep and delete says every rule in words: no raw token of the rule's grammar reaches the screen (owner walk, 12 Nov)", async () => {
  const { retentionWords } = await import("../pages/ai-data-values.ts");
  // every default modules/governance/projections.ts DEFS gives a kind, as the server sends them
  const DEFS = ["1y", "2y", "30d", "30d+daily90d+monthly", "90d", "forever", "per_policy"].map((d) => ({
    key: d,
    default: d,
  }));
  const raw = /per_policy|forever\b|\d+[dwmy]\b|\+|daily\d|_/;
  for (const def of DEFS) assert.doesNotMatch(retentionWords(def.default), raw, `${def.key}: ${def.default}`);
  for (const v of [
    "30d",
    "12w",
    "2m",
    "1y",
    "forever",
    "per_policy",
    "30d+daily90d+monthly",
    "7d+weekly1y",
    "nonsense",
  ])
    assert.doesNotMatch(retentionWords(v), raw, v);
  assert.equal(retentionWords("30d+daily90d+monthly"), "All for 30 days, then daily for 90 days, then monthly");
  assert.equal(retentionWords("per_policy"), "By its own schedule");
  assert.equal(retentionWords("1y"), "1 year");
  assert.equal(retentionWords("forever"), "Forever");
});
