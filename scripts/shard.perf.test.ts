// The speed half of shard.test.ts (a separate file so only this one is a perf file, ruling 46).
import test from "node:test";
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { shardFiles, type Timings } from "./shard.ts";

const mk = (n: number, sec: number): { files: string[]; timings: Timings } => {
  const files: string[] = [], timings: Timings = {};
  for (let i = 0; i < n; i++) { const f = `f${i}.test.ts`; files.push(f); timings[f] = { ms: sec * 1000 }; }
  return { files, timings };
};

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

