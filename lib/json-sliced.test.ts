import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { parseSliced } from "./json-sliced.ts";

const sliced = (text: string, chunk = 40): Promise<unknown> =>
  parseSliced(text, { chunk, turn: () => Promise.resolve() });

test("parseSliced answers what JSON.parse answers: strings with brackets and escapes, nesting, numbers, an empty array, duplicate keys, __proto__", async () => {
  const doc = {
    a: [1, 2, { b: '}]\\"{[', c: [[], {}, "x,y"] }, null, true, 1.5e3, -0.25],
    'k"ey': "v\\a\nb",
    big: Array.from({ length: 50 }, (_, i) => ({
      id: i,
      s: `item ${i}, with "quotes" and ] brackets [`,
      t: [i, i + 1],
    })),
    empty: [],
    o: {},
    z: "end",
  };
  const text = JSON.stringify(doc, null, 1);
  assert.deepEqual(await sliced(text), JSON.parse(text));
  assert.deepEqual(Object.keys((await sliced(text)) as object), Object.keys(JSON.parse(text)), "key order");
  const dup = '{"a":1,"b":[' + "1,".repeat(200) + '2],"a":3,"__proto__":{"x":1}}';
  const got = (await sliced(dup, 20)) as Record<string, unknown>;
  const want = JSON.parse(dup) as Record<string, unknown>;
  assert.deepEqual(got, want);
  assert.equal(Object.getPrototypeOf(got), Object.prototype, "__proto__ is a key, not the prototype");
  assert.deepEqual(await sliced("[1,2,3]"), [1, 2, 3], "a top-level array is parsed whole");
  assert.deepEqual(await sliced('{"a":[1,2]}', 5), { a: [1, 2] });
  await assert.rejects(sliced('{"a":[1,2,' + "3,".repeat(100) + "}", 20), SyntaxError);
});

test("parseSliced of the real generated registry equals JSON.parse of it, and gives the loop turns", async () => {
  const text = fs.readFileSync(new URL("../generated/registry.json", import.meta.url), "utf8");
  let turns = 0;
  const got = await parseSliced(text, { turn: async () => void turns++ });
  assert.ok(turns >= 10, `the loop was given ${turns} turns`);
  assert.deepEqual(got, JSON.parse(text));
});
