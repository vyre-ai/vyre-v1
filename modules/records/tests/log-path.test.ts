// Ruling 20: a records write is an event in the kernel log carrying values; the rt_ tables and clocks are projections of that log.
// @reads /modules/records/migrations/0001_init.sql
import test from "node:test";
import assert from "node:assert/strict";
import { openRecords } from "../impl.ts";
import { payloadOf } from "../../../kernel/src/store/projection.ts";
import { PERSON, ITEM } from "../fixtures/seed.ts";

interface Seen { name: string; subject: string; payload: Record<string, unknown> }
const mk = () => {
  const seen: Seen[] = [];
  const ctx = {
    trace: { traceId: "0123456789abcdef0123456789abcdef" },
    emit: (name: string, subject: string, payload: Record<string, unknown>) => { seen.push({ name, subject, payload }); },
  };
  return { seen, ctx };
};

test("a create, update and delete are in the log with values and the rt_ row is a projection of them", async () => {
  const rec = openRecords({ space: "sp_logpath" });
  await rec.store.define({ add_types: [ITEM] });
  const { seen, ctx } = mk();

  const made = await rec.handlers["records.create"](ctx, { type: "item", fields: { name: "A", qty: 1 } });
  const id = made.record.id;
  await rec.handlers["records.update"](ctx, { type: "item", recordId: id, patch: { qty: 2, note: "n" }, baseVersion: 1 });
  await rec.handlers["records.delete"](ctx, { type: "item", recordId: id });

  // The kernel log holds one event per write, with the values.
  const log = rec.host.store.read({ limit: 5000 });
  const recordEvents = log.filter((e) => e.type.startsWith("record."));
  assert.deepEqual(recordEvents.map((e) => e.type), ["record.created", "record.updated", "record.removed"]);
  const created = payloadOf<{ data: Record<string, unknown> }>(recordEvents[0]!);
  assert.deepEqual(created.data, { name: "A", qty: 1 });
  const updated = payloadOf<{ data: Record<string, unknown>; before: Record<string, unknown> }>(recordEvents[1]!);
  assert.equal(updated.before.qty, 1);
  assert.equal(updated.data.qty, 2);
  assert.equal(updated.data.note, "n");

  // The catalogue events carry the same values: fields and prev.
  assert.deepEqual(seen.map((s) => s.name), ["record.created", "record.updated", "record.deleted"]);
  assert.deepEqual(seen[0]!.payload.fields, { name: "A", qty: 1 });
  assert.deepEqual(seen[1]!.payload.fields, { qty: 2, note: "n" });
  assert.deepEqual(seen[1]!.payload.prev, { qty: 1 });
  assert.deepEqual(seen[2]!.payload.prev, { name: "A", qty: 2, note: "n" });

  // Drop the projections and rebuild them from the log alone: rows and field clocks come back identical.
  const rowBefore = await rec.store.get("item", id);
  const clocksBefore = rec.clocks("item", id);
  const historyBefore = rec.history("item", id);
  rec.host.rebuild("records.rows");
  rec.host.rebuild("records.field_meta");
  assert.deepEqual(await rec.store.get("item", id), rowBefore);
  assert.deepEqual(rec.clocks("item", id), clocksBefore);
  assert.deepEqual(rec.history("item", id), historyBefore);
  assert.equal((await rec.store.get("item", id))?.deleted_at !== undefined, true);
});

test("a write that is refused leaves no event in the log and none on the bus", async () => {
  const rec = openRecords({ space: "sp_logpath2" });
  await rec.store.define({ add_types: [ITEM] });
  const { seen, ctx } = mk();
  const made = await rec.handlers["records.create"](ctx, { type: "item", fields: { name: "A", code: "x" } });
  const before = rec.host.store.read({ limit: 5000 }).length;
  await assert.rejects(() => rec.handlers["records.update"](ctx, { type: "item", recordId: made.record.id, patch: { code: "y" }, baseVersion: 1 }));
  assert.equal(rec.host.store.read({ limit: 5000 }).length, before);
  assert.equal(seen.length, 1);
});

test("sealed values reach the log and the bus as references only", async () => {
  const rec = openRecords({ space: "sp_logpath3" });
  await rec.store.define({ add_types: [PERSON] });
  const { seen, ctx } = mk();
  await rec.handlers["records.create"](ctx, { type: "person", fields: { name: "A", ssn: { sealed: "ssn", ref: "sv_9", present: true } } });
  const text = [JSON.stringify(seen), ...rec.host.store.read({ limit: 5000 }).map((e) => new TextDecoder().decode(e.payload))].join("\n");
  assert.ok(text.includes("sv_9"));
  assert.deepEqual((seen[0]!.payload.fields as { ssn: { ref: string } }).ssn.ref, "sv_9");
});
