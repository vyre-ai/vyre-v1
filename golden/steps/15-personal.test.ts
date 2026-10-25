// P-L11_08: golden flow 15 on a booted daemon, through the gateway with real tokens (rule 27). The modules the flow needs are flipped live in a temporary code root (see 02-space.ts).
// A flow with GAPS (one line per owning packet, in 15-personal-space-relay.ts) is a node:test todo: it runs and prints its trail without failing the run. No step of this flow is wired end to end yet.
// Run: all three flows 7, 8 and 15 are linked from one green run on the packet.
import test from "node:test";
import assert from "node:assert/strict";
import { checkSequence } from "../harness/index.ts";
import flow from "../flows/15-personal-space-relay.flow.ts";
import { todoOf } from "./02-space.ts";
import { GAPS, LIVE_FOR_PERSONAL, runPersonal } from "./15-personal-space-relay.ts";

let started: ReturnType<typeof runPersonal> | undefined;
const run = (): ReturnType<typeof runPersonal> => (started ??= runPersonal(LIVE_FOR_PERSONAL));

test("golden 15: personal-space-relay", { todo: todoOf(GAPS) }, async () => {
  const { events, trail } = await run();
  assert.deepEqual(trail.failures, [], `\n${trail.report()}`);
  assert.deepEqual(checkSequence(flow.events, events), [], `events: ${events.map((e) => e.type).join(", ")}`);
});
