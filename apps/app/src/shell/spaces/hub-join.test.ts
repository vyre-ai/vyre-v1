// The old rail "+" (Join) has no screen: going there opens Home and never leaves a Join tab.
import test from "node:test";
import assert from "node:assert/strict";
import { createShellHub } from "./hub.ts";
import { SEED_DEFS } from "./model.ts";

test("going to Join (the old rail +) opens Home, never an empty place", () => {
  const hub = createShellHub({ spaces: SEED_DEFS, openId: "nw", personId: "irfad", deviceId: "mac", storage: null, skeletonMs: 0 });
  hub.go("join");
  assert.equal(hub.state().place, "home");
  assert.ok(!hub.session().tabs.state().tabs.some((t) => t.place === "join"));
});
