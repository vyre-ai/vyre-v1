import test from "node:test";
import assert from "node:assert/strict";
import { defaultSpaceName } from "../src/daemon/space-name.ts";

test("a Space nobody named is called by its address, else a plain word, never its id", () => {
  assert.equal(defaultSpaceName("https://143-244-130-25.sslip.io"), "143-244-130-25.sslip.io");
  assert.equal(defaultSpaceName("space.example.com:8420"), "space.example.com");
  assert.equal(defaultSpaceName(null), "My Space");
  assert.equal(defaultSpaceName("not an address ::"), "My Space");
});
