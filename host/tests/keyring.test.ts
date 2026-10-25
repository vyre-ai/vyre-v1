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

test("clear and clearAll take the key out", () => {
  const k = createKeyring({ allowed: () => true });
  k.hold("usr_a", key(1)); k.hold("usr_b", key(2));
  k.clear("usr_a");
  assert.equal(k.get("usr_a"), null);
  assert.equal(k.holds("usr_a"), false);
  assert.equal(k.holds("usr_b"), true);
  k.clearAll();
  assert.equal(k.get("usr_b"), null);
});

test("a key unlocked by a session lives while any session that unlocked it is signed in, then is wiped on the next read", () => {
  const alive = new Set(["ses_a", "ses_b"]);
  const k = createKeyring({ allowed: () => true, live: (id) => alive.has(id) });
  k.hold("usr_a", key(6), "ses_a");
  k.hold("usr_a", key(6), "ses_b");
  assert.deepEqual(k.get("usr_a"), key(6));
  alive.delete("ses_a");
  assert.deepEqual(k.get("usr_a"), key(6), "the other session is still signed in");
  alive.delete("ses_b");
  assert.equal(k.get("usr_a"), null, "the last session ended: the key is gone");
  assert.equal(k.get("usr_a"), null);
});

test("a key handed over without a session (the local admin) stays until lock", () => {
  const k = createKeyring({ allowed: () => true, live: () => false });
  k.hold("usr_a", key(8));
  assert.deepEqual(k.get("usr_a"), key(8));
  k.hold("usr_a", key(8), "ses_x");
  assert.deepEqual(k.get("usr_a"), key(8), "adding a session does not make it expire");
  k.clear("usr_a");
  assert.equal(k.get("usr_a"), null);
});

test("get hands out a copy: changing it changes nothing inside", () => {
  const k = createKeyring({ allowed: () => true });
  k.hold("usr_a", key(3));
  const copy = k.get("usr_a")!;
  copy.fill(0);
  assert.deepEqual(k.get("usr_a"), key(3));
});

test("sweep wipes the key of a person whose sessions have all ended without anyone reading it, and leaves the others", () => {
  const alive = new Set(["ses_a", "ses_c"]);
  const k = createKeyring({ allowed: () => true, live: (id) => alive.has(id) });
  k.hold("usr_a", key(1), "ses_a"); k.hold("usr_b", key(2), "ses_b"); k.hold("usr_c", key(3)); k.hold("usr_d", key(4), "ses_c");
  assert.equal(k.sweep(), 1, "only usr_b's session is gone");
  assert.deepEqual([k.holds("usr_a"), k.holds("usr_b"), k.holds("usr_c"), k.holds("usr_d")], [true, false, true, true]);
  alive.delete("ses_a");
  assert.equal(k.sweep(), 1);
  assert.equal(k.holds("usr_a"), false);
  assert.equal(k.sweep(), 0);
});
