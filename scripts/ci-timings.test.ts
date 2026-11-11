import test from "node:test";
import assert from "node:assert/strict";
import { parseLog, mergeLogTimings } from "./ci-timings.ts";
import { shardFiles, toMatrix } from "./shard.ts";

const LOG = [
  "2026-11-11T05:19:17.6901268Z ok   apps/app/src/a.test.tsx 4098 ms",
  "2026-11-11T05:19:17.6941847Z ok   golden/steps/11-restore.test.ts 13110 ms",
  "2026-11-11T05:19:17.6982605Z skip host/tests/computers.live.test.ts (needs VYRE_HEAVY_DOCKER=1)",
  "2026-11-11T05:19:17.7002587Z ok   test/held-send.live.test.ts 12555 ms",
  "2026-11-11T05:19:17.7004851Z FAIL test/vault.live.test.ts 14086 ms",
  "2026-11-11T05:19:17.7004851Z ok   agent/tests/cached.test.ts (cached)",
  "\u001b[36;1mok   not-a-test.txt 5 ms\u001b[0m",
  "90 files, 27 cached, 1 failed, 0 skipped, 67603 ms, shard 1/1",
  "ok   golden/steps/11-restore.test.ts 9000 ms",
].join("\n");

test("a job log gives the milliseconds of the files that passed; skips, failures, cached passes and other lines are left out", () => {
  assert.deepEqual(parseLog(LOG), { "apps/app/src/a.test.tsx": 4098, "golden/steps/11-restore.test.ts": 13110, "test/held-send.live.test.ts": 12555 });
});

test("a refreshed table takes the new numbers, keeps files the logs do not mention and drops files that are gone", () => {
  const prev = { "a.test.ts": { ms: 1, at: "old" }, "gone.test.ts": { ms: 2, at: "old" }, "keep.test.ts": { ms: 3, at: "old" } };
  const next = mergeLogTimings(prev, { "a.test.ts": 500, "new.test.ts": 700, "alsogone.test.ts": 9 }, "NOW", (f) => !f.includes("gone"));
  assert.deepEqual(next, { "a.test.ts": { ms: 500, at: "NOW" }, "keep.test.ts": { ms: 3, at: "old" }, "new.test.ts": { ms: 700, at: "NOW" } });
  assert.deepEqual(Object.keys(next), ["a.test.ts", "keep.test.ts", "new.test.ts"], "sorted");
});

test("timings from a log change how files are packed, never which files run", () => {
  const files = Array.from({ length: 90 }, (_, i) => `fast/f${i}.test.ts`);
  const measured = parseLog(files.map((f, i) => `ok   ${f} ${200 + i * 90} ms`).join("\n"));
  const table = mergeLogTimings({}, measured, "NOW", () => true);
  const run = (t: typeof table) => toMatrix(shardFiles(files, t, [])).include.flatMap((j) => j.files.split(" ")).sort();
  assert.deepEqual(run(table), run({}), "same files with and without a refreshed table");
  assert.deepEqual(run(table), [...files].sort());
});
