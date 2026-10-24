// Pure parts of the probes. The browser parts run in .github/workflows/shots.yml.
import test from "node:test";
import assert from "node:assert/strict";
// @ts-expect-error plain .mjs helpers without types
import { summarize, withinBudget, SCROLL_P95_MS } from "./scroll.mjs";
// @ts-expect-error plain .mjs helpers without types
import { startupMs } from "./startup.mjs";

test("summarize returns the p95 and the worst interval", () => {
  const s = summarize(Array.from({ length: 100 }, (_, i) => (i < 95 ? 16 : 40)));
  assert.equal(s.frames, 100);
  assert.equal(s.p95, 16);
  assert.equal(s.max, 40);
});

test("withinBudget needs enough frames and a p95 at the ceiling plus vsync jitter", () => {
  assert.equal(withinBudget(summarize(Array.from({ length: 100 }, () => 16.7))), true);
  assert.equal(withinBudget(summarize(Array.from({ length: 100 }, () => 30))), false);
  assert.equal(withinBudget(summarize([16, 16])), false, "too few frames to judge");
  assert.equal(withinBudget({ frames: 100, p95: SCROLL_P95_MS + 0.5, max: 20 }), true);
});

test("startupMs reads app.start to app.usable", () => {
  assert.equal(startupMs([{ name: "app.start", startTime: 5 }, { name: "app.usable", startTime: 305 }]), 300);
  assert.equal(startupMs([]), null);
});
