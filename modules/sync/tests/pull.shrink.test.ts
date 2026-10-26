// @reads /modules/sync/migrations/0001_pull.sql
// P-GF_09 (ARCH 5.7): access shrinks without a row changing (a grant revoked or narrowed, a share expiring, a label raised). The next pull hides every row the person can no longer see, with no rescan event:
// the rows a device holds are checked again whenever the access state they were last checked under has changed. A share given reaches a device that had already synced past the row.
import test from "node:test";
import assert from "node:assert/strict";
import { mintRecordId } from "../../../lib/ids.ts";
import type { DeviceClass, PullRes } from "../../../sync/src/protocol.ts";
import type { AccessSnapshot } from "../../../kernel/src/authorize/snapshot.ts";
import { openSync } from "../impl.ts";
import type { SyncHandle } from "../impl.ts";
import type { PullCtx } from "../handlers/index.ts";
import { ADA, BO, CY, CONTACT_TYPE, NOW, buildAccess } from "../fixtures/world.ts";

const TRACE = "0123456789abcdef0123456789abcdef";
interface Rig { s: SyncHandle; access: AccessSnapshot; clock: { now: number } }
async function rig(): Promise<Rig> {
  const access = buildAccess();
  const clock = { now: NOW };
  const s = openSync({ access: () => access, clock: () => clock.now });
  await s.store.define({ add_types: [CONTACT_TYPE] });
  return { s, access, clock };
}
const ctx = (person: string, device = "dev1", deviceClass: DeviceClass = "desktop"): PullCtx => ({ trace: { traceId: TRACE }, principal: person, deviceId: device, deviceClass });
const pull = (r: Rig, c: PullCtx, cursor: number): Promise<PullRes> => r.s.handlers["sync.pull"](c, { cursor, epoch: 0 });
async function contact(r: Rig, fields: Record<string, unknown> = {}): Promise<string> {
  const id = mintRecordId();
  await r.s.store.create("contact", id, { name: "N", email: "n@example.com", phone: "+1", region: "eu", stage: "lead", owner: ADA, ...fields });
  return id;
}
const BO_GRANT = { id: "gr_bo_record", subject_kind: "actor", subject_id: BO, resource_type: "record", resource_id: null, level: "view", conditions: { rowFilter: { op: "eq", field: "region", value: "eu" } } } as const;

test("a revoked grant hides the rows the device holds on the next pull, without any row changing, and the hide is sent again until the device moves on", async () => {
  const r = await rig();
  const a = await contact(r), b = await contact(r);
  const held = await pull(r, ctx(BO), 0);
  assert.equal(held.changes.length, 2);
  r.access.revokeGrant("gr_bo_record");
  const gone = await pull(r, ctx(BO), held.next);
  assert.deepEqual(gone.hide.map((h) => h.id).sort(), [a, b].sort(), "both rows are hidden");
  assert.deepEqual(gone.changes, []);
  const again = await pull(r, ctx(BO), held.next);
  assert.deepEqual(again.hide.map((h) => h.id).sort(), [a, b].sort(), "a response that never arrived is answered the same way");
  // the rescan events carry no row content, and a person with no access learns nothing from them
  const feed = r.s.deps.db.all<{ op: string; fields: string }>("SELECT op, fields FROM sync_changes WHERE op = 'rescan'");
  assert.ok(feed.length >= 2 && feed.every((c) => c.fields === "{}"), "a rescan names the row and carries no content");
  const cy = await pull(r, ctx(CY, "dev_cy"), 0);
  assert.deepEqual([cy.changes, cy.hide], [[], []], "a person with no access gets nothing from the rescans");
  assert.deepEqual((await pull(r, ctx(CY, "dev_cy"), cy.next)).hide, []);
  await contact(r, { region: "us" });
  const later = await pull(r, ctx(BO), gone.next + 1);
  assert.deepEqual(later.hide, [], "once the device has moved past it the hide is not sent again");
});

test("a person who still sees a row keeps it: nothing is hidden when access changes elsewhere", async () => {
  const r = await rig();
  await contact(r);
  const held = await pull(r, ctx(ADA), 0);
  r.access.revokeGrant("gr_bo_record");
  const res = await pull(r, ctx(ADA), held.next);
  assert.deepEqual([res.changes, res.hide], [[], []]);
});

test("a narrowed grant hides only the rows it no longer reaches", async () => {
  const r = await rig();
  const eu = await contact(r, { region: "eu" });
  const held = await pull(r, ctx(BO), 0);
  assert.deepEqual(held.changes.map((c) => c.id), [eu]);
  r.access.putGrant({ ...BO_GRANT, conditions: { rowFilter: { op: "eq", field: "region", value: "us" } } });
  const res = await pull(r, ctx(BO), held.next);
  assert.deepEqual(res.hide.map((h) => h.id), [eu]);
});

test("a share that expires hides its rows once the time has passed", async () => {
  const r = await rig();
  const a = await contact(r);
  r.access.putGrant({ ...BO_GRANT, expires_at: NOW + 60_000 });
  const held = await pull(r, ctx(BO), 0);
  assert.deepEqual(held.changes.map((c) => c.id), [a]);
  r.clock.now = NOW + 30_000;
  assert.deepEqual((await pull(r, ctx(BO), held.next)).hide, [], "still shared");
  r.clock.now = NOW + 120_000;
  const res = await pull(r, ctx(BO), held.next);
  assert.deepEqual(res.hide.map((h) => h.id), [a], "expired");
});

test("a device that never held a row is told nothing about it, and another person's device is unaffected", async () => {
  const r = await rig();
  await contact(r);
  const ada = await pull(r, ctx(ADA), 0);
  const bo = await pull(r, ctx(BO, "dev_bo"), 0);
  r.access.revokeGrant("gr_bo_record");
  const none = await pull(r, ctx(BO, "dev_never"), bo.next);
  assert.deepEqual(none.hide, [], "dev_never held nothing");
  assert.deepEqual((await pull(r, ctx(ADA), ada.next)).hide, []);
  assert.equal((await pull(r, ctx(BO, "dev_bo"), bo.next)).hide.length, 1, "the device that held it is told");
});

test("a grant given back after a hide brings the row back on the next pull", async () => {
  const r = await rig();
  const a = await contact(r);
  const held = await pull(r, ctx(BO), 0);
  r.access.revokeGrant("gr_bo_record");
  const gone = await pull(r, ctx(BO), held.next);
  assert.deepEqual(gone.hide.map((h) => h.id), [a]);
  r.access.putGrant(BO_GRANT);
  const back = await pull(r, ctx(BO), gone.next);
  assert.deepEqual(back.changes.map((c) => [c.id, c.op]), [[a, "upsert"]], "the device that applied the hide gets the row again");
  assert.deepEqual(back.hide, []);
});

const rescans = (r: Rig): number => r.s.deps.db.get<{ n: number }>("SELECT count(*) AS n FROM sync_changes WHERE op = 'rescan'")?.n ?? 0;
const stampOf = (r: Rig, person: string, device = "dev1"): string | undefined => r.s.deps.db.get<{ stamp: string }>("SELECT stamp FROM sync_scope_stamp WHERE person = ? AND device = ?", person, device)?.stamp;

test("without a grant that expires, pulls a minute apart do not recheck anything; with one they do", async () => {
  const r = await rig();
  await contact(r);
  const first = await pull(r, ctx(ADA), 0);
  const stamp = stampOf(r, ADA);
  assert.ok(stamp, "the first pull records what it checked under");
  r.clock.now = NOW + 60_000;
  await pull(r, ctx(ADA), first.next);
  r.clock.now = NOW + 120_000;
  await pull(r, ctx(ADA), first.next);
  assert.equal(stampOf(r, ADA), stamp, "the clock alone does not change what was checked under");
  assert.equal(rescans(r), 0, "and nothing was asked for again");

  r.access.putGrant({ ...BO_GRANT, expires_at: NOW + 10 * 60_000 });
  await pull(r, ctx(BO), 0);
  const timed = stampOf(r, BO);
  r.clock.now = NOW + 180_000;
  await pull(r, ctx(BO), first.next);
  assert.notEqual(stampOf(r, BO), timed, "a person with an expiring share is checked as the clock moves");
});

test("a share given after the device synced past the row delivers it on the next pull", async () => {
  const r = await rig();
  r.access.revokeGrant("gr_bo_record");
  const a = await contact(r);
  const before = await pull(r, ctx(BO), 0);
  assert.deepEqual(before.changes, [], "nothing is shared yet");
  await contact(r, { region: "us" });
  const synced = await pull(r, ctx(BO), before.next);
  r.access.putGrant(BO_GRANT);
  const res = await pull(r, ctx(BO), synced.next);
  assert.deepEqual(res.changes.map((c) => [c.id, c.op]), [[a, "upsert"]], "the newly visible row arrives, the one outside the share does not");
  const retry = await pull(r, ctx(BO), synced.next);
  assert.deepEqual(retry.changes.map((c) => c.id), [a], "a pull whose response was lost is answered the same way");
  const done = await pull(r, ctx(BO), res.next);
  assert.deepEqual([done.changes, done.hide], [[], []], "and the device then has it");
});
