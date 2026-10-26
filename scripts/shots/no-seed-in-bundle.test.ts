// The prototype seed (11 MB) stays out of production: no app, ui or host source names it, and a production export containing it is caught.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MARKERS, checkBundle, checkSources } from "./no-seed-in-bundle.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

test("no production source file imports the generated seed or its generator", () => {
  assert.deepEqual(checkSources(ROOT), []);
});

test("a seed that is only used by tests and shots is not wired into the app's route files", () => {
  const routes = path.join(ROOT, "apps", "app", "app");
  // route files at any depth (app/claim/[token].tsx is one); a directory itself has nothing to read
  for (const f of fs.readdirSync(routes, { recursive: true }) as string[]) {
    if (!fs.statSync(path.join(routes, f)).isFile()) continue;
    assert.ok(!fs.readFileSync(path.join(routes, f), "utf8").includes("fixtures"), `${f} does not pull the fixtures in`);
  }
});

test("the bundle check fails on an export that contains the seed and passes on one that does not", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "export-"));
  fs.writeFileSync(path.join(dir, "ok.js"), "console.log('app')");
  assert.deepEqual(checkBundle(dir), []);
  fs.writeFileSync(path.join(dir, "entry-1.js"), `x=${MARKERS.join(",")}`);
  assert.deepEqual(checkBundle(dir), ["entry-1.js"]);
});
