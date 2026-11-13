import test from "node:test";
import assert from "node:assert/strict";
import { addressWords, isLoopbackAddress } from "../address-words.ts";

test("a loopback address reads This computer; any other address is shown as it is", () => {
  for (const a of ["127.0.0.1:41471", "http://127.0.0.1:41471", "localhost:3000", "[::1]:80", "http://localhost"]) { assert.equal(isLoopbackAddress(a), true, a); assert.equal(addressWords(a), "This computer", a); }
  assert.equal(addressWords("northwind.vyre.run"), "northwind.vyre.run");
  assert.equal(addressWords("https://space.example.org"), "https://space.example.org");
  assert.equal(addressWords(""), "This computer");
  assert.equal(addressWords(undefined, "Not set"), "Not set");
});
