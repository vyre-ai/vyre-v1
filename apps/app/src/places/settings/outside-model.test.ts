import test from "node:test";
import assert from "node:assert/strict";
import { activeNow, appGlyph, appSub, appWhen } from "./outside-model.ts";
import type { Connected } from "./outside-model.ts";

const NOW = Date.UTC(2026, 10, 19, 12, 0, 0);
const c = { now: NOW, offsetMin: 0 };
const row = (o: Partial<Connected> = {}): Connected => ({
  agentId: "agt_1",
  clientName: "Claude",
  connectedAt: NOW - 3 * 3_600_000,
  calls: 0,
  ...o,
});

test("an app that has acted shows what it did; one that has not shows when it joined", () => {
  assert.equal(appSub(row({ lastDid: "Added a task" }), c), "Added a task");
  assert.equal(appSub(row(), c), "Connected 3 h ago");
  assert.equal(appSub(row({ connectedAt: NOW - 30 * 3_600_000 }), c), "Connected yesterday");
});

test("the time is its last call, else its join time", () => {
  assert.equal(appWhen(row({ lastSeenAt: NOW - 120_000 }), c), "2 min ago");
  assert.equal(appWhen(row(), c), "3 h ago");
});

test("the green dot is for the last two minutes only, and never for a clock in the future", () => {
  assert.equal(activeNow(row({ lastSeenAt: NOW - 60_000 }), NOW), true);
  assert.equal(activeNow(row({ lastSeenAt: NOW - 5 * 60_000 }), NOW), false);
  assert.equal(activeNow(row({ lastSeenAt: NOW + 60_000 }), NOW), false);
  assert.equal(activeNow(row(), NOW), false);
});

test("every app gets a mark, an unknown one the link", () => {
  assert.equal(appGlyph("Claude Code"), "laptop");
  assert.equal(appGlyph("Claude"), "spark");
  assert.equal(appGlyph("Cursor"), "grid");
  assert.equal(appGlyph("Mystery"), "link");
});
