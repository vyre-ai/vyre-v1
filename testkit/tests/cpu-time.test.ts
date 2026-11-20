// The CPU-time rule keeps its teeth: work that burns CPU past the limit fails, work that merely waits past the hang guard fails, and a call
// that is slow on the wall clock but cheap in CPU passes (a busy runner stretching the clock).
import test from "node:test";
import assert from "node:assert/strict";
import { assertWithinCpu, assertWithinCpuAsync, timeCpu } from "../src/cpu-time.ts";

const burn = (ms: number): number => {
  const end = performance.now() + ms;
  let n = 0;
  while (performance.now() < end) n += Math.sqrt(n + 1);
  return n;
};

test("work that uses more CPU than the limit fails, however it is spread over runs", () => {
  assert.throws(() => assertWithinCpu("quadratic stand-in", 50, () => burn(200)), /ms of CPU/);
  const quadratic = (n: number): number => {
    let s = 0;
    for (let i = 0; i < n; i += 1) for (let j = 0; j < n; j += 1) s += (i ^ j) & 1;
    return s;
  };
  const { cpuMs } = timeCpu(() => quadratic(20_000));
  assert.ok(cpuMs > 100, `the stand-in really is slow (${Math.round(cpuMs)} ms)`);
  assert.throws(() => assertWithinCpu("n squared", 100, () => quadratic(20_000)), /ms of CPU/);
});

test("work that only waits past the hang guard fails; a short wait passes", () => {
  const nap = (ms: number): void => void Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  assert.throws(() => assertWithinCpu("a hang", 30, () => nap(400)), /hang guard/);
  assert.doesNotThrow(() => assertWithinCpu("a short wait", 30, () => nap(100)));
});

test("a cheap call passes and returns its value; the async form measures the same way", async () => {
  assert.equal(
    assertWithinCpu("cheap", 100, () => 42),
    42,
  );
  assert.equal(await assertWithinCpuAsync("cheap async", 100, async () => "ok"), "ok");
  await assert.rejects(
    assertWithinCpuAsync("burning async", 50, async () => burn(200)),
    /ms of CPU/,
  );
});
