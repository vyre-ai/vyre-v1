import test from "node:test";
import assert from "node:assert/strict";
import { parseExpr, evalExpr, exprNames } from "../expr/expr.ts";
import { LanguageError } from "../expr/errors.ts";

const run = (src: string, values: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) => evalExpr(parseExpr(src), { values, ...extra });

test("literals, arithmetic and precedence", () => {
  assert.equal(run("1 + 2 * 3"), 7);
  assert.equal(run("(1 + 2) * 3"), 9);
  assert.equal(run("10 / 4"), 2.5);
  assert.equal(run("10 / 0"), null);
  assert.equal(run("-3 + 5"), 2);
  assert.equal(run('"a" + "b"'), "ab");
  assert.equal(run("true"), true);
  assert.equal(run("null"), null);
});

test("comparison, boolean operators and short forms", () => {
  assert.equal(run("a >= 3 and b == 'x'", { a: 3, b: "x" }), true);
  assert.equal(run("a < 3 or not (b == 'x')", { a: 3, b: "x" }), false);
  assert.equal(run("a != 1", { a: 2 }), true);
  assert.equal(run("a < 1", {}), false, "a missing value compares false");
});

test("in: lists and substrings", () => {
  assert.equal(run('area in ["PI", "EP"]', { area: "EP" }), true);
  assert.equal(run('area in ["PI"]', { area: "EP" }), false);
  assert.equal(run('"ab" in name', { name: "cabin" }), true);
});

test("dot paths read nested values and never reach the prototype", () => {
  assert.equal(run("client.name", { client: { name: "Ada" } }), "Ada");
  assert.equal(run("client.name.first", { client: { name: "Ada" } }), null);
  assert.equal(run("x.y", {}), null);
  assert.throws(() => parseExpr("a.__proto__"), LanguageError);
  assert.throws(() => parseExpr("constructor"), LanguageError);
});

test("functions: len, lower, upper, empty, round, days_since", () => {
  assert.equal(run("len(name)", { name: "Ada" }), 3);
  assert.equal(run("len(missing)"), 0);
  assert.equal(run("lower(n) + upper(n)", { n: "aB" }), "abAB");
  assert.equal(run("empty(x)", { x: "" }), true);
  assert.equal(run("empty(x)", { x: [1] }), false);
  assert.equal(run("round(2.456, 2)"), 2.46);
  assert.equal(run("days_since(d)", { d: "2026-01-01" }, { now: Date.parse("2026-01-11T12:00:00Z") }), 10);
  assert.equal(run("days_since(d)", { d: "2026-01-01" }), null, "no clock in the context: null");
});

test("stage comparison uses the stage order, not text", () => {
  const order = { stage: ["Intake", "Treating", "Drafting"] };
  assert.equal(run('stage < "Drafting"', { stage: "Intake" }, { stageOrder: order }), true);
  assert.equal(run('stage >= "Treating"', { stage: "Intake" }, { stageOrder: order }), false);
  assert.equal(run('stage < "Nope"', { stage: "Intake" }, { stageOrder: order }), false);
});

test("exprNames lists the first segment of each path", () => {
  assert.deepEqual([...exprNames(parseExpr("a.b > c and len(d) == e.f"))].sort(), ["a", "c", "d", "e"]);
});

test("syntax errors are LanguageError with a stable code", () => {
  for (const bad of ["", "   ", "1 +", "(1", "foo(1)", "a and", "'open", "1.2.3", "a $ b", "[1, 2", "and"]) {
    assert.throws(() => parseExpr(bad), (e: unknown) => e instanceof LanguageError && /^expr_(syntax|limit)$/.test(e.code), `should refuse ${JSON.stringify(bad)}`);
  }
});

test("limits: length, nesting and node count", () => {
  assert.throws(() => parseExpr("1".repeat(2001)), (e: unknown) => e instanceof LanguageError && e.code === "expr_limit");
  assert.throws(() => parseExpr("(".repeat(30) + "1" + ")".repeat(30)), (e: unknown) => e instanceof LanguageError && e.code === "expr_limit");
  assert.throws(() => parseExpr(Array(300).fill("1").join(" + ")), (e: unknown) => e instanceof LanguageError && e.code === "expr_limit");
});

test("nothing is evaluated as code", () => {
  assert.throws(() => parseExpr("process.exit()"), LanguageError);
  assert.throws(() => parseExpr("`x`"), LanguageError);
  assert.equal(run("toString", {}), null);
});
