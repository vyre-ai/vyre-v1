import test from "node:test";
import assert from "node:assert/strict";
import { startLoopLag, WARN_MS } from "../src/scheduler/looplag.ts";

test("the loop-lag guard warns a block over 200 ms with the jobs in flight, and reports the worst lag once", async () => {
  const warned: Array<{ msg: string; attrs: Record<string, unknown> }> = [];
  const lag = startLoopLag({ running: () => ["calendar.pull_provider"], warn: (msg, attrs) => warned.push({ msg, attrs }) });
  await new Promise((r) => setTimeout(r, 120));
  lag.take();
  const end = performance.now() + WARN_MS + 150;
  while (performance.now() < end) { /* a job that holds the loop */ }
  await new Promise((r) => setTimeout(r, 120));
  const got = lag.take();
  assert.ok(got.maxMs >= WARN_MS, `max ${got.maxMs}`);
  assert.equal(warned.length >= 1, true);
  assert.equal(warned[0]!.msg, "scheduler.loop_blocked");
  assert.deepEqual(warned[0]!.attrs.jobs, ["calendar.pull_provider"]);
  assert.equal(lag.take().maxMs < WARN_MS, true, "the reading resets");
  lag.stop();
});
