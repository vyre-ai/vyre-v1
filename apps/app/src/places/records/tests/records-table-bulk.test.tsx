// @reads ../../../../../../scripts/shots/mounts/P-L9d_01b.tsx
// Bulk work on picked rows: every id behind "Select all N", delete in chunks with progress, Undo from the Trash, and an export of exactly the picked rows. Run against the sample replica
// through the data layer's `call`, as the table does.
import test from "node:test";
import assert from "node:assert/strict";
import { CHUNK, allIds, chunks, eachId, pickedFilter, recordsWord } from "../table/bulk.ts";
import { createSampleRecords, northwind } from "../table/sample.ts";

test("chunks cut a list in order and never loop forever", () => {
  assert.deepEqual(chunks([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assert.deepEqual(chunks([], 3), []);
  assert.deepEqual(chunks([1, 2], 0), [[1], [2]]);
  assert.equal(CHUNK, 50);
});

test("Select all N finds every id of the view, page by page, and reports as it goes", async () => {
  const s = createSampleRecords(northwind, { bulk: 450 });
  const seen: number[] = [];
  const ids = await allIds(s.data.call, { type: "clients" }, 464, (n) => seen.push(n));
  assert.equal(ids.length, 464);
  assert.equal(new Set(ids).size, 464, "no id twice");
  assert.deepEqual(seen, [200, 400, 464]);
});

test("a filter narrows what Select all N finds", async () => {
  const s = createSampleRecords(northwind, { bulk: 100 });
  const filter = { field: "status", op: "eq", value: "active" };
  const count = (s.replica.run("records.counts", { type: "clients", filter }) as { data: { count: number } }).data.count;
  const ids = await allIds(s.data.call, { type: "clients", filter }, count, () => undefined);
  assert.equal(ids.length, count);
  assert.ok(count > 0 && count < 114);
});

test("delete runs in chunks with progress, the rows leave the table, and Undo from the Trash brings them back", async () => {
  const s = createSampleRecords(northwind, { bulk: 136 });
  const total = s.replica.rows("records:clients").length;
  assert.equal(total, 150);
  const ids = await allIds(s.data.call, { type: "clients" }, total, () => undefined);
  const progress: number[] = [];
  const r = await eachId(s.data.call, "records.delete", "clients", ids, (done, failed) => progress.push(done + failed));
  assert.deepEqual(r, { done: 150, failed: 0 });
  assert.deepEqual(progress, [50, 100, 150], "one report per chunk");
  assert.equal(s.replica.rows("records:clients").length, 0);
  const back = await eachId(s.data.call, "records.restore", "clients", ids, () => undefined);
  assert.deepEqual(back, { done: 150, failed: 0 });
  assert.equal(s.replica.rows("records:clients").length, 150, "Undo restored every row");
});

test("one failed id is counted and the rest still go", async () => {
  const s = createSampleRecords(northwind);
  const r = await eachId(s.data.call, "records.delete", "clients", ["cl_0", "nope", "cl_1"], () => undefined);
  assert.deepEqual(r, { done: 2, failed: 1 });
});

test("export of a pick is the view's filter and the picked ids; with no pick it is the view's filter", () => {
  assert.deepEqual(pickedFilter(undefined, ["a", "b"]), { field: "id", op: "in", value: ["a", "b"] });
  const view = { field: "status", op: "eq", value: "active" };
  assert.deepEqual(pickedFilter(view, ["a"]), { and: [view, { field: "id", op: "in", value: ["a"] }] });
});

test("the sample understands an id filter, so an export of picked rows is exactly those rows", () => {
  const s = createSampleRecords(northwind);
  const out = s.replica.run("records.query", { type: "clients", filter: { field: "id", op: "in", value: ["cl_2", "cl_5"] } }) as { data: { rows: { id: string }[] } };
  assert.deepEqual(out.data.rows.map((r) => r.id).sort(), ["cl_2", "cl_5"]);
});

test("counts read in words", () => {
  assert.equal(recordsWord(1, "client", "clients"), "1 client");
  assert.equal(recordsWord(1240, "client", "clients"), "1,240 clients");
});
