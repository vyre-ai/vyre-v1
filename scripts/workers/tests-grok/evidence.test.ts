// Evidence and test-file checks of the Grok harness (stdlib Python unittest, run through node:test so CI selects it).
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const python = spawnSync("python3", ["--version"]).status === 0;

test("evidence.py: required tests parse, CI state carries across pushes, preflight, auto evidence", { skip: !python }, () => {
  const r = spawnSync("python3", ["-I", path.join(here, "test_evidence.py")], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr + r.stdout);
});
