// P-L11_05: golden flow 4 on a booted daemon, through the gateway with real tokens (rule 27). The modules the flow needs are flipped live in a temporary code root (see 02-space.ts).
// A flow with GAPS (one line per owning PR, in 04-offline-conflict.ts) is a node:test todo: it runs and prints its trail without failing the run.
import test from "node:test";
import assert from "node:assert/strict";
import { checkSequence } from "../harness/index.ts";
import flow from "../flows/04-offline-edit-conflict.flow.ts";
import { todoOf } from "./02-space.ts";
import { GAPS, LIVE_FOR_CONFLICT, runConflict } from "./04-offline-conflict.ts";

test("golden 4: offline-edit-conflict", { todo: todoOf(GAPS) }, async () => {
  const { events, trail } = await runConflict(LIVE_FOR_CONFLICT);
  assert.deepEqual(trail.failures, [], `\n${trail.report()}`);
  assert.deepEqual(checkSequence(flow.events, events), [], `events: ${events.map((e) => e.type).join(", ")}`);
});
