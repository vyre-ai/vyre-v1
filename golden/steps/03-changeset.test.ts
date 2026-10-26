// P-L11_07: golden flow 3 on a booted daemon, through the gateway with real tokens (rule 27). The modules the flow needs are flipped live in a temporary code root (see 02-space.ts).
// A flow with GAPS (one line per owning PR, in 03-agent-changes.ts) is a node:test todo: it runs and prints its trail without failing the run.
import test from "node:test";
import assert from "node:assert/strict";
import { checkSequence } from "../harness/index.ts";
import flow from "../flows/03-agent-changes-reviewed.flow.ts";
import { todoOf } from "./02-space.ts";
import { GAPS, LIVE_FOR_CHANGES, runChanges } from "./03-agent-changes.ts";

test("golden 3: agent-changes-reviewed", { todo: todoOf(GAPS) }, async () => {
  const { events, trail } = await runChanges(LIVE_FOR_CHANGES);
  assert.deepEqual(trail.failures, [], `\n${trail.report()}`);
  assert.deepEqual(checkSequence(flow.events, events), [], `events: ${events.map((e) => e.type).join(", ")}`);
});
