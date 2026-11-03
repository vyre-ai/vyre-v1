// A reply from an Outlook mailbox joins the conversation it answers (owner, 3 Nov): createReply on this mailbox's copy, then our subject, body and recipients
// on the draft, then send. sendMail alone cannot join a conversation. When the message answered is gone, the reply still goes, as a new message.
import test from "node:test";
import assert from "node:assert/strict";
import { mailSend } from "../handlers/graph.ts";
import { act, contractErrors, harness, seedConsent, U } from "../fixtures/harness.ts";

function ready() {
  const h = harness();
  seedConsent(h);
  return h;
}

test("a reply goes through createReply on the message it answers, with our body and recipients, then sends", async () => {
  const h = ready();
  h.on("POST", `${U}/messages/AAMk-copy/createReply`, { status: 201, body: { id: "draft-r1", conversationId: "AAQk-conv" } });
  h.on("PATCH", `${U}/messages/draft-r1`, { body: { id: "draft-r1" } });
  h.on("POST", `${U}/messages/draft-r1/send`, { status: 202 });
  const out = await mailSend(h.ctx, { ...act, to: ["josh@cohenshah.test"], cc: ["andrey@scout.test"], subject: "Re: Welcome to Scout, Josh", text: "Wednesday works.", replyTo: "AAMk-copy" });
  assert.deepEqual(out, { sent: true });
  assert.deepEqual(contractErrors("ms.mail.send_message", "out", out), []);
  assert.deepEqual(h.hits(`${U}/messages/draft-r1`, "PATCH")[0]!.body, {
    subject: "Re: Welcome to Scout, Josh", body: { contentType: "Text", content: "Wednesday works." },
    toRecipients: [{ emailAddress: { address: "josh@cohenshah.test" } }], ccRecipients: [{ emailAddress: { address: "andrey@scout.test" } }],
  });
  assert.equal(h.hits(`${U}/messages/draft-r1/send`, "POST").length, 1);
  assert.equal(h.hits(`${U}/sendMail`).length, 0);
});

test("when the message answered is gone from the mailbox, the reply still goes, as a new message", async () => {
  const h = ready();
  h.on("POST", `${U}/messages/AAMk-gone/createReply`, { status: 404, body: { error: { code: "ErrorItemNotFound" } } });
  h.on("POST", `${U}/sendMail`, { status: 202 });
  const out = await mailSend(h.ctx, { ...act, to: ["josh@cohenshah.test"], subject: "Re: Welcome", text: "Hi", replyTo: "AAMk-gone" });
  assert.deepEqual(out, { sent: true });
  assert.equal(h.hits(`${U}/sendMail`).length, 1);
});
