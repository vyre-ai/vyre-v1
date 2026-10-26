import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runFile, capFor, breakdown, mergeTimings, DEFAULT_CAP_MS } from "./test-run.ts";

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
