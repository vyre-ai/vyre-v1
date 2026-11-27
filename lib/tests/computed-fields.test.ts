// The pure rules of computed fields: the cycle check and the formula evaluation.
import test from "node:test";
import assert from "node:assert/strict";
import { computeFormula, computedCycle, inputsOf } from "../computed-fields.ts";
import type { TypeShape } from "../computed-fields.ts";

const world = (types: TypeShape[]): Map<string, TypeShape> => new Map(types.map((t) => [t.key, t]));

test("a formula evaluates over the record's values, and a failure is empty", () => {
  assert.equal(computeFormula("a + b", { a: 2, b: 3 }, 0), 5);
  assert.equal(computeFormula('upper(name) + "!"', { name: "ada" }, 0), "ADA!");
  assert.equal(computeFormula("a / b", { a: 1, b: 0 }, 0), null, "a division by zero is empty");
  assert.equal(computeFormula("a +", { a: 1 }, 0), null, "an expression that does not parse is empty");
  assert.equal(computeFormula("missing + 1", {}, 0), 1, "an absent name reads as empty, like the rest of the language");
  assert.equal(computeFormula("days_since(d)", { d: Date.UTC(2026, 0, 1) }, Date.UTC(2026, 0, 11)), 10);
});

test("the inputs of each kind of computed field", () => {
  const types = world([
    {
      key: "a",
      fields: [
        { key: "x", type: "number" },
        { key: "f", type: "formula", options: { expr: "x + y" } },
        { key: "rel", type: "relation", options: { target: "b" } },
        { key: "l", type: "lookup", options: { via: "rel", field: "v" } },
      ],
    },
    { key: "b", fields: [{ key: "v", type: "number" }] },
  ]);
  const a = types.get("a")!;
  assert.deepEqual(inputsOf(types, "a", a.fields[1]!).sort(), ["a.x", "a.y"]);
  assert.deepEqual(inputsOf(types, "a", a.fields[3]!).sort(), ["a.rel", "b.v"]);
});

test("a cycle is found however far round it goes, and an acyclic chain is not one", () => {
  const f = (key: string, expr: string) => ({ key, type: "formula", options: { expr } });
  assert.equal(
    computedCycle(world([{ key: "t", fields: [{ key: "x", type: "number" }, f("a", "x + 1"), f("b", "a * 2")] }])),
    null,
  );
  assert.deepEqual(computedCycle(world([{ key: "t", fields: [f("a", "b + 1"), f("b", "a + 1")] }])), [
    "t.a",
    "t.b",
    "t.a",
  ]);
  assert.deepEqual(
    computedCycle(world([{ key: "t", fields: [f("a", "a + 1")] }])),
    ["t.a", "t.a"],
    "a formula that reads itself",
  );
  // across types: t.l looks up b.r, b.r rolls up t.l
  const cross = world([
    {
      key: "t",
      fields: [
        { key: "rel", type: "relation", options: { target: "b" } },
        { key: "l", type: "lookup", options: { via: "rel", field: "r" } },
      ],
    },
    {
      key: "b",
      fields: [
        { key: "back", type: "relation", options: { target: "t" } },
        { key: "r", type: "rollup", options: { via: "back", field: "l", fn: "count" } },
      ],
    },
  ]);
  const c = computedCycle(cross);
  assert.ok(c && c[0] === c[c.length - 1], `the cross-type cycle is found: ${String(c)}`);
});
