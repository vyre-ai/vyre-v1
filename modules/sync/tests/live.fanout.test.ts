// @reads /modules/sync/migrations/0001_pull.sql
// Budgets edit.remote_seen and connection_count (ARCH 9): an edit on one device is on another in under 500 ms, and twenty screens on a device are one socket on the server.
import test from "node:test";
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { hl, patchOp } from "./push.rig.test.ts";
import { ADA, NOW, liveRig, settle } from "./live.rig.test.ts";
import type { DeviceClient } from "./live.rig.test.ts";

async function until(cond: () => boolean, ms = 2000): Promise<void> {
  const t0 = performance.now();
  while (!cond()) {
    if (performance.now() - t0 > ms) throw new Error("timed out");
    await new Promise<void>((r) => setImmediate(r));
  }
}
const pct = (xs: number[], p: number): number => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.ceil(p * xs.length) - 1)]!;

test("connection_count: twenty screens on each of two devices are exactly two sockets on the server", async () => {
  const rig = liveRig();
  const a = rig.client(ADA, "dev_a"), b = rig.client(ADA, "dev_b");
  const handles = [...Array.from({ length: 20 }, () => a.conn.acquire()), ...Array.from({ length: 20 }, () => b.conn.acquire())];
  await settle();
  assert.equal(rig.open(), 2, "one per device after each raced its endpoints");
  assert.equal(rig.hub.sessions(), 2);
  assert.equal(rig.hub.sessionsOf(ADA, "dev_a"), 1);
  assert.equal(rig.hub.sessionsOf(ADA, "dev_b"), 1);
  rig.row("c1");
  rig.hub.commit();
  await settle();
  assert.equal(a.st.applied.length, 1, "twenty subscribers, one delivery");
  for (const h of handles) h.release();
  a.conn.stop(); b.conn.stop();
  rig.hub.close();
});
