// Golden flow 5, campaign leg: a campaign is launched, its emails go out through the single send API, a reply lands and stops the contact's sequence, and the reply is announced.
// The Gate that approves the launch and the softphone call log are other lanes' steps; this proves the campaign step they sit around.
// @reads /modules/campaigns/migrations/0001_campaigns.sql

import test from "node:test";
import assert from "node:assert/strict";
import { DAY, harness } from "../fixtures/world.ts";
import { build, deliver, launch, pass, run } from "../fixtures/seed.ts";

test("golden 5 campaign step: launch, send through mail.send, reply lands, stop on reply, replied announced", async () => {
  const w = harness();
  const trace: string[] = [];
  const step = (name: string, detail: Record<string, unknown>): void => {
    trace.push(`${String(trace.length + 1).padStart(2, "0")} ${name} ${JSON.stringify(detail)}`);
  };
  w.contact(1);
  w.contact(2);
  const { campaignId } = await build(w, {
    steps: [
      { key: "intro", type: "email", config: { mailboxId: "mbx_sales", subject: "A note for {{first_name}}", text: "Hello {{first_name}}." } },
      { key: "gap", type: "wait", config: { days: 3 } },
      { key: "nudge", type: "email", config: { mailboxId: "mbx_sales", subject: "Following up", text: "Any thoughts?" } },
    ],
  });
  const preview = await run<{ counts: Record<string, number> }>(w.ctx, "campaigns.preview", { campaignId });
  step("preview", preview.counts);
  const { runId } = await launch(w, campaignId);
  step("launched", { runId, events: w.names() });
  assert.equal(w.ofName("campaign.launched").length, 1);
  assert.deepEqual(w.mail.map((m) => m.input.campaignId), [campaignId, campaignId]);
  step("sent", { count: w.mail.length, via: "mail.send", subjects: w.mail.map((m) => m.input.subject) });

  await pass(w, campaignId);
  deliver(w, "mail.received", { messageId: "eml_9001", mailboxId: "mbx_sales", from: "p1@client.example", subject: "Re: A note", contactId: "rec_c001", campaignId });
  step("reply landed", { contact: "rec_c001", message: "eml_9001" });
  w.advance(4 * DAY);
  await pass(w, campaignId);
  assert.deepEqual(w.mail.slice(2).map((m) => m.input.contactId), ["rec_c002"], "the contact who replied gets no nudge");
  assert.deepEqual(w.ofName("campaign.replied").map((e) => e.payload), [{ campaignId, recordId: "rec_c001", messageId: "eml_9001" }]);
  step("stop on reply", { replied: "rec_c001", nudged: "rec_c002" });
  const stats = await run<Record<string, number>>(w.ctx, "campaigns.stats", { campaignId });
  assert.deepEqual(stats, { sent: 3, delivered: 0, bounced: 0, complained: 0, replied: 1, unsubscribed: 0 });
  step("stats", stats);
  for (const line of trace) console.log(`golden5-campaign-step ${line}`);
});
