// The single send API's pacing (spec 2.18, 2.19, ARCH 8.2): send windows, throttling per sending domain, caps per sender, scheduled sends.
// A window or throttle miss queues the message and schedules its delivery; a cap refuses it. Times are fixed instants:
// NOW is Thursday 2025-10-09 08:53:20 UTC, inside the default window (Monday to Friday, 08:00 to 18:00).
import test from "node:test";
import assert from "node:assert/strict";
import { inWindow, nextWindowStart, send, sendPreview } from "../handlers/send.ts";
import type { SendIn } from "../handlers/send.ts";
import { codeOf, contractErrors } from "../fixtures/harness.ts";
import { NOW, rig, row, sendIn } from "./send.rig.test.ts";
import type { Rig } from "./send.rig.test.ts";

const MIN = 60_000;
const HOUR = 3_600_000;
const FRIDAY_5_59PM = 1_760_119_140_000;
const FRIDAY_6PM = 1_760_119_200_000;
const FRIDAY_7PM = 1_760_122_800_000;
const FRIDAY_2PM = 1_760_104_800_000;
const SATURDAY_3AM = 1_760_151_600_000;
const SATURDAY_9AM = 1_760_173_200_000;
const MONDAY_759_59 = 1_760_342_399_000;
const MONDAY_8AM = 1_760_342_400_000;
const MONDAY_8AM_PKT = 1_760_324_400_000;   // Monday 03:00 UTC
const WEEKDAYS = { days: [1, 2, 3, 4, 5], startHour: 8, endHour: 18 };

const rows = (r: Rig, table: string) => r.h.rows(`SELECT * FROM ${table}`);
const due = (r: Rig, n = 0): SendIn => r.scheduled[n]!.input as unknown as SendIn;

async function details(p: Promise<unknown>, code: string): Promise<unknown> {
  let seen: unknown;
  await assert.rejects(p, (e: unknown) => {
    assert.equal(codeOf(e), code);
    seen = (e as { error: { details: unknown } }).error.details;
    return true;
  });
  return seen;
}

// ---- the window itself

test("a time is inside the window by the local weekday and hour: start included, end excluded", () => {
  assert.equal(inWindow(NOW, "UTC", WEEKDAYS), true);
  assert.equal(inWindow(FRIDAY_5_59PM, "UTC", WEEKDAYS), true);
  assert.equal(inWindow(FRIDAY_6PM, "UTC", WEEKDAYS), false);
  assert.equal(inWindow(SATURDAY_3AM, "UTC", WEEKDAYS), false);
  assert.equal(inWindow(MONDAY_759_59, "UTC", WEEKDAYS), false);
  assert.equal(inWindow(MONDAY_8AM, "UTC", WEEKDAYS), true);
});

test("the window follows the zone: 19:00 in Karachi is outside while 14:00 UTC is inside for UTC", () => {
  assert.equal(inWindow(FRIDAY_2PM, "UTC", WEEKDAYS), true);
  assert.equal(inWindow(FRIDAY_2PM, "Asia/Karachi", WEEKDAYS), false);
  assert.equal(inWindow(NOW, "Asia/Karachi", WEEKDAYS), true);   // 13:53 there
  assert.equal(inWindow(NOW, "America/Los_Angeles", WEEKDAYS), false);   // 01:53 there
});

test("the next opening is the first start hour on a listed day, in the zone's own clock", () => {
  assert.equal(nextWindowStart(NOW, "UTC", WEEKDAYS), NOW);   // already open
  assert.equal(nextWindowStart(FRIDAY_6PM, "UTC", WEEKDAYS), MONDAY_8AM);
  assert.equal(nextWindowStart(SATURDAY_3AM, "UTC", WEEKDAYS), MONDAY_8AM);
  assert.equal(nextWindowStart(FRIDAY_2PM, "Asia/Karachi", WEEKDAYS), MONDAY_8AM_PKT);
  assert.equal(nextWindowStart(NOW, "UTC", { days: [6, 7], startHour: 9, endHour: 12 }), SATURDAY_9AM);
  assert.equal(nextWindowStart(NOW, "UTC", { days: [], startHour: 9, endHour: 12 }), null);
});

test("a window whose end is at or before its start wraps past midnight", () => {
  const night = { days: [1, 2, 3, 4, 5, 6, 7], startHour: 22, endHour: 6 };
  assert.equal(inWindow(1_760_050_800_000, "UTC", night), true);   // Thursday 23:00
  assert.equal(inWindow(1_760_075_940_000, "UTC", night), true);   // Friday 05:59
  assert.equal(inWindow(1_759_989_600_000, "UTC", night), false);   // Thursday 06:00
  assert.equal(nextWindowStart(1_759_989_600_000, "UTC", night), 1_760_047_200_000);   // Thursday 22:00
});

// ---- queueing outside the window

test("outside the window the message is queued for the next opening, and a scheduled call delivers the same message", async () => {
  const r = rig();
  r.goto(FRIDAY_7PM);
  const input = sendIn({ campaignId: "cmp_spring" });
  const out = await send(r.ctx, input);
  assert.equal(out.status, "queued");
  assert.deepEqual(contractErrors("mail.send", "out", out), []);
  const id = out.messageId ?? "";
  assert.equal(r.sent().length, 0);
  assert.equal(rows(r, "mail_send_log").length, 0);
  assert.deepEqual([row(r, id)!.status, row(r, id)!.sentAt], ["queued", MONDAY_8AM]);

  assert.equal(r.scheduled.length, 1);
  const call = r.scheduled[0]!;
  assert.deepEqual([call.at, call.cap, call.input.draftId, call.input.idempotencyKey, "sendAt" in call.input], [MONDAY_8AM, "mail.send", id, `${input.idempotencyKey}:due`, false]);
  assert.deepEqual(call.input.to, [{ address: "pat@acme.test" }]);
  assert.deepEqual(await send(r.ctx, input), out);   // asking again queues nothing more
  assert.equal(r.scheduled.length, 1);

  r.goto(MONDAY_8AM);
  const sent = await send(r.ctx, due(r));
  assert.deepEqual([sent.status, sent.messageId], ["sent", id]);
  assert.deepEqual(contractErrors("mail.send", "out", sent), []);
  assert.equal(r.sent().length, 1);
  assert.equal((r.calls("resend.send_email")[0]!.input.headers as Record<string, string>)["Message-ID"], `<${id}@vyre.test>`);
  const m = row(r, id)!;
  assert.deepEqual([m.status, m.providerId, m.sentAt, m.version], ["sent", "resend_1", MONDAY_8AM, 3]);
  assert.equal(rows(r, "mail_message").length, 1);
  assert.equal(r.h.named("message.sent").length, 1);
});

test("the window is read in the sender's time zone", async () => {
  const r = rig({ settings: { "profile.timezone": "Asia/Karachi" } });
  assert.equal((await send(r.ctx, sendIn())).status, "sent");   // 13:53 in Karachi
  r.goto(FRIDAY_2PM);   // 19:00 in Karachi
  const out = await send(r.ctx, sendIn());
  assert.equal(out.status, "queued");
  assert.equal(r.scheduled[0]!.at, MONDAY_8AM_PKT);
});

test("the Space's window setting replaces the default", async () => {
  const r = rig({ settings: { "mail.send_window": { days: [6, 7], startHour: 9, endHour: 12, zone: "space" } } });
  const out = await send(r.ctx, sendIn());
  assert.equal(out.status, "queued");
  assert.equal(r.scheduled[0]!.at, SATURDAY_9AM);
});

test("a setting that does not fit its shape leaves the manifest default in force", async () => {
  const r = rig({ settings: { "mail.send_window": { days: [], startHour: 9, endHour: 12, zone: "space" }, "mail.sender_caps": "many", "mail.throttle": { perMinute: 0 }, "profile.timezone": "Mars/Olympus" } });
  assert.equal((await send(r.ctx, sendIn())).status, "sent");
});

test("a queued message is checked again on delivery: suppressed meanwhile, it is marked failed and nothing is sent", async () => {
  const r = rig();
  r.goto(SATURDAY_3AM);
  const out = await send(r.ctx, sendIn());
  assert.equal(out.status, "queued");
  r.suppressed["pat@acme.test"] = "unsubscribe";
  r.goto(MONDAY_8AM);
  const again = await send(r.ctx, due(r));
  assert.deepEqual(again, { status: "suppressed", suppressed: ["pat@acme.test"] });
  assert.equal(row(r, out.messageId ?? "")!.status, "failed");
  assert.equal(r.sent().length, 0);
});

test("scheduling must be available to queue a message, and then nothing is stored", async () => {
  const r = rig();
  delete r.ctx.schedule;
  r.goto(SATURDAY_3AM);
  await assert.rejects(send(r.ctx, sendIn()), (e: unknown) => codeOf(e) === "internal.unavailable");
  assert.equal(rows(r, "mail_message").length, 0);
});

// ---- a time the sender chose

test("a person's message with a later send time waits for it, without needing the window", async () => {
  const r = rig();
  const out = await send(r.ctx, sendIn({ mailboxId: "mbx_maya", sendAt: NOW + 2 * HOUR }));
  assert.equal(out.status, "queued");
  assert.equal(r.scheduled[0]!.at, NOW + 2 * HOUR);
  assert.equal(row(r, out.messageId ?? "")!.sentAt, NOW + 2 * HOUR);
  r.goto(NOW + 2 * HOUR);
  assert.equal((await send(r.ctx, due(r))).status, "sent");
  assert.equal(r.calls("google.gmail.send_message").length, 1);
});

test("a Space send time inside the closed hours moves on to the next opening, and a past send time sends now", async () => {
  const r = rig();
  const late = await send(r.ctx, sendIn({ sendAt: FRIDAY_7PM }));
  assert.equal(late.status, "queued");
  assert.equal(r.scheduled[0]!.at, MONDAY_8AM);
  const past = await send(r.ctx, sendIn({ sendAt: NOW - HOUR }));
  assert.equal(past.status, "sent");
});

// ---- throttling

test("throttling holds a send back until enough of the last minute has passed", async () => {
  const r = rig({ settings: { "mail.throttle": { perMinute: 2 } } });
  assert.equal((await send(r.ctx, sendIn())).status, "sent");
  r.h.advance(10_000);
  assert.equal((await send(r.ctx, sendIn())).status, "sent");
  r.h.advance(10_000);
  const third = await send(r.ctx, sendIn());
  assert.equal(third.status, "queued");
  assert.equal(r.scheduled[0]!.at, NOW + MIN);   // the first send leaves the minute then
  assert.equal(row(r, third.messageId ?? "")!.sentAt, NOW + MIN);
  r.goto(NOW + MIN);
  assert.equal((await send(r.ctx, due(r))).status, "sent");
  assert.equal(r.calls("resend.send_email").length, 3);
});

test("the throttle counts recipients and is shared by every mailbox on the sending domain", async () => {
  const r = rig({ settings: { "mail.throttle": { perMinute: 3 } } });
  await send(r.ctx, sendIn({ to: [{ address: "a@acme.test" }, { address: "b@acme.test" }] }));
  const other = await send(r.ctx, sendIn({ mailboxId: "mbx_maya", route: "space_domain", to: [{ address: "c@acme.test" }, { address: "d@acme.test" }] }));
  assert.equal(other.status, "queued");
  assert.equal(r.scheduled[0]!.at, NOW + MIN);
  assert.deepEqual(rows(r, "mail_send_log").map((l) => l.throttleKey), ["domain:vyre.test", "domain:vyre.test"]);
});

test("a send with more recipients than the throttle ever allows is refused with a way out", async () => {
  const r = rig({ settings: { "mail.throttle": { perMinute: 2 } } });
  await assert.rejects(send(r.ctx, sendIn({ to: [{ address: "a@acme.test" }, { address: "b@acme.test" }, { address: "c@acme.test" }] })), (e: unknown) => codeOf(e) === "validation.precondition_failed");
  assert.equal(r.sent().length, 0);
  assert.equal(rows(r, "mail_message").length, 0);
});

// ---- caps

test("the hourly cap refuses the send that would pass it and names when it resets", async () => {
  const r = rig({ settings: { "mail.sender_caps": { perHour: 2, perDay: 50 } } });
  await send(r.ctx, sendIn());
  r.h.advance(MIN);
  await send(r.ctx, sendIn());
  r.h.advance(MIN);
  const d = await details(send(r.ctx, sendIn()), "rate_limit.exceeded");
  assert.deepEqual(d, { limit: "perHour", max: 2, resetAt: NOW + HOUR });
  assert.equal(rows(r, "mail_message").length, 2);
  r.goto(NOW + HOUR + 2 * MIN);   // both sends are older than an hour
  assert.equal((await send(r.ctx, sendIn())).status, "sent");
});

test("the daily cap counts a rolling day, and rows older than that are dropped", async () => {
  const r = rig({ settings: { "mail.sender_caps": { perHour: 100, perDay: 3 } } });
  for (const at of [NOW, NOW + 67 * MIN, NOW + 137 * MIN]) {
    r.goto(at);
    assert.equal((await send(r.ctx, sendIn())).status, "sent");
  }
  r.goto(NOW + 207 * MIN);
  const d = await details(send(r.ctx, sendIn()), "rate_limit.exceeded");
  assert.deepEqual(d, { limit: "perDay", max: 3, resetAt: NOW + 24 * HOUR });
  r.goto(NOW + 25 * HOUR);   // Friday 09:53, the first send is now 25 hours old
  assert.equal((await send(r.ctx, sendIn())).status, "sent");
  assert.deepEqual(rows(r, "mail_send_log").map((l) => Number(l.at)).sort((a, b) => a - b), [NOW + 67 * MIN, NOW + 137 * MIN, NOW + 25 * HOUR]);
});

test("caps count recipients: one send to more people than the cap is refused whole", async () => {
  const r = rig({ settings: { "mail.sender_caps": { perHour: 2, perDay: 50 } } });
  const d = await details(send(r.ctx, sendIn({ to: [{ address: "a@acme.test" }, { address: "b@acme.test" }, { address: "c@acme.test" }] })), "rate_limit.exceeded");
  assert.equal((d as { limit: string }).limit, "perHour");
  assert.equal(r.sent().length, 0);
});

test("queued and suppressed sends do not use the cap", async () => {
  const r = rig({ settings: { "mail.sender_caps": { perHour: 1, perDay: 1 } }, suppressed: { "gone@acme.test": "unsubscribe" } });
  await send(r.ctx, sendIn({ to: [{ address: "gone@acme.test" }] }));
  r.goto(SATURDAY_3AM);
  await send(r.ctx, sendIn());
  assert.equal(rows(r, "mail_send_log").length, 0);
  r.goto(MONDAY_8AM);
  assert.equal((await send(r.ctx, due(r))).status, "sent");
});

test("a person's own mailbox is not held to the caps or the window, but an agent sending through it is", async () => {
  const person = rig({ settings: { "mail.sender_caps": { perHour: 1, perDay: 1 } } });
  assert.equal((await send(person.ctx, sendIn({ mailboxId: "mbx_maya" }))).status, "sent");
  assert.equal((await send(person.ctx, sendIn({ mailboxId: "mbx_maya" }))).status, "sent");
  assert.equal(person.calls("google.gmail.send_message").length, 2);

  const agent = rig({ principal: { kind: "agent", id: "agt_scout01" }, settings: { "mail.sender_caps": { perHour: 1, perDay: 1 } } });
  assert.equal((await send(agent.ctx, sendIn({ mailboxId: "mbx_maya", route: "mailbox" }))).status, "sent");
  await assert.rejects(send(agent.ctx, sendIn({ mailboxId: "mbx_maya", route: "mailbox" })), (e: unknown) => codeOf(e) === "rate_limit.exceeded");
  agent.goto(SATURDAY_3AM);
  assert.equal((await send(agent.ctx, sendIn({ mailboxId: "mbx_maya", route: "mailbox", idempotencyKey: "late" }))).status, "queued");
});

test("a campaign is paced like an agent, and the mailbox route throttles per mailbox", async () => {
  const r = rig({ origin: "campaign:cmp_spring", principal: { kind: "service", id: "svc_campaigns" }, settings: { "mail.throttle": { perMinute: 1 } } });
  await send(r.ctx, sendIn({ mailboxId: "mbx_maya", route: "mailbox", campaignId: "cmp_spring" }));
  const second = await send(r.ctx, sendIn({ mailboxId: "mbx_maya", route: "mailbox", campaignId: "cmp_spring" }));
  assert.equal(second.status, "queued");
  assert.deepEqual(rows(r, "mail_send_log").map((l) => l.throttleKey), ["mailbox:mbx_maya"]);
});

test("the preview agrees with the send about caps left", async () => {
  const r = rig({ settings: { "mail.sender_caps": { perHour: 5, perDay: 8 } } });
  await send(r.ctx, sendIn({ to: [{ address: "a@acme.test" }, { address: "b@acme.test" }] }));
  const out = await sendPreview(r.ctx, { mailboxId: "mbx_hello", to: [{ address: "c@acme.test" }] });
  assert.equal(out.capRemainingToday, 3);   // the smaller of 8 - 2 and 5 - 2
});
