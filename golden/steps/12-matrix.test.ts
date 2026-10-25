// P-L11_06: golden flow 12 on a booted daemon, through the gateway with real tokens (rule 27). The modules the flow needs are flipped live in a temporary code root (see 02-space.ts).
// The flow is a known gap today (GAPS in 12-permission-matrix.ts, one line per owning packet): its full test is a node:test todo, so it runs and prints its trail without failing the run, and the steps
// that already work are asserted for real in the first test.
import test from "node:test";
import assert from "node:assert/strict";
import { checkSequence } from "../harness/index.ts";
import flow from "../flows/12-permission-matrix.flow.ts";
import { okSteps, todoOf } from "./02-space.ts";
import { GAPS, LIVE_FOR_MATRIX, runMatrix } from "./12-permission-matrix.ts";

let started: ReturnType<typeof runMatrix> | undefined;
const run = (): ReturnType<typeof runMatrix> => (started ??= runMatrix(LIVE_FOR_MATRIX));

test("golden 12: the steps that are wired already pass", async () => {
  const { trail } = await run();
  const ok = okSteps(trail);
  for (const name of ["every built-in role holds exactly the catalogue's permissions", "refusal: Tess cannot open View as", "the General channel is not visible to Tess"]) assert.ok(ok.includes(name), `${name} is ok\n${trail.report()}`);
});

test("golden 12: permission-matrix", { todo: todoOf(GAPS) }, async () => {
  const { events, trail } = await run();
  assert.deepEqual(trail.failures, [], `\n${trail.report()}`);
  assert.deepEqual(checkSequence(flow.events, events), [], `events: ${events.map((e) => e.type).join(", ")}`);
});
