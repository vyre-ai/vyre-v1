import test from "node:test";
import assert from "node:assert/strict";
import { safeRunIds } from "./cohorts.ts";

test("only safe cohort run ids are offered for apply", () => {
  assert.deepEqual(safeRunIds({
    cohorts: [
      { disposition: "safe", runIds: ["run_a", "run_b"] },
      { disposition: "ambiguous", runIds: ["run_c"] },
      { disposition: "inactive", runIds: ["run_d"] },
    ],
  }), ["run_a", "run_b"]);
  assert.deepEqual(safeRunIds({ cohorts: [] }), []);
  assert.deepEqual(safeRunIds(null), []);
});
