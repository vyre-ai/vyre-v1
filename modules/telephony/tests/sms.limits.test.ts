// run: telephony tests (rerun)
// The Space sending limits on texts (Console > Messaging > Rules: send.cap, send.window, send.throttle; lib/send-limits.ts): over the daily limit a text is refused with reason send_cap_reached and the time it opens again; outside the
// window it is held (queued, not dropped) and goes when the window opens; over the speed it waits for the next minute. A person is not made to wait but is still counted against the daily limit.
import test from "node:test";
import assert from "node:assert/strict";
import * as h from "../handlers/index.ts";
import { AGENT, CALLER, MAYA, NOW, NUM_E164, harness } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";

const PAT = "rec_pat00001";
const DAY = 86_400_000;
type Json = Record<string, unknown>;
const out = (v: unknown): Json => v as Json;
let seq = 0;

async function setup(t: Harness): Promise<string> {
  t.contacts.set(CALLER, PAT);
  t.prefs.set(PAT, { smsConsent: "granted" });
  const made = out(out(await h.numberBuy(t.ctx, { e164: NUM_E164, title: "Main line", assigneeKind: "person", assigneeId: MAYA, idempotencyKey: "k-buy-limits" })).number);
  // the number's own window and caps stay out of the way so each test sees only the Space limits
  t.settings.set("telephony.send_window", { days: [1, 2, 3, 4, 5, 6, 7], startHour: 0, endHour: 24, zone: "space" });
  t.settings.set("telephony.sender_caps", { perHour: 1000, perDay: 1000 });
  return String(made.id);
}
const send = (t: Harness, numberId: string, o: Json = {}) =>
  h.sendSms(t.ctx, { numberId, to: CALLER, body: "Your appointment is Friday at 3.", idempotencyKey: `k-lim-${++seq}`, ...o } as Parameters<typeof h.sendSms>[1]);
const refusal = async (p: Promise<unknown>): Promise<{ code: string; message: string; details: Json }> => {
  try { await p; } catch (e) { const err = (e as { error: { code: string; message: string; details: Json } }).error; return { code: err.code, message: err.message, details: err.details }; }
  throw new Error("expected a refusal");
};

test("over the daily limit a text is refused with send_cap_reached, the limit and when sending opens again; the refused text is not stored", async () => {
  const t = harness();
  const numberId = await setup(t);
  t.settings.set("send.cap", 2);
  t.settings.set("send.window", "any");
  t.actAs("agent", AGENT);
  await send(t, numberId);
  t.advance(60 * 60_000);
  await send(t, numberId);
  const no = await refusal(send(t, numberId));
  assert.equal(no.code, "validation.precondition_failed");
  assert.equal(no.details.reason, "send_cap_reached");
  assert.equal(no.details.limit, 2);
  assert.equal(no.details.resetAt, NOW + DAY, "the first text leaves the day at this time");
  assert.match(no.message, /limit of 2 messages a day/);
  assert.equal(t.rows(`SELECT * FROM telephony_sms`).length, 2);
  assert.equal(t.calls("twilio.sms.send").length, 2);
  t.setNow(NOW + DAY + 1000);
  assert.equal(out(await send(t, numberId)).status, "queued", "room came back");
  assert.equal(t.calls("twilio.sms.send").length, 3);
});

test("a person is not made to wait but counts toward the daily limit", async () => {
  const t = harness();
  const numberId = await setup(t);
  t.settings.set("send.cap", 1);
  t.settings.set("send.window", "9-17");   // 01:53 in the recipient's zone: closed
  t.actAs("person", MAYA);
  await send(t, numberId);
  assert.equal(t.calls("twilio.sms.send").length, 1, "a person's text goes inside a closed window");
  assert.equal((await refusal(send(t, numberId))).details.reason, "send_cap_reached");
});

test("outside the window a text is held, says so, and goes when the window opens in the recipient's zone", async () => {
  const t = harness();
  const numberId = await setup(t);
  t.settings.set("send.window", "9-17");
  t.actAs("agent", AGENT);
  const nine = Date.UTC(2025, 9, 9, 16, 0, 0);   // 09:00 in San Francisco (PDT); NOW is 01:53 there
  const held = out(await send(t, numberId, { body: "Hold until nine." }));
  assert.equal(held.status, "queued");
  assert.match(String(held.note), /Held until the sending window opens at 09:00 on 9 Oct/);
  assert.equal(t.calls("twilio.sms.send").length, 0, "nothing left");
  assert.deepEqual([t.scheduled[0]?.at, t.scheduled[0]?.cap], [nine, "telephony.send_sms"]);
  assert.equal(t.rows(`SELECT * FROM telephony_sms`)[0]?.status, "queued", "the text is kept, not dropped");
  t.setNow(nine);
  const due = t.scheduled[0]?.input as Parameters<typeof h.sendSms>[1];
  const done = out(await h.sendSms(t.ctx, due));
  assert.equal(done.smsId, held.smsId);
  assert.equal(done.note, undefined);
  assert.equal(t.calls("twilio.sms.send").length, 1, "it goes once, when the window opens");
  assert.equal(t.rows(`SELECT * FROM telephony_send_tick`).length, 1, "the returning text does not take a second slot");
});

test("over the speed a text waits for the next minute, and goes then", async () => {
  const t = harness();
  const numberId = await setup(t);
  t.settings.set("send.window", "any");
  t.settings.set("send.throttle", 2);
  t.actAs("agent", AGENT);
  t.setNow(Date.UTC(2025, 9, 9, 8, 53, 10));
  await send(t, numberId);
  await send(t, numberId);
  assert.equal(t.calls("twilio.sms.send").length, 2);
  const third = out(await send(t, numberId, { body: "Third in the minute." }));
  const next = Date.UTC(2025, 9, 9, 8, 54, 0);
  assert.equal(t.calls("twilio.sms.send").length, 2, "the third waits");
  assert.match(String(third.note), /Waiting its turn under the sending speed limit/);
  assert.equal(t.scheduled[0]?.at, next);
  const fourth = out(await send(t, numberId, { body: "Fourth." }));
  assert.equal(t.scheduled[1]?.at, next, "the next minute has room for a second");
  assert.ok(fourth.note);
  const fifth = out(await send(t, numberId, { body: "Fifth." }));
  assert.equal(t.scheduled[2]?.at, next + 60_000, "a full minute pushes to the one after");
  assert.ok(fifth.note);
  t.setNow(next);
  await h.sendSms(t.ctx, t.scheduled[0]?.input as Parameters<typeof h.sendSms>[1]);
  assert.equal(t.calls("twilio.sms.send").length, 3);
});
