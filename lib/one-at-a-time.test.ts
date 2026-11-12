// The per-key queue: work of one key runs one after another; a throw releases the queue; work that never settles fails loudly after the time limit and the queue moves on, with a log line.
import test from "node:test";
import assert from "node:assert/strict";
import { oneAtATime } from "./one-at-a-time.ts";

test("work for one key runs one after another, and a throw releases the queue", async () => {
  const order: string[] = [];
  const a = oneAtATime("k-order", async () => {
    order.push("a1");
    await new Promise((r) => setImmediate(r));
    order.push("a2");
  });
  const b = oneAtATime("k-order", async () => {
    order.push("b");
    throw new Error("b failed");
  });
  const c = oneAtATime("k-order", async () => {
    order.push("c");
    return 3;
  });
  await a;
  await assert.rejects(b, /b failed/);
  assert.equal(await c, 3);
  assert.deepEqual(order, ["a1", "a2", "b", "c"]);
});

test("work that never settles fails after the time limit, says so, and the next work for the key runs", async () => {
  const said: string[] = [];
  const stuck = oneAtATime("k-stuck", () => new Promise<void>(() => undefined), {
    limitMs: 50,
    onLimit: (key, ms) => said.push(`${key}:${ms}`),
  });
  const next = oneAtATime("k-stuck", async () => "ran");
  await assert.rejects(stuck, /did not finish within 50 ms/);
  assert.equal(await next, "ran", "the queue moved on");
  assert.deepEqual(said, ["k-stuck:50"]);
});
