// @tsx
// One of four parts of the background-helpers walk, the paper wide configuration (header and the walk itself: test/crew-background-kit.ts).
import test from "node:test";
import { crewBackgroundWalk, WIDE } from "./crew-background-kit.ts";

test("helpers launched in the background, real app: Working until their own end, one live line with Stop, the sidebar ring, the Assistant back once (dark and light, wide and phone)", async (t) => {
  await crewBackgroundWalk(t, "paper-wide", [["paper", "wide", WIDE]]);
});
