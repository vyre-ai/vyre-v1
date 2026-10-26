// P-L11_07: golden flow 10 on a booted daemon, through the gateway with real tokens (rule 27). The modules the flow needs are flipped live in a temporary code root (see 02-space.ts).
// A flow with GAPS (one line per owning PR, in 10-key-failure.ts) is a node:test todo: it runs and prints its trail without failing the run.
import test from "node:test";
import assert from "node:assert/strict";
import { checkSequence } from "../harness/index.ts";
import flow from "../flows/10-key-failure-fallback.flow.ts";
import { todoOf } from "./02-space.ts";
import { GAPS, LIVE_FOR_KEYFAIL, runKeyFail } from "./10-key-failure.ts";

test("golden 10: key-failure-fallback", { todo: todoOf(GAPS) }, async () => {
  const { events, trail } = await runKeyFail(LIVE_FOR_KEYFAIL);
  assert.deepEqual(trail.failures, [], `\n${trail.report()}`);
  assert.deepEqual(checkSequence(flow.events, events), [], `events: ${events.map((e) => e.type).join(", ")}`);
});
