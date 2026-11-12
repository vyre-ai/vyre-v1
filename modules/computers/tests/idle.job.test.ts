// The idle pass must actually run. On the production server an old desktop sat in "working" from 5 Nov and never slept, because sleepIdle (and the move to a workspace that rides on it)
// had no caller: the module offered the host no periodic job. This reproduces the stuck state: a desktop that has been quiet for a day is still Working after everything the host runs on a
// schedule has run, unless the module hands the host the job.
import test from "node:test";
import assert from "node:assert/strict";
import { collectHooks } from "../../../host/src/daemon/consumers.ts";
import * as impl from "../impl.ts";
import { provision, wake } from "../handlers/lifecycle.ts";
import { harness, MIN } from "../fixtures/harness.ts";

const DAY = 24 * 60 * MIN;

test("the module gives the host an idle job, and one run puts a desktop that has been quiet for a day to sleep", async () => {
  const h = harness();
  const id = (await provision(h.ctx, { agentId: "agt_dex", idempotencyKey: "k-dex" })).computer.computerId;
  await wake(h.ctx, { computerId: id });
  assert.equal(h.rows("SELECT state FROM computers_computers")[0]?.["state"], "working");
  h.advance(DAY);
  // what the host would run: every periodic job the module exports, read the way the host reads them
  const hooks = collectHooks("computers", impl as unknown as Record<string, unknown>);
  const job = hooks.periodic.find((p) => p.name === "computers.idle");
  assert.ok(job, "the module offers no periodic job named computers.idle, so nothing ever calls sleepIdle");
  assert.ok(job.everyMs <= 5 * MIN, "the pass runs at least every five minutes");
  await job.run(h.ctx as never);
  assert.equal(h.rows("SELECT state FROM computers_computers")[0]?.["state"], "asleep", "a desktop nobody used for a day sleeps");
  assert.deepEqual(h.named("computer.slept").map((e) => e.payload["reason"]), ["idle"]);
});
