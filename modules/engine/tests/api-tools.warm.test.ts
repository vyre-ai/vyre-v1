// The tool catalog is built in the idle ticks after the engine module loads, not by the first agent turn (a 176 ms stretch). It is built a slice at a time with a turn of the loop between slices (so no tick
// holds the loop for the whole of it), which takes a few ticks: the test waits for it, with a bound.
import test from "node:test";
import assert from "node:assert/strict";
import { apiToolCatalogWarm } from "../api-tools.ts";
import "../impl.ts";

test("the idle ticks after the engine module loads leave the tool catalog built, without any one of them holding the loop", async () => {
  let longest = 0;
  let last = performance.now();
  const watch = setInterval(() => {
    const at = performance.now();
    longest = Math.max(longest, at - last - 2);
    last = at;
  }, 2);
  const until = Date.now() + 10_000;
  while (!apiToolCatalogWarm() && Date.now() < until) await new Promise<void>((r) => setTimeout(r, 5));
  clearInterval(watch);
  assert.equal(apiToolCatalogWarm(), true, "a turn finds the catalog warm");
  assert.ok(longest < 100, `no stretch of building it held the loop for 100 ms (longest ${Math.round(longest)} ms)`);
});
