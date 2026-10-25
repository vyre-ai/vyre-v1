import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { perfAllowed, splitPerf } from "./lib/perf-skip.mjs";

const slow = [{ file: "k/bench.test.ts", perf: true }, { file: "k/heavy.test.ts" }];
const files = ["k/bench.test.ts", "k/heavy.test.ts", "k/plain.test.ts"];

test("a perf file is skipped in a shard", () => {
  const r = splitPerf(files, slow, {});
  assert.deepEqual(r.skipped, ["k/bench.test.ts"]);
  assert.deepEqual(r.run, ["k/heavy.test.ts", "k/plain.test.ts"]);
});

test("a perf file runs under VYRE_PERF_FULL=1 and on a perf matrix entry (VYRE_PERF_RUN=1)", () => {
  for (const env of [{ VYRE_PERF_FULL: "1" }, { VYRE_PERF_RUN: "1" }]) {
    const r = splitPerf(files, slow, env);
    assert.deepEqual(r.skipped, []);
    assert.deepEqual(r.run, files);
  }
  assert.equal(perfAllowed({ VYRE_PERF_FULL: "0" }), false);
});

test("the runners print one 'skip (perf)' line per skipped file and do not run it", () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const file = "kernel/tests/authorize.bench.test.ts";
  const env = { ...process.env }; delete env["VYRE_PERF_FULL"]; delete env["VYRE_PERF_RUN"]; delete env["NODE_TEST_CONTEXT"];
  for (const cmd of [["scripts/test-run.mjs", "--slow", "--no-cache", "--files", file], ["scripts/test-run.ts", "--slow", "--files", file]]) {
    const r = spawnSync(process.execPath, cmd, { cwd: root, env, encoding: "utf8", timeout: 20000 });
    assert.equal(r.status, 0, `${cmd[0]}: ${r.stdout}${r.stderr}`);
    assert.equal((r.stdout.match(/^skip \(perf\) /gm) ?? []).length, 1, r.stdout);
    assert.match(r.stdout, new RegExp(`skip \\(perf\\) ${file.replace(/\./g, "\\.")}`));
    assert.ok(!/^ok +kernel\//m.test(r.stdout), "the perf file did not run");
  }
});
