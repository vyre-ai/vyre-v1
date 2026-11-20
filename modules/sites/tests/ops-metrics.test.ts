// Site metrics: Docker stats to CPU and memory, the request meter, the Caddy access line, the chart windows (r42-sites-run, slice 4).
import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_TIMES,
  MINUTE,
  RequestMeter,
  bucketed,
  memoryOf,
  minuteOf,
  parseAccess,
  percentile,
  requestLine,
  rightNow,
  usageOf,
  window,
} from "../ops/metrics.ts";
import type { Sample } from "../ops/metrics.ts";

const MB = 1024 * 1024;
const s = (at: number, o: Partial<Sample> = {}): Sample => ({
  at,
  cpu: 0,
  memMb: 0,
  requests: 0,
  errors: 0,
  p50: 0,
  p95: 0,
  ...o,
});

test("cpu is a percent of one core: half the system's time on 4 cores is 200", () => {
  const u = usageOf({
    cpu_stats: { cpu_usage: { total_usage: 2_000 }, system_cpu_usage: 4_000, online_cpus: 4 },
    precpu_stats: { cpu_usage: { total_usage: 1_000 }, system_cpu_usage: 3_000 },
    memory_stats: { usage: 100 * MB, limit: 512 * MB },
  });
  assert.equal(u?.cpu, 400);
  assert.equal(u?.memLimitMb, 512);
});

test("cpu is zero with no earlier reading, and null when Docker sent nothing usable", () => {
  assert.equal(usageOf({ cpu_stats: { cpu_usage: { total_usage: 5 }, system_cpu_usage: 10, online_cpus: 2 } })?.cpu, 0);
  assert.equal(usageOf({}), null);
  const flat = usageOf({
    cpu_stats: { cpu_usage: { total_usage: 5 }, system_cpu_usage: 10 },
    precpu_stats: { cpu_usage: { total_usage: 5 }, system_cpu_usage: 10 },
  });
  assert.equal(flat?.cpu, 0);
});

test("memory leaves out the file cache", () => {
  assert.equal(memoryOf({ memory_stats: { usage: 300, limit: 1000, stats: { inactive_file: 100 } } }).used, 200);
  assert.equal(memoryOf({ memory_stats: { usage: 300, limit: 1000, stats: { inactive_file: 900 } } }).used, 300);
  assert.equal(memoryOf({}).used, 0);
});

test("percentile uses the nearest rank", () => {
  assert.equal(percentile([], 95), 0);
  assert.equal(percentile([5], 95), 5);
  assert.equal(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 50), 5);
  assert.equal(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 95), 10);
  assert.equal(percentile([10, 1, 5], 50), 5);
});

test("the meter closes a minute when the next one starts, counts errors, and never counts a late line twice", () => {
  const m = new RequestMeter();
  const t0 = 10 * MINUTE;
  assert.equal(m.record(t0 + 1, 200, 10), null);
  assert.equal(m.record(t0 + 2, 500, 30), null);
  assert.equal(m.record(t0 + 3, 404, 20), null);
  const done = m.record(t0 + MINUTE + 5, 200, 7);
  assert.deepEqual(done, { at: t0, requests: 3, errors: 1, p50: 20, p95: 30 });
  // a line stamped in the closed minute arrives late: it is dropped, the open minute is untouched
  assert.equal(m.record(t0 + 10, 200, 1), null);
  const next = m.take();
  assert.deepEqual(next, { at: t0 + MINUTE, requests: 1, errors: 0, p50: 7, p95: 7 });
  assert.equal(m.take(), null);
});

test("the meter keeps exact counts and bounded memory under a flood", () => {
  const m = new RequestMeter();
  for (let i = 0; i < MAX_TIMES * 3; i++) m.record(5 * MINUTE + 1, i % 10 === 0 ? 502 : 200, i % 100);
  const out = m.take();
  assert.equal(out?.requests, MAX_TIMES * 3);
  assert.equal(out?.errors, (MAX_TIMES * 3) / 10);
});

test("parseAccess reads a Caddy line and refuses anything else", () => {
  const line = JSON.stringify({
    ts: 1_700_000_000.5,
    status: 200,
    duration: 0.0123,
    size: 321,
    request: { host: "App.Example.com:443", method: "GET", uri: "/a?token=secret" },
  });
  const a = parseAccess(line);
  assert.equal(a?.host, "app.example.com");
  assert.equal(a?.ms, 12);
  assert.equal(a?.at, 1_700_000_000_500);
  assert.equal(requestLine(a!), "GET /a 200 12ms");
  assert.equal(parseAccess("not json"), null);
  assert.equal(parseAccess("{}"), null);
  assert.equal(parseAccess("null"), null);
  assert.equal(parseAccess(JSON.stringify({ ts: 1, status: 200 })), null);
});

test("window fills a quiet minute with nothing, oldest first", () => {
  const now = 100 * MINUTE + 5;
  const w = window([s(100 * MINUTE, { cpu: 4 }), s(98 * MINUTE, { cpu: 2 })], now, 4);
  assert.deepEqual(
    w.map((x) => x?.cpu ?? null),
    [null, 2, null, 4],
  );
  assert.equal(minuteOf(now), 100 * MINUTE);
});

test("bucketed sums requests, averages load, keeps the worst 95th percentile, and leaves empty buckets empty", () => {
  const win = [
    s(0, { cpu: 10, requests: 5, errors: 1, p95: 30, p50: 10 }),
    s(1, { cpu: 30, requests: 5, p95: 90, p50: 20 }),
    null,
    null,
  ];
  const b = bucketed(win, 2);
  assert.equal(b[0]?.cpu, 20);
  assert.equal(b[0]?.requests, 10);
  assert.equal(b[0]?.errors, 1);
  assert.equal(b[0]?.p95, 90);
  assert.equal(b[1], null);
  assert.equal(bucketed(win, 10).length, 4);
});

test("rightNow says what the site uses against what it may", () => {
  const r = rightNow(s(0, { cpu: 50, memMb: 200, requests: 40, errors: 2, p95: 120 }), { cpus: 1, memoryMb: 512 });
  assert.deepEqual(r, {
    cpu: { value: 50, of: 100 },
    mem: { valueMb: 200, ofMb: 512 },
    requestsPerMin: 40,
    p95: 120,
    errorRate: 5,
  });
  assert.equal(rightNow(null, { cpus: 2, memoryMb: 256 }).errorRate, 0);
});
