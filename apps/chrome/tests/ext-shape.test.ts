// The shape of a JSON answer (src/agent/shape.js): keys and types, never a value.
import test from "node:test";
import assert from "node:assert/strict";
import { shapeOf } from "../src/agent/shape.js";

test("keys and the type of each, nested, arrays by their items, and not one value survives", () => {
  const body = {
    user: { id: 42, email: "dana@acme.test", name: "Dana", admin: false, tags: ["a", "b"], manager: null },
    items: [
      { sku: "X1", qty: 2 },
      { sku: "X2", price: 9.5 },
    ],
    token: "sk-live-SECRET",
    empty: [],
  };
  const s = shapeOf(body);
  assert.deepEqual(s, {
    user: { id: "number", email: "string", name: "string", admin: "boolean", tags: ["string"], manager: "null" },
    items: [{ sku: "string", qty: "number", price: "number" }],
    token: "string",
    empty: [],
  });
  const text = JSON.stringify(s);
  for (const value of ["dana@acme.test", "Dana", "SECRET", "X1", "42", "9.5"]) assert.ok(!text.includes(value), value);
});

test("a key that is really data (an id, an email, a token) is folded into one entry, so ids never leak as keys", () => {
  const s = shapeOf({
    byId: {
      "12345": { n: 1 },
      "67890": { n: 2 },
      "d4f1a2b3-1111-2222-3333-444455556666": { n: 3 },
      "dana@acme.test": { n: 4 },
    },
  });
  assert.deepEqual(s, { byId: { "<key>": { n: "number" } } });
});

test("depth, key count and a huge object are bounded", () => {
  const deep = { a: { b: { c: { d: { e: { f: 1 } } } } } };
  assert.equal(JSON.stringify(shapeOf(deep)), JSON.stringify({ a: { b: { c: { d: "object" } } } }));
  const wide: Record<string, number> = {};
  for (let i = 0; i < 500; i++) wide[`field${i}`] = i;
  assert.equal(Object.keys(shapeOf(wide) as object).length, 40);
  assert.equal(shapeOf("text"), "string");
  assert.equal(shapeOf(undefined), "unknown");
  assert.deepEqual(shapeOf([]), []);
});
