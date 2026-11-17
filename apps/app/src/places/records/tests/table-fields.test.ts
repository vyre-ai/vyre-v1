// @tsx
// What a table asks of the server for the rows it draws (r35-speed): the columns in view, not every field of a type of a hundred.
import test from "node:test";
import assert from "node:assert/strict";
import { PLAIN, columnWindow, columnsOf, fieldsFor, querySpec } from "../table/model.ts";
import type { TypeDef } from "../../../../../../generated/types.ts";

const fields = Array.from({ length: 100 }, (_, i) => ({ key: `f${i}`, type: "text", title: `F${i}` }));
const def = {
  key: "matter",
  title: "Matter",
  plural: "Matters",
  titleField: "f0",
  fields: [
    ...fields,
    { key: "total", type: "formula", title: "Total", options: { expr: "f50 + f51" } },
    { key: "who", type: "person", title: "Who" },
  ],
} as unknown as TypeDef;

test("a table of 100 fields asks for the columns in view, widened to blocks, and what the view and a formula need", () => {
  const cols = columnsOf(def, []);
  const win = columnWindow(cols, 0, 1000);
  const asked = fieldsFor(def, cols, win, PLAIN);
  assert.ok(asked.length < 40, `${asked.length} fields of ${def.fields.length}`);
  assert.ok(
    asked.includes("f0") && asked.includes("f1") && asked.includes("who"),
    "the title, the first columns, a person field",
  );
  assert.ok(!asked.includes("f90"), "a column far to the right is not asked for");
  // scrolled to the formula: the fields it reads come with it
  const farLeft = cols.find((c) => c.field.key === "total")!.left;
  const far = fieldsFor(def, cols, columnWindow(cols, farLeft, 1000), PLAIN);
  assert.ok(far.includes("total") && far.includes("f50") && far.includes("f51"), "a formula brings what it reads");
  // sort, group, colour and filter fields are always asked for
  const used = fieldsFor(def, cols, win, {
    ...PLAIN,
    sort: [{ field: "f77", dir: "asc" }],
    group: "f78",
    colour: "f79",
    clauses: [{ field: "f80", op: "eq", value: "x" }],
  });
  for (const k of ["f77", "f78", "f79", "f80"]) assert.ok(used.includes(k), k);
  // a small horizontal scroll asks for the same fields (a block each side), so it asks nothing new
  assert.deepEqual(fieldsFor(def, cols, columnWindow(cols, 40, 1000), PLAIN), asked);
  assert.deepEqual(querySpec("matter", PLAIN, "f0", 0, asked).fields, asked);
  assert.equal(querySpec("matter", PLAIN, "f0", 0).fields, undefined, "without a list, all of them, as before");
});
