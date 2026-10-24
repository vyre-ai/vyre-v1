// mail.send, mail.send_preview, mail.send_as: the single send API (spec 2.18). Suppression and consent, the agent line, the trace header,
// the Space domain and the member mailbox routes, drafts and replies, idempotency, errors, and the preview. Windows, throttling and caps
// are in send.window.test.ts; the Gate is in send.gate.test.ts. Every output is checked against the frozen contract.
import test from "node:test";
import assert from "node:assert/strict";
import { draft } from "../handlers/drafts.ts";
import { send, sendAs, sendPreview, TRACE_HEADER } from "../handlers/send.ts";
import type { Route, SendIn } from "../handlers/send.ts";
import { codeOf, contractErrors, NOW } from "../fixtures/harness.ts";
import { rig, row, sendIn, seedDomain } from "./send.rig.test.ts";
import type { Rig } from "./send.rig.test.ts";

const TRACE = "0123456789abcdef0123456789abcdef";
const SATURDAY_3AM = 1_760_151_600_000;   // 2025-10-11 03:00 UTC, outside the default window

async function refused(p: Promise<unknown>, code: string): Promise<void> {
  await assert.rejects(p, (e: unknown) => {
    assert.equal(codeOf(e), code);
    return true;
  });
}

const rows = (r: Rig, table: string) => r.h.rows(`SELECT * FROM ${table}`);

function seedParent(r: Rig, id: string, o: { inboxes: string[]; rfc: string; thread: string }): void {
  r.ctx.db.run(
    `INSERT INTO mail_message (
      id, "mailboxId", "inboxIds", "providerId", "rfcMessageId", "threadId", direction, status,
      "fromAddress", "toAddresses", "ccAddresses", subject, snippet, body, "sentAt", "contactId",
      "isPrivate", "campaignId", attachments, "draftedByAgent", "traceId", version, updated_at, deleted_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id, o.inboxes[0] ?? "", JSON.stringify(o.inboxes), "pid_parent", o.rfc, o.thread, "in", "received",
    "pat@acme.test", JSON.stringify([{ address: "hello@vyre.test" }]), "[]", "Question", "Question", "Question", NOW, null,
    0, null, "[]", null, TRACE, 1, NOW, null,
  );
}

// ---- Space sending through Resend and Mailgun

test("a Space send goes out through the Resend domain with the trace header, a stored row and a message.sent event", async () => {
  const r = rig();
  const input = sendIn({ campaignId: "cmp_spring", contactId: "rec_pat01", to: [{ address: "Pat@Acme.test", name: "Pat Lee" }] });
  assert.deepEqual(contractErrors("mail.send", "in", input), []);
  const out = await send(r.ctx, input);
  assert.equal(out.status, "sent");
  assert.deepEqual(out.suppressed, []);
  assert.deepEqual(contractErrors("mail.send", "out", out), []);

  const id = out.messageId ?? "";
  const call = r.calls("resend.send_email");
  assert.equal(call.length, 1);
  assert.equal(r.calls("mailgun.send_email").length, 0);
  const body = call[0]!.input;
  assert.deepEqual([body.from, body.to, body.subject, body.text], ["hello@vyre.test", ["pat@acme.test"], "Hello", "Hi Pat"]);
  assert.equal(body.replyTo, undefined);
  assert.equal(body.fromName, undefined);
  assert.deepEqual(body.headers, { [TRACE_HEADER]: TRACE, "Message-ID": `<${id}@vyre.test>` });
  assert.deepEqual(body.tags, [{ name: "message_id", value: id }, { name: "campaign_id", value: "cmp_spring" }]);

  const m = row(r, id)!;
  assert.deepEqual([m.status, m.direction, m.providerId, m.rfcMessageId, m.traceId, m.fromAddress, m.version], ["sent", "out", "resend_1", `<${id}@vyre.test>`, TRACE, "hello@vyre.test", 2]);
  assert.deepEqual([m.contactId, m.campaignId, m.threadId], ["rec_pat01", "cmp_spring", id]);
  assert.deepEqual(JSON.parse(String(m.toAddresses)), [{ address: "pat@acme.test", name: "Pat Lee", contactId: "rec_pat01" }]);
  assert.equal(body.idempotencyKey, id);   // the provider capability's own key: one delivery per message
  assert.equal(r.h.rows(`SELECT * FROM mail_body WHERE "messageId" = ?`, id)[0]!.text, "Hi Pat");
  assert.equal(r.h.rows(`SELECT * FROM mail_rfc WHERE "messageId" = ?`, id).length, 1);
  assert.equal(r.h.rows(`SELECT * FROM mail_seen WHERE "messageId" = ?`, id)[0]!.source, "resend");
  assert.deepEqual(rows(r, "mail_send_log").map((l) => [l.mailboxId, l.throttleKey, l.address]), [["mbx_hello", "domain:vyre.test", "pat@acme.test"]]);
  assert.deepEqual(r.h.named("message.sent").map((e) => [e.subject, e.payload]), [
    [`mail_message/${id}`, { messageId: id, channel: "email", mailboxId: "mbx_hello", contactId: "rec_pat01", campaignId: "cmp_spring" }],
  ]);
});

test("the Mailgun provider setting sends through Mailgun on a Mailgun domain, with the mailbox as reply-to", async () => {
  const r = rig({ settings: { "mail.provider": "mailgun" } });
  const out = await send(r.ctx, sendIn({ campaignId: "cmp_spring" }));
  assert.equal(out.status, "sent");
  assert.equal(r.calls("resend.send_email").length, 0);
  const body = r.calls("mailgun.send_email")[0]!.input;
  // the shared inbox address is on vyre.test, which only has a Resend domain; the Mailgun domain carries the mail and hello@ stays reply-to
  assert.deepEqual([body.domain, body.from, body.replyTo], ["mail.other.test", "hello@mail.other.test", "hello@vyre.test"]);
  assert.deepEqual(body.tags, [`message_id:${out.messageId}`, "campaign_id:cmp_spring"]);
  assert.equal(r.h.rows(`SELECT * FROM mail_seen WHERE "messageId" = ?`, out.messageId ?? "")[0]!.source, "mailgun");
  assert.equal(row(r, out.messageId ?? "")!.providerId, "mailgun_1");
});

test("a mailbox on a verified Space domain sends from its own address; another mailbox sends from the domain with itself as reply-to", async () => {
  const r = rig();
  await send(r.ctx, sendIn());
  assert.equal(r.calls("resend.send_email")[0]!.input.from, "hello@vyre.test");
  r.ctx.db.run(`UPDATE mail_mailbox SET address = ?, title = ? WHERE id = ?`, "ann@elsewhere.test", "Ann Cole", "mbx_hello");
  await send(r.ctx, sendIn());
  const body = r.calls("resend.send_email")[1]!.input;
  assert.deepEqual([body.from, body.fromName, body.replyTo], ["ann@vyre.test", "Ann Cole", "ann@elsewhere.test"]);
});

test("no verified sending domain refuses the send and stores nothing", async () => {
  const r = rig({ noDomain: true });
  seedDomain(r.h, "pending.test", "resend", { verified: false });
  await refused(send(r.ctx, sendIn()), "validation.precondition_failed");
  assert.equal(r.sent().length, 0);
  assert.equal(rows(r, "mail_message").length, 0);
});

test("a provider failure marks the row failed and writes no counter, and the same key can be tried again", async () => {
  const r = rig();
  const input = sendIn();
  r.state.failNext = "provider.rate_limited";
  await refused(send(r.ctx, input), "provider.rate_limited");
  assert.deepEqual(rows(r, "mail_message").map((m) => m.status), ["failed"]);
  assert.equal(rows(r, "mail_send_log").length, 0);
  const out = await send(r.ctx, input);
  assert.equal(out.status, "sent");
  assert.deepEqual(rows(r, "mail_message").map((m) => m.status).sort(), ["failed", "sent"]);
  assert.equal(rows(r, "mail_send_log").length, 1);
});

test("the same idempotency key runs the send once and returns the first answer", async () => {
  const r = rig();
  const input = sendIn();
  const first = await send(r.ctx, input);
  const second = await send(r.ctx, input);
  assert.deepEqual(second, first);
  assert.equal(r.sent().length, 1);
  assert.equal(rows(r, "mail_message").length, 1);
  assert.equal(r.h.named("message.sent").length, 1);
});

test("attachments are named from Files and handed to the provider", async () => {
  const r = rig();
  const out = await send(r.ctx, sendIn({ attachments: ["fil_one"] }));
  assert.deepEqual(r.calls("files.get").map((c) => c.input), [{ fileId: "fil_one" }]);
  assert.deepEqual(r.calls("resend.send_email")[0]!.input.attachments, [{ name: "fil_one.pdf", fileId: "fil_one" }]);
  assert.equal(row(r, out.messageId ?? "")!.attachments, JSON.stringify([{ fileId: "fil_one" }]));
});

test("one recipient field: an address appears once, To before Cc before Bcc, and cc and bcc reach the provider", async () => {
  const r = rig();
  await send(r.ctx, sendIn({ to: [{ address: "pat@acme.test" }], cc: [{ address: "PAT@acme.test" }, { address: "lee@acme.test" }], bcc: [{ address: "lee@acme.test" }, { address: "boss@acme.test" }] }));
  const body = r.calls("resend.send_email")[0]!.input;
  assert.deepEqual([body.to, body.cc, body.bcc], [["pat@acme.test"], ["lee@acme.test"], ["boss@acme.test"]]);
});

// ---- suppression and consent

test("a suppressed address is left out, named in the answer and raises message.suppressed; the rest are sent", async () => {
  const r = rig({ suppressed: { "bounced@acme.test": "bounce_hard" } });
  const out = await send(r.ctx, sendIn({ to: [{ address: "pat@acme.test" }, { address: "bounced@acme.test" }], cc: [{ address: "lee@acme.test" }] }));
  assert.equal(out.status, "sent");
  assert.deepEqual(out.suppressed, ["bounced@acme.test"]);
  assert.deepEqual(contractErrors("mail.send", "out", out), []);
  const body = r.calls("resend.send_email")[0]!.input;
  assert.deepEqual([body.to, body.cc], [["pat@acme.test"], ["lee@acme.test"]]);
  assert.deepEqual(r.h.named("message.suppressed").map((e) => [e.subject, e.payload]), [
    ["address/bounced@acme.test", { channel: "email", address: "bounced@acme.test", reason: "bounce_hard" }],
  ]);
  assert.deepEqual(rows(r, "mail_send_log").map((l) => l.address).sort(), ["lee@acme.test", "pat@acme.test"]);
  assert.deepEqual(r.calls("contacts.suppression.check")[0]!.input, { channel: "email", addresses: ["pat@acme.test", "bounced@acme.test", "lee@acme.test"] });
});

test("when every recipient is suppressed nothing is sent or stored, and the campaign is named on the event", async () => {
  const r = rig({ suppressed: { "bounced@acme.test": "bounce_hard", "gone@acme.test": "unsubscribe" } });
  const input = sendIn({ campaignId: "cmp_spring", to: [{ address: "bounced@acme.test" }, { address: "gone@acme.test" }] });
  const out = await send(r.ctx, input);
  assert.deepEqual(out, { status: "suppressed", suppressed: ["bounced@acme.test", "gone@acme.test"] });
  assert.deepEqual(contractErrors("mail.send", "out", out), []);
  assert.equal(r.sent().length, 0);
  assert.equal(rows(r, "mail_message").length, 0);
  assert.equal(rows(r, "mail_send_log").length, 0);
  assert.deepEqual(r.h.named("message.suppressed").map((e) => e.payload), [
    { channel: "email", address: "bounced@acme.test", reason: "bounce_hard", campaignId: "cmp_spring" },
    { channel: "email", address: "gone@acme.test", reason: "unsubscribe", campaignId: "cmp_spring" },
  ]);
  assert.deepEqual(await send(r.ctx, input), out);   // a replay answers the same and raises nothing more
  assert.equal(r.h.named("message.suppressed").length, 2);
});

test("consent: denied, Do-not-contact and an email opt-out refuse; unknown consent and a missing record do not", async () => {
  const none = { smsConsent: "unknown", doNotContact: false, optedOut: [] };
  const r = rig({
    prefs: {
      rec_denied: { ...none, emailConsent: "denied" },
      rec_dnc: { ...none, emailConsent: "granted", doNotContact: true },
      rec_optout: { ...none, emailConsent: "granted", optedOut: ["email"] },
      rec_unknown: { ...none, emailConsent: "unknown" },
      rec_smsonly: { ...none, emailConsent: "granted", optedOut: ["sms"] },
    },
  });
  const out = await send(r.ctx, sendIn({
    to: [
      { address: "a@acme.test", contactId: "rec_denied" }, { address: "b@acme.test", contactId: "rec_dnc" }, { address: "c@acme.test", contactId: "rec_optout" },
      { address: "d@acme.test", contactId: "rec_unknown" }, { address: "e@acme.test", contactId: "rec_smsonly" }, { address: "f@acme.test", contactId: "rec_gone" },
    ],
  }));
  assert.deepEqual(out.suppressed, ["a@acme.test", "b@acme.test", "c@acme.test"]);
  assert.deepEqual(r.calls("resend.send_email")[0]!.input.to, ["d@acme.test", "e@acme.test", "f@acme.test"]);
  assert.deepEqual(r.h.named("message.suppressed").map((e) => e.payload.reason), ["consent_denied", "do_not_contact", "opted_out"]);
});

test("the top-level contact stands for the first recipient and its consent applies", async () => {
  const r = rig({ prefs: { rec_denied: { emailConsent: "denied", smsConsent: "unknown", doNotContact: false, optedOut: [] } } });
  const out = await send(r.ctx, sendIn({ contactId: "rec_denied" }));
  assert.deepEqual(out, { status: "suppressed", suppressed: ["pat@acme.test"] });
  assert.deepEqual(r.calls("contacts.preferences.get").map((c) => c.input), [{ contactId: "rec_denied" }]);
});

test("an address already on the suppression list is not asked about consent", async () => {
  const r = rig({ suppressed: { "a@acme.test": "complaint" } });
  await send(r.ctx, sendIn({ to: [{ address: "a@acme.test", contactId: "rec_x" }, { address: "b@acme.test" }] }));
  assert.equal(r.calls("contacts.preferences.get").length, 0);
});

// ---- the agent line and the trace id

test("a message an agent sent carries the Drafted by an agent line in text and html, and its row names the agent", async () => {
  const r = rig({ principal: { kind: "agent", id: "agt_scout01" } });
  const out = await send(r.ctx, sendIn({ text: "Hi Pat", html: "<html><body><p>Hi Pat</p></body></html>" }));
  const body = r.calls("resend.send_email")[0]!.input;
  assert.equal(body.text, "Hi Pat\n\n-- \nDrafted by an agent");
  assert.match(String(body.html), /<p>Hi Pat<\/p><p style="[^"]+">Drafted by an agent<\/p><\/body><\/html>$/);
  const m = row(r, out.messageId ?? "")!;
  assert.equal(m.draftedByAgent, "agt_scout01");
  assert.equal(r.h.rows(`SELECT * FROM mail_body WHERE "messageId" = ?`, out.messageId ?? "")[0]!.text, "Hi Pat\n\n-- \nDrafted by an agent");
});

test("a person's own message has no agent line", async () => {
  const r = rig();
  const out = await send(r.ctx, sendIn({ html: "<p>Hi</p>" }));
  const body = r.calls("resend.send_email")[0]!.input;
  assert.deepEqual([body.text, body.html], ["Hi Pat", "<p>Hi</p>"]);
  assert.equal(row(r, out.messageId ?? "")!.draftedByAgent, null);
});

test("the Space setting can switch the agent line off", async () => {
  const r = rig({ principal: { kind: "agent", id: "agt_scout01" }, settings: { "gate.drafted_by_label": false } });
  await send(r.ctx, sendIn());
  assert.equal(r.calls("resend.send_email")[0]!.input.text, "Hi Pat");
});

test("a person sending an agent's draft keeps the agent line and the agent's name on the row", async () => {
  const r = rig({ principal: { kind: "agent", id: "agt_scout01" } });
  const made = await draft(r.ctx, { mailboxId: "mbx_hello", to: [{ address: "pat@acme.test" }], subject: "Follow up", text: "Hi Pat, checking in.", idempotencyKey: "draft-1" });
  r.ctx.principal = { kind: "person", id: "usr_maya01" };
  const out = await send(r.ctx, { mailboxId: "mbx_hello", to: [{ address: "pat@acme.test" }], subject: "Follow up", draftId: made.draftId, idempotencyKey: "send-1" });
  assert.equal(out.messageId, made.draftId);
  assert.equal(r.calls("resend.send_email")[0]!.input.text, "Hi Pat, checking in.\n\n-- \nDrafted by an agent");
  const m = row(r, made.draftId)!;
  assert.deepEqual([m.status, m.draftedByAgent, m.threadId], ["sent", "agt_scout01", made.draftId]);
  assert.equal(rows(r, "mail_message").length, 1);
});

// ---- routes: the Space domain or the member's own mailbox

test("a person's own Gmail mailbox sends through Gmail as that person, with no window, and keeps the Sent copy from duplicating", async () => {
  const r = rig();
  r.goto(SATURDAY_3AM);
  const out = await send(r.ctx, sendIn({ mailboxId: "mbx_maya", text: "Thanks!" }));
  assert.equal(out.status, "sent");
  assert.deepEqual(r.calls("google.gmail.send_message")[0]!.input, { connectionId: "con_g1", as: "maya@vyre.test", to: ["pat@acme.test"], subject: "Hello", text: "Thanks!", idempotencyKey: out.messageId });
  assert.equal(r.calls("resend.send_email").length, 0);
  const m = row(r, out.messageId ?? "")!;
  assert.deepEqual([m.status, m.providerId, m.rfcMessageId], ["sent", "gm_1", null]);
  assert.equal(r.h.rows(`SELECT * FROM mail_seen WHERE "messageId" = ?`, out.messageId ?? "")[0]!.source, "google");
});

test("a Microsoft mailbox sends through Graph; Graph returns no id", async () => {
  const r = rig();
  const out = await send(r.ctx, sendIn({ mailboxId: "mbx_sam", cc: [{ address: "lee@acme.test" }] }));
  assert.equal(out.status, "sent");
  assert.deepEqual(r.calls("ms.mail.send_message")[0]!.input, {
    connectionId: "con_m1", as: "sam@vyre.test", to: ["pat@acme.test"], subject: "Hello", cc: ["lee@acme.test"], text: "Hi Pat", idempotencyKey: out.messageId,
  });
  assert.equal(row(r, out.messageId ?? "")!.providerId, null);
});

test("a person can choose the Space domain from a member mailbox, and an IMAP mailbox defaults to it", async () => {
  const r = rig();
  await send(r.ctx, sendIn({ mailboxId: "mbx_maya", route: "space_domain" }));
  assert.equal(r.calls("resend.send_email")[0]!.input.from, "maya@vyre.test");
  assert.equal(r.calls("google.gmail.send_message").length, 0);
  await send(r.ctx, sendIn({ mailboxId: "mbx_pat" }));
  assert.equal(r.calls("resend.send_email")[1]!.input.from, "pat@vyre.test");
});

test("the mailbox route needs a mailbox that can send, and a connected one", async () => {
  const r = rig();
  await refused(send(r.ctx, sendIn({ mailboxId: "mbx_hello", route: "mailbox" })), "validation.precondition_failed");
  await refused(send(r.ctx, sendIn({ mailboxId: "mbx_pat", route: "mailbox" })), "validation.precondition_failed");
  r.ctx.db.run(`UPDATE mail_mailbox SET paused = ?, state = ? WHERE id = ?`, 1, "paused", "mbx_maya");
  await refused(send(r.ctx, sendIn({ mailboxId: "mbx_maya" })), "validation.precondition_failed");
  r.ctx.db.run(`UPDATE mail_mailbox SET paused = ?, state = ?, "connectionId" = ? WHERE id = ?`, 0, "syncing", null, "mbx_maya");
  await refused(send(r.ctx, sendIn({ mailboxId: "mbx_maya" })), "validation.precondition_failed");
  assert.equal(r.sent().length, 0);
});

// ---- who may send

test("sending needs use of the mailbox, comms.shared_send on a shared inbox, and comms.agent_send for an agent", async () => {
  const shared = rig({ deniedPerms: ["comms.shared_send"] });
  await refused(send(shared.ctx, sendIn({ mailboxId: "mbx_hello" })), "permission.no_grant");
  assert.equal((await send(shared.ctx, sendIn({ mailboxId: "mbx_maya", route: "space_domain" }))).status, "sent");

  const agent = rig({ principal: { kind: "agent", id: "agt_scout01" }, deniedPerms: ["comms.agent_send"] });
  await refused(send(agent.ctx, sendIn({ mailboxId: "mbx_maya" })), "permission.no_grant");
  assert.equal(agent.sent().length, 0);

  const closed = rig({ denied: new Set(["mbx_maya"]) });
  await refused(send(closed.ctx, sendIn({ mailboxId: "mbx_maya" })), "permission.no_grant");
  await refused(send(closed.ctx, sendIn({ mailboxId: "mbx_nobody" })), "validation.not_found");
});

// ---- replies

test("a reply joins the thread and carries In-Reply-To and References", async () => {
  const r = rig();
  seedParent(r, "eml_parent1", { inboxes: ["mbx_hello"], rfc: "<orig@acme.test>", thread: "eml_thread1" });
  const out = await send(r.ctx, sendIn({ replyToMessageId: "eml_parent1", subject: "Re: Question" }));
  const headers = r.calls("resend.send_email")[0]!.input.headers as Record<string, string>;
  assert.deepEqual([headers["In-Reply-To"], headers.References], ["<orig@acme.test>", "<orig@acme.test>"]);
  assert.equal(row(r, out.messageId ?? "")!.threadId, "eml_thread1");
  seedParent(r, "eml_parent2", { inboxes: ["mbx_other"], rfc: "<other@acme.test>", thread: "eml_thread2" });
  await refused(send(r.ctx, sendIn({ replyToMessageId: "eml_parent2" })), "validation.not_found");
});

// ---- bad input

test("bad input is refused before anything is read or sent", async () => {
  const r = rig();
  await refused(send(r.ctx, sendIn({ to: [] })), "validation.bad_input");
  await refused(send(r.ctx, sendIn({ to: [{ address: "not-an-email" }] })), "validation.bad_input");
  await refused(send(r.ctx, sendIn({ cc: [{ address: "nope" }] })), "validation.bad_input");
  await refused(send(r.ctx, sendIn({ mailboxId: "mailbox-1" })), "validation.bad_input");
  await refused(send(r.ctx, sendIn({ idempotencyKey: "" })), "validation.bad_input");
  await refused(send(r.ctx, sendIn({ attachments: ["file-1"] })), "validation.bad_input");
  await refused(send(r.ctx, sendIn({ contactId: "pat" })), "validation.bad_input");
  await refused(send(r.ctx, sendIn({ campaignId: "spring" })), "validation.bad_input");
  await refused(send(r.ctx, sendIn({ sendAt: 1.5 })), "validation.bad_input");
  await refused(send(r.ctx, { ...sendIn(), route: "bogus" as unknown as Route }), "validation.bad_input");
  await refused(send(r.ctx, { ...sendIn(), text: undefined } as unknown as SendIn), "validation.bad_input");   // no body at all
  await refused(send(r.ctx, { ...sendIn(), subject: undefined } as unknown as SendIn), "validation.bad_input");
  await refused(send(r.ctx, sendIn({ draftId: "draft-1" })), "validation.bad_input");
  await refused(send(r.ctx, sendIn({ draftId: "eml_nodraft" })), "validation.not_found");
  assert.equal(r.seen.filter((s) => s.cap !== "settings.get").length, 0);
  assert.equal(rows(r, "mail_message").length, 0);
});

test("a message that was already sent cannot be sent again as a draft, and a draft of another mailbox is refused", async () => {
  const r = rig();
  const out = await send(r.ctx, sendIn());
  await refused(send(r.ctx, sendIn({ draftId: out.messageId ?? "" })), "validation.precondition_failed");
  const made = await draft(r.ctx, { mailboxId: "mbx_maya", to: [{ address: "pat@acme.test" }], subject: "Hi", text: "x", idempotencyKey: "d1" });
  await refused(send(r.ctx, sendIn({ draftId: made.draftId })), "validation.bad_input");
});

// ---- mail.send_preview

test("the preview names who would be sent to, who is suppressed and the route, and changes nothing", async () => {
  const r = rig({ suppressed: { "bounced@acme.test": "complaint" } });
  const input = { mailboxId: "mbx_hello", to: [{ address: "pat@acme.test" }, { address: "bounced@acme.test" }], campaignId: "cmp_spring" };
  assert.deepEqual(contractErrors("mail.send_preview", "in", input), []);
  const out = await sendPreview(r.ctx, input);
  assert.deepEqual(out, {
    allowed: ["pat@acme.test"], suppressed: [{ address: "bounced@acme.test", reason: "complaint" }], outsideWindow: [], capRemainingToday: 30, providerRoute: "space_domain",
  });
  assert.deepEqual(contractErrors("mail.send_preview", "out", out), []);
  assert.equal(r.sent().length, 0);
  assert.equal(rows(r, "mail_message").length + rows(r, "mail_send_log").length, 0);
  assert.equal(r.h.emitted.length, 0);
  await send(r.ctx, sendIn());
  assert.equal((await sendPreview(r.ctx, input)).capRemainingToday, 29);
});

test("the preview outside the window lists the recipients that would wait and when the window opens", async () => {
  const r = rig();
  r.goto(SATURDAY_3AM);
  const out = await sendPreview(r.ctx, { mailboxId: "mbx_hello", to: [{ address: "pat@acme.test" }] });
  assert.deepEqual([out.allowed, out.outsideWindow, out.nextWindowAt], [["pat@acme.test"], ["pat@acme.test"], 1_760_342_400_000]);   // Monday 08:00 UTC
  assert.deepEqual(contractErrors("mail.send_preview", "out", out), []);
});

test("the preview of a person's own mailbox has no caps or window, and a paused mailbox does not stop it", async () => {
  const r = rig();
  r.ctx.db.run(`UPDATE mail_mailbox SET paused = ?, state = ? WHERE id = ?`, 1, "paused", "mbx_maya");
  r.goto(SATURDAY_3AM);
  const out = await sendPreview(r.ctx, { mailboxId: "mbx_maya", to: [{ address: "pat@acme.test" }] });
  assert.deepEqual(out, { allowed: ["pat@acme.test"], suppressed: [], outsideWindow: [], providerRoute: "mailbox" });
});

test("the preview checks the same recipients and mailbox as the send", async () => {
  const r = rig();
  await refused(sendPreview(r.ctx, { mailboxId: "mbx_hello", to: [] }), "validation.bad_input");
  await refused(sendPreview(r.ctx, { mailboxId: "mbx_nobody", to: [{ address: "pat@acme.test" }] }), "validation.not_found");
  await refused(sendPreview(r.ctx, { mailboxId: "bad", to: [{ address: "pat@acme.test" }] }), "validation.bad_input");
});

// ---- mail.send_as

test("send_as sends through the member's Gmail and answers with the Gmail id", async () => {
  const r = rig();
  const input = { mailboxId: "mbx_maya", to: [{ address: "pat@acme.test" }], subject: "Re: Question", text: "Yes.", idempotencyKey: "as-1" };
  assert.deepEqual(contractErrors("mail.send_as", "in", input), []);
  const out = await sendAs(r.ctx, input);
  assert.equal(out.providerId, "gm_1");
  assert.deepEqual(contractErrors("mail.send_as", "out", out), []);
  assert.deepEqual(r.calls("google.gmail.send_message")[0]!.input, {
    connectionId: "con_g1", as: "maya@vyre.test", to: ["pat@acme.test"], subject: "Re: Question", text: "Yes.", idempotencyKey: out.messageId,
  });
  assert.equal(row(r, out.messageId)!.status, "sent");
  assert.deepEqual(r.h.named("message.sent").map((e) => e.payload.messageId), [out.messageId]);
  assert.deepEqual(await sendAs(r.ctx, input), out);   // the same key answers the same and sends once
  assert.equal(r.sent().length, 1);
});

test("send_as through Graph answers with the message id only", async () => {
  const r = rig();
  const out = await sendAs(r.ctx, { mailboxId: "mbx_sam", to: [{ address: "pat@acme.test" }], subject: "Hi", html: "<p>Hi</p>", idempotencyKey: "as-2" });
  assert.deepEqual(Object.keys(out), ["messageId"]);
  assert.equal(r.calls("ms.mail.send_message").length, 1);
});

test("send_as is a person's own mail: no window, no cap, but a suppressed recipient refuses the whole send", async () => {
  const r = rig({ suppressed: { "gone@acme.test": "unsubscribe" } });
  r.goto(SATURDAY_3AM);
  await sendAs(r.ctx, { mailboxId: "mbx_maya", to: [{ address: "pat@acme.test" }], subject: "Hi", text: "x", idempotencyKey: "as-3" });
  await refused(sendAs(r.ctx, { mailboxId: "mbx_maya", to: [{ address: "pat@acme.test" }, { address: "gone@acme.test" }], subject: "Hi", text: "x", idempotencyKey: "as-4" }), "validation.bad_input");
  assert.equal(r.sent().length, 1);
  assert.equal(rows(r, "mail_message").length, 1);
});

test("send_as cannot use an IMAP or inbound-only mailbox, a paused one, or without a key", async () => {
  const r = rig();
  const base = { to: [{ address: "pat@acme.test" }], subject: "Hi", text: "x" };
  await refused(sendAs(r.ctx, { ...base, mailboxId: "mbx_pat", idempotencyKey: "as-5" }), "validation.bad_input");
  await refused(sendAs(r.ctx, { ...base, mailboxId: "mbx_hello", idempotencyKey: "as-6" }), "validation.bad_input");
  r.ctx.db.run(`UPDATE mail_mailbox SET paused = ?, state = ? WHERE id = ?`, 1, "paused", "mbx_maya");
  await refused(sendAs(r.ctx, { ...base, mailboxId: "mbx_maya", idempotencyKey: "as-7" }), "validation.bad_input");
  await refused(sendAs(r.ctx, { ...base, mailboxId: "mbx_sam", idempotencyKey: "" }), "validation.bad_input");
  assert.equal(r.sent().length, 0);
});

test("send_as by an agent adds the agent line", async () => {
  const r = rig({ principal: { kind: "agent", id: "agt_scout01" } });
  await sendAs(r.ctx, { mailboxId: "mbx_maya", to: [{ address: "pat@acme.test" }], subject: "Hi", text: "Hello", idempotencyKey: "as-8" });
  assert.equal(r.calls("google.gmail.send_message")[0]!.input.text, "Hello\n\n-- \nDrafted by an agent");
});
