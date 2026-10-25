// P-L11_06: golden flow 9 on a booted daemon, through the gateway with real tokens (rule 27). The modules the flow needs are flipped live in a temporary code root (see 02-space.ts).
import test from "node:test";
import assert from "node:assert/strict";
import { checkSequence } from "../harness/index.ts";
import flow from "../flows/09-offboarding.flow.ts";
import { runOffboarding, LIVE_FOR_OFFBOARDING } from "./09-offboarding.ts";

test("golden 9: offboarding", async () => {
  const { events, trail } = await runOffboarding(LIVE_FOR_OFFBOARDING);
  assert.deepEqual(trail.failures, [], `\n${trail.report()}`);
  assert.deepEqual(checkSequence(flow.events, events), [], `events: ${events.map((e) => e.type).join(", ")}`);
});
