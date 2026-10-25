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

// @ts-expect-error plain .mjs helpers without types
import { median, summarizeCombo, comboOk } from "./theme-flash-gate.mjs";

const flashBudget = { wrong_frames_max: 0, apply_ms_max: 100 };

test("median takes the middle of three, so one slow sample does not decide", () => {
  assert.equal(median([104.1, 20, 30]), 30);
  assert.equal(median([1, 2, 3, 4]), 2.5);
  assert.ok(Number.isNaN(median([])));
});

test("theme_flash passes when one of three apply samples is slow (ruling 37)", () => {
  const c = summarizeCombo([{ wrong: 0, apply_ms: 104.1 }, { wrong: 0, apply_ms: 20 }, { wrong: 0, apply_ms: 30 }]);
  assert.equal(c.apply_ms_median, 30);
  assert.equal(comboOk(c, flashBudget), true);
});

test("theme_flash fails when the median apply time is over the budget", () => {
  const c = summarizeCombo([{ wrong: 0, apply_ms: 140 }, { wrong: 0, apply_ms: 120 }, { wrong: 0, apply_ms: 30 }]);
  assert.equal(comboOk(c, flashBudget), false);
});

test("theme_flash fails on a single wrong frame, however fast the apply", () => {
  const c = summarizeCombo([{ wrong: 1, apply_ms: 5 }, { wrong: 0, apply_ms: 5 }, { wrong: 0, apply_ms: 5 }]);
  assert.equal(c.wrong, 1);
  assert.equal(comboOk(c, flashBudget), false);
});

test("theme_flash fails when the apply mark is missing", () => {
  const c = summarizeCombo([{ wrong: 0, apply_ms: -1 }, { wrong: 0, apply_ms: 5 }, { wrong: 0, apply_ms: 5 }]);
  assert.equal(c.missing, true);
  assert.equal(comboOk(c, flashBudget), false);
});
