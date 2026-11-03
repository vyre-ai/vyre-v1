// A model that sends a list or an object as its JSON text gets it read back, by the tool's own schema, top level only; anything else is left for validation to name.
import test from "node:test";
import assert from "node:assert/strict";
import { unstringified } from "../src/tools/call.ts";

const schema = { type: "object", properties: { goalId: { type: "string" }, children: { type: "array" }, budget: { type: "object" }, summary: { type: "string" } } };

test("a list or an object sent as JSON text is read back when the schema says so", () => {
  const kids = [{ key: "a", title: "Remind Lab 7", why: "it worked" }];
  assert.deepEqual(unstringified(schema, { goalId: "gol_1", children: JSON.stringify(kids), budget: '{"turns":40}' }), { goalId: "gol_1", children: kids, budget: { turns: 40 } });
});

test("nothing else changes: a string field that holds JSON, text that is not JSON, the wrong shape, and inputs that are not objects", () => {
  const same = { goalId: "gol_1", summary: '["a"]', children: "not json", budget: "[1]" };
  assert.equal(unstringified(schema, same), same);
  assert.equal(unstringified(schema, "x"), "x");
  assert.deepEqual(unstringified(null, { a: 1 }), { a: 1 });
});
