// P-H_14: record ids follow the contract (rec_ then 32 hex), minted in one place; the kernel record store accepts nothing else.
import test from "node:test";
import assert from "node:assert/strict";
import { id } from "../../../manifests/_common.ts";
import { mintUuid } from "../../../lib/ids.ts";
import { mintRecordId, isRecordId } from "../ids.ts";
import { openRecords } from "../impl.ts";
import { ITEM } from "../fixtures/seed.ts";

const ctx = { trace: { traceId: "0123456789abcdef0123456789abcdef", spanId: "0123456789abcdef" }, emit: () => ({}) };

test("ids: a minted record id matches the contract pattern of id.record, and ids sort by time", () => {
  const a = mintRecordId(1_700_000_000_000), b = mintRecordId(1_700_000_000_001);
  const contract = new RegExp((id.record as unknown as { pattern: string }).pattern);
  assert.match(a, contract);
  assert.match(a, /^rec_[0-9a-f]{32}$/);
  assert.ok(isRecordId(a) && isRecordId(b));
  assert.ok(a < b, "later ms sorts later as text");
  assert.equal(new Set(Array.from({ length: 200 }, () => mintRecordId())).size, 200);
});

test("ids: contacts are records, so the contact id schema is the record id schema", () => {
  assert.deepEqual(id.contact, id.record);
});

test("ids: a bare uuid, a wrong prefix, upper case and a short id are not record ids", () => {
  for (const bad of [mintUuid(), `con_${mintUuid().replaceAll("-", "")}`, `rec_${mintUuid()}`, `REC_${"a".repeat(32)}`, `rec_${"a".repeat(31)}`, `rec_${"g".repeat(32)}`, "", 7, null]) {
    assert.equal(isRecordId(bad), false, String(bad));
  }
});

test("ids: records.create returns a contract id, and the store refuses a bare uuid or any other id", async () => {
  const rec = openRecords({ space: "sp_ids" });
  await rec.store.define({ add_types: [ITEM] });
  const made = await rec.handlers["records.create"](ctx, { type: "item", fields: { name: "Alpha", qty: 1 } });
  assert.match(made.record.id, /^rec_[0-9a-f]{32}$/);
  for (const bad of [mintUuid(), "con_" + "a".repeat(32), "not-an-id"]) {
    await assert.rejects(rec.store.create("item", bad, { name: "x" }), (e: unknown) => (e as { code?: string }).code === "invalid", bad);
  }
  const ok = mintRecordId();
  assert.equal((await rec.store.create("item", ok, { name: "ok" })).id, ok);
});
