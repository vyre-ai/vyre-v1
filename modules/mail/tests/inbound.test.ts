// Watching inboxes (lane r42-email-in): machine-made mail is recognised and never answered automatically, failures on the way in are kept and shown with
// the one thing to do, and mail.inbox.monitor says per inbox how it is fed and whether it works. Addresses end in .test; nothing leaves the process.
import test from "node:test";
import assert from "node:assert/strict";
import { autoReason, ingestWatched, monitor, syncWatched } from "../handlers/extra/inbound.ts";
import { ingest } from "../handlers/ingest.ts";
import { send } from "../handlers/send.ts";
import { codeOf, contractErrors, letter, NOW } from "../fixtures/harness.ts";
import { rig, sendIn } from "./send.rig.test.ts";

const MIN = 60_000;

test("machine-made mail is recognised by its headers and sender, and mail from a person is not", () => {
  assert.equal(autoReason({ "auto-submitted": "auto-replied" }, "pat@acme.test"), "an automatic reply");
  assert.equal(autoReason({ "auto-submitted": "no" }, "pat@acme.test"), null);
  assert.equal(autoReason({ "x-auto-response-suppress": "All" }, "pat@acme.test"), "an automatic reply");
  assert.equal(autoReason({ precedence: "Bulk" }, "pat@acme.test"), "bulk mail");
  assert.equal(autoReason({ "list-id": "<news.acme.test>" }, "pat@acme.test"), "a mailing list");
  assert.equal(autoReason({ "content-type": "multipart/report; report-type=delivery-status" }, "mailer-daemon@acme.test"), "a delivery report");
  assert.equal(autoReason({}, "no-reply@acme.test"), "a sender that does not read replies");
  assert.equal(autoReason({}, "noreply+x@acme.test"), "a sender that does not read replies");
  assert.equal(autoReason({}, "pat@acme.test"), null);
  assert.equal(autoReason(undefined, "reply@acme.test"), null);
});

test("an auto-reply is stored, announced as auto, and an Automation or agent may not answer it; a person may", async () => {
  const r = rig({ origin: "automation" });
  const auto = await ingest(r.ctx, letter("pat@acme.test", "<a1@acme.test>", "gm_a1", { mailboxId: "mbx_maya", headers: { "Auto-Submitted": "auto-replied" } }));
  const human = await ingest(r.ctx, letter("kim@acme.test", "<h1@acme.test>", "gm_h1", { mailboxId: "mbx_maya" }));
  const got = r.h.named("mail.received");
  assert.deepEqual(got.map((e) => e.payload.auto), [true, undefined]);
  const reply = (to: string, id: string) => sendIn({ mailboxId: "mbx_maya", to: [{ address: to }], subject: "Re: Hello", text: "Thanks", replyToMessageId: id });
  await assert.rejects(send(r.ctx, reply("pat@acme.test", auto.messageId)), (e) => /automatic reply to it could start a loop/.test(String((e as Error).message ?? "")) || codeOf(e) !== "");
  assert.equal((await send(r.ctx, reply("kim@acme.test", human.messageId))).status, "sent");
  const byHand = rig();
  const auto2 = await ingest(byHand.ctx, letter("pat@acme.test", "<a2@acme.test>", "gm_a2", { mailboxId: "mbx_maya", headers: { Precedence: "bulk" } }));
  assert.equal((await send(byHand.ctx, sendIn({ mailboxId: "mbx_maya", to: [{ address: "pat@acme.test" }], subject: "Re: Hello", text: "Hi", replyToMessageId: auto2.messageId }))).status, "sent");
});

test("mail for an address no inbox answers to is kept as a problem with the fix, once, and moves forward when it repeats", async () => {
  const r = rig();
  const input = letter("pat@acme.test", "<u1@acme.test>", "mg_u1", { source: "mailgun", envelopeTo: "ghost@vyre.test" });
  await assert.rejects(ingestWatched(r.ctx, input, () => ingest(r.ctx, input)), (e) => codeOf(e) === "validation.not_found");
  r.h.advance(5 * MIN);
  await assert.rejects(ingestWatched(r.ctx, input, () => ingest(r.ctx, input)), (e) => codeOf(e) === "validation.not_found");
  const out = await monitor(r.ctx, {});
  assert.deepEqual(contractErrors("mail.inbox.monitor", "out", out), []);
  assert.equal(out.unrouted.length, 1);
  assert.equal(out.unrouted[0]!.address, "ghost@vyre.test");
  assert.equal(out.unrouted[0]!.at, NOW + 5 * MIN);
  assert.match(out.unrouted[0]!.fix, /Add an inbox for that address/);
});

test("an inbox that receives by provider webhook shows when it last received and how many today", async () => {
  const r = rig();
  await ingest(r.ctx, letter("pat@acme.test", "<w1@acme.test>", "mg_w1", { source: "mailgun", envelopeTo: "hello@vyre.test", receivedAt: NOW }));
  r.h.ctx.db.run(`UPDATE mail_message SET "sentAt" = ? WHERE "providerId" = ?`, NOW - 2 * 86_400_000, "mg_w1");
  await ingest(r.ctx, letter("kim@acme.test", "<w2@acme.test>", "mg_w2", { source: "mailgun", envelopeTo: "hello@vyre.test", receivedAt: NOW - 10 * MIN }));
  const row = (await monitor(r.ctx, { mailboxId: "mbx_hello" })).inboxes[0]!;
  assert.deepEqual([row.how, row.state, row.receivedToday, row.lastReceivedAt], ["provider_webhook", "ok", 1, NOW - 10 * MIN]);
  assert.equal(row.problem, undefined);
});

test("a failed sync shows its reason and the fix until something good arrives; a quiet pulling inbox is late, then failing", async () => {
  const r = rig();
  r.h.ctx.db.run(`UPDATE mail_mailbox SET "lastSyncAt" = ?, state = ? WHERE id = ?`, NOW, "syncing", "mbx_pat");
  const quiet = (await monitor(r.ctx, { mailboxId: "mbx_pat" })).inboxes[0]!;
  assert.deepEqual([quiet.how, quiet.state], ["imap", "ok"]);
  r.h.advance(45 * MIN);
  assert.equal((await monitor(r.ctx, { mailboxId: "mbx_pat" })).inboxes[0]!.state, "late");
  r.h.advance(4 * 60 * MIN);
  const down = (await monitor(r.ctx, { mailboxId: "mbx_pat" })).inboxes[0]!;
  assert.equal(down.state, "failing");
  assert.match(down.problem?.reason ?? "", /has not synced for hours/);

  // a sync that fails says why, through the event, and the reason is kept
  await syncWatched(r.ctx, async (watched) => {
    watched.emit("mailbox.sync_failed", "mailbox/mbx_pat", { mailboxId: "mbx_pat", reason: "The mailbox did not accept the sign-in. Reconnect it." });
  });
  const failing = (await monitor(r.ctx, { mailboxId: "mbx_pat" })).inboxes[0]!;
  assert.equal(failing.state, "failing");
  assert.deepEqual([failing.problem?.reason, failing.problem?.fix], ["The mailbox did not accept the sign-in. Reconnect it.", "Open the mailbox and reconnect it."]);
  assert.equal(r.h.named("mailbox.sync_failed").length, 1); // the event still goes out
  // a good sync after it clears the problem
  r.h.advance(MIN);
  r.h.ctx.db.run(`UPDATE mail_mailbox SET "lastSyncAt" = ?, state = ? WHERE id = ?`, r.h.ctx.now(), "syncing", "mbx_pat");
  const healed = (await monitor(r.ctx, { mailboxId: "mbx_pat" })).inboxes[0]!;
  assert.deepEqual([healed.state, healed.problem], ["ok", undefined]);
});

test("a paused inbox says paused; an inbox the caller may not see is left out, and asking for it by id answers as if it were not there", async () => {
  const r = rig({ denied: new Set(["mbx_sam"]) });
  r.h.ctx.db.run(`UPDATE mail_mailbox SET paused = ? WHERE id = ?`, 1, "mbx_pat");
  const all = (await monitor(r.ctx, {})).inboxes;
  assert.equal(all.find((i) => i.mailboxId === "mbx_pat")?.state, "paused");
  assert.equal(all.some((i) => i.mailboxId === "mbx_sam"), false);
  await assert.rejects(monitor(r.ctx, { mailboxId: "mbx_sam" }), (e) => codeOf(e) === "validation.not_found");
  await assert.rejects(monitor(r.ctx, { mailboxId: "nope" }), (e) => codeOf(e) === "validation.bad_input");
});
