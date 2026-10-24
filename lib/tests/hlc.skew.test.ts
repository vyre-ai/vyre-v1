import test from "node:test";
import assert from "node:assert/strict";
import { formatHlc, parseHlc, compareHlc, tickHlc, receiveHlc, clampHlc, MAX_SKEW_MS } from "../hlc.ts";
import type { Hlc } from "../hlc.ts";

// Seeded generator (mulberry32) so a failure replays.
function rng(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const NOW = 1_800_000_000_000;

test("format and parse round-trip, including device ids with dashes", () => {
  const h: Hlc = { ms: NOW, counter: 255, deviceId: "dev-ice-1" };
  assert.deepEqual(parseHlc(formatHlc(h)), h);
  assert.equal(formatHlc({ ms: 1, counter: 2, deviceId: "d" }), "000000000001-0002-d");
  assert.equal(parseHlc("nope"), null);
});

test("order is (ms, counter, deviceId)", () => {
  const a: Hlc = { ms: 5, counter: 9, deviceId: "z" }, b: Hlc = { ms: 6, counter: 0, deviceId: "a" };
  assert.ok(compareHlc(a, b) < 0 && compareHlc(b, a) > 0);
  assert.ok(compareHlc({ ms: 5, counter: 1, deviceId: "a" }, { ms: 5, counter: 2, deviceId: "a" }) < 0);
  assert.ok(compareHlc({ ms: 5, counter: 1, deviceId: "a" }, { ms: 5, counter: 1, deviceId: "b" }) < 0);
  assert.equal(compareHlc(a, { ...a }), 0);
});

test("clamp: exactly 5 minutes ahead passes, one ms more is cut to server now with the excess as skew", () => {
  const edge = clampHlc({ ms: NOW + MAX_SKEW_MS, counter: 3, deviceId: "d" }, NOW);
  assert.equal(edge.clamped, false);
  assert.equal(edge.skewMs, MAX_SKEW_MS);
  const over = clampHlc({ ms: NOW + MAX_SKEW_MS + 1, counter: 3, deviceId: "d" }, NOW);
  assert.equal(over.clamped, true);
  assert.deepEqual(over.hlc, { ms: NOW, counter: 0, deviceId: "d" });
  assert.equal(over.skewMs, MAX_SKEW_MS + 1);
  assert.equal(clampHlc({ ms: NOW - 10_000, counter: 0, deviceId: "d" }, NOW).skewMs, 0, "a slow client is not skew");
});

test("tick is strictly increasing even when the wall clock stands still or runs backwards", () => {
  let last: Hlc | null = null;
  for (const wall of [100, 100, 100, 99, 50, 101, 101]) {
    const next = tickHlc("d", wall, last);
    if (last) assert.ok(compareHlc(next, last) > 0, `${formatHlc(next)} after ${formatHlc(last)}`);
    last = next;
  }
  const full = tickHlc("d", 10, { ms: 10, counter: 0xffff, deviceId: "d" });
  assert.deepEqual(full, { ms: 11, counter: 0, deviceId: "d" });
});

test("receive: the result is after both local and remote", () => {
  const local: Hlc = { ms: 100, counter: 4, deviceId: "me" }, remote: Hlc = { ms: 120, counter: 1, deviceId: "srv" };
  const r = receiveHlc("me", 90, local, remote);
  assert.ok(compareHlc(r, local) > 0 && compareHlc(r, remote) > 0);
  assert.equal(r.deviceId, "me");
});

// 200 seeded cases: devices with wall clocks skewed from -1 h to +2 h exchange hlcs through a server that clamps.
test("clock skew property: 200 seeded cases keep order, bound and idempotence", () => {
  for (let seed = 1; seed <= 200; seed++) {
    const rand = rng(seed);
    const skew = [0, 0, 0].map(() => Math.floor((rand() * 3 - 1) * 3_600_000));
    const devices = skew.map((s, i) => ({ id: `d${i}`, skew: s, last: null as Hlc | null }));
    let server = NOW;
    const accepted: Hlc[] = [];
    for (let step = 0; step < 40; step++) {
      server += Math.floor(rand() * 2000);
      const d = devices[Math.floor(rand() * devices.length)]!;
      const wall = server + d.skew + Math.floor(rand() * 50);
      const h = tickHlc(d.id, wall, d.last);
      assert.ok(!d.last || compareHlc(h, d.last) > 0, `seed ${seed}: device hlc went backwards`);
      d.last = h;
      const c = clampHlc(h, server);
      assert.ok(c.hlc.ms <= server + MAX_SKEW_MS, `seed ${seed}: clamped hlc is more than 5 minutes ahead`);
      assert.equal(c.clamped, h.ms > server + MAX_SKEW_MS, `seed ${seed}: clamp decision`);
      assert.equal(c.skewMs, Math.max(0, h.ms - server), `seed ${seed}: skew`);
      assert.deepEqual(clampHlc(c.hlc, server).hlc, c.hlc, `seed ${seed}: clamp is idempotent`);
      assert.deepEqual(parseHlc(formatHlc(c.hlc)), c.hlc, `seed ${seed}: text round-trip`);
      // the device learns the server's view and keeps ticking after it
      d.last = receiveHlc(d.id, wall, d.last, c.hlc);
      accepted.push(c.hlc);
    }
    // a transitive total order over everything the server accepted
    const sorted = [...accepted].sort(compareHlc);
    for (let i = 1; i < sorted.length; i++) assert.ok(compareHlc(sorted[i - 1]!, sorted[i]!) <= 0);
    const ids = new Set(accepted.map(formatHlc));
    assert.equal(ids.size, new Set(accepted.map((h) => JSON.stringify(h))).size, `seed ${seed}: distinct hlcs format distinctly`);
  }
});
