// campaigns send: launch, send windows by recipient zone, throttling per sending domain, stop on reply, unsubscribe, branches, the bounce guard, triggers and warmup
// (spec 2.19, 3.6; ARCH 7.6, 8.2). The migration is data: @reads keeps ci-select on this test instead of the whole suite.
// @reads /modules/campaigns/migrations/0001_campaigns.sql

import test from "node:test";
import assert from "node:assert/strict";
import { VyreErr } from "../../../packages/contracts/src/errors.ts";
import { poolOptedIn, recordWarmupHealth } from "../impl.ts";
import { DAY, HOUR, MINUTE, NOW, harness } from "../fixtures/world.ts";
import type { World } from "../fixtures/world.ts";
import { EMAIL_STEP, build, code, deliver, launch, pass, run, unsubscribeToken } from "../fixtures/seed.ts";

interface Row { campaignId: string; state: string }
interface Stats { sent: number; delivered: number; bounced: number; complained: number; replied: number; unsubscribed: number }

const stateOf = async (w: World, campaignId: string): Promise<string> => (await run<{ campaign: Row }>(w.ctx, "campaigns.get", { campaignId })).campaign.state;
const stats = (w: World, campaignId: string) => run<Stats>(w.ctx, "campaigns.stats", { campaignId });
const wait = (key: string, o: Record<string, number>) => ({ key, type: "wait", config: o });
const email = (key: string, subject = "S") => ({ key, type: "email", config: { mailboxId: "mbx_sales", subject, text: "Body for {{first_name}}" } });

// ---- launch ---------------------------------------------------------------------------------------------------------

test("launch: the run starts, the first emails go out through mail.send with an unsubscribe link, and a one-step campaign completes", async () => {
  const w = harness();
  w.contact(1);
  w.contact(2);
  const { campaignId } = await build(w);
  const { runId } = await launch(w, campaignId);
  assert.match(runId, /^run_[a-z0-9]+$/);
  assert.deepEqual(w.ofName("campaign.launched").map((e) => [e.subject, e.payload]), [[`campaign/${campaignId}`, { campaignId, audienceCount: 2 }]]);
  assert.equal(w.mail.length, 2);
  const m = w.mail[0]!.input;
  assert.equal(m.mailboxId, "mbx_sales");
  assert.deepEqual(m.to, [{ address: "p1@client.example", name: "Person 1", contactId: "rec_c001" }]);
  assert.equal(m.subject, "Hello Person");
  assert.equal(m.contactId, "rec_c001");
  assert.equal(m.campaignId, campaignId);
  assert.match(String(m.text), /^Hi Person, a note about your matter\.\n\nTo stop these emails: https:\/\/harbor\.example\/u\/[A-Za-z0-9_-]{32}$/);
  assert.equal(m.html, undefined);
  assert.equal(await stateOf(w, campaignId), "completed");
  assert.equal(w.ofName("campaign.completed").length, 1);
  assert.deepEqual(await stats(w, campaignId), { sent: 2, delivered: 0, bounced: 0, complained: 0, replied: 0, unsubscribed: 0 });
  assert.equal(w.scheduled.length, 0, "nothing is left to wake for");
});

test("launch refuses what is not ready", async () => {
  const w = harness();
  w.contact(1);
  const bare = (await run<{ campaign: Row }>(w.ctx, "campaigns.create", { name: "Bare", kind: "sequence" })).campaign.campaignId;
  assert.equal(await code(launch(w, bare)), "validation.precondition_failed", "no steps");
  await run(w.ctx, "campaigns.steps_set", { campaignId: bare, steps: [wait("w", { days: 1 })] });
  assert.equal(await code(launch(w, bare)), "validation.precondition_failed", "no message step");
  await run(w.ctx, "campaigns.steps_set", { campaignId: bare, steps: [EMAIL_STEP] });
  assert.equal(await code(launch(w, bare)), "validation.precondition_failed", "no audience");
  const trig = await build(w, { kind: "triggered", audience: false });
  assert.equal(await code(launch(w, trig.campaignId)), "validation.precondition_failed", "no trigger");
  const ok = await build(w);
  await launch(w, ok.campaignId);
  assert.equal(await code(launch(w, ok.campaignId)), "validation.precondition_failed", "already launched");
  assert.equal(w.ofName("campaign.launched").length, 1);
});

test("launch with a start time in the future waits, and the tick at that time starts it", async () => {
  const w = harness();
  w.contact(1);
  const { campaignId } = await build(w);
  await run(w.ctx, "campaigns.update", { campaignId, settings: { startAt: NOW + 3 * HOUR } });
  await launch(w, campaignId);
  assert.equal(await stateOf(w, campaignId), "scheduled");
  assert.equal(w.mail.length, 0);
  assert.deepEqual(w.scheduled.map((s) => [s.at, s.cap, s.input]), [[NOW + 3 * HOUR, "campaigns.resume", { campaignId }]]);
  assert.deepEqual(await pass(w, campaignId), { sent: 0, nextAt: NOW + 3 * HOUR });
  w.advance(3 * HOUR);
  await run(w.ctx, "campaigns.resume", { campaignId });
  assert.equal(w.mail.length, 1);
  assert.equal(await stateOf(w, campaignId), "completed");
  assert.equal(w.ofName("campaign.launched").length, 1);
});

// ---- windows, throttle, warmup caps ------------------------------------------------------------------------------------

test("send windows: each contact is mailed inside the window of its own zone, and the next wake is the earliest opening", async () => {
  const w = harness();
  w.contact(1);
  w.contact(2, { timezone: "America/Los_Angeles" });
  w.contact(3, { timezone: "Asia/Tokyo" });
  const { campaignId } = await build(w);
  await launch(w, campaignId);
  assert.deepEqual(w.mail.map((m) => m.input.contactId), ["rec_c001"], "03:00 in Los Angeles and 19:00 in Tokyo are closed");
  const due = Object.fromEntries(w.db.rows("campaigns_member").map((m) => [String(m.record_id), m.due_at]));
  assert.equal(due.rec_c002, NOW + 6 * HOUR);
  assert.equal(due.rec_c003, NOW + 14 * HOUR);
  assert.deepEqual(w.scheduled.map((s) => [s.at, s.cap]), [[NOW + 6 * HOUR, "campaigns.resume"]]);
  w.advance(6 * HOUR);
  await pass(w, campaignId);
  assert.deepEqual(w.mail.map((m) => m.input.contactId), ["rec_c001", "rec_c002"]);
  assert.equal(await stateOf(w, campaignId), "running");
  w.advance(8 * HOUR);
  await pass(w, campaignId);
  assert.deepEqual(w.mail.map((m) => m.input.contactId), ["rec_c001", "rec_c002", "rec_c003"]);
  assert.equal(await stateOf(w, campaignId), "completed");
});

test("send windows: a campaign's own window decides, weekends are skipped, and a contact in no valid zone uses the window's zone", async () => {
  const w = harness();
  w.contact(1, { timezone: "Not/AZone" });
  const { campaignId } = await build(w, { windows: { days: [1, 2, 3, 4, 5], from: "11:00", to: "12:00", tz: "UTC" } });
  await launch(w, campaignId);
  assert.equal(w.mail.length, 0, "10:00 UTC is before the 11:00 window");
  assert.equal(w.db.rows("campaigns_member")[0]!.due_at, NOW + HOUR);
  w.advance(HOUR);
  await pass(w, campaignId);
  assert.equal(w.mail.length, 1);
});

test("throttle: at most N emails an hour per sending domain, counted across campaigns; the rest wait for the hour to pass", async () => {
  const w = harness();
  for (let n = 1; n <= 10; n++) w.contact(n);
  const { campaignId } = await build(w, { throttle: 3 });
  await launch(w, campaignId);
  assert.equal(w.mail.length, 3);
  assert.deepEqual(w.scheduled.map((s) => s.at), [NOW + HOUR]);
  w.advance(30 * MINUTE);
  await pass(w, campaignId);
  assert.equal(w.mail.length, 3, "still inside the hour");
  w.advance(31 * MINUTE);
  await pass(w, campaignId);
  assert.equal(w.mail.length, 6);
  const per = (domainHour: number): number => w.db.rows("campaigns_send").filter((s) => Number(s.at) > domainHour).length;
  assert.ok(per(w.now() - HOUR) <= 3);
  w.advance(HOUR);
  await pass(w, campaignId);
  w.advance(HOUR);
  await pass(w, campaignId);
  assert.equal(w.mail.length, 10);
  assert.equal(await stateOf(w, campaignId), "completed");

  const w2 = harness();
  for (let n = 1; n <= 8; n++) w2.contact(n);
  const a = await build(w2, { throttle: 5, name: "First" });
  await run(w2.ctx, "campaigns.audience_set", { campaignId: a.campaignId, type: "contact" });
  const first = await run<{ count: number }>(w2.ctx, "campaigns.audience_set", { campaignId: a.campaignId, type: "contact" });
  assert.equal(first.count, 8);
  // a second campaign shares the sending domain and so the hour
  const b = await build(w2, { throttle: 5, name: "Second", audience: false });
  for (let n = 11; n <= 18; n++) w2.contact(n);
  await run(w2.ctx, "campaigns.audience_set", { campaignId: b.campaignId, type: "contact" });
  await run(w2.ctx, "campaigns.launch", { campaignId: a.campaignId });
  assert.equal(w2.mail.length, 5);
  await run(w2.ctx, "campaigns.launch", { campaignId: b.campaignId });
  assert.equal(w2.mail.length, 5, "the hour is already used up by the first campaign");
});

test("the hourly throttle is per sending domain: another domain is not held back", async () => {
  const w = harness();
  for (let n = 1; n <= 4; n++) w.contact(n);
  const { campaignId } = await build(w, { throttle: 2, steps: [email("a"), { key: "b", type: "email", config: { mailboxId: "mbx_other", subject: "O", text: "x" } }] });
  await launch(w, campaignId);
  assert.equal(w.mail.filter((m) => m.input.mailboxId === "mbx_sales").length, 2);
  await pass(w, campaignId);
  assert.equal(w.mail.filter((m) => m.input.mailboxId === "mbx_other").length, 2, "other.example has its own hour");
});

test("warmup caps a new mailbox per day, ramps by the day, halves when slowed, and releases a ready mailbox", async () => {
  const w = harness();
  for (let n = 1; n <= 8; n++) w.contact(n);
  assert.deepEqual(await run(w.ctx, "warmup.start", { mailboxId: "mbx_sales" }), { ok: true });
  assert.deepEqual(await run(w.ctx, "warmup.start", { mailboxId: "mbx_sales" }), { ok: true });
  assert.equal(await code(run(w.ctx, "warmup.start", { mailboxId: "mbx_nope" })), "validation.not_found");
  assert.deepEqual((await run<{ mailboxes: unknown[] }>(w.ctx, "warmup.status", {})).mailboxes, [{ mailboxId: "mbx_sales", stage: "new", dailyCap: 5, bounceRate: 0, replyRate: 0 }]);
  const { campaignId } = await build(w);
  await launch(w, campaignId);
  assert.equal(w.mail.length, 5, "day one allows five");
  w.advance(DAY + MINUTE);
  await pass(w, campaignId);
  assert.equal(w.mail.length, 8);
  const status = (await run<{ mailboxes: { stage: string; dailyCap: number }[] }>(w.ctx, "warmup.status", {})).mailboxes[0]!;
  assert.deepEqual([status.stage, status.dailyCap], ["warming", 10]);

  assert.equal(recordWarmupHealth(w.ctx, "mbx_sales", { bounceRate: 0.08, replyRate: 0.1, spamRate: 0 }), "slowed");
  assert.deepEqual(w.ofName("warmup.slowed").map((e) => [e.subject, e.payload]), [["mailbox/mbx_sales", { mailboxId: "mbx_sales", reason: "bounce rate 8.0 percent" }]]);
  assert.equal(recordWarmupHealth(w.ctx, "mbx_sales", { bounceRate: 0.09, replyRate: 0.1, spamRate: 0 }), "unchanged");
  assert.equal(w.ofName("warmup.slowed").length, 1, "announced once");
  const slowed = (await run<{ mailboxes: { stage: string; dailyCap: number; bounceRate: number; replyRate: number }[] }>(w.ctx, "warmup.status", {})).mailboxes[0]!;
  assert.deepEqual([slowed.stage, slowed.dailyCap, slowed.bounceRate, slowed.replyRate], ["slowed", 5, 0.09, 0.1]);
  assert.equal(recordWarmupHealth(w.ctx, "mbx_sales", { bounceRate: 0.04, replyRate: 0.1, spamRate: 0 }), "unchanged", "not yet under half the limit");
  assert.equal(recordWarmupHealth(w.ctx, "mbx_sales", { bounceRate: 0.01, replyRate: 0.1, spamRate: 0 }), "released");
  assert.equal((await run<{ mailboxes: { stage: string }[] }>(w.ctx, "warmup.status", {})).mailboxes[0]!.stage, "warming");
  assert.equal(recordWarmupHealth(w.ctx, "mbx_sales", { bounceRate: 0, replyRate: 0, spamRate: 0.01 }), "slowed", "spam placement slows too");
  assert.equal(recordWarmupHealth(w.ctx, "mbx_nope", { bounceRate: 1, replyRate: 0, spamRate: 0 }), "unchanged");

  w.advance(14 * DAY);
  const ready = (await run<{ mailboxes: { stage: string; dailyCap: number }[] }>(w.ctx, "warmup.status", {})).mailboxes[0]!;
  assert.equal(ready.stage, "slowed", "a slowed mailbox stays slowed until its health recovers");
  recordWarmupHealth(w.ctx, "mbx_sales", { bounceRate: 0, replyRate: 0.2, spamRate: 0 });
  assert.deepEqual((await run<{ mailboxes: { stage: string; dailyCap: number }[] }>(w.ctx, "warmup.status", {})).mailboxes.map((m) => [m.stage, m.dailyCap]), [["ready", 250]]);
});

test("the warmup pool is off until someone opts in", async () => {
  const w = harness();
  assert.equal(poolOptedIn(w.ctx), false);
  assert.deepEqual(await run(w.ctx, "warmup.pool_optin_set", { optIn: true }), { optIn: true });
  assert.equal(poolOptedIn(w.ctx), true);
  assert.deepEqual(await run(w.ctx, "warmup.pool_optin_set", { optIn: false }), { optIn: false });
  assert.equal(poolOptedIn(w.ctx), false);
  assert.equal(await code(run(w.ctx, "warmup.pool_optin_set", { optIn: "yes" })), "validation.bad_input");
});

// ---- sequences, branches, tasks, SMS -----------------------------------------------------------------------------------

test("a sequence waits between emails and completes after the last one", async () => {
  const w = harness();
  w.contact(1);
  w.contact(2);
  const { campaignId } = await build(w, { steps: [email("one", "First"), wait("gap", { hours: 2 }), email("two", "Second")] });
  await launch(w, campaignId);
  assert.deepEqual(w.mail.map((m) => m.input.subject), ["First", "First"]);
  const r1 = await pass(w, campaignId);
  assert.equal(r1.sent, 0, "this pass only starts the wait");
  assert.equal(r1.nextAt, NOW + 2 * HOUR);
  w.advance(2 * HOUR - MINUTE);
  await pass(w, campaignId);
  assert.equal(w.mail.length, 2);
  w.advance(MINUTE);
  await pass(w, campaignId);
  assert.deepEqual(w.mail.map((m) => m.input.subject), ["First", "First", "Second", "Second"]);
  assert.equal(await stateOf(w, campaignId), "completed");
  assert.equal(w.ofName("campaign.completed").length, 1);
  assert.equal((await stats(w, campaignId)).sent, 4);
  await pass(w, campaignId);
  assert.equal(w.ofName("campaign.completed").length, 1, "a finished campaign is left alone");
});

test("a branch on open sends thanks to those who opened and a text nudge to those who did not", async () => {
  const w = harness();
  w.contact(1);
  w.contact(2, { phone: "+15550102" });
  const steps = [
    email("first", "Hello"), wait("gap", { days: 1 }), { key: "check", type: "branch", config: { on: "open" }, next: ["thanks", "nudge"] },
    { ...email("thanks", "Thanks for reading"), next: [] }, { key: "nudge", type: "sms", config: { numberId: "num_1", body: "Did you see my note, {{first_name}}?" } },
  ];
  const { campaignId } = await build(w, { steps });
  await launch(w, campaignId);
  await pass(w, campaignId);
  deliver(w, "message.opened", { messageId: w.mail[0]!.messageId });
  assert.equal(w.db.rows("campaigns_member").find((m) => m.record_id === "rec_c001")!.opened, 1);
  w.advance(DAY);
  await pass(w, campaignId);
  assert.deepEqual(w.mail.map((m) => m.input.subject), ["Hello", "Hello", "Thanks for reading"]);
  assert.equal(w.mail[2]!.input.contactId, "rec_c001");
  assert.equal(w.sms.length, 1);
  const { idempotencyKey: smsKey, ...sms0 } = w.sms[0] as Record<string, unknown>;
  assert.match(String(smsKey), new RegExp(`^campaign:${campaignId}:mem_[0-9a-f]+:nudge:sms$`));
  assert.deepEqual(sms0, { numberId: "num_1", to: "+15550102", body: "Did you see my note, Person? Reply STOP to opt out.", contactId: "rec_c002", campaignId });
  assert.equal(await stateOf(w, campaignId), "completed");
});

test("a branch on click follows the click, and a branch on reply follows a reply when stop on reply is off", async () => {
  const w = harness();
  w.contact(1);
  w.contact(2);
  const steps = [
    email("first", "Hello"), wait("gap", { hours: 1 }), { key: "c", type: "branch", config: { on: "click" }, next: ["clicked", "quiet"] },
    { ...email("clicked", "You clicked"), next: [] }, { ...email("quiet", "No click"), next: [] },
  ];
  const { campaignId } = await build(w, { steps });
  await launch(w, campaignId);
  await pass(w, campaignId);
  deliver(w, "message.clicked", { messageId: w.mail[1]!.messageId, url: "https://harbor.example" });
  w.advance(HOUR);
  await pass(w, campaignId);
  assert.deepEqual(w.mail.slice(2).map((m) => [m.input.contactId, m.input.subject]), [["rec_c001", "No click"], ["rec_c002", "You clicked"]]);

  const w2 = harness();
  w2.contact(1);
  const reply = await build(w2, { stopOnReply: false, steps: [email("a", "A"), wait("g", { hours: 1 }), { key: "r", type: "branch", config: { on: "reply" }, next: ["thanks", "nope"] }, { ...email("thanks", "Thanks for replying"), next: [] }, { ...email("nope", "No reply"), next: [] }] });
  await launch(w2, reply.campaignId);
  await pass(w2, reply.campaignId);
  deliver(w2, "mail.received", { messageId: "eml_9001", mailboxId: "mbx_sales", from: "p1@client.example", subject: "Re: A", contactId: "rec_c001", campaignId: reply.campaignId });
  w2.advance(HOUR);
  await pass(w2, reply.campaignId);
  assert.equal(w2.mail.at(-1)!.input.subject, "Thanks for replying");
});

test("task and call task steps open tasks for the contact; the owner is the default assignee", async () => {
  const w = harness();
  w.contact(1);
  const steps = [email("a"), { key: "t", type: "task", config: { title: "Check in with {{name}}" } }, { key: "c", type: "call_task", config: { title: "Phone {{first_name}}", assigned: { kind: "person", id: "usr_closer" } } }];
  const { campaignId } = await build(w, { steps });
  await launch(w, campaignId);
  await pass(w, campaignId);
  assert.deepEqual(w.tasks.map((t) => String((t as Record<string, unknown>).idempotencyKey).replace(/:mem_[0-9a-f]+:/, ":MEM:")), [`campaign:${campaignId}:MEM:t:task`, `campaign:${campaignId}:MEM:c:task`]);
  assert.deepEqual(w.tasks.map((t) => { const { idempotencyKey: _k, ...rest } = t as Record<string, unknown>; return rest; }), [
    { title: "Check in with Person 1", assigned: { kind: "person", id: "usr_owner" }, recordId: "rec_c001", source: { kind: "manual", id: campaignId } },
    { title: "Call: Phone Person", assigned: { kind: "person", id: "usr_closer" }, recordId: "rec_c001", source: { kind: "manual", id: campaignId } },
  ]);
  assert.equal(await stateOf(w, campaignId), "completed");
});

test("an SMS step needs a phone number: contacts without one fail quietly, the rest are texted", async () => {
  const w = harness();
  w.contact(1);
  w.contact(2, { phone: "+15550102" });
  const { campaignId } = await build(w, { steps: [{ key: "t", type: "sms", config: { numberId: "num_1", body: "Reply STOP anytime. Hi {{first_name}}" } }] });
  await launch(w, campaignId);
  assert.equal(w.sms.length, 1);
  assert.equal(w.sms[0]!.body, "Reply STOP anytime. Hi Person", "the opt-out line is not added twice");
  assert.deepEqual(w.db.rows("campaigns_member").map((m) => [m.record_id, m.state]).sort(), [["rec_c001", "failed"], ["rec_c002", "completed"]]);
});

test("A/B variants: each contact gets the wording of its own variant", async () => {
  const w = harness();
  for (let n = 1; n <= 30; n++) w.contact(n);
  const { campaignId } = await build(w, { audience: true });
  await run(w.ctx, "campaigns.variants_set", { campaignId, variants: [{ key: "a", weight: 1, stepKey: "hello", config: { subject: "A for {{first_name}}" } }, { key: "b", weight: 1, stepKey: "hello", config: { subject: "B for {{first_name}}" } }] });
  await launch(w, campaignId);
  const variantOf = Object.fromEntries(w.db.rows("campaigns_member").map((m) => [String(m.record_id), String(m.variant)]));
  assert.equal(w.mail.length, 30);
  for (const m of w.mail) assert.equal(m.input.subject, `${variantOf[String(m.input.contactId)]!.toUpperCase()} for Person`);
  assert.ok(new Set(Object.values(variantOf)).size === 2);
});

// ---- replies, unsubscribe, suppression ---------------------------------------------------------------------------------

test("stop on reply: a contact who replies gets nothing more, the reply is announced once, and it shows in replies and stats", async () => {
  const w = harness();
  w.contact(1);
  w.contact(2);
  const { campaignId } = await build(w, { steps: [email("one", "First"), wait("gap", { days: 1 }), email("two", "Second")] });
  await launch(w, campaignId);
  await pass(w, campaignId);
  deliver(w, "mail.received", { messageId: "eml_9001", mailboxId: "mbx_sales", from: "p1@client.example", subject: "Re: First", contactId: "rec_c001", campaignId });
  deliver(w, "mail.received", { messageId: "eml_9001", mailboxId: "mbx_sales", from: "p1@client.example", subject: "Re: First", contactId: "rec_c001", campaignId });
  deliver(w, "mail.received", { messageId: "eml_9100", mailboxId: "mbx_sales", from: "x@else.example", subject: "Other", contactId: "rec_c001", campaignId: "cmp_other" });
  w.advance(DAY);
  await pass(w, campaignId);
  assert.deepEqual(w.mail.map((m) => [m.input.contactId, m.input.subject]), [["rec_c001", "First"], ["rec_c002", "First"], ["rec_c002", "Second"]]);
  assert.deepEqual(w.db.rows("campaigns_member").map((m) => [m.record_id, m.state]), [["rec_c001", "replied"], ["rec_c002", "completed"]]);
  assert.deepEqual(w.ofName("campaign.replied").map((e) => e.payload), [{ campaignId, recordId: "rec_c001", messageId: "eml_9001" }]);
  await pass(w, campaignId);
  assert.equal(w.ofName("campaign.replied").length, 1);
  const list = await run<{ replies: { recordId: string; messageId: string; at: number }[]; total: number }>(w.ctx, "campaigns.replies", { campaignId });
  assert.deepEqual(list.replies.map((r) => [r.recordId, r.messageId]), [["rec_c001", "eml_9001"]]);
  assert.equal(list.total, 1);
  assert.equal((await stats(w, campaignId)).replied, 1);
  assert.equal((await run<{ campaign: { replies: number } }>(w.ctx, "campaigns.get", { campaignId })).campaign.replies, 1);
});

test("with stop on reply off, a reply is recorded but the sequence goes on", async () => {
  const w = harness();
  w.contact(1);
  const { campaignId } = await build(w, { stopOnReply: false, steps: [email("one", "First"), wait("gap", { days: 1 }), email("two", "Second")] });
  await launch(w, campaignId);
  await pass(w, campaignId);
  deliver(w, "mail.received", { messageId: "eml_9001", mailboxId: "mbx_sales", from: "p1@client.example", subject: "Re", contactId: "rec_c001", campaignId });
  w.advance(DAY);
  await pass(w, campaignId);
  assert.deepEqual(w.mail.map((m) => m.input.subject), ["First", "Second"]);
  assert.equal(w.ofName("campaign.replied").length, 1);
});

test("an SMS reply counts too, using the conversation as its reference", async () => {
  const w = harness();
  w.contact(1, { phone: "+15550101" });
  const { campaignId } = await build(w, { steps: [{ key: "t", type: "sms", config: { numberId: "num_1", body: "Hi" } }, wait("g", { days: 1 }), email("later")] });
  await launch(w, campaignId);
  deliver(w, "conversation.campaign_reply", { conversationId: "cnv_77", contactId: "rec_c001", campaignId, channel: "sms" });
  deliver(w, "conversation.campaign_reply", { conversationId: "cnv_78", contactId: "rec_c001", campaignId, channel: "email" });
  w.advance(DAY);
  await pass(w, campaignId);
  assert.equal(w.mail.length, 0, "stopped by the text reply");
  assert.deepEqual(w.ofName("campaign.replied").map((e) => (e.payload as { messageId: string }).messageId), ["eml_77"]);
});

test("unsubscribe: the link in the email puts the address on the suppression list, ends the contact in every campaign, and announces it once", async () => {
  const w = harness();
  w.contact(1);
  w.contact(2);
  const one = await build(w, { name: "One shot" });
  const two = await build(w, { name: "Follow ups", steps: [email("a", "A"), wait("g", { days: 1 }), email("b", "B")] });
  await launch(w, one.campaignId);
  await launch(w, two.campaignId);
  await pass(w, two.campaignId);
  const token = unsubscribeToken(String(w.mail[0]!.input.text));
  assert.equal(w.mail[0]!.input.contactId, "rec_c001");
  assert.deepEqual(await run(w.ctx, "campaigns.unsubscribe", { token }), { ok: true });
  assert.deepEqual(w.optouts, [{ channel: "email", address: "p1@client.example", keyword: "UNSUBSCRIBE", source: "link", at: NOW }]);
  assert.deepEqual(w.ofName("campaign.unsubscribed").map((e) => e.payload), [{ campaignId: one.campaignId, recordId: "rec_c001" }]);
  assert.deepEqual(await run(w.ctx, "campaigns.unsubscribe", { token }), { ok: true });
  assert.equal(w.ofName("campaign.unsubscribed").length, 1);
  assert.equal(w.optouts.length, 1);
  const states = w.db.rows("campaigns_member").filter((m) => m.record_id === "rec_c001").map((m) => m.state);
  assert.deepEqual(states, ["unsubscribed", "unsubscribed"]);
  assert.equal((await stats(w, one.campaignId)).unsubscribed, 1);
  w.advance(DAY + HOUR);
  await pass(w, two.campaignId);
  assert.deepEqual(w.mail.filter((m) => m.input.subject === "B").map((m) => m.input.contactId), ["rec_c002"], "only the contact who stayed gets the follow up");
  for (const bad of ["nonsense", "x".repeat(300)]) assert.equal(await code(run(w.ctx, "campaigns.unsubscribe", { token: bad })), "auth.invalid_code");
});

test("every email carries its own unsubscribe link, and an HTML body gets an HTML link", async () => {
  const w = harness();
  w.contact(1);
  w.contact(2);
  const { campaignId } = await build(w, { steps: [{ key: "h", type: "email", config: { mailboxId: "mbx_sales", subject: "S", html: "<p>Hello {{first_name}}</p>" } }] });
  await launch(w, campaignId);
  const [a, b] = w.mail.map((m) => m.input);
  assert.match(String(a!.html), /^<p>Hello Person<\/p><p style="font-size:12px;color:#666"><a href="https:\/\/harbor\.example\/u\/[A-Za-z0-9_-]+">Unsubscribe<\/a><\/p>$/);
  assert.match(String(a!.text), /^Hello Person\n\nTo stop these emails: https:\/\/harbor\.example\/u\/[A-Za-z0-9_-]+$/);
  assert.notEqual(/\/u\/([A-Za-z0-9_-]+)/.exec(String(a!.html))![1], /\/u\/([A-Za-z0-9_-]+)/.exec(String(b!.html))![1]);
  assert.equal(w.db.rows("campaigns_unsub").length, 2);
  for (const row of w.db.rows("campaigns_unsub")) assert.match(String(row.token_hash), /^[0-9a-f]{64}$/, "only a hash of each token is kept");
});

test("a send the single send API refuses as suppressed ends that contact without counting as sent", async () => {
  const w = harness();
  w.contact(1);
  w.contact(2);
  w.state.mailStatus = (i) => ((i.to as { address: string }[])[0]!.address === "p1@client.example" ? "suppressed" : "sent");
  const { campaignId } = await build(w);
  await launch(w, campaignId);
  assert.deepEqual(w.db.rows("campaigns_member").map((m) => [m.record_id, m.state]), [["rec_c001", "suppressed"], ["rec_c002", "completed"]]);
  assert.equal((await stats(w, campaignId)).sent, 1);
});

test("a send that fails for a reason that may pass is tried again in 15 minutes; one that cannot succeed ends that contact", async () => {
  const w = harness();
  w.contact(1);
  w.contact(2);
  let busy = true;
  const e = (code: "rate_limit.exceeded" | "provider.auth_failed", retryable: boolean) => new VyreErr({ code, message: "x", retryable, traceId: "0123456789abcdef0123456789abcdef", next: [{ kind: "wait", label: "Wait" }] });
  w.state.mailFail = (i) => ((i.to as { address: string }[])[0]!.address === "p1@client.example" ? (busy ? e("rate_limit.exceeded", true) : null) : e("provider.auth_failed", false));
  const { campaignId } = await build(w);
  await launch(w, campaignId);
  const byRecord = () => Object.fromEntries(w.db.rows("campaigns_member").map((m) => [String(m.record_id), m]));
  assert.equal(byRecord().rec_c001!.state, "active");
  assert.equal(byRecord().rec_c001!.due_at, NOW + 15 * MINUTE);
  assert.equal(byRecord().rec_c002!.state, "failed");
  assert.ok(w.warnings.some((x) => x.includes("failed for good")));
  busy = false;
  w.advance(15 * MINUTE);
  await pass(w, campaignId);
  assert.equal(byRecord().rec_c001!.state, "completed");
  assert.equal(w.mail.length, 1);
});

// ---- guard, pause, resume, stop --------------------------------------------------------------------------------------

test("the bounce guard pauses a campaign whose sends bounce or draw complaints", async () => {
  const w = harness();
  for (let n = 1; n <= 25; n++) w.contact(n);
  const { campaignId } = await build(w, { steps: [email("one"), wait("gap", { days: 1 }), email("two")] });
  await launch(w, campaignId);
  assert.equal(w.mail.length, 25);
  deliver(w, "message.delivered", { messageId: w.mail[2]!.messageId, channel: "email" });
  deliver(w, "message.bounced", { messageId: w.mail[0]!.messageId, channel: "email", address: "p1@client.example", kind: "hard" });
  deliver(w, "message.complained", { messageId: w.mail[1]!.messageId, channel: "email", address: "p2@client.example" });
  deliver(w, "message.delivered", { messageId: w.mail[1]!.messageId, channel: "email" });
  assert.deepEqual(await stats(w, campaignId), { sent: 25, delivered: 2, bounced: 1, complained: 1, replied: 0, unsubscribed: 0 });
  w.advance(HOUR);
  await pass(w, campaignId);
  assert.equal(await stateOf(w, campaignId), "paused");
  assert.deepEqual(w.ofName("campaign.paused").map((e) => e.payload), [{ campaignId, reason: "2 of 25 sends bounced or drew complaints" }]);
  w.advance(DAY);
  await pass(w, campaignId);
  assert.equal(w.mail.length, 25, "nothing more goes out");
});

test("a few bounces on a big enough campaign do not pause it, and a small campaign is never judged on two sends", async () => {
  const w = harness();
  for (let n = 1; n <= 25; n++) w.contact(n);
  const { campaignId } = await build(w, { steps: [email("one"), wait("gap", { days: 1 }), email("two")] });
  await launch(w, campaignId);
  await pass(w, campaignId);
  deliver(w, "message.bounced", { messageId: w.mail[0]!.messageId, channel: "email", address: "p1@client.example", kind: "soft" });
  w.advance(DAY);
  await pass(w, campaignId);
  assert.equal(await stateOf(w, campaignId), "completed");
  assert.equal(w.mail.length, 50);
  const small = harness();
  small.contact(1);
  small.contact(2);
  const s = await build(small, { steps: [email("one"), wait("gap", { days: 1 }), email("two")] });
  await launch(small, s.campaignId);
  await pass(small, s.campaignId);
  deliver(small, "message.bounced", { messageId: small.mail[0]!.messageId, channel: "email", address: "p1@client.example", kind: "hard" });
  small.advance(DAY);
  await pass(small, s.campaignId);
  assert.equal(await stateOf(small, s.campaignId), "completed");
  assert.equal(small.mail.length, 4);
});

test("pause, resume and stop", async () => {
  const w = harness();
  for (let n = 1; n <= 3; n++) w.contact(n);
  const { campaignId } = await build(w, { throttle: 1 });
  await launch(w, campaignId);
  assert.equal(w.mail.length, 1);
  const paused = await run<{ campaign: Row }>(w.ctx, "campaigns.pause", { campaignId, reason: "Legal wants to read it first" });
  assert.equal(paused.campaign.state, "paused");
  assert.deepEqual(w.ofName("campaign.paused").map((e) => e.payload), [{ campaignId, reason: "Legal wants to read it first" }]);
  assert.equal(await code(run(w.ctx, "campaigns.pause", { campaignId })), "validation.precondition_failed", "already paused");
  w.advance(2 * HOUR);
  assert.deepEqual(await pass(w, campaignId), { sent: 0, nextAt: null });
  assert.equal(w.mail.length, 1);
  const resumed = await run<{ campaign: Row }>(w.ctx, "campaigns.resume", { campaignId });
  assert.equal(resumed.campaign.state, "running");
  assert.equal(w.mail.length, 2, "the throttle lets one more through");
  const stopped = await run<{ campaign: Row }>(w.ctx, "campaigns.stop", { campaignId });
  assert.equal(stopped.campaign.state, "stopped");
  assert.deepEqual(w.db.rows("campaigns_member").map((m) => m.state).sort(), ["completed", "completed", "stopped"]);
  w.advance(2 * HOUR);
  await pass(w, campaignId);
  const again = await run<{ campaign: Row }>(w.ctx, "campaigns.resume", { campaignId });
  assert.equal(again.campaign.state, "stopped", "a stopped campaign stays stopped; a late tick is harmless");
  assert.equal(w.mail.length, 2);
  assert.deepEqual((await run<{ campaign: Row }>(w.ctx, "campaigns.stop", { campaignId })).campaign.state, "stopped");
  assert.equal(await code(run(w.ctx, "campaigns.audience_set", { campaignId, type: "contact" })), "validation.precondition_failed");
  const draft = await build(w);
  for (const cap of ["campaigns.pause", "campaigns.resume", "campaigns.stop"] as const) assert.equal(await code(run(w.ctx, cap, { campaignId: draft.campaignId })), "validation.precondition_failed", cap);
});

test("a scheduled tick for a running campaign runs a pass and wakes again for the next contact", async () => {
  const w = harness();
  for (let n = 1; n <= 2; n++) w.contact(n);
  const { campaignId } = await build(w, { steps: [email("one"), wait("gap", { days: 1 }), email("two")] });
  await launch(w, campaignId);
  assert.deepEqual(w.scheduled.map((s) => s.at), [NOW + MINUTE], "contacts that just sent are due for their wait step at once");
  w.advance(MINUTE);
  await run(w.ctx, "campaigns.resume", { campaignId });
  assert.equal(w.scheduled.at(-1)!.at, NOW + MINUTE + DAY);
  w.advance(DAY);
  await run(w.ctx, "campaigns.resume", { campaignId });
  assert.equal(w.mail.length, 4);
  assert.equal(await stateOf(w, campaignId), "completed");
});

// ---- triggered ----------------------------------------------------------------------------------------------------------

test("triggered: a new record of the named type enrols its contact, who is screened before anything is sent", async () => {
  const w = harness();
  const { campaignId } = await build(w, { kind: "triggered", audience: false });
  await run(w.ctx, "campaigns.update", { campaignId, settings: { trigger: { type: "contact", event: "record.created" } } });
  await launch(w, campaignId);
  assert.equal(await stateOf(w, campaignId), "running");
  assert.equal(w.mail.length, 0);
  const id1 = w.contact(1);
  const id2 = w.contact(2);
  w.addRecord({ id: "rec_co1", type: "company", fields: { email: "info@co.example" } });
  w.state.dndRefused.add(id2);
  deliver(w, "record.created", { recordId: id1, type: "contact" });
  deliver(w, "record.created", { recordId: id1, type: "contact" });
  deliver(w, "record.created", { recordId: id2, type: "contact" });
  deliver(w, "record.created", { recordId: "rec_co1", type: "company" });
  deliver(w, "record.updated", { recordId: "rec_c001", type: "contact" });
  assert.deepEqual(w.db.rows("campaigns_member").map((m) => [m.record_id, m.state]), [["rec_c001", "screening"], ["rec_c002", "screening"]]);
  assert.equal(w.mail.length, 0, "nothing goes out before the next pass screens them");
  w.advance(MINUTE);
  await pass(w, campaignId);
  assert.deepEqual(w.db.rows("campaigns_member").map((m) => [m.record_id, m.state]), [["rec_c001", "completed"], ["rec_c002", "suppressed"]]);
  assert.deepEqual(w.mail.map((m) => m.input.contactId), ["rec_c001"]);
  const dnd = w.calls.filter((c) => c.cap === "contacts.dnd_screen").at(-1)!.input;
  assert.equal(dnd.context, "campaign");
  assert.equal(await stateOf(w, campaignId), "running", "a triggered campaign keeps waiting for the next record");
  assert.ok(Number(w.scheduled.at(-1)!.at) <= w.now() + 15 * MINUTE + MINUTE);
});

test("triggered: a campaign that is not running, or listens for another event, enrols nobody", async () => {
  const w = harness();
  const { campaignId } = await build(w, { kind: "triggered", audience: false });
  await run(w.ctx, "campaigns.update", { campaignId, settings: { trigger: { type: "contact", event: "record.updated" } } });
  w.contact(1);
  deliver(w, "record.created", { recordId: "rec_c001", type: "contact" });
  assert.equal(w.db.rows("campaigns_member").length, 0, "still a draft");
  await launch(w, campaignId);
  deliver(w, "record.created", { recordId: "rec_c001", type: "contact" });
  assert.equal(w.db.rows("campaigns_member").length, 0, "this one listens for updates");
  deliver(w, "record.updated", { recordId: "rec_c001", type: "contact" });
  assert.equal(w.db.rows("campaigns_member").length, 1);
});

test("consumers ignore events that are not about a campaign they know", async () => {
  const w = harness();
  w.contact(1);
  const { campaignId } = await build(w);
  deliver(w, "mail.received", { messageId: "eml_1", mailboxId: "mbx_sales", from: "a@b.example", subject: "x" });
  deliver(w, "mail.received", { messageId: "eml_2", mailboxId: "mbx_sales", from: "a@b.example", subject: "x", contactId: "rec_nobody", campaignId });
  deliver(w, "message.delivered", { messageId: "eml_unknown", channel: "email" });
  deliver(w, "message.opened", { messageId: "eml_unknown" });
  deliver(w, "record.created", { recordId: 5, type: "contact" });
  assert.equal(w.db.rows("campaigns_member")[0]!.replied_at, null);
  assert.equal(w.db.rows("campaigns_reply").length, 1, "the reply row is kept, but no member is marked");
});
