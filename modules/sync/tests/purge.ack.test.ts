// P-L1_09 scope add (golden flow 9): the purge client's wipe goes through the client's acknowledger, so devices.purge_ack is called once after the replica is wiped, in the order wipe then ack,
// whichever of the three signals (hello, pull reset, live frame) arrives first, and never when the wipe fails.
import test from "node:test";
import assert from "node:assert/strict";
import { createPurgeAcker } from "../../../client/src/store/index.ts";
import { createNodeDriver, openReplica } from "../../../sync/src/replica/index.ts";
import { createPurgeClient } from "../../../sync/src/purge/index.ts";

const tick = async (): Promise<void> => { for (let i = 0; i < 20; i++) await new Promise<void>((r) => setImmediate(r)); };

function setup(over: { keychain?: () => void } = {}) {
  const driver = createNodeDriver();
  const store = openReplica({ driver, deviceClass: "desktop", registryHash: "h1", personId: "usr_a" });
  const log: string[] = [];
  const acker = createPurgeAcker(async (cap, input) => { log.push(`${cap} ${JSON.stringify(input)}`); return {}; }, { sleep: async () => {} });
  const client = createPurgeClient({
    purge: { driver, store, keychain: { removeAll() { log.push("wipe: keychain"); over.keychain?.(); } } },
    personActive: () => true,
    around: (epoch, wipe) => acker.afterWipe("dev_a1", epoch, async () => { const r = await wipe(); log.push("wipe: done"); return r; }),
  });
  return { client, log, acker };
}

test("a pull that answers purge wipes the replica, then the device acknowledges once", async () => {
  const { client, log, acker } = setup();
  const report = await client.onPull({ reset: "purge", epoch: 3 });
  assert.ok(report && report.errors.length === 0);
  await tick();
  assert.deepEqual(log, ["wipe: keychain", "wipe: done", 'devices.purge_ack {"deviceId":"dev_a1"}'], "wipe first, then the ack");
  assert.deepEqual(acker.status("dev_a1", 3), { tries: 1, acked: true });
  // the live frame for the same epoch arrives afterwards: nothing runs twice
  assert.equal(await client.onFrame({ t: "purge", epoch: 3 }), null);
  await tick();
  assert.equal(log.filter((x) => x.startsWith("devices.purge_ack")).length, 1);
});

test("a wipe that fails is not acknowledged", async () => {
  const { client, log } = setup({ keychain: () => { throw new Error("keychain locked"); } });
  await assert.rejects(() => client.onHello({ mode: "purge", epoch: 4 }), /undone/);
  await tick();
  assert.equal(log.filter((x) => x.startsWith("devices.purge_ack")).length, 0);
});
