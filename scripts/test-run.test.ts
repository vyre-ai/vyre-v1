import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runFile, capFor, breakdown, mergeTimings, skippedOf, allSkipped, DEFAULT_CAP_MS } from "./test-run.ts";

// Scaled stand-in for the 20 s rule: the cap is 1 s here and the fixture runs 1.6 s, so the check is the same without a 21 s wait.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "trun-"));
const fixture = path.join(dir, "slowish.test.mjs");
fs.writeFileSync(fixture, `import test from "node:test";
test("fast one", () => {});
test("takes a while", async () => { await new Promise((r) => setTimeout(r, 1600)); });
`);

test("a file over the default cap fails with the slowest-test breakdown", async () => {
  const r = await runFile(fixture, { cwd: dir, capMs: 1000 });
  assert.equal(r.ok, false);
  assert.equal(r.overCap, true);
  assert.match(r.out, /exceeded its 1 s cap/);
  assert.match(r.out, /slowest tests:/);
});
test("a listed slow file passes up to its capSec", async () => {
  const slow = [{ file: "slowish.test.mjs", capSec: 4, owner: "L1", reason: "fixture" }];
  const capMs = capFor("slowish.test.mjs", slow, 1000);
  assert.equal(capMs, 4000);
  const r = await runFile(fixture, { cwd: dir, capMs });
  assert.equal(r.ok, true, r.out);
  assert.equal(r.overCap, false);
  assert.equal(r.breakdown[0].name, "takes a while");
  assert.ok(r.breakdown[0].ms >= 1500);
});
test("skippedOf counts a file's skipped tests and keeps their reasons (--no-skip fails on them)", async () => {
  const f = path.join(dir, "skips.test.mjs");
  fs.writeFileSync(f, `import test from "node:test";\ntest("runs", () => {});\ntest("needs a build", (t) => { t.skip("VYRE_APP_DIST required"); });\n`);
  const r = await runFile(f, { cwd: dir, capMs: 10_000 });
  assert.equal(r.ok, true, r.out);
  const sk = skippedOf(r.out);
  assert.equal(sk.n, 1);
  assert.match(sk.lines.join("\n"), /needs a build .*# VYRE_APP_DIST required/);
  assert.equal(skippedOf("ℹ skipped 0\n").n, 0);
});
test("unlisted files get the 30 s default", () => assert.equal(capFor("a.test.ts", []), DEFAULT_CAP_MS));
test("breakdown sorts the slowest leaf tests first", () => {
  const out = "✔ a (5.2ms)\n✔ b (120.9ms)\n✖ c (50ms)\nnoise\n";
  assert.deepEqual(breakdown(out, 2), [{ name: "b", ms: 121 }, { name: "c", ms: 50 }]);
});
test("timings merge keeps passing files only", () => {
  const at = "2026-10-24T00:00:00.000Z";
  const base = { file: "b.test.ts", ok: true, ms: 7, capMs: 20000, overCap: false, breakdown: [], out: "" };
  const t = mergeTimings({ "old.test.ts": { ms: 1, at } }, [{ ...base, file: "a.test.ts" }, { ...base, ok: false }], at);
  assert.deepEqual(Object.keys(t).sort(), ["a.test.ts", "old.test.ts"]);
});

test("a file whose every test was skipped is a skip with its reason, not a pass; a file that ran anything is not", () => {
  const out = "﹣ needs a key # VYRE_TEST_CODEX_HOME is not set\nℹ tests 1\nℹ pass 0\nℹ fail 0\nℹ skipped 1\n";
  assert.equal(allSkipped(out), "VYRE_TEST_CODEX_HOME is not set");
  assert.equal(allSkipped("ℹ pass 2\nℹ fail 0\nℹ skipped 1\n"), null);
  assert.equal(allSkipped("ℹ pass 0\nℹ fail 1\nℹ skipped 1\n"), null);
  assert.equal(allSkipped("ℹ pass 3\nℹ fail 0\nℹ skipped 0\n"), null);
  assert.equal(allSkipped("ℹ pass 0\nℹ fail 0\nℹ skipped 2\n"), "no reason given");
});

test("the runners print skip <file> (<reason>) and count skips apart from passes", async () => {
  const { spawnSync } = await import("node:child_process");
  const fs2 = await import("node:fs"), os2 = await import("node:os"), path2 = await import("node:path");
  const dir = fs2.mkdtempSync(path2.join(os2.tmpdir(), "runner-skip-"));
  try {
    fs2.writeFileSync(path2.join(dir, "only-skips.test.ts"), 'import test from "node:test";\ntest("needs a key", { skip: "no key here" }, () => {});\n');
    const r = spawnSync(process.execPath, ["--test", "--test-reporter=spec", path2.join(dir, "only-skips.test.ts")], { encoding: "utf8", env: Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== "NODE_TEST_CONTEXT")) });
    assert.equal(allSkipped(r.stdout + r.stderr), "no key here");
  } finally { fs2.rmSync(dir, { recursive: true, force: true }); }
});
