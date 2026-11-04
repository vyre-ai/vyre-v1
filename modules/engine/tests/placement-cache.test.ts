// Where a chat runs is read once and kept; a machine that was drained, hit its limits, ran out of room or has room again (network.machine_changed) drops what was kept, so the next turn reads it again.
import assert from "node:assert/strict";
import { test } from "node:test";
import { consumers } from "../impl.ts";
import { forgetPlacement, placementOf } from "../placement-cache.ts";

test("a cached placement is dropped when a machine changes, and read again on the next turn", async () => {
  forgetPlacement();
  const key = { threadId: "thr_1", agentId: "agt_a", asker: "usr_me" };
  let reads = 0, where: string | undefined = "dev_mac";
  const read = async (): Promise<string | undefined> => { reads++; return where; };
  assert.equal(await placementOf(read, key, 1000), "dev_mac");
  assert.equal(await placementOf(read, key, 2000), "dev_mac");
  assert.equal(reads, 1, "kept");
  const c = consumers["engine.placement_cache"];
  assert.deepEqual(c.on, ["network.machine_changed"]);
  where = undefined;   // the Mac was drained: the turn goes to the Space
  await c.run();
  assert.equal(await placementOf(read, key, 3000), undefined, "read again after the event");
  assert.equal(reads, 2);
  forgetPlacement();
});
