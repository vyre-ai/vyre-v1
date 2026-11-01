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

test("the Chats badge moves with what it counts, and an equal count draws nothing", () => {
  const hub = createShellHub({ spaces: SEED_DEFS, openId: "nw", personId: "irfad", deviceId: "mac", storage: null, skeletonMs: 0 });
  let drew = 0;
  hub.subscribe(() => { drew += 1; });
  const badge = (): number => [...hub.rail().top, ...hub.rail().bottom].find((e) => e.place === "chats")?.count ?? -1;
  hub.count("chats", 4);
  assert.equal(badge(), 4);
  const once = drew;
  hub.count("chats", 4);
  assert.equal(drew, once, "the same count is no change");
  hub.count("chats", 0);
  assert.equal(badge(), 0, "decided elsewhere, the badge falls by itself");
});
