// @tsx
// Switching back to an open tab paints its content at once and never leaves an empty page (owner, 16 Nov 2026, F97). Part B: automation, console, settings. The walk is tabs-switch-walk.ts.
import test from "node:test";
import { switchWalk } from "./tabs-switch-walk.test.ts";

test("tabs: switching back to an open tab paints its content at once, never an empty page (automation, console, settings)", async (t) => {
  await switchWalk(t, ["automation", "console", "settings"], "b");
});
