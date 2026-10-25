// P-L11_08: golden flow 7 on a booted daemon, through the gateway with real tokens (rule 27). The modules the flow needs are flipped live in a temporary code root (see 02-space.ts).
// A flow with GAPS (one line per owning packet, in 07-gate-approval-expiry.ts) is a node:test todo: it runs and prints its trail without failing the run. The steps that already work are asserted in the first test.
import test from "node:test";
import assert from "node:assert/strict";
import { checkSequence } from "../harness/index.ts";
import flow from "../flows/07-gate-approval-expiry.flow.ts";
import { okSteps, todoOf } from "./02-space.ts";
import { GAPS, LIVE_FOR_GATE, runGate } from "./07-gate-approval-expiry.ts";

let started: ReturnType<typeof runGate> | undefined;
const run = (): ReturnType<typeof runGate> => (started ??= runGate(LIVE_FOR_GATE));

test("golden 7: the steps that are wired already pass", async () => {
  const { trail } = await run();
  const ok = okSteps(trail);
  for (const name of ["an agent is made", "it gets a routine that sends mail"]) assert.ok(ok.includes(name), `${name} is ok\n${trail.report()}`);
});

test("golden 7: gate-approval-expiry", { todo: todoOf(GAPS) }, async () => {
  const { events, trail } = await run();
  assert.deepEqual(trail.failures, [], `\n${trail.report()}`);
  assert.deepEqual(checkSequence(flow.events, events), [], `events: ${events.map((e) => e.type).join(", ")}`);
});
