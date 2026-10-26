// P-SEC_10: governance.jobs.tick is the schedule's call. A direct call from someone who does not manage policy is refused and purges nothing; the host's own call, a nested call and an admin's scheduled call still run.
import test from "node:test";
import assert from "node:assert/strict";
import * as g from "../handlers/index.ts";
import { harness } from "../fixtures/harness.ts";

const direct = (h: ReturnType<typeof harness>, manages: boolean): void => {
  h.ctx.depth = 0;
  h.ctx.authorize = (a) => ({ effect: manages && a.perm === "policy.manage" ? "allow" : "deny" });
};

test("a direct call from a member who does not manage policy is refused and removes nothing", async () => {
  const h = harness();
  h.addFile("fil_old00001", { deletedAt: 1 });
  direct(h, false);
  await assert.rejects(g.jobsTick(h.ctx, { kind: "trash" }), (e: unknown) => { assert.equal((e as { error?: { code?: string } }).error?.code, "permission.role_lacks_permission"); return true; });
  assert.deepEqual(h.emitted.filter((e) => e.name === "retention.purged"), []);
  assert.deepEqual(h.calls("files.purge"), []);
  assert.ok(h.world.files.has("fil_old00001"), "the old Trash file is still there");
});

test("a direct call with no authorizer at all is refused (it fails closed)", async () => {
  const h = harness();
  delete (h.ctx as { authorize?: unknown }).authorize;
  for (const depth of [0, 1]) { h.ctx.depth = depth; await assert.rejects(g.jobsTick(h.ctx, { kind: "trash" })); }
});

test("a nested call made for a member who does not manage policy is refused too", async () => {
  const h = harness();
  h.addFile("fil_old00001", { deletedAt: 1 });
  h.ctx.depth = 1;
  h.ctx.authorize = () => ({ effect: "deny" });
  await assert.rejects(g.jobsTick(h.ctx, { kind: "trash" }), (e: unknown) => (e as { error?: { code?: string } }).error?.code === "permission.role_lacks_permission");
  assert.ok(h.world.files.has("fil_old00001"));
});

test("the host's own call, and the call of someone who manages policy at any depth, run", async () => {
  const h = harness();
  h.actAs("service", "svc_host");
  h.ctx.depth = 0;
  assert.deepEqual(await g.jobsTick(h.ctx, { kind: "trash" }), { removed: 0, skippedOnHold: 0 });
  h.actAs("person", "usr_olivia");
  for (const depth of [0, 1]) {
    h.ctx.depth = depth;
    direct(h, true);
    h.ctx.depth = depth;
    assert.deepEqual(await g.jobsTick(h.ctx, { kind: "trash" }), { removed: 0, skippedOnHold: 0 });
  }
});
