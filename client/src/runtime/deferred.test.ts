import test from "node:test";
import assert from "node:assert/strict";
import { NOTHING_DEFERRED, capsByModule, createDeferred } from "./deferred.ts";

const rows = [
  { name: "sites.list", module: "sites" }, { name: "sites.promote", module: "sites" },
  { name: "vault.import", module: "vault" }, { name: "vault.fill", module: "vault" },
  { name: "files.read", module: "files" },
];

test("deferred: a module is deferred only when all of its capabilities are", () => {
  const d = createDeferred(["sites.list", "sites.promote", "vault.import"], capsByModule(rows));
  assert.deepEqual([...d.deferredModules], ["sites"]);
  assert.equal(d.isModuleDeferred("sites"), true);
  assert.equal(d.isModuleDeferred("vault"), false, "one deferred action does not defer the place");
  assert.equal(d.isDeferred("vault.import"), true);
  assert.equal(d.isDeferred("vault.fill"), false);
  assert.equal(d.isDeferred("files.read"), false);
});

test("deferred: nothing is deferred before the bootstrap answers, and a module with no capabilities is never deferred", () => {
  assert.equal(NOTHING_DEFERRED.deferredModules.size, 0);
  assert.equal(NOTHING_DEFERRED.isDeferred("sites.list"), false);
  assert.equal(createDeferred(["x.y"], { empty: [] }).deferredModules.size, 0);
});
