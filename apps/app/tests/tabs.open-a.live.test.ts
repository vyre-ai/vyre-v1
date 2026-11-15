// @tsx
// What opens where, by pointer, Cmd-press, the middle button and the menu (the model: TABS-2026-11-15.md D1 to D8). Part A: chats, files. The walk is tabs-open-walk.ts.
import test from "node:test";
import { openWalk } from "./tabs-open-walk.ts";

test("tabs: a press opens where the model says (chats, files)", async (t) => {
  await openWalk(t, new Set(["chats", "files"]), "a");
});
