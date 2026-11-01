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

test("every release export goes through the script that bakes the hash in and checks it", () => {
  const read = (p: string): string => fs.readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
  for (const p of [".github/workflows/release.yml", ".github/workflows/desktop.yml", "apps/desktop/package.json"]) assert.doesNotMatch(read(p).replace(/EXPO_PUBLIC_VYRE_REGISTRY_HASH=\S+/g, "HASHED"), /(^|[^D] )npx expo export/m, p);
  assert.match(read(".github/workflows/release.yml"), /node scripts\/app-export\.mjs/);
  assert.match(read("apps/desktop/package.json"), /scripts\/app-export\.mjs/);
});
