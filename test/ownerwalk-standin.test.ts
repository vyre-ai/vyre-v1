// The owner walk's model stand-in (test/ownerwalk-kit.test.ts): a short reply names what was asked, and a LONG ask runs long enough to press Stop. The kit holds no test of its own, so the walk
// coverage guard sees it as a kit and the walks that import it as walks.
import test from "node:test";
import assert from "node:assert/strict";
import { replyFor } from "./support/ownerwalk-model.ts";

test("owner walk kit: the stand-in names what was asked and a LONG ask runs long", () => {
  assert.match(replyFor("plan the launch"), /plan the launch/);
  assert.ok(replyFor("LONG please").split(" ").length > 300);
});
