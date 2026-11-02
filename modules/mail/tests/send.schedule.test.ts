// When a message leaves (spec 2.18): now, or at the time the sender chose. Regular email is an Automation, so nothing here waits for a window, counts against a mailbox or throttles a domain.
import test from "node:test";
import assert from "node:assert/strict";
import { send } from "../handlers/send.ts";
import type { SendIn } from "../handlers/send.ts";
import { codeOf } from "../fixtures/harness.ts";
import { NOW, rig, row, sendIn } from "./send.rig.test.ts";
import type { Rig } from "./send.rig.test.ts";

const HOUR = 3_600_000;
const SATURDAY_3AM = 1_760_151_600_000;

const rows = (r: Rig, table: string) => r.h.rows(`SELECT * FROM ${table}`);
const due = (r: Rig, n = 0): SendIn => r.scheduled[n]!.input as unknown as SendIn;

test("an appointment confirmation booked at 3am on a Saturday leaves now, not on Monday", async () => {
  const r = rig({ origin: "automation:aut_confirm", principal: { kind: "service", id: "svc_automations" } });
  r.goto(SATURDAY_3AM);
  assert.equal((await send(r.ctx, sendIn())).status, "sent");
  assert.equal(r.scheduled.length, 0);
  assert.equal(r.sent().length, 1);
});

test("an old send window, cap or throttle setting on a Space changes nothing", async () => {
  const r = rig({ settings: { "mail.send_window": { days: [6], startHour: 9, endHour: 10, zone: "space" }, "mail.sender_caps": { perHour: 1, perDay: 1 }, "mail.throttle": { perMinute: 1 } } });
  assert.equal((await send(r.ctx, sendIn())).status, "sent");
  assert.equal((await send(r.ctx, sendIn())).status, "sent");
});

test("a newsletter to more people than the old daily cap all goes out", async () => {
  const r = rig({ origin: "automation:aut_news", principal: { kind: "service", id: "svc_automations" } });
  for (let i = 0; i < 200; i++) assert.equal((await send(r.ctx, sendIn({ to: [{ address: `reader${i}@acme.test` }] }))).status, "sent");
  assert.equal(r.sent().length, 200);
});

test("a later send time waits for it, and a past one sends now", async () => {
  const r = rig();
  const out = await send(r.ctx, sendIn({ mailboxId: "mbx_maya", sendAt: NOW + 2 * HOUR }));
  assert.equal(out.status, "queued");
  assert.equal(r.scheduled[0]!.at, NOW + 2 * HOUR);
  assert.equal(row(r, out.messageId ?? "")!.sentAt, NOW + 2 * HOUR);
  r.goto(NOW + 2 * HOUR);
  assert.equal((await send(r.ctx, due(r))).status, "sent");
  assert.equal(r.calls("google.gmail.send_message").length, 1);
  assert.equal((await send(r.ctx, sendIn({ sendAt: NOW - HOUR }))).status, "sent");
});

test("a queued message is checked again on delivery: suppressed meanwhile, it is marked failed and nothing is sent", async () => {
  const r = rig();
  const out = await send(r.ctx, sendIn({ sendAt: NOW + HOUR }));
  assert.equal(out.status, "queued");
  r.suppressed["pat@acme.test"] = "unsubscribe";
  r.goto(NOW + HOUR);
  assert.deepEqual(await send(r.ctx, due(r)), { status: "suppressed", suppressed: ["pat@acme.test"] });
  assert.equal(row(r, out.messageId ?? "")!.status, "failed");
  assert.equal(r.sent().length, 0);
});

test("scheduling must be available to queue a message, and then nothing is stored", async () => {
  const r = rig();
  delete r.ctx.schedule;
  await assert.rejects(send(r.ctx, sendIn({ sendAt: NOW + HOUR })), (e: unknown) => codeOf(e) === "internal.unavailable");
  assert.equal(rows(r, "mail_message").length, 0);
});
