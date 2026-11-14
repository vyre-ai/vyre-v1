// A popover that opens upward from the composer needs room above it. Without room (a composer high in a short window, as on an empty chat) its first rows were cut off by the top of the pane, so "Upload files" could not be pressed (F32).
import test from "node:test";
import assert from "node:assert/strict";
import { popOpensBelow } from "./pop-room.ts";

test("a popover that would start above the pane's top opens below its composer instead", () => {
  assert.equal(popOpensBelow({ popTop: 120, paneTop: 38 }), false, "room above: stays above");
  assert.equal(popOpensBelow({ popTop: 38, paneTop: 38 }), false, "exactly at the top still fits");
  assert.equal(popOpensBelow({ popTop: 20, paneTop: 38 }), true, "its top row would be cut off");
  assert.equal(popOpensBelow({ popTop: -60, paneTop: 0 }), true);
});
