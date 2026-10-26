// P-GF_15: golden flow 5 on a booted daemon, through the gateway with real tokens (rule 27). Resend and Twilio are the only fakes: a fake network under the daemon's fetch seam and a fake DNS zone.
import test from "node:test";
import assert from "node:assert/strict";
import { checkSequence } from "../harness/index.ts";
import flow from "../flows/05-lead-campaign-reply-call.flow.ts";
import { okSteps, todoOf } from "./02-space.ts";
import { GAPS, LIVE_FOR_LEAD, runLead } from "./05-lead-campaign-reply-call.ts";

let started: ReturnType<typeof runLead> | undefined;
const run = (): ReturnType<typeof runLead> => (started ??= runLead(LIVE_FOR_LEAD));

test("golden 5: the steps that are wired already pass", async () => {
  const { trail } = await run();
  const ok = okSteps(trail);
  for (const name of ["the contact type exists", "a lead is made"]) assert.ok(ok.includes(name), `${name} is ok\n${trail.report()}`);
});

test("golden 5: lead-campaign-reply-call", { todo: todoOf(GAPS) }, async () => {
  const { events, trail } = await run();
  assert.deepEqual(trail.failures, [], `\n${trail.report()}`);
  assert.deepEqual(checkSequence(flow.events, events, flow.external), [], `events: ${events.map((e) => e.type).join(", ")}`);
});
