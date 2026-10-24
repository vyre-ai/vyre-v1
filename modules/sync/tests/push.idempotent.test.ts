// @reads /modules/sync/migrations/0001_pull.sql
// sync.push is exact under retry (ARCH 5.4): an op may be pushed any number of times and applies once.
import test from "node:test";
import assert from "node:assert/strict";
import { createPushHandlers } from "../handlers/push.ts";
import { NOW, hl, patchOp, pushRig } from "./push.rig.test.ts";

const code = (c: string) => (e: unknown) => {
  assert.equal((e as { error?: { code?: string } }).error?.code, c);
  return true;
};

test("a retried push applies once and gets the first answer back", async () => {
  const r = pushRig();
  const s0 = r.seed("contact", "c1", { name: "A", stage: "lead" });
  const ops = [patchOp({ id: "op1", fields: { name: "B" }, base: { name: s0 }, hlc: hl(NOW - 5000) }), patchOp({ id: "op2", fields: { stage: "won" }, base: { stage: s0 }, hlc: hl(NOW - 4000) })];
  const first = await r.push("usr_ada", "dev_a", ops);
  const head = r.s.host.store.head.seq;
  const again = await r.push("usr_ada", "dev_a", ops);
  const third = await r.push("usr_ada", "dev_a", ops);
  assert.deepEqual(first.applied.map((a) => a.opId), ["op1", "op2"]);
  assert.deepEqual(again.applied, first.applied);
  assert.deepEqual(third.applied, first.applied);
  assert.equal(r.calls.length, 2, "the capability ran once per op");
  assert.equal(r.s.host.store.head.seq, head, "no event was written by the retries");
  assert.equal(r.value("contact", "c1", "name"), "B");
});

test("the op id is the capability's idempotency key and the call carries the person, device, trace and clamped hlc", async () => {
  const r = pushRig();
  const s0 = r.seed("contact", "c1", { name: "A" });
  await r.push("usr_bo", "dev_phone", [patchOp({ id: "op_key", fields: { name: "B" }, base: { name: s0 }, hlc: hl(NOW - 1000, 3, "dev_phone") })]);
  const c = r.calls[0]!;
  assert.equal(c.idempotencyKey, "op_key");
  assert.equal(c.principal, "usr_bo");
  assert.equal(c.deviceId, "dev_phone");
  assert.equal(c.traceId, "0123456789abcdef0123456789abcdef");
  assert.equal(c.hlc, hl(NOW - 1000, 3, "dev_phone"));
  assert.deepEqual(c.input, { fields: { name: "B" } });
});

test("a half-applied batch: the refused op is refused again, the applied ops stay applied, nothing runs twice", async () => {
  const r = pushRig();
  const s0 = r.seed("contact", "c1", { name: "A", stage: "lead", region: "eu" });
  r.refuse.add("test.denied");
  const ops = [
    patchOp({ id: "ok1", fields: { name: "B" }, base: { name: s0 }, hlc: hl(NOW - 3000) }),
    patchOp({ id: "bad", fields: { stage: "won" }, base: { stage: s0 }, hlc: hl(NOW - 2000), cap: "test.denied" }),
    patchOp({ id: "ok2", fields: { region: "us" }, base: { region: s0 }, hlc: hl(NOW - 1000) }),
  ];
  const first = await r.push("usr_ada", "dev_a", ops);
  assert.deepEqual(first.applied.map((a) => a.opId), ["ok1", "ok2"]);
  assert.equal(first.rejected.length, 1);
  assert.equal(first.rejected[0]!.opId, "bad");
  assert.equal(first.rejected[0]!.error.code, "permission.no_grant");
  assert.deepEqual(first.rejected[0]!.copyOut, { stage: "won" }, "the person can copy the refused values out");
  const callsBefore = r.calls.length;
  r.refuse.clear();
  const again = await r.push("usr_ada", "dev_a", ops);
  assert.deepEqual(again.applied, first.applied);
  assert.deepEqual(again.rejected, first.rejected);
  assert.equal(r.calls.length, callsBefore, "a refusal is a result: it is not tried again");
});

test("a failure that may pass stops the batch; the next push applies the rest and does not repeat the first", async () => {
  const r = pushRig();
  const s0 = r.seed("contact", "c1", { name: "A", stage: "lead", region: "eu" });
  const ops = [
    patchOp({ id: "t1", fields: { name: "B" }, base: { name: s0 }, hlc: hl(NOW - 3000) }),
    patchOp({ id: "t2", fields: { stage: "won" }, base: { stage: s0 }, hlc: hl(NOW - 2000) }),
    patchOp({ id: "t3", fields: { region: "us" }, base: { region: s0 }, hlc: hl(NOW - 1000) }),
  ];
  // The first invoke passes, the second times out.
  const real = r.deps.invoke;
  let n = 0;
  r.deps.invoke = async (call) => { n++; if (n === 2) r.transient.n = 1; return real(call); };
  const first = await r.push("usr_ada", "dev_a", ops);
  assert.deepEqual(first.applied.map((a) => a.opId), ["t1"]);
  assert.deepEqual(first.rejected, []);
  assert.equal(r.value("contact", "c1", "stage"), "lead", "the op after the failure did not run");
  r.deps.invoke = real;
  const second = await r.push("usr_ada", "dev_a", ops);
  assert.deepEqual(second.applied.map((a) => a.opId), ["t1", "t2", "t3"]);
  assert.equal(second.applied[0]!.seq, first.applied[0]!.seq, "t1 gets its first answer");
  assert.equal(r.calls.filter((c) => c.idempotencyKey === "t1").length, 1);
  assert.equal(r.value("contact", "c1", "region"), "us");
});

test("a failure on the very first op fails the request", async () => {
  const r = pushRig();
  const s0 = r.seed("contact", "c1", { name: "A" });
  r.transient.n = 1;
  await assert.rejects(r.push("usr_ada", "dev_a", [patchOp({ id: "x1", fields: { name: "B" }, base: { name: s0 }, hlc: hl(NOW - 1000) })]), code("timeout.deadline"));
  const ok = await r.push("usr_ada", "dev_a", [patchOp({ id: "x1", fields: { name: "B" }, base: { name: s0 }, hlc: hl(NOW - 1000) })]);
  assert.equal(ok.applied.length, 1, "a failed attempt frees the id");
});

test("the same op id with different content is refused, not applied a second time", async () => {
  const r = pushRig();
  const s0 = r.seed("contact", "c1", { name: "A" });
  await r.push("usr_ada", "dev_a", [patchOp({ id: "dup", fields: { name: "B" }, base: { name: s0 }, hlc: hl(NOW - 2000) })]);
  const res = await r.push("usr_ada", "dev_a", [patchOp({ id: "dup", fields: { name: "C" }, base: { name: s0 }, hlc: hl(NOW - 1000) })]);
  assert.equal(res.applied.length, 0);
  assert.equal(res.rejected[0]!.error.code, "validation.duplicate");
  assert.deepEqual(res.rejected[0]!.copyOut, { fields: { name: "C" } });
  assert.equal(r.value("contact", "c1", "name"), "B");
});

test("a held op is reported held, and a retry reports the same task", async () => {
  const r = pushRig();
  const s0 = r.seed("contact", "c1", { name: "A" });
  r.hold.add("h1");
  const op = patchOp({ id: "h1", fields: { name: "B" }, base: { name: s0 }, hlc: hl(NOW - 1000) });
  const first = await r.push("usr_ada", "dev_a", [op]);
  assert.deepEqual(first.held, [{ opId: "h1", taskId: "tsk_h1" }]);
  assert.deepEqual(first.applied, []);
  assert.equal(r.value("contact", "c1", "name"), "A");
  const again = await r.push("usr_ada", "dev_a", [op]);
  assert.deepEqual(again.held, first.held);
  assert.equal(r.calls.length, 1);
});

test("a device below the person's epoch is revoked: the push fails with auth.device_revoked and nothing runs", async () => {
  const r = pushRig();
  const s0 = r.seed("contact", "c1", { name: "A" });
  r.epochs.set("usr_ada", 3);
  await assert.rejects(r.push("usr_ada", "dev_a", [patchOp({ id: "e1", fields: { name: "B" }, base: { name: s0 }, hlc: hl(NOW - 1000) })], 2), code("auth.device_revoked"));
  assert.equal(r.calls.length, 0);
  const ok = await r.push("usr_ada", "dev_a", [patchOp({ id: "e1", fields: { name: "B" }, base: { name: s0 }, hlc: hl(NOW - 1000) })], 3);
  assert.equal(ok.applied.length, 1);
});

test("the request is checked: more than 200 ops, a bad op, or another device's id is refused", async () => {
  const r = pushRig();
  const many = Array.from({ length: 201 }, (_, i) => patchOp({ id: `m${i}`, fields: { name: "x" }, hlc: hl(NOW - 1000) }));
  await assert.rejects(r.push("usr_ada", "dev_a", many), code("validation.too_large"));
  const wrong = createPushHandlers(r.deps);
  await assert.rejects(wrong["sync.push"]({ trace: { traceId: "0123456789abcdef0123456789abcdef" }, principal: "usr_ada", deviceId: "dev_other", deviceClass: "desktop" }, { deviceId: "dev_a", epoch: 0, ops: [] }), code("validation.bad_input"));
  await assert.rejects(wrong["sync.push"]({ trace: { traceId: "0123456789abcdef0123456789abcdef" }, principal: "usr_ada", deviceId: "dev_a", deviceClass: "desktop" }, { deviceId: "dev_a", epoch: 0, ops: [{ opId: "" }] } as never), code("validation.bad_input"));
});
