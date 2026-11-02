// The old rail "+" (Join) has no screen: going there opens Home and never leaves a Join tab.
import test from "node:test";
import assert from "node:assert/strict";
import { createShellHub } from "./hub.ts";
import { SEED_DEFS } from "./model.ts";

test("going to Join (the old rail +) opens Chats, never an empty place; a link to Home lands in Chats with its hash", () => {
  const hub = createShellHub({ spaces: SEED_DEFS, openId: "nw", personId: "irfad", deviceId: "mac", storage: null, skeletonMs: 0 });
  hub.go("join");
  assert.equal(hub.state().place, "chats");
  hub.go("home", "screen=tasks.my-work");
  assert.deepEqual([hub.state().place, hub.state().hash], ["chats", "screen=tasks.my-work"]);
  assert.equal(hub.session().tabs.state().tabs.find((t) => t.hash === "screen=tasks.my-work")?.title, "Tasks");
  assert.ok(!hub.session().tabs.state().tabs.some((t) => t.place === "home"));
  assert.ok(!hub.session().tabs.state().tabs.some((t) => t.place === "join"));
});
