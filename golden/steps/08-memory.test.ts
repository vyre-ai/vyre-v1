// P-L11_08: golden flow 8 on a booted daemon, through the gateway with real tokens (rule 27). The modules the flow needs are flipped live in a temporary code root (see 02-space.ts).
// A flow with GAPS (one line per owning packet, in 08-memory-promotion.ts) is a node:test todo: it runs and prints its trail without failing the run. The steps that already work are asserted in the first test.
import test from "node:test";
import assert from "node:assert/strict";
import { checkSequence } from "../harness/index.ts";
import flow from "../flows/08-memory-promotion.flow.ts";
import { okSteps, todoOf } from "./02-space.ts";
import { GAPS, LIVE_FOR_MEMORY, runMemory } from "./08-memory-promotion.ts";

let started: ReturnType<typeof runMemory> | undefined;
const run = (): ReturnType<typeof runMemory> => (started ??= runMemory(LIVE_FOR_MEMORY));

test("golden 8: the steps that are wired already pass", async () => {
  const { trail } = await run();
  const ok = okSteps(trail);
  for (const name of ["Noah proposes a fact in his own layer", "the fact is accepted into current memory", "another member cannot read it: it is Noah's alone"]) assert.ok(ok.includes(name), `${name} is ok\n${trail.report()}`);
});

test("golden 8: memory-promotion", { todo: todoOf(GAPS) }, async () => {
  const { events, trail } = await run();
  assert.deepEqual(trail.failures, [], `\n${trail.report()}`);
  assert.deepEqual(checkSequence(flow.events, events), [], `events: ${events.map((e) => e.type).join(", ")}`);
});
