import test from "node:test";
import assert from "node:assert/strict";
import { cleanAnswer, saveInterview } from "./interview.ts";
import type { CapCall } from "../shell/session/caps.ts";

test("each answer becomes a person-layer fact from onboarding and proposed ones are accepted", async () => {
  const calls: Array<[string, any]> = [];
  const call = (async (cap: string, input: any) => { calls.push([cap, input]); return cap === "memory.propose_fact" ? { fact: { factId: `fct_${calls.length}`, status: input.text.startsWith("Uses") ? "current" : "proposed" } } : {}; }) as unknown as CapCall;
  const n = await saveInterview(call, { work: "  runs  operations ", tools: "Gmail, Sheets", style: "" }, "run1");
  assert.equal(n, 2, "a blank answer is skipped");
  const proposes = calls.filter(([c]) => c === "memory.propose_fact");
  assert.deepEqual(proposes.map(([, i]) => [i.layer, i.sourceKind, i.sourceRef, i.text, i.idempotencyKey]), [
    ["person", "manual", "onboarding", "Works as: runs operations", "run1:work"],
    ["person", "manual", "onboarding", "Uses every day: Gmail, Sheets", "run1:tools"],
  ]);
  assert.deepEqual(calls.filter(([c]) => c === "memory.fact.accept").map(([, i]) => i), [{ factId: "fct_1" }], "only the proposed one needs accepting");
});

test("answers are trimmed and capped", () => {
  assert.equal(cleanAnswer("  a \n b  "), "a b");
  assert.equal(cleanAnswer("x".repeat(900)).length, 400);
});
