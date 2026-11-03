// The deps cache key (scripts/ci-deps.sh): a release version bump keeps the key, any dependency change moves it.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "ci-deps.sh");

const pkg = (version: string, dep = "1.2.3") => JSON.stringify({ name: "vyre-v1", version, workspaces: ["lib"], dependencies: { left: dep } }, null, 2) + "\n";
const lock = (version: string, dep = "1.2.3", workspaceVersion = "0.0.1") => JSON.stringify({
  name: "vyre-v1", version, lockfileVersion: 3, requires: true,
  packages: {
    "": { name: "vyre-v1", version, workspaces: ["lib"], dependencies: { left: dep } },
    lib: { name: "lib", version: workspaceVersion },
    "node_modules/left": { version: dep, resolved: "https://registry/left.tgz" },
  },
}, null, 2) + "\n";

function key(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "deps-key-"));
  for (const [f, body] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), body); }
  const r = spawnSync("bash", [SCRIPT, dir], { encoding: "utf8", env: { ...process.env, VYRE_DEPS_KEY_ONLY: "1", VYRE_DEPS_CACHE: path.join(dir, ".cache") } });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim();
}

test("a version bump of the project keeps the deps cache key; a changed dependency, workspace version or manifest moves it", { skip: process.platform === "win32" || spawnSync("sha256sum", ["--version"]).status !== 0 }, () => {
  const base = key({ "package.json": pkg("1.0.0-rc.20"), "package-lock.json": lock("1.0.0-rc.20") });
  assert.match(base, /^[0-9a-f]{16}$/);
  assert.equal(key({ "package.json": pkg("1.0.0-rc.21"), "package-lock.json": lock("1.0.0-rc.21") }), base, "only the project's own version changed");
  assert.notEqual(key({ "package.json": pkg("1.0.0-rc.20", "1.2.4"), "package-lock.json": lock("1.0.0-rc.20", "1.2.4") }), base, "a dependency changed");
  assert.notEqual(key({ "package.json": pkg("1.0.0-rc.20"), "package-lock.json": lock("1.0.0-rc.20", "1.2.3", "0.0.2") }), base, "a workspace entry changed");
  assert.notEqual(key({ "package.json": pkg("1.0.0-rc.20"), "package-lock.json": lock("1.0.0-rc.20").replace("registry/left", "registry/right") }), base, "a resolved address changed");
});
