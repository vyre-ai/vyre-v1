// Conditional logic (spec 2.11): the operators, nested conditions, and what the rules say about visibility, required fields and skips.
import test from "node:test";
import assert from "node:assert/strict";
import { evaluate, resolve } from "../src/logic.js";
import { define } from "./fixtures.ts";

const f = (field: string, op: string, value?: unknown) => ({ field, op, ...(value !== undefined ? { value } : {}) });

test("eq and ne compare what was answered with what the rule says, across text, numbers, a ticked box and a one-item choice list", () => {
  assert.equal(evaluate(f("a", "eq", "x"), { a: "x" }), true);
  assert.equal(evaluate(f("a", "eq", "x"), { a: "y" }), false);
  assert.equal(evaluate(f("a", "eq", 5), { a: "5" }), true, "an answer read from a field is text");
  assert.equal(evaluate(f("a", "eq", "5"), { a: 5 }), true);
  assert.equal(evaluate(f("a", "eq", true), { a: true }), true);
  assert.equal(evaluate(f("a", "eq", true), { a: false }), false);
  assert.equal(evaluate(f("a", "eq", "x"), {}), false);
  assert.equal(evaluate(f("a", "eq", "x"), { a: ["x"] }), true);
  assert.equal(evaluate(f("a", "eq", "x"), { a: ["x", "y"] }), false);
  assert.equal(evaluate(f("a", "ne", "x"), { a: "y" }), true);
  assert.equal(evaluate(f("a", "ne", "x"), {}), true);
  assert.equal(evaluate(f("a", "ne", "x"), { a: "x" }), false);
});

test("in, contains, and the ordering operators work on text, lists and numbers, and an empty answer never passes an ordering test", () => {
  assert.equal(evaluate(f("a", "in", ["x", "y"]), { a: "y" }), true);
  assert.equal(evaluate(f("a", "in", ["x", "y"]), { a: ["z", "x"] }), true);
  assert.equal(evaluate(f("a", "in", ["x", "y"]), { a: "z" }), false);
  assert.equal(evaluate(f("a", "in", ["x", "y"]), {}), false);
  assert.equal(evaluate(f("a", "in", "x"), { a: "x" }), false, "in needs a list");
  assert.equal(evaluate(f("a", "contains", "ell"), { a: "Hello" }), true);
  assert.equal(evaluate(f("a", "contains", "ELL"), { a: "hello" }), true);
  assert.equal(evaluate(f("a", "contains", ""), { a: "hello" }), false);
  assert.equal(evaluate(f("a", "contains", "b"), { a: ["a", "b"] }), true);
  assert.equal(evaluate(f("a", "contains", "c"), { a: ["a", "b"] }), false);
  assert.equal(evaluate(f("a", "gt", 9), { a: "10" }), true, "numbers compare as numbers, so 10 is more than 9");
  assert.equal(evaluate(f("a", "gt", "9"), { a: "10" }), true);
  assert.equal(evaluate(f("a", "gte", 10), { a: 10 }), true);
  assert.equal(evaluate(f("a", "lt", 10), { a: 9 }), true);
  assert.equal(evaluate(f("a", "lte", 9), { a: 10 }), false);
  assert.equal(evaluate(f("a", "gt", "apple"), { a: "banana" }), true, "otherwise as text");
  for (const op of ["gt", "gte", "lt", "lte"]) assert.equal(evaluate(f("a", op, 0), { a: "" }), false, op);
  assert.equal(evaluate(f("a", "gt", 0), {}), false);
  assert.equal(evaluate(f("a", "nonsense"), { a: 1 }), false);
});

test("empty and notempty treat blank text, an empty list and a missing answer alike", () => {
  for (const v of ["", "   ", [], null, undefined, {}]) {
    assert.equal(evaluate(f("a", "empty"), { a: v }), true, JSON.stringify(v));
    assert.equal(evaluate(f("a", "notempty"), { a: v }), false, JSON.stringify(v));
  }
  for (const v of ["x", 0, false, ["a"]]) {
    assert.equal(evaluate(f("a", "empty"), { a: v }), false, JSON.stringify(v));
    assert.equal(evaluate(f("a", "notempty"), { a: v }), true, JSON.stringify(v));
  }
});

test("all, any and not nest", () => {
  const yes = f("a", "eq", "x"), no = f("a", "eq", "y");
  assert.equal(evaluate({ all: [yes, yes] }, { a: "x" }), true);
  assert.equal(evaluate({ all: [yes, no] }, { a: "x" }), false);
  assert.equal(evaluate({ any: [no, yes] }, { a: "x" }), true);
  assert.equal(evaluate({ any: [no, no] }, { a: "x" }), false);
  assert.equal(evaluate({ not: no }, { a: "x" }), true);
  assert.equal(evaluate({ not: { any: [yes, no] } }, { a: "x" }), false);
  assert.equal(evaluate({ all: [{ any: [no, yes] }, { not: no }] }, { a: "x" }), true);
});

test("resolve: a field named by show is hidden until its rule matches, hide hides while it matches, require adds to what is required, skips are collected, and a hidden-mode field is never visible", () => {
  const def = define();
  const none = resolve(def, {});
  assert.deepEqual([...none.visible].sort(), ["area", "details", "email", "has_deadline", "name", "notice", "budget", "referral"].sort());
  assert.deepEqual([...none.required].sort(), ["deadline", "details", "email", "name"], "deadline is required whenever it is asked; validation only checks fields that are visible, so it is not checked until a rule shows it");
  assert.deepEqual(none.skips, []);
  const ticked = resolve(def, { has_deadline: true });
  assert.ok(ticked.visible.has("deadline"));
  assert.ok(ticked.required.has("deadline"));
  const estate = resolve(def, { area: "estate" });
  assert.ok(!estate.visible.has("budget"));
  assert.ok(estate.required.has("referral"));
  assert.deepEqual(resolve(def, { area: "other" }).skips, [2]);
  assert.ok(!none.visible.has("source_secret"));
});
