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

test("edit.remote_seen: a pushed edit reaches the other device in well under 500 ms (median and p95 over 30 edits)", async () => {
  const rig = liveRig();
  const s0 = rig.row("c1", { stage: "lead" });
  const writer: DeviceClient = rig.client(ADA, "dev_writer");
  const reader: DeviceClient = rig.client(ADA, "dev_reader");
  writer.conn.start(); reader.conn.start();
  await settle();
  await until(() => reader.st.applied.length >= 1);
  const lat: number[] = [];
  let base = s0;
  for (let i = 0; i < 30; i++) {
    const seen = reader.st.applied.length;
    const t0 = performance.now();
    // The writer's edit: a push through the real handler, then the commit tick that fans out.
    const res = await rig.r.push(ADA, "dev_writer", [patchOp({ id: `edit${i}`, fields: { stage: `s${i}` }, base: { stage: base }, hlc: hl(NOW - 60_000 + i * 10) })]);
    rig.hub.commit();
    await until(() => reader.st.applied.length > seen);
    lat.push(performance.now() - t0);
    base = res.applied[0]!.seq;
  }
  const p50 = pct(lat, 0.5), p95 = pct(lat, 0.95);
  assert.ok(p50 < 500, `median ${p50.toFixed(1)} ms`);
  assert.ok(p95 < 500, `p95 ${p95.toFixed(1)} ms, samples ${lat.map((x) => x.toFixed(1)).join(",")}`);
  assert.equal(reader.st.ids.filter((x) => x.startsWith("c1@")).length, 31, "the row once, then each edit once");
  writer.conn.stop(); reader.conn.stop();
  rig.hub.close();
});

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
