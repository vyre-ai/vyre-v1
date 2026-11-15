// @tsx
// Switching back to an open tab paints its content at once and never leaves an empty page (owner, 16 Nov 2026, F97). Part A: chat, file, record. The walk is tabs-switch-walk.ts.
import test from "node:test";
import { switchWalk } from "./tabs-switch-walk.ts";

test("tabs: switching back to an open tab paints its content at once, never an empty page (chat, file, record)", async (t) => {
  await switchWalk(t, ["chat", "file", "record"], "a");
});
