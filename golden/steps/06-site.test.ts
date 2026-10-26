// P-L11_07: golden flow 6 on a booted daemon, through the gateway with real tokens (rule 27). The modules the flow needs are flipped live in a temporary code root (see 02-space.ts).
// A flow with GAPS (one line per owning PR, in 06-site-deploy.ts) is a node:test todo: it runs and prints its trail without failing the run.
import test from "node:test";
import assert from "node:assert/strict";
import { checkSequence } from "../harness/index.ts";
import flow from "../flows/06-site-deploy-rollback.flow.ts";
import { todoOf } from "./02-space.ts";
import { GAPS, LIVE_FOR_SITE, runSite } from "./06-site-deploy.ts";

test("golden 6: site-deploy-rollback", { todo: todoOf(GAPS) }, async () => {
  const { events, trail } = await runSite(LIVE_FOR_SITE);
  assert.deepEqual(trail.failures, [], `\n${trail.report()}`);
  assert.deepEqual(checkSequence(flow.events, events), [], `events: ${events.map((e) => e.type).join(", ")}`);
});
