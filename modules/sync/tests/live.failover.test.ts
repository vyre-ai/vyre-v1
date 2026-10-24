// @reads /modules/sync/migrations/0001_pull.sql
// Failover (ARCH 5.9): heartbeat loss moves the device to the next endpoint and the stream resumes from its cursor with no gap and nothing applied twice.
import test from "node:test";
import assert from "node:assert/strict";
import { HEARTBEAT_DEAD_MS, HEARTBEAT_MS } from "../../../client/src/connection/index.ts";
import { ADA, BO, liveRig, settle } from "./live.rig.test.ts";
import type { LiveRig } from "./live.rig.test.ts";

const DIRECT = "wss://direct.example/live";
const RELAY = "wss://relay.example/live";

async function run(rig: LiveRig, ms: number): Promise<void> {
  for (let t = 0; t < ms; t += HEARTBEAT_MS) { rig.sched.advance(HEARTBEAT_MS); await settle(); }
}
const rowIds = (ids: string[]): string[] => ids.map((x) => x.split("@")[0]!);

test("heartbeat loss fails over to the next endpoint and resumes without a gap", async () => {
  const rig = liveRig();
  const a = rig.client(ADA, "dev_a");
  a.conn.start();
  await settle();
  const first = a.conn.endpoint()!.url;
  const other = first === DIRECT ? RELAY : DIRECT;
  for (let i = 1; i <= 3; i++) rig.row(`c${i}`);
  rig.hub.commit();
  await settle();
  assert.deepEqual(rowIds(a.st.ids), ["c1", "c2", "c3"]);

  // The path to the first endpoint dies without a close. Three more rows commit while the device cannot hear them.
  rig.blackhole(first);
  for (let i = 4; i <= 6; i++) rig.row(`c${i}`);
  rig.hub.commit();
  await settle();
  assert.deepEqual(rowIds(a.st.ids), ["c1", "c2", "c3"], "nothing got through");

  await run(rig, HEARTBEAT_DEAD_MS + HEARTBEAT_MS);
  assert.equal(a.conn.status(), "live");
  assert.equal(a.conn.endpoint()?.url, other, "now on the other endpoint");
  assert.equal(a.conn.stats().failovers, 1);
  assert.equal(a.conn.endpoints().find((e) => e.url === first)!.health, "down");
  assert.deepEqual(rowIds(a.st.ids), ["c1", "c2", "c3", "c4", "c5", "c6"], "every row once, in order, none missing");
  assert.equal(a.st.cursor, a.st.applied.at(-1)!.seq);
  assert.equal(rig.hub.sessionsOf(ADA, "dev_a"), 1, "the hub dropped the dead session too");
  assert.equal(rig.links.filter((l) => l.link.isOpen() && l.url === other).length, 1);
  a.conn.stop();
  rig.hub.close();
});

test("after a failover a new commit still reaches the device, and the stream keeps its numbering", async () => {
  const rig = liveRig();
  const a = rig.client(ADA, "dev_a");
  a.conn.start();
  await settle();
  rig.row("c1");
  rig.hub.commit();
  await settle();
  rig.blackhole(a.conn.endpoint()!.url);
  await run(rig, HEARTBEAT_DEAD_MS + HEARTBEAT_MS);
  assert.equal(a.conn.stats().failovers, 1);
  const seq = rig.row("c2");
  rig.hub.commit();
  await settle();
  assert.deepEqual(rowIds(a.st.ids), ["c1", "c2"]);
  assert.equal(a.st.cursor, seq);
  a.conn.stop();
  rig.hub.close();
});

test("a hide that was in flight when the path died is delivered once after failover", async () => {
  const rig = liveRig();
  rig.row("c1");
  const bo = rig.client(BO, "dev_bo");
  bo.conn.start();
  await settle();
  assert.deepEqual(rowIds(bo.st.ids), ["c1"]);
  const hides: string[] = [];
  const first = bo.conn.endpoint()!.url;
  rig.blackhole(first);
  rig.patch("c1", { region: "us" });
  rig.hub.commit();
  await settle();
  await run(rig, HEARTBEAT_DEAD_MS + HEARTBEAT_MS);
  for (const b of bo.st.applied) for (const h of b.hide) hides.push(h.id);
  assert.deepEqual(hides, ["c1"], "exactly one hide");
  assert.equal(bo.conn.status(), "live");
  bo.conn.stop();
  rig.hub.close();
});

test("a device whose only endpoint dies reconnects to it when it comes back and catches up", async () => {
  const rig = liveRig();
  const a = rig.client(ADA, "dev_a", { urls: [DIRECT] });
  a.conn.start();
  await settle();
  rig.row("c1");
  rig.hub.commit();
  await settle();
  rig.links.forEach((l) => l.link.cut("server restarted"));
  rig.refused.add(DIRECT);
  await settle();
  assert.equal(a.conn.status(), "reconnecting");
  rig.row("c2");
  rig.refused.delete(DIRECT);
  rig.sched.advance(500);
  await settle();
  assert.equal(a.conn.status(), "live");
  assert.deepEqual(rowIds(a.st.ids), ["c1", "c2"]);
  a.conn.stop();
  rig.hub.close();
});
