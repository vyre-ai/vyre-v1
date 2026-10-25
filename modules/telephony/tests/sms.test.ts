// Texts (P-L5_07; spec 2.18 Sending, Single send API; 2.19): telephony.send_sms is the SMS half of the single send API. It honors the suppression list, SMS consent, send windows and caps like mail.send;
// inbound texts land in the contact's conversation and STOP suppresses the sender; status callbacks move a text to delivered, undelivered or failed. Twilio, contacts and inbox are scripted capabilities.
// @reads /modules/telephony/migrations/0001_telephony.sql
// @reads /modules/telephony/handlers/sms.ts
// @reads /modules/telephony/handlers/ingest.ts
import test from "node:test";
import assert from "node:assert/strict";
import * as h from "../handlers/index.ts";
import { AGENT, CALLER, MAYA, NOW, NUM_E164, SMS_SID, contractErrors, eventErrors, harness, refusedWith } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";

const PAT = "rec_pat00001";
const DAY = 86_400_000;
type Json = Record<string, unknown>;
const out = (v: unknown): Json => v as Json;
let seq = 0;
const sid = (k: number): string => `SM${String(k).padStart(32, "0")}`;

async function setup(t: Harness, o: { consent?: string } = {}): Promise<string> {
  t.contacts.set(CALLER, PAT);
  t.prefs.set(PAT, { smsConsent: o.consent ?? "granted" });
  const made = out(out(await h.numberBuy(t.ctx, { e164: NUM_E164, title: "Main line", assigneeKind: "person", assigneeId: MAYA, idempotencyKey: "k-buy" })).number);
  return String(made.id);
}

const send = (t: Harness, numberId: string, o: Json = {}) =>
  h.sendSms(t.ctx, { numberId, to: CALLER, body: "Your appointment is Friday at 3.", idempotencyKey: `k-sms-${++seq}`, ...o } as Parameters<typeof h.sendSms>[1]);
const sms = (t: Harness) => t.rows(`SELECT * FROM telephony_sms`);

test("send_sms sends through Twilio, keeps the text, writes it to the contact's conversation and a delivered callback moves it on", async () => {
  const t = harness();
  const numberId = await setup(t);
  const sent = out(await send(t, numberId, { idempotencyKey: "k-first" }));
  assert.deepEqual(contractErrors("telephony.send_sms", "out", sent), []);
  assert.equal(sent.status, "queued");
  assert.deepEqual(t.calls("twilio.sms.send")[0]?.input, { from: NUM_E164, to: CALLER, body: "Your appointment is Friday at 3.", idempotencyKey: "k-first:send" });
  const row = sms(t)[0] ?? {};
  assert.deepEqual([row.id, row.direction, row.from, row.to, row.status, row.contactId, row.twilioSid, row.at], [sent.smsId, "out", NUM_E164, CALLER, "queued", PAT, SMS_SID, NOW]);
  assert.deepEqual(t.named("message.sent")[0]?.payload, { messageId: sent.smsId, channel: "sms", contactId: PAT });
  assert.deepEqual(t.calls("inbox.link_message")[0]?.input, { channel: "sms", ref: { kind: "sms", id: sent.smsId }, address: CALLER, direction: "out", at: NOW, numberId, preview: "Your appointment is Friday at 3." });
  assert.equal(t.rows(`SELECT * FROM telephony_send_log`).length, 0, "a person's text is not counted against the caps");

  assert.deepEqual(await h.ingestStatus(t.ctx, { sid: SMS_SID, kind: "sms", status: "delivered", at: NOW + 5000 }), { applied: true });
  assert.equal(sms(t)[0]?.status, "delivered");
  assert.deepEqual(t.named("message.delivered")[0]?.payload, { messageId: sent.smsId, channel: "sms" });
  assert.deepEqual(await h.ingestStatus(t.ctx, { sid: SMS_SID, kind: "sms", status: "sent", at: NOW + 6000 }), { applied: true });
  assert.equal(sms(t)[0]?.status, "delivered", "a late sent does not undo delivered");
  assert.equal(t.named("message.delivered").length, 1);
  assert.deepEqual(await h.ingestStatus(t.ctx, { sid: "SM00000000000000000000000000000099", kind: "sms", status: "delivered", at: NOW }), { applied: false });
});

test("send_sms honors suppression, Do not contact, consent and opt-outs: the text is not sent and the refusal is recorded", async () => {
  const t = harness();
  const numberId = await setup(t);
  const refusedText = async (reason: string): Promise<void> => {
    const before = t.calls("twilio.sms.send").length;
    const got = out(await send(t, numberId));
    assert.deepEqual(got, { status: "suppressed" });
    assert.equal(t.calls("twilio.sms.send").length, before, "nothing reached Twilio");
    assert.equal(sms(t).length, 0, "no text was stored");
    assert.deepEqual(t.named("message.suppressed").at(-1)?.payload, { channel: "sms", address: CALLER, reason });
  };
  t.suppressed.set("sms", [{ address: CALLER, reason: "stop" }]);
  await refusedText("stop");
  t.suppressed.clear();
  t.prefs.set(PAT, { smsConsent: "granted", doNotContact: true });
  await refusedText("do_not_contact");
  t.prefs.set(PAT, { smsConsent: "denied" });
  await refusedText("consent_denied");
  t.prefs.set(PAT, { smsConsent: "granted", optedOut: ["sms"] });
  await refusedText("opted_out");
  t.prefs.set(PAT, { smsConsent: "unknown" });
  await refusedText("no_consent");
  t.prefs.clear();
  await refusedText("no_consent");
  // a number with no contact has no consent on file
  const stranger = out(await send(t, numberId, { to: "+14155550166" }));
  assert.equal(stranger.status, "suppressed");
  assert.equal(t.named("message.suppressed").at(-1)?.payload.address, "+14155550166");
  for (const e of t.named("message.suppressed")) assert.deepEqual(eventErrors("message.suppressed", e.payload), []);

  // the Space can turn the consent requirement off; the other refusals stay
  t.settings.set("contacts.sms_requires_consent", false);
  assert.equal(out(await send(t, numberId)).status, "queued");
  t.suppressed.set("sms", [{ address: CALLER, reason: "manual" }]);
  assert.equal(out(await send(t, numberId)).status, "suppressed", "the suppression list still applies");
  assert.deepEqual(t.named("message.suppressed").at(-1)?.payload, { channel: "sms", address: CALLER, reason: "manual" });
});

test("a reply to a text they sent counts as consent for that conversation, a reply to someone else's does not", async () => {
  const t = harness();
  const numberId = await setup(t, { consent: "unknown" });
  const inbound = out(await h.ingestSms(t.ctx, { messageSid: "SM00000000000000000000000000000020", from: CALLER, to: NUM_E164, body: "Can you call me?", at: NOW }));
  const reply = out(await send(t, numberId, { body: "Calling you now.", replyToId: inbound.smsId }));
  assert.equal(reply.status, "queued");
  assert.equal(await refusedWith(send(t, numberId, { replyToId: "sms_nope" })), "validation.not_found");
  const other = out(await send(t, numberId, { to: "+14155550166", replyToId: inbound.smsId }));
  assert.equal(other.status, "suppressed", "the reply answers a different number");
  const sentOut = out(await send(t, numberId, { replyToId: reply.smsId }));
  assert.equal(sentOut.status, "suppressed", "replying to our own text is not consent");
});

test("send windows and caps apply to agents, automations and campaigns, not to a person typing a text", async () => {
  const t = harness();
  const numberId = await setup(t);
  t.actAs("agent", AGENT);
  // Thursday 08:53 UTC is inside the default window (Monday to Friday, 08:00 to 18:00)
  assert.equal(out(await send(t, numberId, { body: "Inside the window." })).status, "queued");
  assert.equal(t.rows(`SELECT * FROM telephony_send_log`).length, 1, "an agent's text is counted");

  // Saturday: the window is shut until Monday 08:00 UTC
  t.setNow(NOW + 2 * DAY);
  const monday = Date.UTC(2025, 9, 13, 8, 0, 0);
  const waiting = out(await send(t, numberId, { body: "Hold until Monday." }));
  assert.equal(waiting.status, "queued");
  assert.equal(t.calls("twilio.sms.send").length, 1, "nothing was sent on Saturday");
  assert.equal(t.scheduled.length, 1);
  const due = t.scheduled[0];
  assert.deepEqual([due?.at, due?.cap, due?.input.sendAt], [monday, "telephony.send_sms", monday]);
  assert.match(String(due?.input.idempotencyKey), /:due$/);
  const queued = sms(t).find((r) => r.id === waiting.smsId);
  assert.deepEqual([queued?.status, queued?.at], ["queued", monday]);

  // a person at the same moment is not made to wait
  t.actAs("person", MAYA);
  assert.equal(out(await send(t, numberId, { body: "A person texting." })).status, "queued");
  assert.equal(t.calls("twilio.sms.send").length, 2);
  // but a person who schedules a text for later is queued for that time
  const later = NOW + 2 * DAY + 3_600_000;
  const planned = out(await send(t, numberId, { body: "Later today.", sendAt: later }));
  assert.equal(planned.status, "queued");
  assert.deepEqual([t.scheduled[1]?.at, t.calls("twilio.sms.send").length], [later, 2]);

  // Monday 08:00: the scheduled call comes back and the same text is sent, not a second one
  t.actAs("agent", AGENT);
  t.setNow(monday);
  const delivered = out(await h.sendSms(t.ctx, due?.input as Parameters<typeof h.sendSms>[1]));
  assert.equal(delivered.smsId, waiting.smsId);
  assert.equal(t.calls("twilio.sms.send").length, 3);
  assert.equal(sms(t).filter((r) => r.body === "Hold until Monday.").length, 1, "one row for the text");
  assert.equal(sms(t).find((r) => r.id === waiting.smsId)?.twilioSid, SMS_SID);
  assert.equal(t.rows(`SELECT * FROM telephony_send_log`).length, 1, "the Thursday count aged out; Monday's text is counted");
});

test("a scheduled text whose contact asked to stop meanwhile is not sent", async () => {
  const t = harness();
  const numberId = await setup(t);
  t.actAs("agent", AGENT);
  t.setNow(NOW + 2 * DAY);
  const waiting = out(await send(t, numberId, { body: "Hold until Monday." }));
  const due = t.scheduled[0];
  t.suppressed.set("sms", [{ address: CALLER, reason: "stop" }]);
  t.setNow(Date.UTC(2025, 9, 13, 8, 0, 0));
  assert.deepEqual(await h.sendSms(t.ctx, due?.input as Parameters<typeof h.sendSms>[1]), { status: "suppressed" });
  assert.equal(t.calls("twilio.sms.send").length, 0);
  assert.equal(sms(t).find((r) => r.id === waiting.smsId)?.status, "failed", "the queued row does not wait for ever");
});

test("caps per number: over the hourly limit is refused with when it resets, and room comes back as time passes", async () => {
  const t = harness();
  const numberId = await setup(t);
  t.settings.set("mail.sender_caps", { perHour: 2, perDay: 3 });
  t.actAs("agent", AGENT);
  await send(t, numberId);
  await send(t, numberId);
  assert.equal(await refusedWith(send(t, numberId)), "rate_limit.exceeded");
  assert.equal(sms(t).length, 2, "the refused text was not stored");
  assert.equal(t.calls("twilio.sms.send").length, 2);
  t.advance(61 * 60_000);
  assert.equal(out(await send(t, numberId)).status, "queued", "the hour passed");
  t.advance(61 * 60_000);
  assert.equal(await refusedWith(send(t, numberId)), "rate_limit.exceeded", "three a day, and they are all within the day");
});

test("send_sms refuses what it must: bad input, pictures, numbers that cannot text, released numbers", async () => {
  const t = harness();
  const numberId = await setup(t);
  assert.equal(await refusedWith(send(t, numberId, { body: "" })), "validation.bad_input");
  assert.equal(await refusedWith(send(t, numberId, { body: "x".repeat(1601) })), "validation.bad_input");
  assert.equal(await refusedWith(send(t, numberId, { to: "4155550177" })), "validation.bad_input");
  assert.equal(await refusedWith(send(t, numberId, { numberId: "nope" })), "validation.bad_input");
  assert.equal(await refusedWith(send(t, numberId, { mediaFileIds: ["pic"] })), "validation.bad_input");
  assert.equal(await refusedWith(send(t, numberId, { sendAt: 1.5 })), "validation.bad_input");
  assert.equal(await refusedWith(send(t, numberId, { idempotencyKey: "" })), "validation.bad_input");
  assert.equal(await refusedWith(send(t, numberId, { mediaFileIds: ["fil_pic00001"] })), "validation.precondition_failed", "pictures are not sent yet");
  assert.equal(await refusedWith(send(t, "num_nope")), "validation.not_found");
  assert.equal(t.calls("twilio.sms.send").length, 0);

  t.script("twilio.number.buy", (i) => ({ number: { sid: "PN00000000000000000000000000000044", e164: i["e164"], capabilities: ["voice"] } }));
  const voiceOnly = String(out(out(await h.numberBuy(t.ctx, { e164: "+14155550188", title: "Voice", assigneeKind: "person", assigneeId: MAYA, idempotencyKey: "k-v" })).number).id);
  assert.equal(await refusedWith(send(t, voiceOnly)), "validation.precondition_failed", "a voice-only number cannot text");

  await h.numberRelease(t.ctx, { numberId, idempotencyKey: "k-rel" });
  assert.equal(await refusedWith(send(t, numberId)), "validation.precondition_failed", "a released number cannot text");
});

test("a text Twilio refuses is kept as failed, announced as failed and the error reaches the caller", async () => {
  const t = harness();
  const numberId = await setup(t);
  t.script("twilio.sms.send", () => { throw t.err("provider.rate_limited", "slow down"); });
  assert.equal(await refusedWith(send(t, numberId)), "provider.rate_limited");
  const row = sms(t)[0] ?? {};
  assert.equal(row.status, "failed");
  assert.deepEqual(t.named("message.failed")[0]?.payload, { messageId: row.id, channel: "sms", reason: "provider.rate_limited" });
  assert.equal(t.named("message.sent").length, 0);
  assert.equal(t.calls("inbox.link_message").length, 0, "a text that never left is not in the conversation");
});

test("undelivered and failed callbacks: a hard bounce suppresses the number, a soft one does not", async () => {
  const t = harness();
  const numberId = await setup(t);
  let n = 0;
  t.script("twilio.sms.send", () => ({ sid: sid(100 + ++n), status: "queued" }));
  const a = out(await send(t, numberId));
  const b = out(await send(t, numberId));
  const c = out(await send(t, numberId));
  await h.ingestStatus(t.ctx, { sid: sid(101), kind: "sms", status: "undelivered", errorCode: "30003", at: NOW });
  assert.deepEqual(t.named("message.bounced")[0]?.payload, { messageId: a.smsId, channel: "sms", address: CALLER, kind: "hard", reason: "30003" });
  assert.deepEqual(t.calls("contacts.suppression.add")[0]?.input, { channel: "sms", addresses: [CALLER], reason: "bounce_hard", source: "telephony.status", note: "Twilio error 30003" });
  await h.ingestStatus(t.ctx, { sid: sid(102), kind: "sms", status: "undelivered", errorCode: "30008", at: NOW });
  assert.deepEqual(t.named("message.bounced")[1]?.payload, { messageId: b.smsId, channel: "sms", address: CALLER, kind: "soft", reason: "30008" });
  assert.equal(t.calls("contacts.suppression.add").length, 1, "a soft bounce is not suppressed");
  await h.ingestStatus(t.ctx, { sid: sid(103), kind: "sms", status: "failed", errorCode: "30007", at: NOW });
  assert.deepEqual(t.named("message.failed")[0]?.payload, { messageId: c.smsId, channel: "sms", reason: "30007" });
  assert.deepEqual(sms(t).map((r) => r.status), ["undelivered", "undelivered", "failed"]);
  // the first number is now suppressed, so the next text to it is refused
  assert.equal(out(await send(t, numberId)).status, "suppressed");
});

test("an incoming text is kept, linked to the contact and announced; STOP suppresses the sender and a replay lands nothing twice", async () => {
  const t = harness();
  const numberId = await setup(t);
  const text = out(await h.ingestSms(t.ctx, { messageSid: "SM00000000000000000000000000000020", from: CALLER, to: NUM_E164, body: "Can you call me?", at: NOW + 1000 }));
  assert.deepEqual(contractErrors("telephony.ingest_sms", "out", text), []);
  assert.deepEqual([text.optOut, text.contactId, text.conversationId], [false, PAT, "cnv_1"]);
  const row = sms(t)[0] ?? {};
  assert.deepEqual([row.direction, row.from, row.to, row.body, row.status, row.contactId, row.numberId, row.at], ["in", CALLER, NUM_E164, "Can you call me?", "received", PAT, numberId, NOW + 1000]);
  assert.deepEqual(t.named("sms.received")[0]?.payload, { smsId: text.smsId, numberId, from: CALLER, contactId: PAT, optOut: false });
  assert.deepEqual(t.calls("inbox.link_message")[0]?.input, { channel: "sms", ref: { kind: "sms", id: text.smsId }, address: CALLER, direction: "in", at: NOW + 1000, numberId, preview: "Can you call me?" });
  assert.equal(t.calls("contacts.apply_optout").length, 0);

  const stop = out(await h.ingestSms(t.ctx, { messageSid: "SM00000000000000000000000000000021", from: CALLER, to: NUM_E164, body: " Stop ", at: NOW + 2000 }));
  assert.deepEqual([stop.optOut, stop.contactId], [true, PAT]);
  assert.deepEqual(t.calls("contacts.apply_optout")[0]?.input, { channel: "sms", address: CALLER, keyword: "STOP", source: "sms_stop", at: NOW + 2000 });
  assert.deepEqual(t.named("sms.received")[1]?.payload, { smsId: stop.smsId, numberId, from: CALLER, contactId: PAT, optOut: true });
  assert.equal(out(await send(t, numberId)).status, "suppressed", "after STOP the sender is on the suppression list");
  assert.deepEqual(t.named("message.suppressed").at(-1)?.payload, { channel: "sms", address: CALLER, reason: "stop" });

  // Twilio sent the hook twice
  const again = out(await h.ingestSms(t.ctx, { messageSid: "SM00000000000000000000000000000021", from: CALLER, to: NUM_E164, body: " Stop ", at: NOW + 2000 }));
  assert.deepEqual([again.smsId, again.optOut, again.contactId], [stop.smsId, true, PAT]);
  assert.equal(sms(t).filter((r) => r.direction === "in").length, 2);
  assert.equal(t.calls("contacts.apply_optout").length, 1);
  assert.equal(t.named("sms.received").length, 2);

  // the Space decides which words opt out
  t.settings.set("contacts.optout_keywords", ["PAUSE"]);
  assert.equal(out(await h.ingestSms(t.ctx, { messageSid: "SM00000000000000000000000000000022", from: "+14155550166", to: NUM_E164, body: "stop", at: NOW })).optOut, false);
  assert.equal(out(await h.ingestSms(t.ctx, { messageSid: "SM00000000000000000000000000000023", from: "+14155550166", to: NUM_E164, body: "pause", at: NOW })).optOut, true);

  assert.equal(await refusedWith(h.ingestSms(t.ctx, { messageSid: "SM00000000000000000000000000000024", from: CALLER, to: "+14155550999", body: "hi", at: NOW })), "validation.not_found");
  assert.equal(await refusedWith(h.ingestSms(t.ctx, { messageSid: "SM00000000000000000000000000000025", from: "caller", to: NUM_E164, body: "hi", at: NOW })), "validation.bad_input");
  assert.equal(await refusedWith(h.ingestSms(t.ctx, { messageSid: "", from: CALLER, to: NUM_E164, body: "hi", at: NOW })), "validation.bad_input");
});

test("the text list: by number, contact and direction, newest first, in pages", async () => {
  const t = harness();
  const numberId = await setup(t);
  t.settings.set("contacts.sms_requires_consent", false);
  await send(t, numberId, { body: "first" });
  t.advance(1000);
  await h.ingestSms(t.ctx, { messageSid: "SM00000000000000000000000000000030", from: CALLER, to: NUM_E164, body: "second", at: t.ctx.now() });
  t.advance(1000);
  await send(t, numberId, { body: "third", to: "+14155550166" });
  const all = out(await h.smsList(t.ctx, {}));
  assert.deepEqual(contractErrors("telephony.sms.list", "out", all), []);
  assert.deepEqual((all.messages as Json[]).map((m) => m.body), ["third", "second", "first"]);
  assert.deepEqual((out(await h.smsList(t.ctx, { contactId: PAT })).messages as Json[]).map((m) => m.body), ["second", "first"]);
  assert.deepEqual((out(await h.smsList(t.ctx, { direction: "in" })).messages as Json[]).map((m) => m.body), ["second"]);
  assert.equal((out(await h.smsList(t.ctx, { numberId })).messages as Json[]).length, 3);
  assert.equal((out(await h.smsList(t.ctx, { numberId: "num_other" })).messages as Json[]).length, 0);
  const page = out(await h.smsList(t.ctx, { limit: 2 }));
  assert.deepEqual([(page.messages as Json[]).length, page.next, page.total], [2, "2", 3]);
  assert.deepEqual((out(await h.smsList(t.ctx, { limit: 2, cursor: "2" })).messages as Json[]).map((m) => m.body), ["first"]);
  assert.equal(await refusedWith(h.smsList(t.ctx, { direction: "up" })), "validation.bad_input");
  assert.equal(await refusedWith(h.smsList(t.ctx, { limit: 501 })), "validation.bad_input");
});
