import test from "node:test";
import assert from "node:assert/strict";
import { specifiers, resolve, imports, dependents, testsReaching, cacheKey } from "../scripts/lib/graph.mjs";
import { select } from "../scripts/ci-select.mjs";

const files = { "lib/a.mjs": 'export const a = 1;', "lib/a.test.mjs": 'import "./a.mjs";', "lib/b.mjs": 'import { a } from "./a.mjs";', "lib/c.mjs": "export const c = 1;" };
const tracked = new Set(Object.keys(files));
const read = (f) => files[f];

test("specifiers finds imports and @reads", () => {
  assert.deepEqual(specifiers('import x from "./x.mjs";\n// @reads fixtures/y.json').sort(), ["./x.mjs", "fixtures/y.json"]);
});
test("resolve maps relative specifiers", () => assert.equal(resolve("lib/b.mjs", "./a.mjs", tracked), "lib/a.mjs"));
test("tests reaching a file follow the chain", () => {
  const rev = dependents(imports(tracked, read));
  assert.deepEqual(testsReaching("lib/a.mjs", rev), ["lib/a.test.mjs"]);
  assert.deepEqual(testsReaching("lib/b.mjs", rev), []);
});
test("select picks affected tests and flags uncovered code", () => {
  assert.deepEqual(select({ changed: ["lib/a.mjs"], tracked, read }).files, ["lib/a.test.mjs"]);
  assert.deepEqual(select({ changed: ["lib/c.mjs"], tracked, read }).uncovered, ["lib/c.mjs"]);
  assert.equal(select({ changed: ["package.json"], tracked, read }).all, true);
});
test("cache key changes with content", () => {
  const env = { node: "v24", runner: "1", tag: "t" };
  const k1 = cacheKey("lib/a.test.mjs", imports(tracked, read), read, env);
  const k2 = cacheKey("lib/a.test.mjs", imports(tracked, read), (f) => read(f) + (f === "lib/a.mjs" ? " " : ""), env);
  assert.notEqual(k1, k2);
});
