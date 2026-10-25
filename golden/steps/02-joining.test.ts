// P-L11_06: golden flow 2 on a booted daemon, through the gateway with real tokens (rule 27). The modules the flow needs are flipped live in a temporary code root (see 02-space.ts).
import test from "node:test";
import assert from "node:assert/strict";
import { checkSequence } from "../harness/index.ts";
import flow from "../flows/02-person-joining.flow.ts";
import { runJoining, LIVE_FOR_JOIN } from "./02-person-joining.ts";

test("golden 2: person-joining", async () => {
  const { events, trail } = await runJoining(LIVE_FOR_JOIN);
  assert.deepEqual(trail.failures, [], `\n${trail.report()}`);
  assert.deepEqual(checkSequence(flow.events, events), [], `events: ${events.map((e) => e.type).join(", ")}`);
});
