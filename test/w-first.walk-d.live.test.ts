// The walker's first pass, fixed (w-first, 15 Nov 2026), part d: a real browser on a booted team Space presses what the walker pressed (wf-connect-after). Steps: scripts/shots/first-hour-team.mjs. Each part stands alone and stays under about 45 s.
import test from "node:test";
import { runWalk } from "./w-first.walk-support.ts";

test("the walker's first pass, part d: every step passes in a real browser", { timeout: 300_000 }, async (t) => {
  await runWalk(t, ["wf-connect-after"]);
});
