// The sandbox package starts a person's sandbox only through the walled starters (P-L2_16b, security sign-off S8). The unwalled startDockerSandbox and bwrapCommand keep a path from the sandbox to
// the host that P-L2_HEAVY found; they stay in their own files for the walled starters to build on and for their unit tests, and are not in the package's index, so nothing outside the package
// can start a sandbox without the wall. This test fails when one comes back to the index or when a source imports one from it.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import * as sandbox from "../../../sandbox/src/index.ts";

const root = path.resolve(import.meta.dirname, "../../..");

test("the index exports the walled starters and neither unwalled one", () => {
  const names = Object.keys(sandbox);
  assert.ok(names.includes("startWalledDockerSandbox"));
  assert.ok(names.includes("startWalledBwrapSandbox"));
  assert.ok(!names.includes("startDockerSandbox"), "startDockerSandbox is gone from the index");
  assert.ok(!names.includes("bwrapCommand"), "bwrapCommand is gone from the index");
  assert.equal(typeof sandbox.startWalledDockerSandbox, "function");
  assert.equal(typeof sandbox.startWalledBwrapSandbox, "function");
  // The pieces the walled starters and their callers need are still there.
  for (const n of ["containerConfig", "createDockerApi", "createEgressProxy", "seatbeltCommand", "validateSpec", "chooseSandbox", "confinementProbe"]) assert.ok(names.includes(n), n);
});

function sources(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name === ".git" || e.name === "generated") continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) sources(p, out);
    else if (/\.(ts|tsx|mjs)$/.test(e.name)) out.push(p);
  }
  return out;
}

test("no source outside the sandbox package takes an unwalled starter from the package index", () => {
  const bad: string[] = [];
  for (const file of [...sources(path.join(root, "modules")), ...sources(path.join(root, "agent")), ...sources(path.join(root, "host")), ...sources(path.join(root, "apps")), ...sources(path.join(root, "kernel"))]) {
    if (file.endsWith("tools.sandbox.test.ts")) continue;
    const text = fs.readFileSync(file, "utf8");
    const rel = path.relative(root, file);
    // Naming the unwalled starter in an import from the package index.
    for (const m of text.matchAll(/import\s*\{([^}]*)\}\s*from\s*["'][^"']*sandbox\/src\/index\.ts["']/g)) {
      if (/\b(startDockerSandbox|bwrapCommand)\b/.test(m[1] ?? "")) bad.push(`${rel}: imports an unwalled starter from the index`);
    }
  }
  assert.deepEqual(bad, []);
});

test("the unwalled starters are still in their own files, which is what the walled ones build on", async () => {
  const docker = await import("../../../sandbox/src/docker.ts");
  const bwrap = await import("../../../sandbox/src/bwrap.ts");
  assert.equal(typeof docker.startDockerSandbox, "function");
  assert.equal(typeof bwrap.bwrapCommand, "function");
  const walled = fs.readFileSync(path.join(root, "sandbox/src/net/docker.ts"), "utf8");
  assert.match(walled, /startDockerSandbox/);
});
