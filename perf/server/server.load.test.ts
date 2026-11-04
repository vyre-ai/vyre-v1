// (the perf Space load probe; one of three files split from server.test.ts) P-L11_03: server and headless probes on a booted daemon over the perf Space, through the gateway with a real token (rule 27).
//   perf Space      the template loads in under 1 s
//   server_write    records.create at 200 ops/s: p50 and p95 under 10 ms (cap.commit; measured here as the whole round trip on loopback, an upper bound)
//   connection_count  a device holds exactly one live socket: a second connection replaces the first
//   engine_pool, send  need the agent turn engine on the daemon: todo until P-L2_23 (the module level proofs are agent/tests/pool.perf.test.ts and turn-engine.perf.test.ts)
// Ruling 46: a speed number counts only from the v1-perf runners. VYRE_PERF_FULL=1 builds the full Space (100k contacts) and holds the numbers to the budgets; without it the file runs at the
// ci scale, prints the same METRIC lines and asserts the structure (the pacer kept up, every create answered) with a loose ceiling that only catches a pathology.
import test from "node:test";
import assert from "node:assert/strict";
import { bootPerf } from "../../fixtures/seed/perf/build.ts";
import { FULL, SCALE, cache, scratch } from "./support.ts";

test(`perf Space: the ${SCALE} template loads in under 1 s`, async () => {
  const warm = await bootPerf({ scale: SCALE, cache, scratch: scratch() });   // builds the template when the cache has none
  warm.close();
  const t0 = performance.now();
  const s = await bootPerf({ scale: SCALE, cache, scratch: scratch() });
  const ms = performance.now() - t0;
  s.close();
  assert.equal(s.hit, true);
  console.log(`METRIC ${JSON.stringify({ name: "perf_space_load", scale: SCALE, ms: Math.round(ms), budget_ms: 1000, contacts: s.sizes.contacts })}`);
  assert.ok(ms < 1000, `loading the ${SCALE} perf Space took ${ms.toFixed(0)} ms, budget 1000 ms`);
});

