// (the server_write probe; one of three files split from server.test.ts) P-L11_03: server and headless probes on a booted daemon over the perf Space, through the gateway with a real token (rule 27).
//   perf Space      the template loads in under 1 s
//   server_write    records.create at 200 ops/s: p50 and p95 under 10 ms (cap.commit; measured here as the whole round trip on loopback, an upper bound)
//   connection_count  a device holds exactly one live socket: a second connection replaces the first
//   engine_pool, send  need the agent turn engine on the daemon: todo until P-L2_23 (the module level proofs are agent/tests/pool.perf.test.ts and turn-engine.perf.test.ts)
// Ruling 46: a speed number counts only from the v1-perf runners. VYRE_PERF_FULL=1 builds the full Space (100k contacts) and holds the numbers to the budgets; without it the file runs at the
// ci scale, prints the same METRIC lines and asserts the structure (the pacer kept up, every create answered) with a loose ceiling that only catches a pathology.
import test from "node:test";
import assert from "node:assert/strict";
import { bootPerf, PERF_LIVE } from "../../fixtures/seed/perf/build.ts";
import { startSeeded } from "../../fixtures/seed/small/build.ts";
import { judge, metricLine } from "../harness/index.ts";
import { FULL, SCALE, budget, cache, post, scratch, sleep } from "./support.ts";

test("server_write: records.create at 200 ops/s through the gateway, p50 and p95 under 10 ms", async () => {
  const space = await bootPerf({ scale: SCALE, cache, scratch: scratch() });
  const d = await startSeeded(space.dir, PERF_LIVE);
  try {
    assert.equal((await post(d, "schema.types.list", {})).status, 200);
    for (let i = 0; i < 20; i++) assert.equal((await post(d, "records.create", { idempotencyKey: `warm-${i}`, type: "contact", fields: { name: `Warm ${i}`, email: `warm${i}@w.example.test` } })).status, 200);
    const N = 400, lat: number[] = [], traces: string[] = [];
    const t0 = performance.now();
    for (let i = 0; i < N; i++) {
      const wait = t0 + i * 5 - performance.now();
      if (wait > 0) await sleep(wait);
      const sent = performance.now();
      const res = await post(d, "records.create", { idempotencyKey: `w-${i}`, type: "contact", fields: { name: `Write ${i}`, email: `write${i}@w.example.test` } });
      lat.push(performance.now() - sent);
      traces.push(res.headers.get("x-vyre-trace") ?? "");
      assert.equal(res.status, 200, `create ${i}: ${res.status}`);
    }
    const wall = (performance.now() - t0) / 1000;
    const report = judge(budget("server_write"), lat.map((value, i) => ({ value, traceId: traces[i] ?? "", spans: [] })));
    console.log(metricLine(report));
    console.log(`server_write: ${N} creates in ${wall.toFixed(2)} s (${(N / wall).toFixed(0)}/s) over ${space.sizes.contacts} contacts, p50 ${report.p50.toFixed(2)} p95 ${report.p95.toFixed(2)} ms`);
    if (FULL) assert.ok(N / wall >= 150, `the pacer kept up (${(N / wall).toFixed(0)}/s)`);
    if (FULL) assert.ok(report.ok, `server_write p50 ${report.p50.toFixed(2)} p95 ${report.p95.toFixed(2)} over the 10 ms budget\n${report.waterfall ?? ""}`);
    else assert.ok(report.p95 < 1000, `p95 ${report.p95.toFixed(2)} ms is a pathology even for a loaded shared runner (informative only, ruling 46)`);
  } finally { await d.stop(); space.close(); }
});

