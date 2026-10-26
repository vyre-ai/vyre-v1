// Erase reaches synced devices (P-CC_41): a device that already pulled a record is told to drop it when the record is erased, with the same delete that the replica turns into a hide (row, field clocks,
// search entry, saved documents, cached files), and the delete carries no field values. A device that never held the row hears nothing. Real log events through the records store and sync.changes.
// @reads /modules/sync/migrations/0001_pull.sql
import test from "node:test";
import assert from "node:assert/strict";
import { mintRecordId } from "../../../lib/ids.ts";
import { parsePullRes } from "../../../sync/src/protocol.ts";
import type { DeviceClass, PullRes } from "../../../sync/src/protocol.ts";
import { pullHides } from "../../../sync/src/purge/index.ts";
import { openSync } from "../impl.ts";
import type { SyncHandle } from "../impl.ts";
import type { PullCtx } from "../handlers/index.ts";
import { ADA, CONTACT_TYPE, NOW, buildAccess } from "../fixtures/world.ts";

const TRACE = "0123456789abcdef0123456789abcdef";
const ctx = (person: string, device: string, deviceClass: DeviceClass = "desktop"): PullCtx => ({ trace: { traceId: TRACE }, principal: person, deviceId: device, deviceClass });

async function pull(s: SyncHandle, c: PullCtx, cursor: number): Promise<PullRes> {
  const res = await s.handlers["sync.pull"](c, { cursor, epoch: 0 });
  const parsed = parsePullRes(JSON.parse(JSON.stringify(res)));
  assert.ok(parsed.ok, parsed.ok ? "" : parsed.error);
  return res;
}

test("a device that pulled the record is told to drop it when it is erased, and the delete carries no values", async () => {
  const access = buildAccess();
  const s = openSync({ access: () => access, clock: () => NOW });
  await s.store.define({ add_types: [CONTACT_TYPE] });
  const id = mintRecordId();
  const rec = await s.store.create("contact", id, { name: "Pat Lee", email: "pat@client.example", phone: "+14155550177", region: "eu", stage: "lead", owner: ADA });
  const laptop = await pull(s, ctx(ADA, "dev_laptop"), 0);
  assert.equal(laptop.changes[0]!.fields["name"]?.v, "Pat Lee", "the laptop holds the record");
  const phone = await pull(s, ctx(ADA, "dev_phone", "phone"), 0);
  assert.equal(phone.changes.length, 1, "so does the phone");

  await s.store.remove("contact", id, rec.version);   // what records.delete does for the eraser

  for (const [device, prior] of [["dev_laptop", laptop.next], ["dev_phone", phone.next]] as const) {
    const after = await pull(s, ctx(ADA, device, device === "dev_phone" ? "phone" : "desktop"), prior);
    assert.deepEqual(after.changes.map((c) => [c.op, c.entity, c.id]), [["delete", "contact", id]], `${device} is told to drop the row`);
    assert.deepEqual(after.changes[0]!.fields, {}, "the delete holds no field values");
    assert.deepEqual(pullHides(after).map((h) => [h.entity, h.id]), [["contact", id]], `${device}: the client turns it into a hide of the row and what sits beside it`);
    assert.equal(JSON.stringify(after).includes("pat@client.example"), false);
  }
});

test("a device that never held the erased row hears nothing about it", async () => {
  const access = buildAccess();
  const s = openSync({ access: () => access, clock: () => NOW });
  await s.store.define({ add_types: [CONTACT_TYPE] });
  const id = mintRecordId();
  const rec = await s.store.create("contact", id, { name: "Pat Lee", email: "pat@client.example", phone: "+1", region: "eu", stage: "lead", owner: ADA });
  await s.store.remove("contact", id, rec.version);
  const fresh = await pull(s, ctx(ADA, "dev_new"), 0);
  assert.deepEqual(fresh.changes, []);
  assert.deepEqual(pullHides(fresh), []);
});
