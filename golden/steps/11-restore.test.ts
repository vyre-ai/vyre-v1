// P-L11_06: golden flow 11 on a booted daemon, through the gateway with real tokens (rule 27). The modules the flow needs are flipped live in a temporary code root (see 02-space.ts).
// The flow is a known gap today (GAPS in 11-backup-restore-tombstones.ts, one line per owning packet): its full test is a node:test todo, so it runs and prints its trail without failing the run, and the steps
// that already work are asserted for real in the first test.
import test from "node:test";
import assert from "node:assert/strict";
import { checkSequence } from "../harness/index.ts";
import flow from "../flows/11-backup-restore-tombstones.flow.ts";
import { okSteps, todoOf } from "./02-space.ts";
import { GAPS, LIVE_FOR_RESTORE, runRestore } from "./11-backup-restore-tombstones.ts";

let started: ReturnType<typeof runRestore> | undefined;
const run = (): ReturnType<typeof runRestore> => (started ??= runRestore(LIVE_FOR_RESTORE));

test("golden 11: the steps that are wired already pass", async () => {
  const { trail } = await run();
  const ok = okSteps(trail);
  for (const name of ["the contact type exists"]) assert.ok(ok.includes(name), `${name} is ok\n${trail.report()}`);
});

test("golden 11: backup-restore-tombstones", { todo: todoOf(GAPS) }, async () => {
  const { events, trail } = await run();
  assert.deepEqual(trail.failures, [], `\n${trail.report()}`);
  assert.deepEqual(checkSequence(flow.events, events), [], `events: ${events.map((e) => e.type).join(", ")}`);
});
