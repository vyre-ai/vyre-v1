import test from "node:test";
import assert from "node:assert/strict";
import { shardCount, shardFiles, toMatrix, MAX_SHARDS, FAST_CAP_SEC, FILES_PER_SHARD, type Timings } from "./shard.ts";
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
  assert.equal(s.count, 1);
  assert.deepEqual(s.fast.flatMap((b) => b.files).sort(), files);
  assert.equal(s.makespanSec, 45);
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
  assert.ok(withSlow.makespanSec <= 50, "10 five-second files in one shard");
  const m = toMatrix(withSlow).include;
  assert.equal(m.filter((j) => j.slow).length, 1, "two slow files share one slow job");
  assert.ok(m.filter((j) => !j.slow).every((j) => !/s[12]\.test/.test(j.files)));
});

test("a slow file never extends the fast critical path even when it is the longest by far", () => {
  const { files, timings } = mk(4, 20);
  timings["big.test.ts"] = { ms: 100000 };
  const s = shardFiles([...files, "big.test.ts"], timings, [slowEntry("big.test.ts", 120)]);
  assert.equal(s.makespanSec, 80);
  assert.equal(s.count, 1);
});

test("a file missing from timings gets the median; none known gets the fallback", () => {
  const s = shardFiles(["x.test.ts", "y.test.ts", "z.test.ts"], { "x.test.ts": { ms: 4000 }, "y.test.ts": { ms: 6000 } }, []);
  assert.equal(s.totalSec, 4 + 6 + 6);
  const none = shardFiles(["a.test.ts"], {}, []);
  assert.equal(none.totalSec, 3);
});

test("a fast file is budgeted at no more than the fast file cap", () => {
  const s = shardFiles(["a.test.ts"], { "a.test.ts": { ms: 90000 } }, []);
  assert.equal(s.totalSec, FAST_CAP_SEC);
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

test("shards scale with the file count: about 40 files per shard, at least 1, at most 24", () => {
  const n = (k: number) => { const { files, timings } = mk(k, 1); return shardFiles(files, timings, []).count; };
  assert.equal(n(1), 1);
  assert.equal(n(FILES_PER_SHARD), 1);
  assert.equal(n(FILES_PER_SHARD + 1), 2);
  assert.equal(n(100), 3);
  assert.equal(n(10000), MAX_SHARDS);
});

test("a small selection takes few jobs: 5 files give 1 fast shard, 12 plain slow files give 2 slow jobs, each perf file its own", () => {
  const { files, timings } = mk(5, 3);
  const slowNames = Array.from({ length: 12 }, (_, i) => `slow${i}.test.ts`);
  const perf = ["a.perf.test.ts", "b.perf.test.ts"];
  const slow = [...slowNames.map((f) => slowEntry(f, 60)), ...perf.map((f) => ({ ...slowEntry(f, 120), perf: true }))];
  const m = toMatrix(shardFiles([...files, ...slowNames, ...perf], timings, slow)).include;
  assert.equal(m.filter((j) => !j.slow).length, 1);
  const plain = m.filter((j) => j.slow && j.runner === "v1");
  assert.equal(plain.length, 2);
  assert.ok(plain.every((j) => j.files.split(" ").length <= 8));
  assert.deepEqual(plain.flatMap((j) => j.files.split(" ")).sort(), [...slowNames].sort());
  assert.deepEqual(m.filter((j) => j.runner === "v1-perf").map((j) => j.files).sort(), perf);
  assert.equal(m.length, 5);
});

test("a heavy test gets a job to itself on the v1 runners; plain slow files still share jobs", () => {
  const slow = [slowEntry("images/vyred/smoke.heavy.test.ts", 120), slowEntry("a.test.ts", 60), slowEntry("b.test.ts", 60), { ...slowEntry("c.test.ts", 60), heavy: true }];
  const m = toMatrix(shardFiles(["images/vyred/smoke.heavy.test.ts", "a.test.ts", "b.test.ts", "c.test.ts"], {}, slow)).include;
  assert.deepEqual(m.filter((j) => j.name.startsWith("heavy-")).map((j) => j.files).sort(), ["c.test.ts", "images/vyred/smoke.heavy.test.ts"]);
  assert.deepEqual(m.filter((j) => j.name.startsWith("slow-")).map((j) => j.files), ["a.test.ts b.test.ts"]);
  assert.ok(m.filter((j) => j.slow).every((j) => j.runner === "v1"));
});

test("golden steps are slow by pattern: each lands in a slow job without being listed in test/slow.json", () => {
  const steps = ["golden/steps/01-lead.test.ts", "golden/steps/guest.test.ts", "golden/steps/nested/x.test.ts"];
  const m = toMatrix(shardFiles([...steps, "lib/x.test.ts"], {}, [])).include;
  const slowFiles = m.filter((j) => j.slow).flatMap((j) => j.files.split(" ")).sort();
  assert.deepEqual(slowFiles, ["golden/steps/01-lead.test.ts", "golden/steps/guest.test.ts"], "a nested path is not a step");
  assert.ok(m.filter((j) => !j.slow).every((j) => !/golden\/steps\/(01|guest)/.test(j.files)));
});

test("a test that boots a daemon is slow by rule: *.live.test, *.booted.test, and any test that calls the boot helpers", () => {
  const src: Record<string, string> = {
    "host/tests/portal.live.test.ts": "test('x', () => {});",
    "modules/identity/tests/lockout.booted.test.ts": "test('x', () => {});",
    "host/tests/blobs.test.ts": 'import { startDaemon } from "../src/daemon/daemon.ts";\\ntest("x", async () => { await startDaemon({}); });',
    "host/tests/seed.grants.test.ts": 'import { startSeeded } from "../../fixtures/seed/small/build.ts";',
    "test/backup.list.after.run.test.mjs": 'import { bootFlowSpace } from "../golden/steps/02-space.ts";',
    "lib/plain.test.ts": 'test("x", () => {});',
    "fixtures/seed/small/build.ts": "export function startSeeded() {}",
  };
  const files = Object.keys(src);
  const m = toMatrix(shardFiles(files, {}, [], { read: (f) => src[f]! })).include;
  const slowFiles = m.filter((j) => j.slow).flatMap((j) => j.files.split(" ")).sort();
  assert.deepEqual(slowFiles, ["host/tests/blobs.test.ts", "host/tests/portal.live.test.ts", "host/tests/seed.grants.test.ts", "modules/identity/tests/lockout.booted.test.ts", "test/backup.list.after.run.test.mjs"]);
  assert.deepEqual(m.filter((j) => !j.slow).flatMap((j) => j.files.split(" ")).sort(), ["fixtures/seed/small/build.ts", "lib/plain.test.ts"], "a non-test source that exports the helper stays fast");
});
