// @tsx
// What opens where, by pointer, Cmd-press, the middle button and the menu (the model: TABS-2026-11-15.md D1 to D8). Part C: links, cmdk, already. The walk is tabs-open-walk.ts.
import test from "node:test";
import { openWalk } from "./tabs-open-walk.test.ts";

test("tabs: a press opens where the model says (links, cmdk, already)", async (t) => {
  await openWalk(t, new Set(["links", "cmdk", "already"]), "c");
});
