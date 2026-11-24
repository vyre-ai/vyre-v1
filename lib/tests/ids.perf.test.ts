// The speed half of ids.pool.test.ts (a perf file, ruling 46): minting an id costs a slice of a pooled buffer, not a call to the system's random source. r38 profile on the firm's server: 3,521 ms of 90 s in mintId.
import test from "node:test";
import assert from "node:assert/strict";
import { mintId } from "../ids.ts";
import { assertWithinCpu } from "../../testkit/src/cpu-time.ts";

/** The budget for 200,000 ids, in ms (one run, CPU time). The per-id call it replaced took about 1,750 ms for the same count on box D (r38: 1,800 ms before, 210 ms after). */
export const IDS_200K_BUDGET_MS = 400;

test("ids200k: two hundred thousand ids are minted inside the speed budget", () => {
  // one run in CPU time: the per-id call it replaced burned about 1,750 ms of CPU, so the limit still tells the two apart
  assertWithinCpu(`200k ids (budget ${IDS_200K_BUDGET_MS} ms)`, IDS_200K_BUDGET_MS, () => {
    for (let i = 0; i < 200_000; i++) mintId("evt");
  });
});
