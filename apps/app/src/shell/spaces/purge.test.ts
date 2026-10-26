// P-L9_33: the shell's purge. A purge signal wipes what this browser holds once per epoch, then acknowledges it to the server with devices.purge_ack, never after a wipe that failed, and only then
// does the shell leave. The ack is the client package's createPurgeAcker; the signals are the live link's.
import test from "node:test";
import assert from "node:assert/strict";
import { watchPurge, webPurgeClient, wipeBrowserStorage } from "./purge.ts";

const fast = { backoffMs: () => 0, sleep: async () => undefined };

test("a purge wipes once per epoch, acknowledges it with the device, then lets the shell leave", async () => {
  const calls: { cap: string; input: unknown }[] = [];
  const order: string[] = [];
  const client = webPurgeClient({
    deviceId: "web", call: async (cap, input) => { calls.push({ cap, input }); order.push("ack"); return {}; },
    wipe: () => { order.push("wipe"); }, done: () => { order.push("done"); }, ack: fast, sleep: async () => undefined,
  });
  await client.onFrame({ t: "purge", epoch: 7 });
  await client.onFrame({ t: "purge", epoch: 7 });
  assert.deepEqual(order, ["wipe", "ack", "done"], "wipe first, then the ack, then the shell leaves; the second signal for the epoch does nothing");
  assert.deepEqual(calls, [{ cap: "devices.purge_ack", input: { deviceId: "web" } }]);
});

test("a wipe that fails acknowledges nothing, rethrows, and is tried again on the next signal", async () => {
  let n = 0;
  const calls: string[] = [];
  const client = webPurgeClient({ deviceId: "web", call: async (cap) => { calls.push(cap); return {}; }, wipe: () => { if (++n === 1) throw new Error("storage is locked"); }, ack: fast, sleep: async () => undefined });
  await assert.rejects(() => client.onFrame({ t: "purge", epoch: 3 }), /storage is locked/);
  assert.deepEqual(calls, [], "data left behind is not a purge: nothing was acknowledged");
  await client.onFrame({ t: "purge", epoch: 3 });
  assert.deepEqual(calls, ["devices.purge_ack"]);
});

test("an ack the server cannot take is retried and then given up on, and the shell still leaves", async () => {
  let tries = 0;
  let left = 0;
  const client = webPurgeClient({ deviceId: "web", call: async () => { tries++; throw new Error("offline"); }, wipe: () => undefined, done: () => { left++; }, ack: { ...fast, maxTries: 3 }, sleep: async () => undefined, settleMs: 5_000 });
  await client.onFrame({ t: "purge", epoch: 1 });
  assert.equal(tries, 3);
  assert.equal(left, 1);
});

test("watchPurge sends each signal the link hears to the client and stops when asked", async () => {
  let listener: ((epoch: number) => void) | null = null;
  const got: number[] = [];
  const stop = watchPurge({ client: { onFrame: async (f) => { got.push(f.epoch); return null; } }, subscribe: (l) => { listener = l; return () => { listener = null; }; } });
  listener!(4);
  await Promise.resolve();
  assert.deepEqual(got, [4]);
  stop();
  assert.equal(listener, null);
});

test("wiping the browser removes every key the app keeps and leaves the rest", () => {
  const store = new Map<string, string>([["vyre.session.v1", "x"], ["vyre.tabs.nw", "y"], ["other", "z"]]);
  (globalThis as { localStorage?: unknown }).localStorage = {
    get length() { return store.size; }, key: (i: number) => [...store.keys()][i] ?? null, removeItem: (k: string) => { store.delete(k); },
  };
  try {
    wipeBrowserStorage();
    assert.deepEqual([...store.keys()], ["other"]);
  } finally {
    delete (globalThis as { localStorage?: unknown }).localStorage;
  }
});
