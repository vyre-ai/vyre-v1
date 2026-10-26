import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { registryHash as daemonHash } from "../modules/mcp/projections.ts";
import { exportEnv, registryHash } from "./lib/registry-hash.mjs";
import { filesWithHash } from "./shots/registry-hash-in-bundle.mjs";

test("the hash baked into a web export is the daemon's registry hash", async () => {
  assert.equal(registryHash(), await daemonHash());
  assert.match(registryHash(), /^[0-9a-f]{64}$/);
});

test("expo export gets the hash as EXPO_PUBLIC_VYRE_REGISTRY_HASH", () => {
  assert.equal(exportEnv()["EXPO_PUBLIC_VYRE_REGISTRY_HASH"], registryHash());
  assert.equal(exportEnv()["CI"], "1");
});

test("the bundle check finds the hash in an export and fails on one built without it", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "reg-hash-"));
  fs.mkdirSync(path.join(dir, "_expo/static/js/web"), { recursive: true });
  fs.writeFileSync(path.join(dir, "_expo/static/js/web/entry.js"), `var h="${registryHash()}";hello(h)`);
  fs.writeFileSync(path.join(dir, "index.html"), "<html></html>");
  assert.equal(filesWithHash(dir, registryHash()).length, 1);
  fs.writeFileSync(path.join(dir, "_expo/static/js/web/entry.js"), `var h="";hello(h)`);
  assert.equal(filesWithHash(dir, registryHash()).length, 0);
});
