// P-L11_08: golden flow 8 on a booted daemon, through the gateway with real tokens (rule 27). The modules the flow needs are flipped live in a temporary code root (see 02-space.ts).
// The flow itself passes for real. The approver path (a promotion that waits for the layer's owner) is a todo with its named gap.
// Run: all three flows 7, 8 and 15 are linked from one green run on the packet.
import test from "node:test";
import assert from "node:assert/strict";
import { checkSequence } from "../harness/index.ts";
import flow from "../flows/08-memory-promotion.flow.ts";
import { todoOf } from "./02-space.ts";
import { APPROVAL_GAPS, GAPS, LIVE_FOR_MEMORY, runMemory, runMemoryApproval } from "./08-memory-promotion.ts";

test("golden 8: memory-promotion", { todo: todoOf(GAPS) }, async () => {
  const { events, trail } = await runMemory(LIVE_FOR_MEMORY);
  assert.deepEqual(trail.failures, [], `\n${trail.report()}`);
  assert.deepEqual(checkSequence(flow.events, events), [], `events: ${events.map((e) => e.type).join(", ")}`);
});

test("golden 8: a promotion into a layer the person cannot edit waits for its owner", { todo: todoOf(APPROVAL_GAPS) }, async () => {
  const { events, trail } = await runMemoryApproval(LIVE_FOR_MEMORY);
  assert.deepEqual(trail.failures, [], `\n${trail.report()}`);
  assert.deepEqual(checkSequence(flow.events, events), [], `events: ${events.map((e) => e.type).join(", ")}`);
});
