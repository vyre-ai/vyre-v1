// Cmd-K offers Open terminal where the Space has a terminal (rc.8): always in a Personal Space, owners and developers in a Team Space; nowhere else.
import test from "node:test";
import assert from "node:assert/strict";
import { gateActions } from "./gate.ts";

test("Open terminal is an action only when the Space has a terminal", () => {
  assert.ok(gateActions({ away: false, offline: false, terminal: true }).some((a) => a.key === "terminal.open" && a.title === "Open terminal"));
  assert.ok(!gateActions({ away: false, offline: false }).some((a) => a.key === "terminal.open"));
  assert.ok(!gateActions({ away: false, offline: false, terminal: false }).some((a) => a.key === "terminal.open"));
});

test("typing import in the palette finds the spreadsheet import", () => {
  const hit = gateActions({ away: false, offline: false }).filter((a) => a.title.toLowerCase().includes("import"));
  assert.deepEqual(hit.map((a) => a.key), ["records.import"]);
});
