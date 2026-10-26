// P-CC_39: records.purge hard-deletes one record (row, field clocks, change-feed rows with their before and after values, field history, holds, version notes) and leaves the others; records.purge_trashed removes
// records that have been in Trash since before a cutoff, oldest first in batches, and skips a record under a hold, counting it. The kernel event log is not touched (see the header of handlers/purge.ts).
import test from "node:test";
import assert from "node:assert/strict";
import { formatHlc } from "../../../lib/hlc.ts";
import { mintRecordId } from "../../../lib/ids.ts";
import { openRecords } from "../impl.ts";
import { createPurgeHandlers } from "../handlers/purge.ts";
import { ITEM } from "../fixtures/seed.ts";

const ctx = () => {
  const emitted: { name: string; subject: string; payload: Record<string, unknown> }[] = [];
  return { emitted, trace: { traceId: "0123456789abcdef0123456789abcdef" }, emit: (name: string, subject: string, payload: Record<string, unknown>) => { emitted.push({ name, subject, payload }); } };
};

async function world() {
  let clock = 1_760_000_000_000;
  const rec = openRecords({ space: "sp_purge", clock: () => clock });
  await rec.store.define({ add_types: [ITEM] });
  const make = async (name: string): Promise<string> => { const id = mintRecordId(); await rec.store.create("item", id, { name, qty: 1, status: "open", code: name }); return id; };
  const purge = createPurgeHandlers({ store: rec.store, tx: rec.host.tx });
  return { rec, purge, make, tick: (ms: number) => { clock += ms; }, now: () => clock };
}

const count = (w: Awaited<ReturnType<typeof world>>, table: string, id: string): number => w.rec.host.tx.get<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table} WHERE id = ?`, id)!.n;

test("purge removes the record from its table, its clocks, its change feed and its history, and leaves other records", async () => {
  const w = await world();
  const gone = await w.make("Pat Lee divorce file");
  const keep = await w.make("Lunch order");
  await w.rec.mergeFields("item", gone, { name: { value: "Pat Lee settlement", hlc: formatHlc({ ms: 2_000, counter: 0, deviceId: "dev_a" }), baseSeq: 1 } }, "usr_dana");
  assert.ok(count(w, "rs_changes", gone) > 0, "the change feed holds the record before the purge");
  const c = ctx();
  assert.deepEqual(await w.purge["records.purge"](c, { type: "item", recordId: gone, idempotencyKey: "k1" }), { erased: true });
  assert.equal(await w.rec.store.get("item", gone, { include_deleted: true }), null);
  assert.ok(await w.rec.store.get("item", keep));
  for (const t of ["rt_item", "rt_item__fm", "rs_changes", "records_field_history"]) assert.equal(count(w, t, gone), 0, `${t} holds nothing of the record`);
  assert.ok(count(w, "rs_changes", keep) > 0, "the other record's feed stays");
  assert.deepEqual(c.emitted.map((e) => [e.name, e.payload]), [["record.purged", { type: "item", recordId: gone }]]);
  assert.deepEqual(await w.purge["records.purge"](c, { type: "item", recordId: gone, idempotencyKey: "k2" }), { erased: false });
  assert.deepEqual(await w.purge["records.purge"](c, { type: "nope", recordId: gone, idempotencyKey: "k3" }), { erased: false }, "an unknown type is nothing to erase");
});

test("a record in Trash is purged too, and Trash purge keeps the young and the held, oldest first in batches", async () => {
  const w = await world();
  const old1 = await w.make("old one");
  w.tick(1000);
  const old2 = await w.make("old two");
  const held = await w.make("old held");
  const young = await w.make("young");
  const live = await w.make("live");
  for (const id of [old1, old2, held]) { const r = (await w.rec.store.get("item", id))!; await w.rec.store.remove("item", id, r.version); w.tick(1000); }
  w.tick(40 * 86_400_000);
  const y = (await w.rec.store.get("item", young))!;
  await w.rec.store.remove("item", young, y.version);
  w.rec.host.tx.exec("CREATE TABLE IF NOT EXISTS records_holds (hold_id INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT NOT NULL, id TEXT NOT NULL, reason TEXT NOT NULL, by TEXT NOT NULL, at INTEGER NOT NULL)");
  w.rec.host.tx.run("INSERT INTO records_holds (type, id, reason, by, at) VALUES (?, ?, ?, ?, ?)", "item", held, "litigation", "usr_dana", 1);
  const cutoff = w.now() - 30 * 86_400_000;
  const c = ctx();
  const first = await w.purge["records.purge_trashed"](c, { before: cutoff, limit: 1, idempotencyKey: "p1" });
  assert.deepEqual(first, { removed: 1, more: true });
  const second = await w.purge["records.purge_trashed"](c, { before: cutoff, limit: 5, idempotencyKey: "p2" });
  assert.deepEqual(second, { removed: 1, more: false, skippedOnHold: 1 });
  assert.equal(await w.rec.store.get("item", old1, { include_deleted: true }), null);
  assert.equal(await w.rec.store.get("item", old2, { include_deleted: true }), null);
  assert.ok(await w.rec.store.get("item", held, { include_deleted: true }), "the held record stays");
  assert.ok(await w.rec.store.get("item", young, { include_deleted: true }), "the young Trash record stays");
  assert.ok(await w.rec.store.get("item", live), "a live record is never purged");
});
