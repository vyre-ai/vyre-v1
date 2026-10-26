// P-L11_05: golden flow 14 on a booted daemon, through the gateway with real tokens (rule 27). The modules the flow needs are flipped live in a temporary code root (see 02-space.ts).
// A flow with GAPS (one line per owning PR, in 14-sync-purge.ts) is a node:test todo: it runs and prints its trail without failing the run.
import test from "node:test";
import assert from "node:assert/strict";
import { checkSequence } from "../harness/index.ts";
import flow from "../flows/14-sync-revocation-purge.flow.ts";
import { todoOf } from "./02-space.ts";
import { GAPS, LIVE_FOR_PURGE, runPurge } from "./14-sync-purge.ts";

test("golden 14: sync-revocation-purge", { todo: todoOf(GAPS) }, async () => {
  const { events, trail } = await runPurge(LIVE_FOR_PURGE);
  assert.deepEqual(trail.failures, [], `\n${trail.report()}`);
  assert.deepEqual(checkSequence(flow.events, events), [], `events: ${events.map((e) => e.type).join(", ")}`);
});
