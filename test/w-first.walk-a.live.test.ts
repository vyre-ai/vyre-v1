// The walker's first pass, fixed (w-first, 15 Nov 2026), part a: a real browser on a booted team Space presses what the walker pressed (wf-getting-started-fresh wf-new-goal wf-agent-share wf-people-share-everyone). Steps: scripts/shots/first-hour-team.mjs.
import test from "node:test";
import { runWalk } from "./w-first.walk-support.ts";

test("the walker's first pass, part a: every step passes in a real browser", { timeout: 300_000 }, async (t) => {
  await runWalk(t, ["wf-getting-started-fresh", "wf-new-goal", "wf-agent-share", "wf-people-share-everyone"]);
});
