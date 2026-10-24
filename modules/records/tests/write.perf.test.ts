// Budget server_write: records create through the module, 200 ops/s, p95 under 10 ms.
import test from "node:test";
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { mintUuid } from "../../../lib/ids.ts";
import { openRecords } from "../impl.ts";
import { ITEM } from "../fixtures/seed.ts";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const pct = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)]!;
};

test("server_write p95 under 10 ms at 200 records creates per second", async () => {
  const rec = openRecords({ space: "sp_perf" });
  await rec.store.define({ add_types: [ITEM] });
  for (let i = 0; i < 20; i++) await rec.store.create("item", mintUuid(), { name: `w${i}` });
  const N = 200;
  const lat: number[] = [];
  const t0 = performance.now();
  for (let i = 0; i < N; i++) {
    const due = t0 + i * 5;
    const wait = due - performance.now();
    if (wait > 0) await sleep(wait);
    const sent = performance.now();
    await rec.store.create("item", mintUuid(), { name: `n${i}` });
    lat.push(performance.now() - sent);
  }
  const wall = (performance.now() - t0) / 1000;
  const p95 = pct(lat, 0.95);
  console.log(`server_write: ${N} creates in ${wall.toFixed(2)} s (${(N / wall).toFixed(0)}/s), p95 ${p95.toFixed(2)} ms`);
  assert.ok(N / wall >= 150, `the pacer kept up (${(N / wall).toFixed(0)}/s)`);
  assert.ok(p95 < 10, `p95 ${p95.toFixed(2)} ms must be under 10 ms`);
});
