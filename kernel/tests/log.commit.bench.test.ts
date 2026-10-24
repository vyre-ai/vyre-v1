// Budget server_write: the kernel write path under group commit, 200 appends per second, p95 under 10 ms (ARCH 4.1, spec "speed").
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { LogClient } from "../src/log/index.ts";
import type { NewEvent } from "../src/log/index.ts";

const ev = (i: number): NewEvent => ({
  type: "record.updated", sv: 1, trace_id: "0123456789abcdef0123456789abcdef", actor: "usr_dana", vis: "space",
  entity: "rec", entity_id: `r${i % 50}`, fields: ["name", "stage"], payload: { i, note: "x".repeat(200) },
});
const pct = (xs: number[], p: number) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)]!; };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

test("group commit at 200 ops/s: p95 append latency under 10 ms", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-bench-"));
  const log = await LogClient.open({ path: path.join(dir, "events.db"), space: "sp_1" });
  try {
    await Promise.all(Array.from({ length: 40 }, (_, i) => log.append(ev(i)))); // warm the worker, the WAL and the statement cache
    const N = 400, lat: number[] = [], pending: Promise<void>[] = [];
    const t0 = performance.now();
    for (let i = 0; i < N; i++) {
      const due = t0 + i * 5; // 200 per second
      const wait = due - performance.now();
      if (wait > 0) await sleep(wait);
      const sent = performance.now();
      pending.push(log.append(ev(1000 + i)).then(() => { lat.push(performance.now() - sent); }));
    }
    await Promise.all(pending);
    const wall = (performance.now() - t0) / 1000;
    const p50 = pct(lat, 0.5), p95 = pct(lat, 0.95), p99 = pct(lat, 0.99);
    console.log(`server_write: ${N} appends in ${wall.toFixed(2)} s (${(N / wall).toFixed(0)}/s), p50 ${p50.toFixed(2)} ms, p95 ${p95.toFixed(2)} ms, p99 ${p99.toFixed(2)} ms, max ${Math.max(...lat).toFixed(2)} ms`);
    assert.ok(N / wall >= 150, `the pacer kept up (${(N / wall).toFixed(0)}/s)`);
    assert.ok(p95 < 10, `p95 ${p95.toFixed(2)} ms must be under 10 ms`);
    assert.equal((await log.verify()).ok, true);
  } finally { await log.close(); }
});

test("burst: 5000 appends at once commit in 64-event transactions and verify", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-bench-"));
  const log = await LogClient.open({ path: path.join(dir, "events.db"), space: "sp_1" });
  try {
    const t0 = performance.now();
    await Promise.all(Array.from({ length: 5000 }, (_, i) => log.append(ev(i))));
    const s = (performance.now() - t0) / 1000;
    console.log(`burst: 5000 appends in ${s.toFixed(2)} s (${(5000 / s).toFixed(0)}/s)`);
    assert.ok(5000 / s > 1000, "a burst writes well over 1000 events per second");
    const v = await log.verify();
    assert.equal(v.ok, true);
    if (v.ok) assert.equal(v.seq, 5000);
  } finally { await log.close(); }
});
