import test from "node:test";
import assert from "node:assert/strict";
import { shardCount, shardFiles, toMatrix, MAX_SHARDS, type Timings } from "./shard.ts";
import type { SlowEntry } from "./slow-check.ts";

const slowEntry = (file: string, capSec = 90): SlowEntry => ({ file, capSec, owner: "t", reason: "t" });
const mk = (n: number, sec: number, prefix = "f"): { files: string[]; timings: Timings } => {
  const files: string[] = [], timings: Timings = {};
  for (let i = 0; i < n; i++) { const f = `${prefix}${i}.test.ts`; files.push(f); timings[f] = { ms: sec * 1000 }; }
  return { files, timings };
};

test("shard count is min(24, ceil(total/25))", () => {
  assert.equal(shardCount(0), 0);
  assert.equal(shardCount(1), 1);
  assert.equal(shardCount(25), 1);
  assert.equal(shardCount(25.1), 2);
  assert.equal(shardCount(240), 10);
  assert.equal(shardCount(5000), MAX_SHARDS);
});

test("greedy longest-first: balanced bins, every file once, deterministic", () => {
  const timings: Timings = { "a.test.ts": { ms: 10000 }, "b.test.ts": { ms: 9000 }, "c.test.ts": { ms: 8000 }, "d.test.ts": { ms: 7000 }, "e.test.ts": { ms: 6000 }, "f.test.ts": { ms: 5000 } };
  const files = Object.keys(timings);
  const s = shardFiles(files, timings, []);
  assert.equal(s.count, 2);
  assert.deepEqual(s.fast.flatMap((b) => b.files).sort(), files);
  assert.equal(s.makespanSec, 23);
  assert.deepEqual(shardFiles([...files].reverse(), timings, []), s);
});

test("slow files only in slow shards; the fast critical path ignores them", () => {
  const { files, timings } = mk(10, 5);
  const slowFiles = ["s1.test.ts", "s2.test.ts"];
  for (const f of slowFiles) timings[f] = { ms: 110000 };
  const slow = slowFiles.map((f) => slowEntry(f, 120));
  const withSlow = shardFiles([...files, ...slowFiles], timings, slow);
  const without = shardFiles(files, timings, []);
  assert.deepEqual(withSlow.slow.map((j) => j.file), slowFiles);
  for (const b of withSlow.fast) for (const f of slowFiles) assert.ok(!b.files.includes(f));
  assert.equal(withSlow.count, without.count);
  assert.equal(withSlow.makespanSec, without.makespanSec);
  assert.ok(withSlow.makespanSec <= 25);
  const m = toMatrix(withSlow).include;
  assert.equal(m.filter((j) => j.slow).length, 2);
  assert.ok(m.filter((j) => !j.slow).every((j) => !/s[12]\.test/.test(j.files)));
});

test("a slow file never extends the fast critical path even when it is the longest by far", () => {
  const { files, timings } = mk(4, 20);
  timings["big.test.ts"] = { ms: 100000 };
  const s = shardFiles([...files, "big.test.ts"], timings, [slowEntry("big.test.ts", 120)]);
  assert.equal(s.makespanSec, 20);
  assert.equal(s.count, 4);
});

test("a file missing from timings gets the median; none known gets the fallback", () => {
  const s = shardFiles(["x.test.ts", "y.test.ts", "z.test.ts"], { "x.test.ts": { ms: 4000 }, "y.test.ts": { ms: 6000 } }, []);
  assert.equal(s.totalSec, 4 + 6 + 6);
  const none = shardFiles(["a.test.ts"], {}, []);
  assert.equal(none.totalSec, 3);
});

test("a fast file is budgeted at no more than the 20 s cap", () => {
  const s = shardFiles(["a.test.ts"], { "a.test.ts": { ms: 90000 } }, []);
  assert.equal(s.totalSec, 20);
});

test("no files gives no shards", () => {
  const s = shardFiles([], {}, []);
  assert.equal(s.count, 0);
  assert.deepEqual(toMatrix(s).include, []);
});

test("many files cap at 24 shards and stay balanced", () => {
  const { files, timings } = mk(1200, 10);
  const s = shardFiles(files, timings, []);
  assert.equal(s.count, 24);
  assert.equal(s.makespanSec, 500);
});

test("perf: sharding 5,000 files stays far inside the select budget (ci_push_5m)", (t) => {
  const { files, timings } = mk(5000, 1);
  files.forEach((f, i) => { timings[f] = { ms: 200 + ((i * 37) % 9000) }; });
  const t0 = performance.now();
  const s = shardFiles(files, timings, []);
  const ms = performance.now() - t0;
  t.diagnostic(`PERF shard 5000 files into ${s.count}: ${ms.toFixed(0)} ms (budget 8000 ms, file cap 20 s)`);
  assert.ok(ms < 2000);
  assert.ok(s.makespanSec <= s.totalSec / s.count + 20);
});
