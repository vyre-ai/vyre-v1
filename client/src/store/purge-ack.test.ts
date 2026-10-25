// P-L1_09 scope add (golden flow 9): after the wipe the client calls devices.purge_ack once, retried when the server cannot be reached, and never for a wipe that failed.
import test from "node:test";
import assert from "node:assert/strict";
import { createPurgeAcker } from "./index.ts";

const tick = async (): Promise<void> => { for (let i = 0; i < 20; i++) await new Promise<void>((r) => setImmediate(r)); };

test("the ack goes after the wipe, once, with the device id", async () => {
  const order: string[] = [];
  const acker = createPurgeAcker(async (cap, input) => { order.push(`${cap} ${JSON.stringify(input)}`); return {}; }, { sleep: async () => {} });
  const out = await acker.afterWipe("dev_a1", 3, async () => { order.push("wipe"); return { tables: 12 }; });
  assert.deepEqual(out, { tables: 12 }, "the wipe's own result is returned");
  await tick();
  assert.deepEqual(order, ["wipe", 'devices.purge_ack {"deviceId":"dev_a1"}']);
  assert.deepEqual(acker.status("dev_a1", 3), { tries: 1, acked: true });
  // the same purge signalled again (live frame and pull reset both arrive): the wipe runs again but the server is told once
  await acker.afterWipe("dev_a1", 3, async () => ({ tables: 0 }));
  await tick();
  assert.equal(order.filter((x) => x.startsWith("devices.purge_ack")).length, 1);
  // a later purge of the same device (a new epoch) is acknowledged on its own
  await acker.afterWipe("dev_a1", 4, async () => ({}));
  await tick();
  assert.equal(order.filter((x) => x.startsWith("devices.purge_ack")).length, 2);
});

test("a server that cannot be reached is retried with a growing delay until it answers", async () => {
  let fails = 3;
  const delays: number[] = [];
  const acker = createPurgeAcker(async () => { if (fails-- > 0) throw new Error("offline"); return {}; }, { sleep: async (ms) => { delays.push(ms); } });
  await acker.afterWipe("dev_b2", 1, async () => ({}));
  await tick();
  assert.deepEqual(acker.status("dev_b2", 1), { tries: 4, acked: true });
  assert.deepEqual(delays, [500, 1000, 2000], "doubling");
});

test("the retries stop after maxTries and the wipe is never held up by the server", async () => {
  let calls = 0;
  const acker = createPurgeAcker(async () => { calls++; throw new Error("down"); }, { maxTries: 3, sleep: async () => {} });
  const t0 = Date.now();
  await acker.afterWipe("dev_c3", 1, async () => "wiped");
  assert.ok(Date.now() - t0 < 1000, "the wipe returns without waiting for the ack");
  await tick();
  assert.equal(calls, 3);
  assert.deepEqual(acker.status("dev_c3", 1), { tries: 3, acked: false });
});

test("a wipe that fails acknowledges nothing", async () => {
  let calls = 0;
  const acker = createPurgeAcker(async () => { calls++; return {}; }, { sleep: async () => {} });
  await assert.rejects(() => acker.afterWipe("dev_d4", 2, async () => { throw new Error("purge left work undone"); }), /undone/);
  await tick();
  assert.equal(calls, 0);
  assert.deepEqual(acker.status("dev_d4", 2), { tries: 0, acked: false });
});
