// The walker's first pass, fixed (w-first, 15 Nov 2026), part c: a real browser on a booted team Space presses what the walker pressed (wf-console-home-words wf-invite-link wf-notes-and-files wf-public-channel). Steps: scripts/shots/first-hour-team.mjs.
import test from "node:test";
import { runWalk } from "./w-first.walk-support.ts";

test("the walker's first pass, part c: every step passes in a real browser", { timeout: 300_000 }, async (t) => {
  await runWalk(t, ["wf-console-home-words", "wf-invite-link", "wf-notes-and-files", "wf-public-channel"]);
});
