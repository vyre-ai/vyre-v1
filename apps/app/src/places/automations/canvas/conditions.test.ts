import test from "node:test";
import assert from "node:assert/strict";
import { build, parse } from "./conditions.ts";

// every condition the engine's own tests use: those the controls can show go to rows and back unchanged, the rest are kept whole
const SHOWN = [
  "trigger.n > 1",
  'steps.approve.out.decision == "approved"',
  "x > 1",
  "lead.phone is not empty",
  "lead.score > 80",
  "lead.score > 40",
  'lead.name == "Sam" && lead.score >= 5',
  "a.b == c.d || a.e != 3",
];
const KEPT = [
  "x",
  "wait.resumedBy is event",
  "max(steps.find.out.rows[0].score, steps.find.out.rows[1].score) > 8",
  "x  >  1",
  "a > 1 && b > 2 || c > 3",
];

test("a condition the controls can show goes to rows and back to the same text", () => {
  for (const t of SHOWN) {
    const p = parse(t);
    assert.ok(p, t);
    assert.equal(build(p), t);
  }
  assert.deepEqual(parse("lead.score > 80")!.clauses[0], { left: "lead.score", op: ">", value: "80" });
  assert.deepEqual(parse("lead.phone is not empty")!.clauses[0]!.op, "is not empty");
});

test("a condition the controls cannot write back exactly is kept whole, never rewritten", () => {
  for (const t of KEPT) assert.equal(parse(t), null, t);
  assert.deepEqual(parse(""), { join: "&&", clauses: [] });
});
