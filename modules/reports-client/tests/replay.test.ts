// The replay sandbox (P-L7b_08; spec 4.18, b9, ARCH 7.14): replaying a failed Run on a copy sends nothing and replaces sealed values.
// Golden flow 7 (a failed Run) uses the same function against the seeded Space; this test runs it against a fake copy so the rule is checked on its own.
// @reads ../migrations/0001_init.sql

import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { VyreErr } from "../../../packages/contracts/src/errors.ts";
import { replayWorld, world } from "../fixtures/world.ts";
import { configureReplay, replayRun } from "../handlers/index.ts";
import { leaves, configureReports } from "../handlers/submit.ts";
import { synthetic } from "../handlers/replay.ts";

const failed = async (p: Promise<unknown>): Promise<VyreErr> => {
  try { await p; } catch (e) { assert.ok(e instanceof VyreErr, "a typed error"); return e; }
  throw new Error("expected the call to fail");
};

afterEach(() => { configureReplay(null); configureReports(null); });

test("replaying a failed Run sends nothing and replaces sealed and Restricted values", async () => {
  const w = world();
  configureReports(w.drivers);
  const rw = replayWorld();
  configureReplay(rw.drivers);

  const out = await replayRun(w.ctx, { seq: 4812, target: { kind: "run", runId: "run_failed1" } });

  assert.deepEqual(rw.restored, [4812]);
  assert.deepEqual(out.outcome, { result: "failed", failedAt: "step_3" });
  assert.equal(out.sent, 0);
  assert.equal(w.posted.length, 0, "nothing went to the report service");
  assert.deepEqual(rw.leaked, [], "nothing reached a real transport");
  assert.deepEqual(out.stubbed.map((c) => c.cap), ["mail.send", "telephony.sms"]);
  assert.equal(out.replaced, 3);

  // the values in the copy are synthetic now
  const copy = rw.copies[0]!;
  for (const v of rw.values) assert.notEqual(copy.state.get(v.ref), v.value, `${v.ref} was replaced`);
  assert.equal(copy.state.get("rows/contact/1/email"), "person2@example.invalid");
  // and the calls the re-run made carry only the synthetic ones
  for (const leaf of leaves(out.stubbed)) for (const v of rw.values) assert.ok(!leaf.includes(v.value), `"${leaf}" holds a real value`);
  assert.match(JSON.stringify(out.stubbed[0]!.input), /person2@example\.invalid/);
  assert.equal(copy.disposed, true, "the copy is removed");
});

test("a Space that sends the real values on purpose: a caller who may reveal them can keep them, others cannot ask", async () => {
  const w = world();
  configureReports(w.drivers);
  const rw = replayWorld();
  configureReplay(rw.drivers);
  const kept = await replayRun(w.ctx, { seq: 10, target: { kind: "run", runId: "run_x" }, keepValues: true });
  assert.equal(kept.replaced, 0);
  assert.equal(kept.sent, 0, "even with real values nothing is sent");
  assert.ok(leaves(kept.stubbed).some((l) => l.includes("123-45-6789")), "the caller sees the real values");
  w.perms.delete("records.reveal");
  const err = await failed(replayRun(w.ctx, { seq: 10, target: { kind: "run", runId: "run_x" }, keepValues: true }));
  assert.equal(err.error.code, "permission.above_clearance");
  assert.equal(rw.copies.length, 1, "no copy was made for the refused request");
});

test("replay needs server.logs and console.access", async () => {
  const w = world();
  configureReports(w.drivers);
  const rw = replayWorld();
  configureReplay(rw.drivers);
  for (const missing of ["server.logs", "console.access"]) {
    w.perms.add("server.logs"); w.perms.add("console.access");
    w.perms.delete(missing);
    const err = await failed(replayRun(w.ctx, { seq: 1, target: { kind: "run", runId: "run_x" } }));
    assert.equal(err.error.code, "permission.role_lacks_permission", missing);
  }
  assert.deepEqual(rw.restored, []);
});

test("a sync conflict can be replayed the same way, and a bad sequence number is refused", async () => {
  const w = world();
  configureReports(w.drivers);
  const rw = replayWorld();
  configureReplay(rw.drivers);
  await replayRun(w.ctx, { seq: 77, target: { kind: "sync_conflict", conflictId: "cfl_1" } });
  assert.deepEqual(rw.copies[0]!.reruns, [{ kind: "sync_conflict", conflictId: "cfl_1" }]);
  for (const seq of [-1, 1.5, Number.NaN]) {
    assert.equal((await failed(replayRun(w.ctx, { seq, target: { kind: "run", runId: "run_x" } }))).error.code, "validation.bad_input");
  }
});

test("the copy is removed even when the re-run throws", async () => {
  const w = world();
  configureReports(w.drivers);
  const rw = replayWorld();
  const base = rw.drivers.restoreCopy.bind(rw.drivers);
  configureReplay({ restoreCopy: async (seq) => { const c = await base(seq); (c as { rerunFails?: string }).rerunFails = "the Run engine crashed"; return c; } });
  await assert.rejects(replayRun(w.ctx, { seq: 5, target: { kind: "run", runId: "run_x" } }), /Run engine crashed/);
  assert.equal(rw.copies[0]!.disposed, true);
});

test("without the sandbox wired the answer says so", async () => {
  const w = world();
  const err = await failed(replayRun(w.ctx, { seq: 1, target: { kind: "run", runId: "run_x" } }));
  assert.equal(err.error.code, "internal.unavailable");
});

test("synthetic stand-ins keep the look of the value they replace", () => {
  assert.equal(synthetic({ ref: "a", kind: "sealed", value: "ada@clientco.example" }, 1), "person1@example.invalid");
  assert.equal(synthetic({ ref: "a", kind: "sealed", value: "+1 (555) 123-4567" }, 2), "+15550000002");
  assert.equal(synthetic({ ref: "a", kind: "sealed", value: "123-45-6789" }, 3), "+15550000003");
  assert.equal(synthetic({ ref: "a", kind: "restricted", value: "Maria Okafor" }, 4), "restricted-value-4");
  assert.equal(synthetic({ ref: "a", kind: "sealed", value: "token" }, 5), "sealed-value-5");
});
