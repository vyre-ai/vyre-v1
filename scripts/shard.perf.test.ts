// The speed half of shard.test.ts (a separate file so only this one is a perf file, ruling 46).
import test from "node:test";
import assert from "node:assert/strict";
import { shardFiles, type Timings } from "./shard.ts";
import { timeCpu, wallCeiling } from "../testkit/src/cpu-time.ts";

const mk = (n: number, sec: number): { files: string[]; timings: Timings } => {
  const files: string[] = [],
    timings: Timings = {};
  for (let i = 0; i < n; i++) {
    const f = `f${i}.test.ts`;
    files.push(f);
    timings[f] = { ms: sec * 1000 };
  }
  return { files, timings };
};

test("perf: sharding 5,000 files stays far inside the select budget (ci_push_5m)", (t) => {
  const { files, timings } = mk(5000, 1);
  files.forEach((f, i) => {
    timings[f] = { ms: 200 + ((i * 37) % 9000) };
  });
  const { out: s, cpuMs: ms, wallMs } = timeCpu(() => shardFiles(files, timings, []));
  t.diagnostic(`PERF shard 5000 files into ${s.count}: ${ms.toFixed(0)} ms of CPU (budget 8000 ms, file cap 20 s)`);
  assert.ok(ms < 2000);
  assert.ok(wallMs < wallCeiling(2000), `${wallMs.toFixed(0)} ms of wall time (hang guard)`);
  assert.ok(s.makespanSec <= s.totalSec / s.count + 20);
});
