// @reads /modules/records/migrations/0001_init.sql
import test from "node:test";
import assert from "node:assert/strict";
import { conformance } from "../../../kernel/conformance/suite.ts";
import { mintRecordId } from "../../../lib/ids.ts";
import { formatHlc } from "../../../lib/hlc.ts";
import { openRecords } from "../impl.ts";
import { ITEM, LEDGER } from "../fixtures/seed.ts";

const make = async () => openRecords({ space: "sp_conf" }).store;
conformance(make, { test, assert }, "records");

const code = (c: string) => (e: unknown) => {
  assert.equal((e as { code?: string }).code, c);
  return true;
};
const vcode = (c: string) => (e: unknown) => {
  assert.equal((e as { error?: { code?: string } }).error?.code, c);
  return true;
};
const hlc = (ms: number, deviceId: string) => formatHlc({ ms, counter: 0, deviceId });
const ctx = { trace: { traceId: "0123456789abcdef0123456789abcdef" }, emit: (_n: string, _s: string, _p: Record<string, unknown>) => {} };

test("field clocks: baseSeq applies, a stale older clock loses, assistant keeps the current value", async () => {
  const rec = openRecords({ space: "sp_clk" });
  await rec.store.define({ add_types: [ITEM] });
  const id = mintRecordId();
  await rec.store.create("item", id, { name: "A", qty: 1, status: "open", code: "c1" });
  const first = rec.clocks("item", id);
  assert.deepEqual(first.map((c) => c.field).sort(), ["code", "name", "qty", "status"]);
  assert.ok(first.every((c) => c.seq === 1));

  const h1 = hlc(2_000, "dev_a");
  const named = await rec.mergeFields("item", id, { name: { value: "B", hlc: h1, baseSeq: 1 } }, "usr_dana");
  assert.deepEqual(named.applied, ["name"]);
  assert.equal(named.record.data.name, "B");
  assert.equal(rec.clocks("item", id).find((c) => c.field === "name")?.hlc, h1);
  assert.equal(rec.clocks("item", id).find((c) => c.field === "name")?.seq, 2);
  assert.equal(rec.clocks("item", id).find((c) => c.field === "name")?.actor, "usr_dana");

  const h2 = hlc(3_000, "dev_b");
  const won = await rec.mergeFields("item", id, { name: { value: "C", hlc: h2, baseSeq: 1 } }, "usr_lee");
  assert.deepEqual(won.applied, ["name"]);
  assert.equal((await rec.store.get("item", id))?.data.name, "C");

  const h0 = hlc(1_000, "dev_c");
  const lost = await rec.mergeFields("item", id, { name: { value: "OLD", hlc: h0, baseSeq: 1 } }, "usr_old");
  assert.deepEqual(lost.lost, [{ field: "name", reason: "lww_loser" }]);
  assert.equal((await rec.store.get("item", id))?.data.name, "C");
  const loser = rec.history("item", id).find((row) => row.reason === "lww_loser");
  assert.equal(loser?.field, "name");
  assert.equal(loser?.value, "OLD");

  const qty = await rec.mergeFields("item", id, { qty: { value: 9, hlc: h0, baseSeq: 1 } }, "usr_dana");
  assert.deepEqual(qty.applied, ["qty"]);
  assert.equal((await rec.store.get("item", id))?.data.qty, 9);

  const parked = await rec.mergeFields("item", id, { status: { value: "closed", hlc: h2, baseSeq: 0 } }, "usr_lee");
  assert.deepEqual(parked.lost, [{ field: "status", reason: "conflict" }]);
  assert.equal((await rec.store.get("item", id))?.data.status, "open");
  assert.equal(rec.history("item", id).some((row) => row.reason === "conflict" && row.field === "status"), true);

  const noted = await rec.mergeFields("item", id, { note: { value: "one", hlc: h1, baseSeq: 0 } }, "usr_dana");
  assert.deepEqual(noted.applied, ["note"]);
  const noteLost = await rec.mergeFields("item", id, { note: { value: "two", hlc: h2, baseSeq: 0 } }, "usr_lee");
  assert.deepEqual(noteLost.lost, [{ field: "note", reason: "conflict" }]);
  assert.equal((await rec.store.get("item", id))?.data.note, "one");
});

test("write-once refuses a second value and the version stays", async () => {
  const rec = openRecords({ space: "sp_once" });
  await rec.store.define({ add_types: [ITEM] });
  const id = mintRecordId();
  const row = await rec.store.create("item", id, { name: "A", code: "c1" });
  await assert.rejects(() => rec.mergeFields("item", id, { code: { value: "c2", hlc: hlc(4_000, "dev_a"), baseSeq: 1 } }, "usr_dana"), code("invalid"));
  await assert.rejects(() => rec.store.update("item", id, { code: "c2" }, row.version), code("invalid"));
  const still = await rec.store.get("item", id);
  assert.equal(still?.data.code, "c1");
  assert.equal(still?.version, 1);
});

test("API callers get version_conflict and a stale write changes nothing", async () => {
  const rec = openRecords({ space: "sp_ver" });
  await rec.store.define({ add_types: [ITEM] });
  const created = await rec.handlers["records.create"](ctx, { type: "item", fields: { name: "A" }, idempotencyKey: "k1" });
  const id = created.record.id;
  const updated = await rec.handlers["records.update"](ctx, { type: "item", recordId: id, patch: { qty: 2 }, baseVersion: 1 });
  assert.equal(updated.record.version, 2);
  assert.equal(updated.record.fields.qty, 2);
  await assert.rejects(() => rec.handlers["records.update"](ctx, { type: "item", recordId: id, patch: { qty: 3 }, baseVersion: 1 }), vcode("validation.version_conflict"));
  assert.equal((await rec.store.get("item", id))?.data.qty, 2);
  assert.equal((await rec.store.get("item", id))?.version, 2);
  const again = await rec.handlers["records.create"](ctx, { type: "item", fields: { name: "other" }, idempotencyKey: "k1" });
  assert.equal(again.record.id, id);
});

test("delete and restore bump the version; a protected type and a hold cannot be deleted", async () => {
  const rec = openRecords({ space: "sp_del" });
  await rec.store.define({ add_types: [ITEM, LEDGER] });
  const created = await rec.handlers["records.create"](ctx, { type: "item", fields: { name: "T" }, idempotencyKey: "t" });
  const gone = await rec.handlers["records.delete"](ctx, { type: "item", recordId: created.record.id });
  assert.equal(gone.deleted, true);
  assert.equal(await rec.store.get("item", created.record.id), null);
  const back = await rec.handlers["records.restore"](ctx, { type: "item", recordId: created.record.id });
  assert.equal(back.record.version, 3);
  assert.equal(back.record.deletedAt, undefined);
  assert.equal(back.record.fields.name, "T");

  const ledger = await rec.store.create("ledger", mintRecordId(), { name: "L" });
  await assert.rejects(() => rec.store.remove("ledger", ledger.id, 1), code("invalid"));
  await assert.rejects(() => rec.handlers["records.delete"](ctx, { type: "ledger", recordId: ledger.id }), vcode("validation.field_locked"));
  assert.equal((await rec.store.get("ledger", ledger.id))?.data.name, "L");
  await assert.rejects(() => rec.store.define({ remove_types: ["ledger"] }), code("invalid"));
  assert.equal((await rec.store.types()).some((t) => t.name === "ledger"), true);

  const held = await rec.store.create("item", mintRecordId(), { name: "H" });
  rec.host.tx.run("UPDATE records_row_meta SET holds = 1 WHERE type = ? AND id = ?", "item", held.id);
  await assert.rejects(() => rec.store.remove("item", held.id, 1), code("invalid"));
  await assert.rejects(() => rec.handlers["records.delete"](ctx, { type: "item", recordId: held.id }), vcode("permission.on_hold"));
  assert.equal((await rec.store.get("item", held.id))?.version, 1);
});
