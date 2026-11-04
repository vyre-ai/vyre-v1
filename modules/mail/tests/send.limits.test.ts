// The Space sending limits on email (Console > Messaging > Rules: send.cap, send.window, send.throttle; lib/send-limits.ts): over the daily limit a send is refused with reason send_cap_reached and the time sending opens again;
// outside the window an automation's or an agent's email is held (queued, not dropped) and goes when the window opens; over the speed it waits for the next minute. A person is not made to wait but is still counted.
import test from "node:test";
import assert from "node:assert/strict";
import { HostError } from "../../../host/src/routes/errors.ts";
import { send, sendAs } from "../handlers/send.ts";
import type { SendIn } from "../handlers/send.ts";
import { NOW, rig, row, sendIn } from "./send.rig.test.ts";

const DAY = 86_400_000;
const AUTO = { origin: "automation:aut_news", principal: { kind: "service" as const, id: "svc_automations" } };
const SATURDAY_3AM = 1_760_151_600_000;   // 2025-10-11 03:00 UTC
const SATURDAY_8AM = SATURDAY_3AM + 5 * 3_600_000;

const refusal = async (p: Promise<unknown>): Promise<{ code: string; message: string; details: Record<string, unknown> }> => {
  try { await p; } catch (e) { if (e instanceof HostError) return { code: e.error.code, message: e.error.message, details: (e.error.details ?? {}) as Record<string, unknown> }; throw e; }
  throw new Error("expected a refusal");
};
const to = (i: number): Partial<SendIn> => ({ to: [{ address: `reader${i}@acme.test` }] });

test("over the daily limit a send is refused with send_cap_reached, the limit and when sending opens again; nothing is stored or sent", async () => {
  const r = rig({ settings: { "send.cap": 2 } });
  await send(r.ctx, sendIn(to(1)));
  r.goto(NOW + 3_600_000);
  await send(r.ctx, sendIn(to(2)));
  const no = await refusal(send(r.ctx, sendIn(to(3))));
  assert.equal(no.code, "validation.precondition_failed");
  assert.deepEqual([no.details.reason, no.details.limit, no.details.resetAt], ["send_cap_reached", 2, NOW + DAY]);
  assert.match(no.message, /limit of 2 messages a day. Sending opens again at \d\d:\d\d on 10 Oct \(UTC\)/);
  assert.equal(r.sent().length, 2);
  assert.equal(r.h.rows(`SELECT * FROM mail_message`).length, 2);
  r.goto(NOW + DAY + 1000);
  assert.equal((await send(r.ctx, sendIn(to(4)))).status, "sent", "room came back");
});

test("a person is not made to wait for the window but counts toward the limit, and a reply from their own mailbox is refused over it", async () => {
  const r = rig({ settings: { "send.cap": 2, "send.window": "9-17" } });
  r.goto(SATURDAY_3AM);
  assert.equal((await send(r.ctx, sendIn(to(1)))).status, "sent", "a person's email goes inside a closed window");
  const reply = await sendAs(r.ctx, { mailboxId: "mbx_maya", to: [{ address: "pat@acme.test" }], subject: "Re", text: "ok", idempotencyKey: "idem-reply-1" });
  assert.ok(reply.messageId);
  assert.equal(r.sent().length, 2);
  assert.equal((await refusal(send(r.ctx, sendIn(to(2))))).details.reason, "send_cap_reached");
  assert.match((await refusal(sendAs(r.ctx, { mailboxId: "mbx_maya", to: [{ address: "pat@acme.test" }], subject: "Re", text: "again", idempotencyKey: "idem-reply-2" }))).message, /limit of 2 messages a day/);
});

test("outside the window an automation's email is held, says so, and goes when the window opens", async () => {
  const r = rig({ ...AUTO });   // the default window is 8:00 to 20:00
  r.goto(SATURDAY_3AM);
  const held = await send(r.ctx, sendIn(to(1)));
  assert.equal(held.status, "queued");
  assert.match(held.note ?? "", /Held until the sending window opens at 08:00 on 11 Oct/);
  assert.equal(r.sent().length, 0, "nothing left");
  assert.equal(r.scheduled[0]!.at, SATURDAY_8AM);
  assert.equal(row(r, held.messageId ?? "")!.status, "queued", "the message is kept, not dropped");
  r.goto(SATURDAY_8AM);
  const done = await send(r.ctx, r.scheduled[0]!.input as unknown as SendIn);
  assert.equal(done.status, "sent");
  assert.equal(r.sent().length, 1);
  assert.equal(r.h.rows(`SELECT * FROM mail_send_tick`).length, 1, "the returning message does not take a second slot");
});

test("the window follows the Space time zone, and 'any' never holds", async () => {
  const shifted = rig({ ...AUTO, settings: { "profile.timezone": "Asia/Karachi", "send.window": "8-20" } });
  assert.equal((await send(shifted.ctx, sendIn(to(1)))).status, "sent", "08:53 UTC is 13:53 in Karachi");
  shifted.goto(Date.UTC(2025, 9, 9, 16, 0, 0));   // 21:00 in Karachi
  const late = await send(shifted.ctx, sendIn(to(2)));
  assert.equal(late.status, "queued");
  assert.equal(shifted.scheduled[0]!.at, Date.UTC(2025, 9, 10, 3, 0, 0), "08:00 the next morning in Karachi");
  const open = rig({ ...AUTO, settings: { "send.window": "any" } });
  open.goto(SATURDAY_3AM);
  assert.equal((await send(open.ctx, sendIn(to(1)))).status, "sent");
});

test("over the speed an email waits for the next minute and goes then", async () => {
  const r = rig({ ...AUTO, settings: { "send.throttle": 2 } });
  r.goto(Date.UTC(2025, 9, 9, 8, 53, 10));
  assert.equal((await send(r.ctx, sendIn(to(1)))).status, "sent");
  assert.equal((await send(r.ctx, sendIn(to(2)))).status, "sent");
  const third = await send(r.ctx, sendIn(to(3)));
  const next = Date.UTC(2025, 9, 9, 8, 54, 0);
  assert.equal(third.status, "queued");
  assert.match(third.note ?? "", /Waiting its turn under the sending speed limit/);
  assert.equal(r.sent().length, 2, "the third waits");
  assert.equal(r.scheduled[0]!.at, next);
  assert.equal((await send(r.ctx, sendIn(to(4)))).status, "queued");
  assert.equal(r.scheduled[1]!.at, next);
  assert.equal((await send(r.ctx, sendIn(to(5)))).status, "queued");
  assert.equal(r.scheduled[2]!.at, next + 60_000, "a full minute pushes to the one after");
  r.goto(next);
  assert.equal((await send(r.ctx, r.scheduled[0]!.input as unknown as SendIn)).status, "sent");
  assert.equal(r.sent().length, 3);
});
