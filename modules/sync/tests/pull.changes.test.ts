// @reads /modules/sync/migrations/0001_pull.sql
// sync.pull (ARCH 5.3): visibility, hide, cursor and limit, retries, profiles, labels, private rows, epochs. Real log events through the records store and the sync.changes projection.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { mintRecordId } from "../../../lib/ids.ts";
import { parsePullRes } from "../../../sync/src/protocol.ts";
import type { Change, DeviceClass, PullRes } from "../../../sync/src/protocol.ts";
import type { AccessSnapshot } from "../../../kernel/src/authorize/snapshot.ts";
import { openSync } from "../impl.ts";
import type { SyncHandle, SyncOpts } from "../impl.ts";
import type { PullCtx } from "../handlers/index.ts";
import { ADA, BO, CY, CONTACT_TYPE, NOW, buildAccess } from "../fixtures/world.ts";

const TRACE = "0123456789abcdef0123456789abcdef";
const DAY = 86_400_000;

interface Rig { s: SyncHandle; access: AccessSnapshot }
function rig(over: Partial<SyncOpts> = {}, access: AccessSnapshot = buildAccess()): Rig {
  return { s: openSync({ access: () => access, clock: () => NOW, ...over }), access };
}
const ctx = (person: string, device = "dev1", deviceClass: DeviceClass = "desktop"): PullCtx => ({ trace: { traceId: TRACE }, principal: person, deviceId: device, deviceClass });

async function pull(r: Rig, c: PullCtx, cursor: number, extra: { limit?: number; entities?: string[]; epoch?: number } = {}): Promise<PullRes> {
  const res = await r.s.handlers["sync.pull"](c, { cursor, epoch: extra.epoch ?? 0, ...(extra.limit !== undefined ? { limit: extra.limit } : {}), ...(extra.entities ? { entities: extra.entities } : {}) });
  const parsed = parsePullRes(JSON.parse(JSON.stringify(res)));
  assert.ok(parsed.ok, parsed.ok ? "" : parsed.error);
  return res;
}

async function contact(r: Rig, fields: Record<string, unknown>): Promise<{ id: string; version: number }> {
  const id = mintRecordId();
  const rec = await r.s.store.create("contact", id, { name: "N", email: "n@example.com", phone: "+1", region: "eu", stage: "lead", owner: ADA, ...fields });
  return { id, version: rec.version };
}
async function withType(over: Partial<SyncOpts> = {}, access?: AccessSnapshot): Promise<Rig> {
  const r = rig(over, access);
  await r.s.store.define({ add_types: [CONTACT_TYPE] });
  return r;
}
function row(r: Rig, payload: Record<string, unknown>, extra: Record<string, unknown> = {}): number {
  return r.s.host.append({ type: "sync.row", sv: 1, trace_id: TRACE, actor: ADA, vis: "space", payload, ...extra } as never).seq;
}
function rescan(r: Rig, entity: string, id: string): void {
  r.s.host.append({ type: "sync.row_rescan", sv: 1, trace_id: TRACE, actor: ADA, vis: "space", payload: { entity, id } } as never);
}
const ids = (cs: readonly Change[]): string[] => cs.map((c) => c.id);

test("a created row reaches a person who may see it as a full upsert with its field clocks; a person with no grant gets nothing", async () => {
  const r = await withType();
  const a = await contact(r, { name: "Ada's lead" });
  const res = await pull(r, ctx(ADA), 0);
  assert.equal(res.changes.length, 1);
  const c = res.changes[0]!;
  assert.equal(c.op, "upsert");
  assert.equal(c.entity, "contact");
  assert.equal(c.id, a.id);
  assert.equal(c.fields["name"]?.v, "Ada's lead");
  assert.match(c.fields["name"]?.hlc ?? "", /^[0-9a-f]+-[0-9a-f]+-/);
  assert.ok(c.fields["name"]?.actor);
  assert.equal(res.more, false);
  assert.ok(res.next >= c.seq);
  const none = await pull(r, ctx(CY), 0);
  assert.deepEqual(none.changes, []);
  assert.deepEqual(none.hide, []);
});

test("a patch for a row the device holds carries only the changed fields; the next pull from `next` is empty", async () => {
  const r = await withType();
  const a = await contact(r, {});
  const first = await pull(r, ctx(ADA), 0);
  await r.s.store.update("contact", a.id, { stage: "won" }, a.version);
  const second = await pull(r, ctx(ADA), first.next);
  assert.equal(second.changes.length, 1);
  assert.equal(second.changes[0]!.op, "patch");
  assert.deepEqual(Object.keys(second.changes[0]!.fields), ["stage"]);
  const third = await pull(r, ctx(ADA), second.next);
  assert.deepEqual(third.changes, []);
  assert.equal(third.next, second.next);
});

test("a row that leaves the person's view comes back as hide, and as a full upsert when it returns", async () => {
  const r = await withType();
  const a = await contact(r, { region: "eu" });
  const seen = await pull(r, ctx(BO), 0);
  assert.equal(seen.changes.length, 1);
  assert.equal(seen.changes[0]!.fields["phone"], undefined, "the grant hides the phone field");
  assert.ok(seen.changes[0]!.fields["email"]);
  const moved = await r.s.store.update("contact", a.id, { region: "us" }, a.version);
  const gone = await pull(r, ctx(BO), seen.next);
  assert.deepEqual(gone.changes, []);
  assert.equal(gone.hide.length, 1);
  assert.deepEqual({ entity: gone.hide[0]!.entity, id: gone.hide[0]!.id }, { entity: "contact", id: a.id });
  await r.s.store.update("contact", a.id, { region: "eu" }, moved.version);
  const back = await pull(r, ctx(BO), gone.next);
  assert.equal(back.changes.length, 1);
  assert.equal(back.changes[0]!.op, "upsert");
  assert.equal(back.changes[0]!.fields["name"]?.v, "N");
  assert.deepEqual(back.hide, []);
});

test("visibility is judged on the row as it is now: a row that left and came back before the pull is two patches and no hide", async () => {
  const r = await withType();
  const a = await contact(r, { region: "eu" });
  const first = await pull(r, ctx(BO), 0);
  const moved = await r.s.store.update("contact", a.id, { region: "us" }, a.version);
  await r.s.store.update("contact", a.id, { region: "eu" }, moved.version);
  const res = await pull(r, ctx(BO), first.next);
  assert.deepEqual(res.hide, []);
  assert.deepEqual(res.changes.map((c) => c.op), ["patch", "patch"]);
});

test("delete reaches a device that holds the row; restore brings it back whole", async () => {
  const r = await withType();
  const a = await contact(r, {});
  const first = await pull(r, ctx(ADA), 0);
  const removed = await r.s.store.remove("contact", a.id, a.version);
  const del = await pull(r, ctx(ADA), first.next);
  assert.deepEqual(del.changes.map((c) => c.op), ["delete"]);
  assert.deepEqual(del.changes[0]!.fields, {});
  await r.s.store.restore("contact", a.id);
  const back = await pull(r, ctx(ADA), del.next);
  assert.deepEqual(back.changes.map((c) => c.op), ["upsert"]);
  assert.equal(back.changes[0]!.fields["name"]?.v, "N");
  assert.ok(removed.deleted_at !== undefined);
});

test("a device that never held the row hears nothing of its deletion", async () => {
  const r = await withType();
  const a = await contact(r, {});
  await r.s.store.remove("contact", a.id, a.version);
  const res = await pull(r, ctx(ADA), 0);
  assert.deepEqual(res.changes, []);
});

test("limit and cursor: ten rows in pages of four, none twice, none lost, `more` true until the last page", async () => {
  const r = await withType();
  const made: string[] = [];
  for (let i = 0; i < 10; i++) made.push((await contact(r, { name: `c${i}` })).id);
  const got: string[] = [];
  let cursor = 0, calls = 0, more = true;
  while (more) {
    const res = await pull(r, ctx(ADA), cursor, { limit: 4 });
    calls++;
    assert.ok(res.changes.length <= 4);
    got.push(...ids(res.changes));
    assert.ok(res.next >= cursor);
    cursor = res.next;
    more = res.more;
    assert.ok(calls < 10);
  }
  assert.equal(calls, 3);
  assert.deepEqual(got, made);
});

test("a pull is repeatable: a response that never arrived leaves the device without the row, so the same request sends it again", async () => {
  const r = await withType();
  const a = await contact(r, {});
  const lost = await pull(r, ctx(ADA), 0);
  const again = await pull(r, ctx(ADA), 0);
  assert.deepEqual(again.changes, lost.changes);
  assert.equal(again.next, lost.next);
  const quiet = await pull(r, ctx(ADA), again.next);
  assert.deepEqual(quiet.changes, []);
  await r.s.store.update("contact", a.id, { stage: "won" }, a.version);
  const patch = await pull(r, ctx(ADA), quiet.next);
  assert.deepEqual(patch.changes.map((c) => c.op), ["patch"]);
});

test("a hide that was lost is sent again", async () => {
  const r = await withType();
  const a = await contact(r, { region: "eu" });
  const held = await pull(r, ctx(BO), 0);
  await r.s.store.update("contact", a.id, { region: "us" }, a.version);
  const lost = await pull(r, ctx(BO), held.next);
  const again = await pull(r, ctx(BO), held.next);
  assert.equal(lost.hide.length, 1);
  assert.deepEqual(again.hide, lost.hide);
  const quiet = await pull(r, ctx(BO), again.next);
  assert.deepEqual(quiet.hide, []);
});

test("two devices of one person are separate: the second gets the full row, not a patch", async () => {
  const r = await withType();
  const a = await contact(r, {});
  const phone = await pull(r, ctx(ADA, "dev_phone", "phone"), 0);
  assert.equal(phone.changes.length, 1);
  await r.s.store.update("contact", a.id, { stage: "won" }, a.version);
  const laptop = await pull(r, ctx(ADA, "dev_laptop"), 0);
  assert.deepEqual(laptop.changes.map((c) => c.op), ["upsert"], "the laptop never held the row, and the whole row already carries the later patch");
  assert.equal(laptop.changes[0]!.fields["stage"]?.v, "won");
  assert.ok(laptop.changes[0]!.seq > phone.next, "the whole row carries the version of the patch it absorbed, so the device's next edit is not concurrent with it");
  const phone2 = await pull(r, ctx(ADA, "dev_phone", "phone"), phone.next);
  assert.deepEqual(phone2.changes.map((c) => c.op), ["patch"]);
});

test("`entities` limits a pull to those entities", async () => {
  const r = await withType();
  await contact(r, {});
  row(r, { entity: "note_board", id: "nb1", op: "upsert", fields: { title: "Board" } });
  const res = await pull(r, ctx(ADA), 0, { entities: ["note_board"] });
  assert.deepEqual(res.changes.map((c) => c.entity), ["note_board"]);
  const all = await pull(r, ctx(ADA), 0);
  assert.equal(all.changes.length, 2);
});

test("profiles: an entity with profile none never leaves the server, and a phone gets nothing of an entity it does not mirror", async () => {
  const r = await withType();
  row(r, { entity: "grant", id: "gr1", op: "upsert", fields: { level: "view" } });
  row(r, { entity: "file_version", id: "fv1", op: "upsert", fields: { name: "v1" } });
  const desk = await pull(r, ctx(ADA), 0);
  assert.deepEqual(desk.changes.map((c) => c.entity), ["file_version"]);
  const phone = await pull(r, ctx(ADA, "dev_phone", "phone"), 0);
  assert.deepEqual(phone.changes, []);
});

test("the phone window: a message older than 90 days stays on the server, a desktop gets it", async () => {
  const r = await withType();
  row(r, { entity: "message", id: "m_new", op: "upsert", fields: { body: "fresh" }, at: NOW - DAY });
  row(r, { entity: "message", id: "m_old", op: "upsert", fields: { body: "stale" }, at: NOW - 200 * DAY });
  const desk = await pull(r, ctx(ADA), 0);
  assert.deepEqual(ids(desk.changes).sort(), ["m_new", "m_old"]);
  const phone = await pull(r, ctx(ADA, "dev_phone", "phone"), 0);
  assert.deepEqual(ids(phone.changes), ["m_new"]);
});

test("a starred thread stays on the phone whatever its age, and the window keeps the newest 200", async () => {
  const r = await withType({ keep: (_p, entity, id) => entity === "thread" && id === "t_old" });
  row(r, { entity: "thread", id: "t_old", op: "upsert", fields: { title: "Old" }, at: NOW - 900 * DAY });
  for (let i = 0; i < 205; i++) row(r, { entity: "thread", id: `t${String(i).padStart(3, "0")}`, op: "upsert", fields: { title: `T${i}` }, at: NOW - i * 1000 });
  const phone = await pull(r, ctx(ADA, "dev_phone", "phone"), 0, { limit: 1000 });
  const got = new Set(ids(phone.changes));
  assert.ok(got.has("t_old"), "starred");
  assert.ok(!got.has("t204"), "outside the newest 200");
  assert.equal(got.size, 201);
});

test("labels: a row above the person's clearance is not sent, Restricted goes nowhere, and a field above the ceiling is left out", async () => {
  const r = await withType({ phoneCeiling: () => "internal" });
  row(r, { entity: "client_plan", id: "cp_conf", op: "upsert", fields: { name: "Plan", taxId: "12-345", region: "eu" } }, { label: 2 });
  row(r, { entity: "client_plan", id: "cp_open", op: "upsert", fields: { name: "Open", taxId: "99-999", region: "eu" } }, { label: 0 });
  row(r, { entity: "client_plan", id: "cp_rest", op: "upsert", fields: { name: "Secret", region: "eu" } }, { label: 3 });
  row(r, { entity: "call", id: "call1", op: "upsert", fields: { from: "+1555", transcript: "hello", region: "eu" } });
  const bo = await pull(r, ctx(BO), 0);
  assert.deepEqual(ids(bo.changes).sort(), ["call1", "cp_open"], "bo has clearance 1 and sees no label 2 row");
  assert.equal(bo.changes.find((c) => c.id === "call1")?.fields["transcript"], undefined, "a confidential field is omitted for clearance 1");
  assert.equal(bo.changes.find((c) => c.id === "call1")?.fields["from"]?.v, "+1555");
  const ada = await pull(r, ctx(ADA), 0);
  assert.deepEqual(ids(ada.changes).sort(), ["call1", "cp_conf", "cp_open"], "ada sees up to confidential on a desktop, never restricted");
  assert.equal(ada.changes.find((c) => c.id === "call1")?.fields["transcript"]?.v, "hello");
  assert.ok(ada.changes.find((c) => c.id === "cp_conf")?.fields["name"]);
  assert.equal(ada.changes.find((c) => c.id === "cp_conf")?.fields["taxId"], undefined, "a Restricted field goes to no device");
  const phone = await pull(r, ctx(ADA, "dev_phone", "phone"), 0);
  assert.deepEqual(ids(phone.changes).sort(), ["call1", "cp_open"], "a phone ceiling of internal drops the confidential row");
  assert.equal(phone.changes.find((c) => c.id === "call1")?.fields["transcript"], undefined, "and the confidential field of a row it does get");
});

test("a private (enc 2) row goes only to its owner, as one sealed field with its key and nonce", async () => {
  const r = await withType();
  r.s.host.append({
    type: "sync.row", sv: 1, trace_id: TRACE, actor: ADA, vis: "owner", enc: 2, key_id: "k1", nonce: "bm9uY2U=", entity: "thread", entity_id: "th1",
    payload: new Uint8Array([1, 2, 3, 4]),
  } as never);
  const ada = await pull(r, ctx(ADA), 0);
  assert.equal(ada.changes.length, 1);
  const f = ada.changes[0]!.fields["$sealed"]!;
  assert.equal(f.v, Buffer.from([1, 2, 3, 4]).toString("base64"));
  assert.deepEqual(f.enc, { key: "k1", nonce: "bm9uY2U=" });
  const bo = await pull(r, ctx(BO), 0);
  assert.deepEqual(bo.changes, []);
});

test("a stale epoch gets purge and no data; the current epoch pulls normally", async () => {
  const r = await withType();
  await contact(r, {});
  r.s.setEpoch(ADA, 2);
  const stale = await pull(r, ctx(ADA), 0, { epoch: 1 });
  assert.equal(stale.reset, "purge");
  assert.equal(stale.epoch, 2);
  assert.deepEqual(stale.changes, []);
  const ok = await pull(r, ctx(ADA), 0, { epoch: 2 });
  assert.equal(ok.reset, undefined);
  assert.equal(ok.changes.length, 1);
});

test("a rescan after a grant is revoked hides the row from the device that held it, and a restored grant sends it again", async () => {
  const r = await withType();
  const a = await contact(r, { region: "eu" });
  const held = await pull(r, ctx(BO), 0);
  assert.equal(held.changes.length, 1);
  const grant = { id: "gr_bo_record", subject_kind: "actor", subject_id: BO, resource_type: "record", resource_id: null, level: "view", conditions: { rowFilter: { op: "eq", field: "region", value: "eu" } } } as const;
  r.access.revokeGrant(grant.id);
  rescan(r, "contact", a.id);
  const gone = await pull(r, ctx(BO), held.next);
  assert.equal(gone.hide.length, 1);
  assert.equal(gone.hide[0]!.id, a.id);
  r.access.putGrant(grant);
  rescan(r, "contact", a.id);
  const back = await pull(r, ctx(BO), gone.next);
  assert.deepEqual(back.changes.map((c) => c.op), ["upsert"]);
});

test("a rescan that changes nothing for a device that holds the row sends nothing", async () => {
  const r = await withType();
  const a = await contact(r, {});
  const held = await pull(r, ctx(ADA), 0);
  rescan(r, "contact", a.id);
  const res = await pull(r, ctx(ADA), held.next);
  assert.deepEqual(res.changes, []);
  assert.deepEqual(res.hide, []);
});

test("the change feed is rebuilt from the log: a reopen of the same file and a projection rebuild serve the same pull", async () => {
  const file = path.join(os.tmpdir(), `vyre-sync-pull-${process.pid}-${Date.now()}.db`);
  try {
    const access = buildAccess();
    const first = openSync({ access: () => access, clock: () => NOW, path: file });
    await first.store.define({ add_types: [CONTACT_TYPE] });
    await first.store.create("contact", mintRecordId(), { name: "Kept", region: "eu", owner: ADA });
    const before = await first.handlers["sync.pull"](ctx(ADA), { cursor: 0, epoch: 0 });
    first.host.close();
    const second = openSync({ access: () => access, clock: () => NOW, path: file });
    const after = await second.handlers["sync.pull"](ctx(ADA, "dev2"), { cursor: 0, epoch: 0 });
    second.host.rebuild("sync.changes");
    const rebuilt = await second.handlers["sync.pull"](ctx(ADA, "dev3"), { cursor: 0, epoch: 0 });
    second.host.close();
    assert.equal(before.changes.length, 1);
    assert.deepEqual(after.changes, before.changes);
    assert.deepEqual(rebuilt.changes, before.changes);
  } finally {
    for (const ext of ["", "-wal", "-shm"]) fs.rmSync(file + ext, { force: true });
  }
});
