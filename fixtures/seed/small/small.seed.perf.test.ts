// The speed half of small.seed.test.ts (moved here so only this file is a perf file, ruling 46): the small seed is ready in under 150 ms from the cache.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { bootSmall } from "./build.ts";

const scratch = (): string => fs.mkdtempSync(path.join(os.tmpdir(), "small-seed-perf-"));
const cache = scratch();
const first = async (): Promise<Awaited<ReturnType<typeof bootSmall>>> => bootSmall({ cache, scratch: scratch() });

test("PERF: the small seed is ready in under 150 ms from the cache", async () => {
  (await first()).close();
  const times: number[] = [];
  for (let i = 0; i < 7; i++) {
    const t0 = performance.now();
    const s = await bootSmall({ cache, scratch: scratch() });
    times.push(performance.now() - t0);
    assert.equal(s.hit, true);
    s.close();
  }
  times.sort((x, y) => x - y);
  const median = times[3]!;
  console.log(`small seed on a cache hit: median ${median.toFixed(1)} ms, min ${times[0]!.toFixed(1)} ms, max ${times[6]!.toFixed(1)} ms (budget 150 ms)`);
  assert.ok(median < 150, `median ${median.toFixed(1)} ms is over the 150 ms budget`);
  assert.ok(times[6]! < 150 * 3, "even the slowest boot stays near the budget");
});
