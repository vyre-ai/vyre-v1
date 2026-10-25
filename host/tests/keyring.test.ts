// The person keys a node holds (ruling 62): in memory only, for people whose node this is, cleared at sign-out and shutdown, and waiting out a second factor before they count.
import test from "node:test";
import assert from "node:assert/strict";
import { createKeyring } from "../src/seams/keyring.ts";

const key = (n: number): Uint8Array => new Uint8Array(32).fill(n);

test("a key is held for a person whose node this is, and a copy is held, not the caller's array", () => {
  const k = createKeyring({ allowed: (p) => p === "usr_a", now: () => 0 });
  const mine = key(7);
  k.hold("usr_a", mine);
  mine.fill(0);
  assert.deepEqual(k.get("usr_a"), key(7));
  k.hold("usr_b", key(9));
  assert.equal(k.get("usr_b"), null, "not this person's node: never held");
});

test("clear and clearAll take the key out and zero it", () => {
  const k = createKeyring({ allowed: () => true, now: () => 0 });
  k.hold("usr_a", key(1)); k.hold("usr_b", key(2));
  const held = k.get("usr_a")!;
  k.clear("usr_a");
  assert.equal(k.get("usr_a"), null);
  assert.ok(held.every((b) => b === 0), "the bytes are wiped");
  k.clearAll();
  assert.equal(k.get("usr_b"), null);
});

test("a staged key counts only once its second factor is released, and not after five minutes", () => {
  let t = 0;
  const k = createKeyring({ allowed: () => true, now: () => t });
  k.stage("chl_1", "usr_a", key(3));
  assert.equal(k.get("usr_a"), null, "owed a second factor: not held yet");
  k.release("chl_1");
  assert.deepEqual(k.get("usr_a"), key(3));
  k.clear("usr_a");
  k.stage("chl_2", "usr_a", key(4));
  t = 5 * 60_000 + 1;
  k.release("chl_2");
  assert.equal(k.get("usr_a"), null, "the challenge expired");
  k.stage("chl_3", "usr_a", key(5));
  k.clear("usr_a");
  k.release("chl_3");
  assert.equal(k.get("usr_a"), null, "signing out drops what was waiting");
});
