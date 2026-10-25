// The person key under the password (ruling 62): sealed by the device, opened at sign-in on the person's own node, and nothing else opens it.
// @reads /modules/identity/handlers/personkey.ts
import test from "node:test";
import assert from "node:assert/strict";
import { unwrapPersonKey, wrapPersonKey } from "../handlers/personkey.ts";

const KEY = new Uint8Array(32).map((_, i) => i + 1);

test("the password opens the key it sealed, whatever the case of the username", () => {
  const wrapped = wrapPersonKey("correct horse battery staple 9", "Maya", KEY);
  assert.match(wrapped, /^[A-Za-z0-9+/=]+$/, "base64, so it fits a key bundle");
  assert.deepEqual(unwrapPersonKey("correct horse battery staple 9", "maya", wrapped), KEY);
  assert.ok(!wrapped.includes(Buffer.from(KEY).toString("base64")));
});

test("a wrong password, another username or a bundle made some other way open nothing", () => {
  const wrapped = wrapPersonKey("correct horse battery staple 9", "maya", KEY);
  assert.equal(unwrapPersonKey("wrong password entirely", "maya", wrapped), null);
  assert.equal(unwrapPersonKey("correct horse battery staple 9", "rob", wrapped), null);
  assert.equal(unwrapPersonKey("correct horse battery staple 9", "maya", "cGVyc29uLWJ5LXBhc3N3b3Jk"), null);
  assert.equal(unwrapPersonKey("x", "maya", ""), null);
});
