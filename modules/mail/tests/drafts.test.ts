// mail.draft, mail.drafts.list, mail.drafts.discard: a draft is a mail_message row (status draft, direction out) that nothing sends.
// An agent draft carries the Gate line; a person editing it does not clear who drafted it.
import test from "node:test";
import assert from "node:assert/strict";
import { draft, draftsDiscard, draftsList } from "../handlers/drafts.ts";
import { ingest } from "../handlers/ingest.ts";
import { codeOf, contractErrors, harness, letter, NOW, seedMailbox } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";

const MBX = "mbx_maya";
const PERSON = { kind: "person", id: "usr_maya01" } as const;
const AGENT = { kind: "agent", id: "agt_scout01" } as const;

function setup(opts: Parameters<typeof harness>[0] = {}): Harness {
  const h = harness(opts);
  seedMailbox(h, MBX, "maya@vyre.test", { kind: "personal", provider: "google", ownerId: "usr_maya01" });
  return h;
}

let keys = 0;
const key = (): string => `idem-${++keys}`;
const row = (h: Harness, id: string) => h.rows(`SELECT * FROM mail_message WHERE id = ?`, id)[0]!;
const body = (h: Harness, id: string) => h.rows(`SELECT * FROM mail_body WHERE "messageId" = ?`, id)[0]!;
const addrs = (json: unknown): string[] => (JSON.parse(String(json)) as { address: string }[]).map((p) => p.address);

test("a person's draft is saved as a draft row with no Gate line", async () => {
  const h = setup();
  const out = await draft(h.ctx, {
    mailboxId: MBX, to: [{ address: "Pat@Acme.test", name: "Pat Lee" }], subject: "Hello Pat", text: "Thanks for your time.", idempotencyKey: key(),
  });
  assert.deepEqual(contractErrors("mail.draft", "out", out), []);
  assert.equal(out.gateLine, undefined);
  const r = row(h, out.draftId);
  assert.deepEqual([r.status, r.direction, r.fromAddress, r.subject, r.version], ["draft", "out", "maya@vyre.test", "Hello Pat", 1]);
  assert.equal(r.providerId, null);
  assert.equal(r.rfcMessageId, null);
  assert.equal(r.draftedByAgent, null);
  assert.equal(r.threadId, out.draftId);
  assert.deepEqual(JSON.parse(String(r.toAddresses)), [{ address: "pat@acme.test", name: "Pat Lee" }]);
  assert.equal(body(h, out.draftId).text, "Thanks for your time.");
  assert.deepEqual(h.named("mail_draft.saved").map((e) => e.payload), [{ draftId: out.draftId, mailboxId: MBX }]);
  assert.equal(h.calls("mail.send").length, 0);
});

test("an agent draft carries the Gate line and its agent", async () => {
  const h = setup({ principal: AGENT });
  const out = await draft(h.ctx, { mailboxId: MBX, to: [{ address: "pat@acme.test" }], subject: "Follow up", text: "Hi Pat", idempotencyKey: key() });
  assert.match(out.gateLine ?? "", /person approves/);
  assert.equal(row(h, out.draftId).draftedByAgent, "agt_scout01");
  assert.equal(h.named("mail_draft.saved")[0]?.payload.byAgent, "agt_scout01");
  assert.deepEqual(contractErrors("mail.draft", "out", out), []);
});

test("a person editing an agent draft keeps who drafted it and the Gate line", async () => {
  const h = setup({ principal: AGENT });
  const made = await draft(h.ctx, { mailboxId: MBX, to: [{ address: "pat@acme.test" }], subject: "Follow up", text: "Hi Pat", idempotencyKey: key() });
  h.ctx.principal = PERSON;
  h.advance(60_000);
  const edited = await draft(h.ctx, { mailboxId: MBX, draftId: made.draftId, subject: "Following up", text: "Hi Pat, quick note.", idempotencyKey: key() });
  assert.equal(edited.draftId, made.draftId);
  assert.ok(edited.gateLine);
  const r = row(h, made.draftId);
  assert.deepEqual([r.subject, r.version, r.draftedByAgent, r.sentAt], ["Following up", 2, "agt_scout01", NOW + 60_000]);
  assert.deepEqual(addrs(r.toAddresses), ["pat@acme.test"]);   // untouched fields stay
  assert.equal(body(h, made.draftId).text, "Hi Pat, quick note.");
  assert.equal(h.rows(`SELECT id FROM mail_message`).length, 1);
});

test("one recipient field: an address appears once, To before Cc before Bcc", async () => {
  const h = setup();
  const out = await draft(h.ctx, {
    mailboxId: MBX, subject: "Team", text: "x", idempotencyKey: key(),
    to: [{ address: "a@x.test" }, { address: "B@x.test" }], cc: [{ address: "b@x.test" }, { address: "c@x.test" }], bcc: [{ address: "a@x.test" }, { address: "c@x.test" }, { address: "d@x.test" }],
  });
  const r = row(h, out.draftId);
  assert.deepEqual(addrs(r.toAddresses), ["a@x.test", "b@x.test"]);
  assert.deepEqual(addrs(r.ccAddresses), ["c@x.test"]);
  assert.deepEqual(addrs(body(h, out.draftId).bcc), ["d@x.test"]);
});

test("the same idempotency key returns the same draft and writes nothing more", async () => {
  const h = setup();
  const k = key();
  const a = await draft(h.ctx, { mailboxId: MBX, to: [{ address: "pat@acme.test" }], subject: "Once", idempotencyKey: k });
  const b = await draft(h.ctx, { mailboxId: MBX, to: [{ address: "pat@acme.test" }], subject: "Once", idempotencyKey: k });
  assert.equal(a.draftId, b.draftId);
  assert.equal(h.rows(`SELECT id FROM mail_message`).length, 1);
  assert.equal(h.named("mail_draft.saved").length, 1);
});

test("a reply draft takes the thread, the subject and the sender of the message it answers", async () => {
  const h = setup({ contacts: { "pat@acme.test": [{ recordId: "rec_pat01", score: 0.9 }] } });
  const got = await ingest(h.ctx, letter("pat@acme.test", "<q@acme.test>", "g-q", { mailboxId: MBX, subject: "Question", threadKey: "thread-q" }));
  const out = await draft(h.ctx, { mailboxId: MBX, replyToMessageId: got.messageId, text: "Yes.", idempotencyKey: key() });
  const r = row(h, out.draftId);
  assert.equal(r.subject, "Re: Question");
  assert.equal(r.threadId, "thread-q");
  assert.equal(r.contactId, "rec_pat01");
  assert.deepEqual(addrs(r.toAddresses), ["pat@acme.test"]);
  const answered = await ingest(h.ctx, letter("pat@acme.test", "<q2@acme.test>", "g-q2", { mailboxId: MBX, subject: "Re: Question" }));
  const again = await draft(h.ctx, { mailboxId: MBX, replyToMessageId: answered.messageId, text: "Thanks.", idempotencyKey: key() });
  assert.equal(row(h, again.draftId).subject, "Re: Question");   // no second Re:
});

test("a reply to mail we sent goes to its recipients and never to ourselves", async () => {
  const h = setup();
  const sent = await ingest(h.ctx, letter("maya@vyre.test", "<s@vyre.test>", "g-s", { mailboxId: MBX, direction: "out", to: [{ address: "pat@acme.test" }, { address: "maya@vyre.test" }] }));
  const out = await draft(h.ctx, { mailboxId: MBX, replyToMessageId: sent.messageId, subject: "Re: Hello", idempotencyKey: key() });
  assert.deepEqual(addrs(row(h, out.draftId).toAddresses), ["pat@acme.test"]);
});

test("a reply to a message that is not in this mailbox is refused", async () => {
  const h = setup();
  seedMailbox(h, "mbx_other", "other@vyre.test");
  const got = await ingest(h.ctx, letter("pat@acme.test", "<o@acme.test>", "g-o", { mailboxId: "mbx_other" }));
  await assert.rejects(() => draft(h.ctx, { mailboxId: MBX, replyToMessageId: got.messageId, idempotencyKey: key() }), (e) => codeOf(e) === "validation.not_found");
  assert.equal(h.rows(`SELECT id FROM mail_message WHERE status = ?`, "draft").length, 0);
});

test("attachments are kept as file ids and checked", async () => {
  const h = setup();
  const out = await draft(h.ctx, { mailboxId: MBX, to: [{ address: "pat@acme.test" }], subject: "Files", attachments: ["fil_a1", "fil_b2"], idempotencyKey: key() });
  assert.deepEqual(JSON.parse(String(row(h, out.draftId).attachments)), [{ fileId: "fil_a1" }, { fileId: "fil_b2" }]);
  await assert.rejects(() => draft(h.ctx, { mailboxId: MBX, attachments: ["file one"], idempotencyKey: key() }), (e) => codeOf(e) === "validation.bad_input");
});

test("an edit must name a draft of the same mailbox", async () => {
  const h = setup();
  seedMailbox(h, "mbx_other", "other@vyre.test");
  const made = await draft(h.ctx, { mailboxId: MBX, subject: "Mine", idempotencyKey: key() });
  await assert.rejects(() => draft(h.ctx, { mailboxId: "mbx_other", draftId: made.draftId, idempotencyKey: key() }), (e) => codeOf(e) === "validation.bad_input");
  await assert.rejects(() => draft(h.ctx, { mailboxId: MBX, draftId: "eml_nothere", idempotencyKey: key() }), (e) => codeOf(e) === "validation.not_found");
  const got = await ingest(h.ctx, letter("pat@acme.test", "<n@acme.test>", "g-n", { mailboxId: MBX }));
  await assert.rejects(() => draft(h.ctx, { mailboxId: MBX, draftId: got.messageId, idempotencyKey: key() }), (e) => codeOf(e) === "validation.precondition_failed");
});

test("bad input is refused before anything is written", async () => {
  const h = setup();
  const bad = [
    { mailboxId: "box" }, { mailboxId: "mbx_nope" }, { to: [{ address: "nope" }] }, { idempotencyKey: "" }, { contactId: "pat" }, { campaignId: "spring" },
    { replyToMessageId: "msg_1" }, { to: "pat@acme.test" as unknown as { address: string }[] },
  ];
  for (const patch of bad) {
    await assert.rejects(() => draft(h.ctx, { mailboxId: MBX, idempotencyKey: key(), ...patch }), (e) => ["validation.bad_input", "validation.not_found"].includes(codeOf(e)), JSON.stringify(patch));
  }
  assert.equal(h.rows(`SELECT id FROM mail_message`).length, 0);
});

// ---- list

async function three(h: Harness): Promise<string[]> {
  const ids: string[] = [];
  for (const [i, who] of ["pat", "kim", "lee"].entries()) {
    const out = await draft(h.ctx, { mailboxId: MBX, to: [{ address: `${who}@acme.test` }], subject: `Draft ${i}`, ...(who === "kim" ? { contactId: "rec_kim01" } : {}), idempotencyKey: key() });
    ids.push(out.draftId);
    h.advance(1000);
  }
  return ids;
}

test("drafts list newest first, filtered by mailbox and contact, with a cursor", async () => {
  const h = setup();
  const [a, b, c] = await three(h);
  const all = await draftsList(h.ctx, {});
  assert.deepEqual(all.drafts.map((d) => d.id), [c, b, a]);
  assert.equal(all.total, 3);
  assert.equal(all.next, undefined);
  assert.deepEqual(contractErrors("mail.drafts.list", "out", all), []);
  const page1 = await draftsList(h.ctx, { mailboxId: MBX, limit: 2 });
  assert.deepEqual(page1.drafts.map((d) => d.id), [c, b]);
  assert.equal(page1.next, "2");
  const page2 = await draftsList(h.ctx, { mailboxId: MBX, limit: 2, cursor: page1.next });
  assert.deepEqual(page2.drafts.map((d) => d.id), [a]);
  assert.equal(page2.next, undefined);
  assert.deepEqual((await draftsList(h.ctx, { contactId: "rec_kim01" })).drafts.map((d) => d.id), [b]);
  const first = all.drafts[2]!;
  assert.deepEqual([first.status, first.direction, first.from.address, first.draftedByAgent, first.isPrivate], ["draft", "out", "maya@vyre.test", undefined, false]);
});

test("the list leaves out discarded drafts, received mail and mailboxes the caller may not read", async () => {
  const h = setup();
  seedMailbox(h, "mbx_secret", "secret@vyre.test", { kind: "personal", provider: "google", ownerId: "usr_other" });
  const [a, b] = await three(h);
  await draft(h.ctx, { mailboxId: "mbx_secret", subject: "Not yours", idempotencyKey: key() });
  await ingest(h.ctx, letter("pat@acme.test", "<m@acme.test>", "g-m", { mailboxId: MBX }));
  await draftsDiscard(h.ctx, { draftId: a! });
  h.denied.add("mbx_secret");
  const out = await draftsList(h.ctx, {});
  assert.equal(out.drafts.length, 2);
  assert.ok(out.drafts.every((d) => d.mailboxId === MBX && d.id !== a));
  assert.equal(out.total, 2);
  assert.ok(out.drafts.some((d) => d.id === b));
});

test("list refuses a malformed filter, limit or cursor", async () => {
  const h = setup();
  for (const input of [{ mailboxId: "box" }, { contactId: "pat" }, { limit: 0 }, { limit: 501 }, { cursor: "-1" }, { cursor: "x" }]) {
    await assert.rejects(() => draftsList(h.ctx, input), (e) => codeOf(e) === "validation.bad_input", JSON.stringify(input));
  }
});

// ---- discard

test("discard removes the draft from the list and says so once", async () => {
  const h = setup();
  const made = await draft(h.ctx, { mailboxId: MBX, subject: "Oops", idempotencyKey: key() });
  const out = await draftsDiscard(h.ctx, { draftId: made.draftId });
  assert.deepEqual(out, { discarded: true });
  assert.deepEqual(contractErrors("mail.drafts.discard", "out", out), []);
  assert.equal(row(h, made.draftId).deleted_at, NOW);
  assert.deepEqual(h.named("mail_draft.discarded").map((e) => e.payload), [{ draftId: made.draftId }]);
  assert.equal((await draftsList(h.ctx, {})).drafts.length, 0);
  await assert.rejects(() => draftsDiscard(h.ctx, { draftId: made.draftId }), (e) => codeOf(e) === "validation.not_found");
});

test("discard refuses mail that is not a draft, a draft the caller may not use, and a bad id", async () => {
  const h = setup();
  const got = await ingest(h.ctx, letter("pat@acme.test", "<d@acme.test>", "g-d", { mailboxId: MBX }));
  await assert.rejects(() => draftsDiscard(h.ctx, { draftId: got.messageId }), (e) => codeOf(e) === "validation.precondition_failed");
  const made = await draft(h.ctx, { mailboxId: MBX, subject: "Locked", idempotencyKey: key() });
  h.denied.add(MBX);
  await assert.rejects(() => draftsDiscard(h.ctx, { draftId: made.draftId }), (e) => codeOf(e) === "permission.no_grant");
  await assert.rejects(() => draftsDiscard(h.ctx, { draftId: "nope" }), (e) => codeOf(e) === "validation.bad_input");
  assert.equal(row(h, made.draftId).deleted_at, null);
});
