import test from "node:test";
import assert from "node:assert/strict";
import { NOTHING_DEFERRED, createDeferred } from "./deferred.ts";

test("deferred: the set answers by capability and by whole module", () => {
  const d = createDeferred(["sites.list", "sites.promote", "vault.import"], ["sites"]);
  assert.deepEqual([...d.deferredModules], ["sites"]);
  assert.equal(d.isModuleDeferred("sites"), true);
  assert.equal(d.isModuleDeferred("vault"), false, "one deferred action does not defer the place");
  assert.equal(d.isDeferred("vault.import"), true);
  assert.equal(d.isDeferred("vault.fill"), false);
});

test("deferred: nothing is deferred before the bootstrap answers or when the host sends no list", () => {
  assert.equal(NOTHING_DEFERRED.deferredModules.size, 0);
  assert.equal(NOTHING_DEFERRED.isDeferred("sites.list"), false);
  assert.equal(createDeferred(undefined, undefined).caps.size, 0);
});
