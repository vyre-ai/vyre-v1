// P-L11_07: golden flow 13 on a booted daemon, through the gateway with real tokens (rule 27). The modules the flow needs are flipped live in a temporary code root (see 02-space.ts).
// A flow with GAPS (one line per owning PR, in 13-private-chat.ts) is a node:test todo: it runs and prints its trail without failing the run.
import test from "node:test";
import assert from "node:assert/strict";
import { checkSequence } from "../harness/index.ts";
import flow from "../flows/13-private-chat-e2e.flow.ts";
import { todoOf } from "./02-space.ts";
import { GAPS, LIVE_FOR_PRIVATE, runPrivate } from "./13-private-chat.ts";

test("golden 13: private-chat-e2e", { todo: todoOf(GAPS) }, async () => {
  const { events, trail } = await runPrivate(LIVE_FOR_PRIVATE);
  assert.deepEqual(trail.failures, [], `\n${trail.report()}`);
  assert.deepEqual(checkSequence(flow.events, events), [], `events: ${events.map((e) => e.type).join(", ")}`);
});
