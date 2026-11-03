// Replying in a thread (owner, 3 Nov): a reply from a member mailbox stays in the thread for everyone on it. Gmail gets this mailbox's thread id and the
// In-Reply-To and References chain; Graph gets this mailbox's id of the message answered, so it replies through createReply; a Space domain send carries the
// whole References chain. The sent Gmail message's own copy is kept, so the next reply from here threads too.
import test from "node:test";
import assert from "node:assert/strict";
import { ingest } from "../handlers/ingest.ts";
import { send } from "../handlers/send.ts";
import { contractErrors, NOW } from "../fixtures/harness.ts";
import { rig, row, sendIn } from "./send.rig.test.ts";

const JOSH = "josh@cohenshah.test";

test("a reply from Gmail goes into this mailbox's Gmail thread with In-Reply-To and the References chain", async () => {
  const r = rig();
  const parent = await ingest(r.ctx, {
    source: "google", mailboxId: "mbx_maya", providerId: "gm_c4", rfcMessageId: "<c4@cohenshah.test>", threadKey: "18c2a1f04e9b", from: { address: JOSH }, to: [{ address: "maya@vyre.test" }],
    subject: "RE: Clio Grow setup", text: "Can we do 11:00?", receivedAt: NOW, headers: { References: "<j0@cohenshah.test> <c3@cohenshah.test>", "In-Reply-To": "<c3@cohenshah.test>" },
  });
  const input = sendIn({ mailboxId: "mbx_maya", to: [{ address: JOSH }], subject: "Re: Clio Grow setup", text: "11:00 works.", replyToMessageId: parent.messageId });
  assert.deepEqual(contractErrors("mail.send", "in", input), []);
  const out = await send(r.ctx, input);
  const call = r.calls("google.gmail.send_message")[0]!.input;
  assert.deepEqual(contractErrors("google.gmail.send_message", "in", call), []);
  assert.equal(call.threadId, "18c2a1f04e9b");
  assert.equal(call.inReplyTo, "<c4@cohenshah.test>");
  assert.equal(call.references, "<j0@cohenshah.test> <c3@cohenshah.test> <c4@cohenshah.test>");
  const m = row(r, out.messageId ?? "")!;
  assert.equal(m.threadId, row(r, parent.messageId)!.threadId, "the reply is stored in the thread it answers");
  assert.deepEqual(r.h.rows(`SELECT "providerId", "threadKey" FROM mail_copy WHERE "messageId" = ?`, out.messageId ?? ""), [{ providerId: "gm_1", threadKey: "thr_g" }]);
});

test("a reply from Outlook answers this mailbox's copy through createReply", async () => {
  const r = rig();
  const parent = await ingest(r.ctx, {
    source: "microsoft", mailboxId: "mbx_sam", providerId: "AAMkAD-sam-copy", rfcMessageId: "<w2@cohenshah.test>", threadKey: "AAQkAD-conv", from: { address: JOSH }, to: [{ address: "sam@vyre.test" }],
    subject: "RE: Welcome to Scout, Josh", text: "Thanks Andrey.", receivedAt: NOW,
  });
  await send(r.ctx, sendIn({ mailboxId: "mbx_sam", to: [{ address: JOSH }], subject: "Re: Welcome to Scout, Josh", text: "Wednesday works.", replyToMessageId: parent.messageId }));
  const call = r.calls("ms.mail.send_message")[0]!.input;
  assert.deepEqual(contractErrors("ms.mail.send_message", "in", call), []);
  assert.equal(call.replyTo, "AAMkAD-sam-copy");
});

test("a new email (no reply target) starts its own thread and carries no reply headers", async () => {
  const r = rig();
  const out = await send(r.ctx, sendIn({ mailboxId: "mbx_maya", to: [{ address: JOSH }], subject: "Separate topic", text: "A new question." }));
  const call = r.calls("google.gmail.send_message")[0]!.input;
  assert.deepEqual([call.threadId, call.inReplyTo, call.references], [undefined, undefined, undefined]);
  assert.equal(row(r, out.messageId ?? "")!.threadId, out.messageId);
});

test("a Space domain reply carries In-Reply-To and the whole References chain", async () => {
  const r = rig();
  const parent = await ingest(r.ctx, {
    source: "resend", mailboxId: "mbx_hello", providerId: "rs_1", rfcMessageId: "<c4@cohenshah.test>", from: { address: JOSH }, to: [{ address: "hello@vyre.test" }],
    subject: "Question", text: "Hi", receivedAt: NOW, headers: { References: "<j0@cohenshah.test>" },
  });
  await send(r.ctx, sendIn({ replyToMessageId: parent.messageId, subject: "Re: Question" }));
  const headers = r.calls("resend.send_email")[0]!.input.headers as Record<string, string>;
  assert.equal(headers["In-Reply-To"], "<c4@cohenshah.test>");
  assert.equal(headers.References, "<j0@cohenshah.test> <c4@cohenshah.test>");
});
