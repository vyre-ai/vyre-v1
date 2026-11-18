// The speed half of ids.pool.test.ts (a perf file, ruling 46): minting an id costs a slice of a pooled buffer, not a call to the system's random source. r38 profile on the firm's server: 3,521 ms of 90 s in mintId.
import test from "node:test";
import assert from "node:assert/strict";
import { mintId } from "../ids.ts";

/** The budget for 200,000 ids, in ms (the best of three runs). The per-id call it replaced took about 1,750 ms for the same count on box D (r38: 1,800 ms before, 210 ms after). */
export const IDS_200K_BUDGET_MS = 400;

test("ids200k: two hundred thousand ids are minted inside the speed budget", () => {
  const runs: number[] = [];
  for (let r = 0; r < 3; r++) {
    const t = performance.now();
    for (let i = 0; i < 200_000; i++) mintId("evt");
    runs.push(performance.now() - t);
  }
  const best = Math.min(...runs);
  console.log(`ids200k best ${best.toFixed(0)} ms (runs ${runs.map((x) => x.toFixed(0)).join(", ")})`);
  assert.ok(best <= IDS_200K_BUDGET_MS, `200k ids took ${best.toFixed(0)} ms, budget ${IDS_200K_BUDGET_MS}`);
});
