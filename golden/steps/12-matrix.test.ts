// P-L11_06: golden flow 12 on a booted daemon, through the gateway with real tokens (rule 27). The modules the flow needs are flipped live in a temporary code root (see 02-space.ts).
import test from "node:test";
import assert from "node:assert/strict";
import { checkSequence } from "../harness/index.ts";
import flow from "../flows/12-permission-matrix.flow.ts";
import { runMatrix, LIVE_FOR_MATRIX } from "./12-permission-matrix.ts";

test("golden 12: permission-matrix", async () => {
  const { events, trail } = await runMatrix(LIVE_FOR_MATRIX);
  assert.deepEqual(trail.failures, [], `\n${trail.report()}`);
  assert.deepEqual(checkSequence(flow.events, events), [], `events: ${events.map((e) => e.type).join(", ")}`);
});
