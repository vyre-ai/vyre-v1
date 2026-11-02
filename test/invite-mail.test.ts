// An emailed invite goes through the Space's one send API (mail.send) into the test mail sink the send tests share (modules/mail/tests/send.rig.test.ts): nothing leaves the process.
// What the person gets: the subject, who invited them, the link and that it works once.
import test from "node:test";
import assert from "node:assert/strict";
import { send } from "../modules/mail/handlers/send.ts";
import { rig } from "../modules/mail/tests/send.rig.test.ts";
import { draftInvites, sendDrafts } from "../apps/app/src/onboarding/suite.ts";

const LINK = "https://acme.vyre.run/join#c=ABCD-EFGH&k=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA&fp=411bb1ab4c98e74a";

test("an emailed invite leaves through mail.send from the inviter's own mailbox, with the link in the body", async () => {
  const r = rig();
  const call = async (cap: string, input: unknown): Promise<unknown> => { assert.equal(cap, "mail.send"); return send(r.ctx, input as never); };
  const drafts = draftInvites([{ email: "erin@example.test", link: LINK }], new Map([["erin@example.test", "Erin Hale"]]), "Olive Owner", "Acme");
  const out = await sendDrafts(call as never, { mailboxId: "mbx_maya", address: "maya@vyre.test" }, drafts, "invite-mail-1");
  assert.deepEqual(out, [{ to: "erin@example.test", status: "sent" }]);
  const sent = r.sent();
  assert.equal(sent.length, 1, "one message reached the sink");
  const raw = JSON.stringify(sent[0]!.input);
  assert.match(raw, /Olive Owner invited you to Acme on Vyre/);
  assert.ok(raw.includes(LINK.replace(/&/g, "\\u0026")) || raw.includes(LINK), "the link is in the message as written");
  const body = r.h.rows(`SELECT text FROM mail_body`)[0]!.text as string;
  assert.match(body, /^Hi Erin,\n\nOlive Owner invited you to join Acme on Vyre/);
  assert.match(body, /The link works once and expires\./);
});
