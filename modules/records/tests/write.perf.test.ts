// Budget server_write: records create through the module, 200 ops/s, p95 under 10 ms.
import test from "node:test";
import { appendFileSync } from "node:fs";
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { mintUuid } from "../../../lib/ids.ts";
import { openRecordStore } from "../../../kernel/src/store/records.ts";
import { openRecords } from "../impl.ts";
import { ITEM } from "../fixtures/seed.ts";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const pct = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)]!;
};

/** 200 creates at 5 ms spacing against one store; returns the latencies and the wall time. */
async function drive(store: { create(type: string, id: string, data: Record<string, unknown>): Promise<unknown>; define(d: never): Promise<unknown> }, tag: string): Promise<{ lat: number[]; wall: number }> {
  await store.define({ add_types: [ITEM] } as never);
  for (let i = 0; i < 20; i++) await store.create("item", mintUuid(), { name: `w${i}` });
  const N = 200;
  const lat: number[] = [];
  const t0 = performance.now();
  for (let i = 0; i < N; i++) {
    const wait = t0 + i * 5 - performance.now();
    if (wait > 0) await sleep(wait);
    const sent = performance.now();
    await store.create("item", mintUuid(), { name: `${tag}${i}` });
    lat.push(performance.now() - sent);
  }
  return { lat, wall: (performance.now() - t0) / 1000 };
}
const line = (name: string, r: { lat: number[]; wall: number }): string =>
  `${name}: ${r.lat.length} creates in ${r.wall.toFixed(2)} s (${(r.lat.length / r.wall).toFixed(0)}/s), p50 ${pct(r.lat, 0.5).toFixed(2)} p95 ${pct(r.lat, 0.95).toFixed(2)} p99 ${pct(r.lat, 0.99).toFixed(2)} ms`;

test("server_write p95 under 10 ms at 200 records creates per second", async () => {
  // The kernel store alone, so a slow run says whether the cost is below the module (kernel append, hash chain) or in it (clocks, row meta).
  const base = await drive(openRecordStore({ path: ":memory:", space: "sp_perf_kernel" }).store as never, "k");
  console.log(line("server_write kernel only", base));
  const rec = openRecords({ space: "sp_perf" });
  const r = await drive(rec.store as never, "n");
  console.log(line("server_write", r));
  // a passing test prints nothing in the shard log, so the numbers also go to the job summary when CI gives one
  if (process.env["GITHUB_STEP_SUMMARY"]) appendFileSync(process.env["GITHUB_STEP_SUMMARY"], `${line("server_write", r)}\n${line("server_write kernel only", base)}\n`);
  const p95 = pct(r.lat, 0.95);
  assert.ok(200 / r.wall >= 150, `the pacer kept up (${(200 / r.wall).toFixed(0)}/s)`);
  assert.ok(p95 < 10, `p95 ${p95.toFixed(2)} ms must be under 10 ms (${line("server_write", r)}; ${line("kernel only", base)})`);
  // Headroom: the budget is 10 ms, the runner must stay well inside it.
  assert.ok(p95 < 7, `p95 ${p95.toFixed(2)} ms leaves too little headroom (${line("server_write", r)}; ${line("kernel only", base)})`);
});
// run 1
// run 2
// run 3
// run 5
