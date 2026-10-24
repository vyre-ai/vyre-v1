// @reads /modules/records/migrations/0001_init.sql
// P-H_01: the host-facing handler map of the records module carries the reads next to the writes (get, query, search, counts, history), and they answer the contract's shapes.
import test from "node:test";
import assert from "node:assert/strict";
import { handlers, openRecords } from "../impl.ts";
import { ITEM } from "../fixtures/seed.ts";

const ctx = { trace: { traceId: "0123456789abcdef0123456789abcdef", spanId: "0123456789abcdef" }, emit: () => ({}) };

async function seeded() {
  const rec = openRecords({ space: "sp_wiring" });
  await rec.store.define({ add_types: [ITEM] });
  const a = await rec.handlers["records.create"](ctx, { type: "item", fields: { name: "Alpha", qty: 1 } });
  const b = await rec.handlers["records.create"](ctx, { type: "item", fields: { name: "Beta", qty: 2 } });
  return { rec, a: a.record.id, b: b.record.id };
}

test("the loader entry exposes every record read and write this module implements", () => {
  for (const name of ["records.create", "records.update", "records.delete", "records.restore", "records.get", "records.query", "records.search", "records.counts", "records.history"]) {
    assert.equal(typeof (handlers as unknown as Record<string, unknown>)[name], "function", name);
  }
});

test("records.get returns the row, and a missing id is validation.not_found", async () => {
  const { rec, a } = await seeded();
  const got = await rec.handlers["records.get"](ctx, { type: "item", recordId: a });
  assert.equal(got.record.id, a);
  assert.equal(got.record.type, "item");
  assert.equal(got.record.fields["name"], "Alpha");
  await assert.rejects(rec.handlers["records.get"](ctx, { type: "item", recordId: "00000000-0000-4000-8000-000000000000" }), (e: unknown) => (e as { error?: { code?: string } }).error?.code === "validation.not_found");
});

test("records.query, records.search and records.counts answer through the same handle", async () => {
  const { rec, a } = await seeded();
  const q = await rec.handlers["records.query"](ctx, { type: "item", sort: [{ field: "qty", dir: "desc" }] });
  assert.equal(q.rows.length, 2);
  assert.equal(q.rows[1]!.id, a);
  assert.deepEqual(await rec.handlers["records.counts"](ctx, { type: "item" }), { count: 2 });
  const s = await rec.handlers["records.search"](ctx, { type: "item", q: "Beta" });
  assert.deepEqual(s.rows.map((r) => r.fields["name"]), ["Beta"]);
});

test("records.history lists the kept earlier values of a record, all of them or one field's", async () => {
  const { rec, a, b } = await seeded();
  const put = (id: string, field: string, value: unknown, seq: number): void => {
    rec.host.tx.run(
      "INSERT INTO records_field_history (type, id, field, value, hlc, actor, seq, reason) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      "item", id, field, JSON.stringify(value), `h${seq}`, "usr_x", seq, "lww_loser",
    );
  };
  put(a, "name", "Alpha old", 1);
  put(a, "qty", 9, 2);
  put(b, "name", "Beta old", 3);
  const all = await rec.handlers["records.history"](ctx, { type: "item", recordId: a });
  assert.deepEqual(all.entries.map((e) => [e.field, e.value, e.hlc, e.actor, e.reason]), [["name", "Alpha old", "h1", "usr_x", "lww_loser"], ["qty", 9, "h2", "usr_x", "lww_loser"]]);
  const one = await rec.handlers["records.history"](ctx, { type: "item", recordId: a, field: "qty" });
  assert.deepEqual(one.entries.map((e) => e.field), ["qty"]);
  assert.deepEqual((await rec.handlers["records.history"](ctx, { type: "item", recordId: "nobody" })).entries, []);
});

// P-H_01 final run: each named test shows its own ok line in the run on the last commit.
