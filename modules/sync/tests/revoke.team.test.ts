// @reads /modules/sync/migrations/0001_pull.sql
// A revoked device in a Team Space (P-SEC_02, ARCH 5.7): after `sync.epoch.bump` with reason device_revoked the device is refused on every path the server has, whatever epoch it says it holds
// (that number is the client's word): pull answers purge with no rows, hello answers purge, a snapshot is not started or paged, a push applies nothing. The person's other device is untouched.
import test from "node:test";
import assert from "node:assert/strict";
import { deviceRevoked } from "../../../sync/src/server/pull/index.ts";
import { createPushHandlers } from "../handlers/push.ts";
import { createPurgeHandlers, purgeDepsOf } from "../handlers/purge.ts";
import { ADA, NOW } from "../fixtures/world.ts";
import { ctx as pushCtx, hl, patchOp, pushRig } from "./push.rig.test.ts";
import { liveRig, settle } from "./live.rig.test.ts";

const TRACE = "0123456789abcdef0123456789abcdef";
const code = (e: unknown): string => (e as { error?: { code?: string } } | null)?.error?.code ?? "";
const admin = { trace: { traceId: TRACE }, principal: ADA };

function scene() {
  const rig = pushRig();
  const push = createPushHandlers({ deviceRevoked: (person, device) => deviceRevokedOf(rig, person, device), ...rig.deps });
  const purge = createPurgeHandlers(purgeDepsOf(rig.s, { purge: () => 0 }));
  return { rig, push, purge };
}
// the same read the module's own push wiring uses (modules/sync/impl.ts)
const deviceRevokedOf = (rig: ReturnType<typeof pushRig>, person: string, device: string): boolean => deviceRevoked(rig.s.host.tx, person, device);

const pullCtx = (device: string) => ({ ...pushCtx(ADA, device), deviceClass: "desktop" as const });
test("a revoked device's pull answers purge and sends no rows, whatever epoch it presents; the person's other device keeps pulling", async () => {
  const { rig, purge } = scene();
  rig.seed("contact", "c1", { name: "Ann", email: "a@example.com", phone: "+1", region: "eu", stage: "lead", owner: ADA });
  const pull = rig.s.handlers["sync.pull"];
  assert.equal((await pull(pullCtx("dev_phone"), { cursor: 0, epoch: 0 })).changes.length, 1, "before the revoke the phone pulls");
  const bump = await purge["sync.epoch.bump"](admin, { personId: ADA, reason: "device_revoked", deviceId: "dev_phone" });
  assert.equal(bump.epoch, 1);
  for (const presented of [0, 1, 2, 99]) {
    const r = await pull(pullCtx("dev_phone"), { cursor: 0, epoch: presented });
    assert.equal(r.reset, "purge", `epoch ${presented} is refused`);
    assert.deepEqual([r.changes, r.hide, r.more], [[], [], false], "no rows, no hides");
  }
  const laptop = await pull(pullCtx("dev_laptop"), { cursor: 0, epoch: 0 });
  assert.equal(laptop.reset, undefined, "the other device is not told to purge");
  assert.equal(laptop.changes.length, 1, "and still gets its rows");
});

test("a revoked device cannot start or page a snapshot; the other device can", async () => {
  const { rig, purge } = scene();
  rig.seed("contact", "c1", { name: "Ann", email: "a@example.com", phone: "+1", region: "eu", stage: "lead", owner: ADA });
  const h = rig.s.handlers;
  const begin = await h["sync.snapshot.begin"](pullCtx("dev_phone"), { deviceClass: "desktop" });
  assert.ok(begin.plan.length > 0, "before the revoke the phone can start one");
  await purge["sync.epoch.bump"](admin, { personId: ADA, reason: "device_revoked", deviceId: "dev_phone" });
  await assert.rejects(() => h["sync.snapshot.begin"](pullCtx("dev_phone"), { deviceClass: "desktop" }), (e: unknown) => code(e) === "auth.device_revoked");
  await assert.rejects(() => h["sync.snapshot.page"](pullCtx("dev_phone"), { entity: begin.plan[0]!.entity, asOf: begin.asOfSeq }), (e: unknown) => code(e) === "auth.device_revoked", "a snapshot begun earlier cannot be paged either");
  const other = await h["sync.snapshot.begin"](pullCtx("dev_laptop"), { deviceClass: "desktop" });
  assert.ok(other.plan.length > 0);
  const page = await h["sync.snapshot.page"](pullCtx("dev_laptop"), { entity: other.plan[0]!.entity, asOf: other.asOfSeq });
  assert.ok(page.rows.length > 0, "the other device gets its page");
});

test("a revoked device's push applies nothing, whatever epoch it presents; the other device's push applies", async () => {
  const { rig, push, purge } = scene();
  const seq = rig.seed("contact", "c1", { name: "Ann", email: "a@example.com", phone: "+1", region: "eu", stage: "lead", owner: ADA });
  await purge["sync.epoch.bump"](admin, { personId: ADA, reason: "device_revoked", deviceId: "dev_phone" });
  const op = (id: string, device: string) => patchOp({ id, fields: { stage: "won" }, base: { stage: seq }, hlc: hl(NOW - 1000, 0, device) });
  for (const presented of [0, 1, 50]) {
    await assert.rejects(
      () => push["sync.push"](pullCtx("dev_phone"), JSON.parse(JSON.stringify({ deviceId: "dev_phone", epoch: presented, ops: [op(`op_p${presented}`, "dev_phone")] })) as never),
      (e: unknown) => code(e) === "auth.device_revoked", `epoch ${presented} is refused`,
    );
  }
  assert.equal(rig.value("contact", "c1", "stage"), "lead", "nothing the revoked device sent was applied");
  assert.equal(rig.calls.length, 0, "no capability ran for it");
  const ok = await push["sync.push"](pullCtx("dev_laptop"), JSON.parse(JSON.stringify({ deviceId: "dev_laptop", epoch: 0, ops: [op("op_laptop", "dev_laptop")] })) as never);
  assert.equal(ok.applied.length, 1, "the other device pushes as before");
  assert.equal(rig.value("contact", "c1", "stage"), "won");
});

test("a revoked device's hello is answered purge, whatever epoch it says, and its live socket is closed; the other device goes live", async () => {
  const rig = liveRig();
  rig.row("c1");
  const purge = createPurgeHandlers(purgeDepsOf(rig.r.s, rig.hub));
  await purge["sync.epoch.bump"](admin, { personId: ADA, reason: "device_revoked", deviceId: "dev_phone" });
  const phone = rig.client(ADA, "dev_phone");
  const laptop = rig.client(ADA, "dev_laptop");
  phone.conn.start();
  laptop.conn.start();
  await settle();
  assert.deepEqual(phone.st.ids, [], "the revoked device is sent no rows");
  assert.notEqual(phone.conn.status(), "live", "and is not live");
  assert.deepEqual(laptop.st.ids.map((x) => x.split("@")[0]), ["c1"], "the other device is live and has its row");
  assert.equal(laptop.conn.status(), "live");
  phone.conn.stop();
  laptop.conn.stop();
  rig.hub.close();
});
