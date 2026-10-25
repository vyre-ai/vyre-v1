// The person key a node holds (ruling 62, 63): in memory only, for people whose node this is, a copy not the caller's array, wiped when cleared.
import test from "node:test";
import assert from "node:assert/strict";
import { createKeyring } from "../src/seams/keyring.ts";

const key = (n: number): Uint8Array => new Uint8Array(32).fill(n);

test("a key is held for a person whose node this is, as a copy, and only at 32 bytes", () => {
  const k = createKeyring({ allowed: (p) => p === "usr_a" });
  const mine = key(7);
  assert.equal(k.hold("usr_a", mine), true);
  mine.fill(0);
  assert.deepEqual(k.get("usr_a"), key(7));
  assert.equal(k.hold("usr_b", key(9)), false, "not this person's node: never held");
  assert.equal(k.get("usr_b"), null);
  assert.equal(k.hold("usr_a", new Uint8Array(16)), false, "a key is 32 bytes");
  assert.deepEqual(k.get("usr_a"), key(7), "a refused hold leaves the old key as it was");
});

test("clear and clearAll take the key out and zero it", () => {
  const k = createKeyring({ allowed: () => true });
  k.hold("usr_a", key(1)); k.hold("usr_b", key(2));
  const held = k.get("usr_a")!;
  k.clear("usr_a");
  assert.equal(k.get("usr_a"), null);
  assert.ok(held.every((b) => b === 0), "the bytes are wiped");
  k.clearAll();
  assert.equal(k.get("usr_b"), null);
});
