import test from "node:test";
import assert from "node:assert/strict";
import { turns } from "./yield-loop.ts";

test("turns() gives the event loop back once a budget of work has passed, and not before", async () => {
  let ticks = 0;
  const timer = setInterval(() => ticks++, 0);
  try {
    const quick = turns(10_000);
    for (let i = 0; i < 50; i++) await quick();
    assert.equal(ticks, 0, "inside the budget nothing yields");
    const turn = turns(5);
    const until = performance.now() + 60;
    while (performance.now() < until) {
      const spin = performance.now() + 6;
      while (performance.now() < spin);
      await turn();
    }
    assert.ok(ticks >= 3, `a timer ran between the steps (${ticks})`);
  } finally {
    clearInterval(timer);
  }
});
