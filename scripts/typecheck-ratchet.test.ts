import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { countErrors, judge, inCi } from "./typecheck-ratchet.ts";

const SCRIPT = fileURLToPath(new URL("./typecheck-ratchet.ts", import.meta.url));

test("errors are counted per line, module-not-found ones are not", () => {
  const out = ["a.ts(1,1): error TS2322: x", "a.ts(2,1): error TS2307: Cannot find module", "b.tsx(3,4): error TS7016: no declaration", "b.tsx(9,9): error TS2339: y", "  continuation line"].join("\n");
  assert.equal(countErrors(out), 2);
});

test("more errors than the baseline fail; fewer pass and offer the lower count", () => {
  assert.equal(judge(11, 10).ok, false);
  assert.deepEqual([judge(10, 10).ok, judge(10, 10).lower], [true, false]);
  assert.deepEqual([judge(9, 10).ok, judge(9, 10).lower], [true, true]);
});

test("on a CI runner a ratchet that cannot count fails; elsewhere it says it skipped (the gates step read skipped on every push until 5 Nov)", () => {
  assert.deepEqual([inCi({ GITHUB_ACTIONS: "true" }), inCi({ CI: "true" }), inCi({ CI: "1" }), inCi({})], [true, true, false, false]);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ratchet-"));
  try {
    const ci = spawnSync(process.execPath, [SCRIPT], { cwd: dir, encoding: "utf8", env: { ...process.env, GITHUB_ACTIONS: "true" } });
    assert.equal(ci.status, 1, ci.stdout + ci.stderr);
    assert.match(ci.stdout, /typecheck ratchet cannot run: react-native is not installed here/);
    const local = spawnSync(process.execPath, [SCRIPT], { cwd: dir, encoding: "utf8", env: { ...process.env, GITHUB_ACTIONS: "", CI: "" } });
    assert.equal(local.status, 0, local.stdout + local.stderr);
    assert.match(local.stdout, /typecheck ratchet skipped/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
