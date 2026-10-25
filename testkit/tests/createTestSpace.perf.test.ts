// The speed half of createTestSpace.test.ts (a separate file so only this one is a perf file, ruling 46): a blank Space boots from the copied template under 80 ms (median of 5).
import test from "node:test";
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { createTestSpace } from "../src/index.ts";

const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;

test("a blank Space boots in under 80 ms (median of 5)", async () => {
  const warm = await createTestSpace(); await warm.close();   // builds the template once per machine; not part of the measurement
  const ms: number[] = [];
  for (let i = 0; i < 5; i++) {
    const t0 = performance.now();
    const s = await createTestSpace();
    ms.push(performance.now() - t0);
    await s.close();
  }
  console.log(`createTestSpace blank boot: ${ms.map((x) => x.toFixed(1)).join(", ")} ms, median ${median(ms).toFixed(1)} ms (budget 80)`);
  assert.ok(median(ms) < 80, `median ${median(ms).toFixed(1)} ms is over the 80 ms budget`);
});
