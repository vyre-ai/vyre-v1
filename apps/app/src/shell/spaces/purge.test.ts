// P-L9_33: the shell's purge. A purge signal wipes what this browser holds once per epoch, then acknowledges it to the server with devices.purge_ack, never after a wipe that failed, and only then
// does the shell leave. The ack is the client package's createPurgeAcker; the signals are the live link's.
import test from "node:test";
import assert from "node:assert/strict";
import { removeSpaceFromBrowser, watchPurge, webPurgeClient, wipeBrowserStorage } from "./purge.ts";
import { NORTHWIND } from "./model.ts";
import { readStored, readStoredSessions, writeStored } from "../session/stored.ts";
import type { StoredSession } from "../session/stored.ts";

const fast = { backoffMs: () => 0, sleep: async () => undefined };

test("a purge wipes once per epoch, acknowledges it with the device, then lets the shell leave", async () => {
  const calls: { cap: string; input: unknown }[] = [];
  const order: string[] = [];
  const client = webPurgeClient({
    deviceId: "web",
    call: async (cap, input) => {
      calls.push({ cap, input });
      order.push("ack");
      return {};
    },
    wipe: () => {
      order.push("wipe");
    },
    done: () => {
      order.push("done");
    },
    ack: fast,
    sleep: async () => undefined,
  });
  await client.onFrame({ t: "purge", epoch: 7 });
  await client.onFrame({ t: "purge", epoch: 7 });
  assert.deepEqual(
    order,
    ["wipe", "ack", "done"],
    "wipe first, then the ack, then the shell leaves; the second signal for the epoch does nothing",
  );
  assert.deepEqual(calls, [{ cap: "devices.purge_ack", input: { deviceId: "web" } }]);
});

test("a wipe that fails acknowledges nothing, rethrows, and is tried again on the next signal", async () => {
  let n = 0;
  const calls: string[] = [];
  const client = webPurgeClient({
    deviceId: "web",
    call: async (cap) => {
      calls.push(cap);
      return {};
    },
    wipe: () => {
      if (++n === 1) throw new Error("storage is locked");
    },
    ack: fast,
    sleep: async () => undefined,
  });
  await assert.rejects(() => client.onFrame({ t: "purge", epoch: 3 }), /storage is locked/);
  assert.deepEqual(calls, [], "data left behind is not a purge: nothing was acknowledged");
  await client.onFrame({ t: "purge", epoch: 3 });
  assert.deepEqual(calls, ["devices.purge_ack"]);
});

test("an ack the server cannot take is retried and then given up on, and the shell still leaves", async () => {
  let tries = 0;
  let left = 0;
  const client = webPurgeClient({
    deviceId: "web",
    call: async () => {
      tries++;
      throw new Error("offline");
    },
    wipe: () => undefined,
    done: () => {
      left++;
    },
    ack: { ...fast, maxTries: 3 },
    sleep: async () => undefined,
    settleMs: 5_000,
  });
  await client.onFrame({ t: "purge", epoch: 1 });
  assert.equal(tries, 3);
  assert.equal(left, 1);
});

test("watchPurge sends each signal the link hears to the client and stops when asked", async () => {
  let listener: ((epoch: number) => void) | null = null;
  const got: number[] = [];
  const stop = watchPurge({
    client: {
      onFrame: async (f) => {
        got.push(f.epoch);
        return null;
      },
    },
    subscribe: (l) => {
      listener = l;
      return () => {
        listener = null;
      };
    },
  });
  listener!(4);
  await Promise.resolve();
  assert.deepEqual(got, [4]);
  stop();
  assert.equal(listener, null);
});

test("wiping the browser removes every key the app keeps and leaves the rest", () => {
  const store = new Map<string, string>([
    ["vyre.session.v1", "x"],
    ["vyre.tabs.nw", "y"],
    ["other", "z"],
  ]);
  (globalThis as { localStorage?: unknown }).localStorage = {
    get length() {
      return store.size;
    },
    key: (i: number) => [...store.keys()][i] ?? null,
    removeItem: (k: string) => {
      store.delete(k);
    },
  };
  try {
    wipeBrowserStorage();
    assert.deepEqual([...store.keys()], ["other"]);
  } finally {
    delete (globalThis as { localStorage?: unknown }).localStorage;
  }
});

test("clearing one Space from a browser leaves every other Space signed in and opening (F5)", () => {
  const store = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    get length() {
      return store.size;
    },
    key: (i: number) => [...store.keys()][i] ?? null,
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  };
  try {
    const one: StoredSession = {
      baseUrl: "https://one.example.test",
      token: "t1",
      personId: "p1",
      marker: "m1",
      def: { ...NORTHWIND, spaceId: "one" },
    };
    const two: StoredSession = {
      baseUrl: "https://two.example.test",
      token: "t2",
      personId: "p2",
      marker: "m2",
      def: { ...NORTHWIND, spaceId: "two" },
    };
    writeStored(one);
    writeStored(two);
    for (const k of [
      "vyre.sidebar.folded.one",
      "vyre.sidebar.v2.one",
      "vyre.tabs.v1:web:p1:one",
      "vyre.look.p1",
      "vyre.appearance.v1:p1:one",
      "vyre.inbox.has.p1.one",
      // the other Space's own
      "vyre.sidebar.folded.two",
      "vyre.sidebar.v2.two",
      "vyre.tabs.v1:web:p2:two",
      "vyre.look.p2",
      "vyre.appearance.v1:p2:two",
      // the device's own
      "vyre.update.auto",
      "vyre.ui.v1",
      "other",
    ])
      store.set(k, "x");
    removeSpaceFromBrowser(one);
    assert.equal(readStored(undefined, one.baseUrl), null, "the removed Space is signed out here");
    const left = readStored(undefined, two.baseUrl);
    assert.equal(left?.token, "t2", "the other Space is still signed in");
    assert.deepEqual(
      readStoredSessions().map((s) => s.def.spaceId),
      ["two"],
      "and it still opens from the stored list",
    );
    assert.deepEqual(
      [...store.keys()].sort(),
      [
        "other",
        "vyre.appearance.v1:p2:two",
        "vyre.look.p2",
        "vyre.session.v1",
        "vyre.sidebar.folded.two",
        "vyre.sidebar.v2.two",
        "vyre.tabs.v1:web:p2:two",
        "vyre.ui.v1",
        "vyre.update.auto",
      ].sort(),
    );
  } finally {
    delete (globalThis as { localStorage?: unknown }).localStorage;
  }
});

test("a person who is in two Spaces on this browser keeps their look when one Space goes", () => {
  const store = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    get length() {
      return store.size;
    },
    key: (i: number) => [...store.keys()][i] ?? null,
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  };
  try {
    const a: StoredSession = {
      baseUrl: "https://a.example.test",
      token: "ta",
      personId: "same",
      marker: "m",
      def: { ...NORTHWIND, spaceId: "a" },
    };
    const b: StoredSession = {
      baseUrl: "https://b.example.test",
      token: "tb",
      personId: "same",
      marker: "m",
      def: { ...NORTHWIND, spaceId: "b" },
    };
    writeStored(a);
    writeStored(b);
    store.set("vyre.look.same", "x");
    removeSpaceFromBrowser(a);
    assert.equal(store.has("vyre.look.same"), true);
  } finally {
    delete (globalThis as { localStorage?: unknown }).localStorage;
  }
});
