// P-L11_06: golden flow 11 on a booted daemon, through the gateway with real tokens (rule 27). The modules the flow needs are flipped live in a temporary code root (see 02-space.ts).
import test from "node:test";
import assert from "node:assert/strict";
import { checkSequence } from "../harness/index.ts";
import flow from "../flows/11-backup-restore-tombstones.flow.ts";
import { runRestore, LIVE_FOR_RESTORE } from "./11-backup-restore-tombstones.ts";

test("golden 11: backup-restore-tombstones", async () => {
  const { events, trail } = await runRestore(LIVE_FOR_RESTORE);
  assert.deepEqual(trail.failures, [], `\n${trail.report()}`);
  assert.deepEqual(checkSequence(flow.events, events), [], `events: ${events.map((e) => e.type).join(", ")}`);
});
