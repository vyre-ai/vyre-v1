// A retry sends the stored message as the system, and the original sender stays as data (lane r42-email-in): it delivers although the person who sent has since lost
// every right to the mailbox, it can only send what is stored, the child is credited to the original sender, and a retry handed back again and again ends held, not looping.
import test from "node:test";
import assert from "node:assert/strict";
import { statusUpdate } from "../handlers/extra/status.ts";
import { MAX_GIVEBACKS, recordSentBy, retry, retrySender, trail } from "../handlers/extra/delivery.ts";
import { hostError, seedSent } from "../handlers/extra/kit.ts";
import { rig } from "./send.rig.test.ts";

const DAY = 86_400_000;
const system = { kind: "service", id: "svc_host" } as const;
const soft = (r: ReturnType<typeof rig>, providerId: string, at: number) =>
  statusUpdate(r.ctx, { providerId, status: "bounced", kind: "soft", reason: "Mailbox full", address: "pat@acme.test", at });

test("a retry delivers after the person who sent has lost every right, sends only what is stored, and credits the original sender", async () => {
  retrySender.send = null; // the module's own send
  const r = rig({ principal: system });
  seedSent(r.h, { id: "eml_m1", mailboxId: "mbx_hello", providerId: "re_1" });
  recordSentBy(r.ctx, "eml_m1", { kind: "person", principal: "usr_gone01" });
  await soft(r, "re_1", r.ctx.now() + 1);
  r.h.denied.add("mbx_hello"); // whoever sent can no longer use the mailbox; the retry does not ask them
  r.h.advance(DAY);
  // extra fields in the call change nothing: the retry carries a message id, an address and an attempt, and sends that stored message
  const out = await retry(r.ctx, { messageId: "eml_m1", address: "pat@acme.test", attempt: 1, subject: "Evil", text: "Evil", to: [{ address: "mallory@evil.test" }] } as never);
  assert.equal(out.outcome, "sent");
  const calls = r.calls("resend.send_email");
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0]!.input.to, ["pat@acme.test"]);
  assert.equal(calls[0]!.input.subject, "Hello");
  assert.doesNotMatch(JSON.stringify(calls[0]!.input), /Evil|mallory/);
  // credited to the person who asked, on the original and on the retry (read by someone who may see the mailbox)
  r.h.denied.delete("mbx_hello");
  assert.deepEqual((await trail(r.ctx, { messageId: "eml_m1" })).sentBy, { kind: "person", id: "usr_gone01" });
  const child = r.h.rows(`SELECT "childId" FROM mail_delivery_child`)[0]!.childId as string;
  assert.deepEqual((await trail(r.ctx, { messageId: child })).sentBy, { kind: "person", id: "usr_gone01" });
});

test("a send records who asked, the person an agent acts for in preference", async () => {
  const r = rig({ principal: { kind: "person", id: "usr_maya01" } });
  const { send } = await import("../handlers/send.ts");
  const { sendIn } = await import("./send.rig.test.ts");
  const out = await send(r.ctx, sendIn());
  assert.deepEqual((await trail(r.ctx, { messageId: out.messageId ?? "" })).sentBy, { kind: "person", id: "usr_maya01" });
});

test("a retry handed back for lack of a right is tried again, then held with the reason, and stops", async () => {
  const r = rig({ principal: system });
  seedSent(r.h, { id: "eml_m1", mailboxId: "mbx_hello", providerId: "re_1" });
  await soft(r, "re_1", r.ctx.now() + 1);
  retrySender.send = () => {
    throw hostError(r.h, "permission.no_grant");
  };
  for (let n = 1; n < MAX_GIVEBACKS; n++) {
    r.h.advance(DAY);
    await assert.rejects(retry(r.ctx, { messageId: "eml_m1", address: "pat@acme.test", attempt: 1 }));
    assert.equal(r.h.rows(`SELECT state FROM mail_delivery_retry`)[0]!.state, "pending");
  }
  r.h.advance(DAY);
  assert.equal((await retry(r.ctx, { messageId: "eml_m1", address: "pat@acme.test", attempt: 1 })).outcome, "held");
  assert.equal(r.h.rows(`SELECT state FROM mail_delivery_retry`)[0]!.state, "held");
  const t = await trail(r.ctx, { messageId: "eml_m1" });
  assert.equal(t.state, "held");
  assert.match(t.events.find((e) => e.kind === "held")?.detail ?? "", /Send it again by hand/);
  // held means stopped: another call, or another soft bounce, does nothing
  r.h.advance(DAY);
  assert.equal((await retry(r.ctx, { messageId: "eml_m1", address: "pat@acme.test", attempt: 1 })).outcome, "skipped");
  await soft(r, "re_1", r.ctx.now() + 5);
  assert.equal(r.h.rows(`SELECT state FROM mail_delivery_retry`)[0]!.state, "held");
  retrySender.send = null;
});

test("a throw after the provider accepted the retry sends nothing new: the attempt counts as gone out, and every attempt shares one provider key", async () => {
  retrySender.send = null;
  const r = rig({ principal: system });
  seedSent(r.h, { id: "eml_m1", mailboxId: "mbx_hello", providerId: "re_1" });
  recordSentBy(r.ctx, "eml_m1", { kind: "person", principal: "usr_ask01" });
  await soft(r, "re_1", r.ctx.now() + 1);
  const emit = r.ctx.emit.bind(r.ctx);
  let boom = true;
  r.ctx.emit = (name, subject, payload, o) => {
    if (boom && name === "message.sent") throw new Error("the event log is down");
    return emit(name, subject, payload, o);
  };
  r.h.advance(DAY);
  const out = await retry(r.ctx, { messageId: "eml_m1", address: "pat@acme.test", attempt: 1 });
  assert.equal(out.outcome, "sent"); // the provider had it: not a failed try
  assert.equal(r.calls("resend.send_email").length, 1);
  const child = r.h.rows(`SELECT "childId" FROM mail_delivery_child`)[0]!.childId as string;
  assert.equal(out.messageId, child);
  assert.equal(r.h.rows(`SELECT state FROM mail_delivery_retry`)[0]!.state, "waiting");
  assert.equal(r.h.rows(`SELECT status, "providerId" FROM mail_message WHERE id = ?`, child)[0]!.status, "sent"); // acceptance was written first
  // the next tick, and a repeat of the same attempt, send nothing
  boom = false;
  r.h.advance(DAY);
  assert.equal((await retry(r.ctx, { messageId: "eml_m1", address: "pat@acme.test", attempt: 1 })).outcome, "skipped");
  assert.equal(r.calls("resend.send_email").length, 1);
  // the provider reports the retry delivered: the message ends delivered
  await statusUpdate(r.ctx, { providerId: String(r.h.rows(`SELECT "providerId" FROM mail_message WHERE id = ?`, child)[0]!.providerId), status: "delivered", address: "pat@acme.test", at: r.ctx.now() + 1 });
  assert.equal(r.h.rows(`SELECT status FROM mail_message WHERE id = ?`, "eml_m1")[0]!.status, "delivered");
  // credit stays with the person who asked
  assert.deepEqual((await trail(r.ctx, { messageId: child })).sentBy, { kind: "person", id: "usr_ask01" });
  // the provider key is the same whatever the attempt: the retried message and the address
  assert.equal(r.calls("resend.send_email")[0]!.input.idempotencyKey, "retry:eml_m1:pat@acme.test");
});

test("the first record of who asked stands; a later send of the same message by the system does not replace it", async () => {
  const r = rig({ principal: { kind: "person", id: "usr_maya01" } });
  recordSentBy(r.ctx, "eml_x1");
  (r.ctx as unknown as { principal: { kind: string; id: string } }).principal = system;
  recordSentBy(r.ctx, "eml_x1");
  assert.deepEqual(r.h.rows(`SELECT kind, principal FROM mail_sent_by WHERE "messageId" = ?`, "eml_x1"), [{ kind: "person", principal: "usr_maya01" }]);
});
