// The loser of a route race takes its provider route back: deleted at once, and when the provider will not, queued, retried with a back-off, shown on the Email page, and gone when it finally works.
import test from "node:test";
import assert from "node:assert/strict";
import { addressAdd } from "../handlers/address.ts";
import { openCleanups, retryCleanups } from "../handlers/cleanup.ts";
import { hostError, script, seedDomain } from "../handlers/extra/kit.ts";
import { codeOf, harness, seedMailbox } from "../fixtures/harness.ts";

function race() {
  const h = harness();
  seedDomain(h, { id: "dom_mg", name: "mg.example", provider: "mailgun", verified: true, ref: "mg.example" });
  seedMailbox(h, "mbx_a", "a@mg.example", { kind: "shared", privacy: "space" });
  seedMailbox(h, "mbx_b", "b@mg.example", { kind: "shared", privacy: "space" });
  let n = 0;
  let deleteFails = 100; // how many delete calls fail before one works
  script(h, {
    "mailgun.routes.create": async () => {
      await new Promise((r) => setTimeout(r, 5));
      return { route: { routeId: `mgr_${++n}` } };
    },
    "mailgun.routes.delete": () => {
      if (deleteFails-- > 0) throw hostError(h, "provider.unavailable");
      return {};
    },
  });
  return { h, failDeletes: (k: number) => (deleteFails = k) };
}
const both = (h: ReturnType<typeof harness>) =>
  Promise.allSettled([
    addressAdd(h.ctx, { domainId: "dom_mg", localPart: "sales", mailboxId: "mbx_a", idempotencyKey: "k-cl-1" }),
    addressAdd(h.ctx, { domainId: "dom_mg", localPart: "sales", mailboxId: "mbx_b", idempotencyKey: "k-cl-2" }),
  ]);

test("a loser whose provider route cannot be deleted is told it lost, and the route is queued, shown, retried with a back-off and cleared when it finally goes", async () => {
  const { h, failDeletes } = race();
  failDeletes(100);
  const results = await both(h);
  assert.deepEqual(results.map((r) => r.status).sort(), ["fulfilled", "rejected"]);
  assert.equal(
    codeOf((results.find((r) => r.status === "rejected") as PromiseRejectedResult).reason),
    "validation.duplicate",
  );
  assert.equal(h.called.filter((c) => c.cap === "mailgun.routes.delete").length, 3, "three tries at once");
  const open = openCleanups(h.ctx);
  assert.equal(open.length, 1);
  assert.equal(open[0]?.kind, "provider_route");
  assert.match(open[0]?.note ?? "", /sales@mg\.example/);
  // retried: too soon does nothing, later tries again and fails, later still works
  assert.equal(await retryCleanups(h.ctx), 1);
  const calls = (): number => h.called.filter((c) => c.cap === "mailgun.routes.delete").length;
  const afterFirst = calls();
  assert.equal(await retryCleanups(h.ctx), 1);
  assert.equal(calls(), afterFirst, "inside the back-off nothing is tried");
  h.advance(3 * 60_000);
  assert.equal(await retryCleanups(h.ctx), 1);
  assert.equal(openCleanups(h.ctx)[0]?.lastError, "provider.unavailable");
  assert.ok(openCleanups(h.ctx)[0]!.attempts >= 2);
  failDeletes(0);
  h.advance(10 * 60_000);
  assert.equal(await retryCleanups(h.ctx), 0);
  assert.equal(openCleanups(h.ctx).length, 0, "gone from the page once the provider has deleted it");
});

test("a loser whose provider route is deleted at once leaves nothing queued", async () => {
  const { h, failDeletes } = race();
  failDeletes(0);
  await both(h);
  assert.equal(openCleanups(h.ctx).length, 0);
  assert.equal(h.called.filter((c) => c.cap === "mailgun.routes.delete").length, 1);
});
