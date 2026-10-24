// Connector replay for mail.ingest, mail.connect and mail.sync_now: the same message in two inboxes is one record, a sure match links,
// an unsure match goes to Needs you, private and paused mailboxes keep their mail in the mailbox view, and recorded IMAP sessions
// (LOGIN, catch-up fetch, IDLE) land through the same path. No socket is opened.
// The @reads lines put the recordings and the schema in the import graph, so a change to them selects this file:
// @reads /modules/mail/fixtures/imap/same-message.json
// @reads /modules/mail/fixtures/imap/replay.example.json
// @reads /modules/mail/fixtures/imap/bad.example.json
// @reads /modules/mail/fixtures/imap/stale.example.json
// @reads /modules/mail/migrations/0001_mail_core.sql
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { bindImapSession, connect, ingest, setDefaultImapSession, syncNow } from "../handlers/ingest.ts";
import type { IngestIn } from "../handlers/ingest.ts";
import { codeOf, contractErrors, harness, IMAP, letter, NOW, seedMailbox } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";
import { replayFactory } from "../fixtures/replay.ts";
import { ensure } from "../projections.ts";

const json = <T>(rel: string): T => JSON.parse(readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8")) as T;
const same = json<{ rfcMessageId: string; from: { address: string; name: string }; to: { address: string }[]; subject: string; text: string; receivedAt: number; copies: { source: IngestIn["source"]; providerId: string }[] }>("../fixtures/imap/same-message.json");

const LEE = { "lee@acme.test": [{ recordId: "rec_lee01", score: 0.95 }] };
const PAT = { "pat@acme.test": [{ recordId: "rec_pata", score: 0.4 }, { recordId: "rec_patb", score: 0.55 }] };

async function mailbox(h: Harness, address: string, privacy?: "private" | "space" | "people"): Promise<string> {
  const out = await connect(h.ctx, { provider: "google", address, idempotencyKey: `idem-${address}`, ...(privacy ? { privacy } : {}) });
  assert.deepEqual(contractErrors("mail.connect", "out", out), []);
  return out.mailbox.id;
}

const shared = (h: Harness, id: string, address: string): void => seedMailbox(h, id, address);

test("the schema is created on first use and left alone after", () => {
  const h = harness();
  ensure(h.ctx);
  ensure(h.ctx);
  assert.deepEqual(h.rows(`SELECT id FROM mail_message`), []);
  assert.deepEqual(h.rows(`SELECT "messageId" FROM mail_seen`), []);
  assert.match(readFileSync(fileURLToPath(new URL("../migrations/0001_mail_core.sql", import.meta.url)), "utf8"), /CREATE TABLE IF NOT EXISTS mail_seen/);
});

test("the same provider id is one record, linked once, announced once", async () => {
  const h = harness();
  const mbx = await mailbox(h, "maya@vyre.test");
  const input = letter("pat@acme.test", "<once@acme.test>", "gmail-hist-1", { mailboxId: mbx });
  const first = await ingest(h.ctx, input);
  const second = await ingest(h.ctx, input);
  assert.equal(first.deduped, false);
  assert.equal(second.deduped, true);
  assert.equal(first.messageId, second.messageId);
  assert.equal(h.rows(`SELECT id FROM mail_message`).length, 1);
  assert.equal(h.rows(`SELECT "providerId" FROM mail_seen`).length, 1);
  assert.equal(h.calls("inbox.link_message").length, 1);
  assert.equal(h.named("mail.received").length, 1);
  assert.deepEqual(contractErrors("mail.ingest", "out", first), []);
  assert.deepEqual(contractErrors("mail.ingest", "out", second), []);
});

test("the same message in two inboxes is one record with both inboxes", async () => {
  const h = harness({ contacts: LEE });
  const maya = await mailbox(h, "maya@vyre.test");
  const sam = await mailbox(h, "sam@vyre.test");
  const [a, b] = same.copies;
  assert.ok(a && b);
  const base = { rfcMessageId: same.rfcMessageId, from: same.from, to: same.to, subject: same.subject, text: same.text, receivedAt: same.receivedAt };
  const one = await ingest(h.ctx, { ...base, source: a.source, providerId: a.providerId, mailboxId: maya });
  const two = await ingest(h.ctx, { ...base, source: b.source, providerId: b.providerId, mailboxId: sam });
  assert.equal(one.deduped, false);
  assert.equal(two.deduped, true);
  assert.equal(one.messageId, two.messageId);
  assert.equal(h.rows(`SELECT id FROM mail_message`).length, 1);
  assert.equal(h.rows(`SELECT "rfcMessageId" FROM mail_rfc`).length, 1);
  assert.equal(h.rows(`SELECT "providerId" FROM mail_seen`).length, 2);
  const inboxes = JSON.parse(String(h.rows(`SELECT "inboxIds" FROM mail_message`)[0]?.inboxIds)) as string[];
  assert.deepEqual([...inboxes].sort(), [maya, sam].sort());
  assert.equal(h.calls("inbox.link_message").length, 1);
  assert.equal(h.named("mail.received").length, 1);
  // a redelivery of the second copy changes nothing
  const three = await ingest(h.ctx, { ...base, source: b.source, providerId: b.providerId, mailboxId: sam });
  assert.equal(three.messageId, one.messageId);
  assert.equal(h.rows(`SELECT "providerId" FROM mail_seen`).length, 2);
});

test("a sure address links the message to the contact", async () => {
  const h = harness({ contacts: LEE });
  const mbx = await mailbox(h, "maya@vyre.test");
  const out = await ingest(h.ctx, letter("lee@acme.test", "<sure@acme.test>", "g-sure", { mailboxId: mbx }));
  assert.equal(out.linked, "sure");
  assert.equal(out.contactId, "rec_lee01");
  assert.ok(out.conversationId);
  assert.equal(out.taskId, undefined);
  assert.equal(h.rows(`SELECT "contactId" FROM mail_message`)[0]?.contactId, "rec_lee01");
  assert.equal(h.named("mail.received")[0]?.payload.contactId, "rec_lee01");
  const call = h.calls("inbox.link_message")[0]!.input;
  assert.equal(call.channel, "email");
  assert.equal(call.address, "lee@acme.test");
  assert.equal(call.direction, "in");
  assert.deepEqual(call.ref, { kind: "mail_message", id: out.messageId });
  assert.equal(call.mailboxId, mbx);
});

test("an unsure match goes to Needs you and is not linked", async () => {
  const h = harness({ contacts: PAT });
  const mbx = await mailbox(h, "maya@vyre.test");
  const out = await ingest(h.ctx, letter("pat@acme.test", "<unsure@acme.test>", "g-unsure", { mailboxId: mbx }));
  assert.equal(out.linked, "unsure");
  assert.equal(out.contactId, undefined);
  assert.match(out.taskId ?? "", /^tsk_/);
  assert.equal(h.rows(`SELECT "contactId" FROM mail_message`)[0]?.contactId, null);
  assert.equal(h.named("mail.received")[0]?.payload.contactId, undefined);
  assert.deepEqual(contractErrors("mail.ingest", "out", out), []);
  // a repeat delivery returns the same Needs you task instead of raising another
  const again = await ingest(h.ctx, letter("pat@acme.test", "<unsure@acme.test>", "g-unsure", { mailboxId: mbx }));
  assert.equal(again.taskId, out.taskId);
  assert.equal(h.calls("inbox.link_message").length, 1);
});

test("a stranger stays unmatched", async () => {
  const h = harness();
  const mbx = await mailbox(h, "maya@vyre.test");
  const out = await ingest(h.ctx, letter("who@nowhere.test", "<x@nowhere.test>", "g-x", { mailboxId: mbx }));
  assert.equal(out.linked, "none");
  assert.equal(out.contactId, undefined);
  assert.equal(out.taskId, undefined);
});

test("an address-only delivery finds its mailbox by address and by inbound route", async () => {
  const h = harness();
  shared(h, "mbx_hello", "hello@vyre.test");
  shared(h, "mbx_support", "support@vyre.test");
  h.ctx.db.run(`INSERT INTO mail_domain (id, name, provider, spf, dkim, dmarc, verified, "isDefault", records, "checkedAt", version, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    "dom_mail", "mail.vyre.test", "resend", "pass", "pass", "pass", 1, 1, "[]", NOW, 1, NOW, null);
  h.ctx.db.run(`INSERT INTO mail_route (id, "domainId", "localPart", "mailboxId", provider, version, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    "rte_support", "dom_mail", "help", "mbx_support", "resend", 1, NOW, null);
  const byAddress = await ingest(h.ctx, letter("pat@acme.test", "<a@acme.test>", "rs-1", { source: "resend", envelopeTo: "Hello@Vyre.test" }));
  const byRoute = await ingest(h.ctx, letter("pat@acme.test", "<b@acme.test>", "rs-2", { source: "resend", envelopeTo: "help@mail.vyre.test" }));
  const boxes = h.rows(`SELECT id, "mailboxId" FROM mail_message`).map((r) => r.mailboxId);
  assert.deepEqual(boxes.sort(), ["mbx_hello", "mbx_support"]);
  assert.notEqual(byAddress.messageId, byRoute.messageId);
  await assert.rejects(() => ingest(h.ctx, letter("pat@acme.test", "<c@acme.test>", "rs-3", { source: "resend", envelopeTo: "nobody@vyre.test" })), (e) => codeOf(e) === "validation.not_found");
});

test("mail in a private mailbox is stored but never linked or announced to the Space", async () => {
  const h = harness({ contacts: LEE });
  const priv = await mailbox(h, "sam@vyre.test", "private");
  const out = await ingest(h.ctx, letter("lee@acme.test", "<priv@acme.test>", "g-priv", { mailboxId: priv }));
  assert.equal(out.linked, "none");
  assert.equal(out.contactId, undefined);
  assert.equal(h.calls("inbox.link_message").length, 0);
  assert.equal(h.rows(`SELECT "isPrivate" FROM mail_message`)[0]?.isPrivate, 1);
  assert.equal(h.rows(`SELECT "messageId" FROM mail_link`).length, 0);
  assert.equal(h.named("mail.received")[0]?.vis, "owner");
});

test("a paused mailbox keeps its mail in the mailbox view until a copy arrives in an open one", async () => {
  const h = harness({ contacts: LEE });
  const paused = await mailbox(h, "sam@vyre.test");
  const open = await mailbox(h, "maya@vyre.test");
  h.ctx.db.run(`UPDATE mail_mailbox SET paused = ? WHERE id = ?`, 1, paused);
  const base = { rfcMessageId: "<both@acme.test>", from: { address: "lee@acme.test" }, to: [{ address: "sam@vyre.test" }, { address: "maya@vyre.test" }], subject: "Both", text: "Both", receivedAt: NOW };
  const one = await ingest(h.ctx, { ...base, source: "google", providerId: "g-1", mailboxId: paused });
  assert.equal(one.linked, "none");
  assert.equal(h.calls("inbox.link_message").length, 0);
  const two = await ingest(h.ctx, { ...base, source: "google", providerId: "g-2", mailboxId: open });
  assert.equal(two.deduped, true);
  assert.equal(two.linked, "sure");
  assert.equal(two.contactId, "rec_lee01");
  assert.equal(h.calls("inbox.link_message").length, 1);
});

test("mail from the Sent folder is stored as sent, linked by its recipient and not announced as received", async () => {
  const h = harness({ contacts: LEE });
  const mbx = await mailbox(h, "maya@vyre.test");
  const out = await ingest(h.ctx, letter("maya@vyre.test", "<out@vyre.test>", "g-out", { mailboxId: mbx, direction: "out", to: [{ address: "lee@acme.test" }] }));
  assert.equal(out.linked, "sure");
  assert.equal(h.rows(`SELECT status, direction FROM mail_message`)[0]?.status, "sent");
  assert.equal(h.named("mail.received").length, 0);
  assert.equal(h.calls("inbox.link_message")[0]!.input.address, "lee@acme.test");
  assert.equal(h.calls("inbox.link_message")[0]!.input.direction, "out");
});

test("a reply keeps the thread and the campaign of the message it answers", async () => {
  const h = harness({ contacts: LEE });
  const mbx = await mailbox(h, "maya@vyre.test");
  const sent = await ingest(h.ctx, letter("maya@vyre.test", "<Campaign-1@vyre.test>", "g-c1", { mailboxId: mbx, direction: "out", to: [{ address: "lee@acme.test" }], threadKey: "thread-9" }));
  h.ctx.db.run(`UPDATE mail_message SET "campaignId" = ? WHERE id = ?`, "cmp_spring", sent.messageId);
  const reply = await ingest(h.ctx, letter("lee@acme.test", "<reply-1@acme.test>", "g-r1", { mailboxId: mbx, headers: { "In-Reply-To": "<campaign-1@vyre.test>" } }));
  const row = h.rows(`SELECT "threadId", "campaignId" FROM mail_message WHERE id = ?`, reply.messageId)[0]!;
  assert.equal(row.threadId, "thread-9");
  assert.equal(row.campaignId, "cmp_spring");
  assert.equal(h.named("mail.received")[0]?.payload.campaignId, "cmp_spring");
  assert.equal(h.calls("inbox.link_message")[1]!.input.campaignId, "cmp_spring");
});

test("when the linking step is down the message is kept and linked on the next delivery", async () => {
  const h = harness({ contacts: LEE, linkFails: true });
  const mbx = await mailbox(h, "maya@vyre.test");
  const input = letter("lee@acme.test", "<late@acme.test>", "g-late", { mailboxId: mbx });
  const first = await ingest(h.ctx, input);
  assert.equal(first.linked, "none");
  assert.equal(h.rows(`SELECT id FROM mail_message`).length, 1);
  assert.equal(h.rows(`SELECT "messageId" FROM mail_link`).length, 0);
  h.failLinks(false);
  const second = await ingest(h.ctx, input);
  assert.equal(second.deduped, true);
  assert.equal(second.linked, "sure");
  assert.equal(h.rows(`SELECT "contactId" FROM mail_message`)[0]?.contactId, "rec_lee01");
});

test("a pull from a person's mailbox writes a read log row for that person; hook delivery to a shared inbox does not", async () => {
  const h = harness();
  const mbx = await mailbox(h, "maya@vyre.test");
  await ingest(h.ctx, letter("pat@acme.test", "<r1@acme.test>", "g-r1", { mailboxId: mbx }));
  shared(h, "mbx_hello", "hello@vyre.test");
  await ingest(h.ctx, letter("pat@acme.test", "<r2@acme.test>", "rs-r2", { source: "resend", envelopeTo: "hello@vyre.test" }));
  const log = h.rows(`SELECT actor, "mailboxId", action FROM mail_read_log`);
  assert.deepEqual(log.map((r) => [r.actor, r.mailboxId, r.action]), [["usr_maya01", mbx, "ingest"]]);
});

test("bad input is refused before anything is written", async () => {
  const h = harness();
  const mbx = await mailbox(h, "maya@vyre.test");
  const bad: Partial<IngestIn>[] = [
    { providerId: " " }, { rfcMessageId: "" }, { from: { address: "not-an-email" } }, { to: "x" as unknown as IngestIn["to"] },
    { receivedAt: -1 }, { source: "carrier-pigeon" as unknown as IngestIn["source"] }, { mailboxId: "box" }, { direction: "sideways" as unknown as IngestIn["direction"] },
  ];
  for (const patch of bad) {
    await assert.rejects(() => ingest(h.ctx, { ...letter("pat@acme.test", "<z@acme.test>", "g-z", { mailboxId: mbx }), ...patch }), (e) => codeOf(e) === "validation.bad_input", JSON.stringify(patch));
  }
  await assert.rejects(() => ingest(h.ctx, { ...letter("pat@acme.test", "<z@acme.test>", "g-z"), }), (e) => codeOf(e) === "validation.bad_input");
  await assert.rejects(() => ingest(h.ctx, letter("pat@acme.test", "<z@acme.test>", "g-z", { mailboxId: "mbx_missing" })), (e) => codeOf(e) === "validation.not_found");
  assert.equal(h.rows(`SELECT id FROM mail_message`).length, 0);
});

// ---- mail.connect

test("connect makes a Pending mailbox owned by the caller, once per idempotency key", async () => {
  const h = harness();
  const a = await connect(h.ctx, { provider: "google", address: "Maya@Vyre.test", idempotencyKey: "k1" });
  const b = await connect(h.ctx, { provider: "google", address: "maya@vyre.test", idempotencyKey: "k1" });
  assert.equal(a.mailbox.id, b.mailbox.id);
  assert.equal(a.mailbox.address, "maya@vyre.test");
  assert.equal(a.mailbox.state, "pending");
  assert.equal(a.mailbox.kind, "personal");
  assert.equal(a.mailbox.ownerId, "usr_maya01");
  assert.equal(a.mailbox.privacy, "space");
  assert.equal(h.named("mailbox.connected").length, 1);
  assert.equal(h.named("mailbox.connected")[0]?.payload.memberId, "usr_maya01");
  await assert.rejects(() => connect(h.ctx, { provider: "google", address: "maya@vyre.test", idempotencyKey: "k2" }), (e) => codeOf(e) === "validation.duplicate");
});

test("an agent connects its own address as an agent mailbox", async () => {
  const h = harness({ principal: { kind: "agent", id: "agt_scout01" } });
  const out = await connect(h.ctx, { provider: "microsoft", address: "scout@vyre.test", idempotencyKey: "k" });
  assert.equal(out.mailbox.kind, "agent");
  assert.equal(out.mailbox.agentId, "agt_scout01");
  assert.equal(out.mailbox.ownerId, undefined);
  assert.equal(h.named("mailbox.connected")[0]?.payload.memberId, undefined);
});

test("connect refuses a bad provider, address, privacy, key and IMAP settings", async () => {
  const h = harness();
  bindImapSession(h.ctx, replayFactory);
  const ok = { provider: "google" as const, address: "maya@vyre.test", idempotencyKey: "k" };
  const bad = [
    { ...ok, provider: "aol" as unknown as "google" }, { ...ok, address: "nope" }, { ...ok, privacy: "everyone" as unknown as "space" }, { ...ok, idempotencyKey: "" },
    { ...ok, provider: "imap" as const }, { ...ok, provider: "imap" as const, imap: { ...IMAP, port: 0 } }, { ...ok, provider: "imap" as const, imap: { ...IMAP, passwordHandle: "plain-text-password" } },
    { ...ok, provider: "imap" as const, imap: { ...IMAP, host: "bad host" } },
  ];
  for (const input of bad) await assert.rejects(() => connect(h.ctx, input), (e) => codeOf(e) === "validation.bad_input", JSON.stringify(input));
  assert.equal(h.rows(`SELECT id FROM mail_mailbox`).length, 0);
});

test("an IMAP connection proves LOGIN and NOOP, keeps only the Vault handle, and logs the sign-in", async () => {
  const h = harness();
  bindImapSession(h.ctx, replayFactory);
  const out = await connect(h.ctx, { provider: "imap", address: "sam@vyre.test", idempotencyKey: "imap", imap: IMAP });
  assert.equal(out.mailbox.provider, "imap");
  assert.equal(out.mailbox.state, "pending");
  const stored = h.rows(`SELECT host, "passwordHandle" FROM mail_imap`)[0]!;
  assert.deepEqual([stored.host, stored.passwordHandle], ["replay.example", "#Imap.Sam"]);
  assert.deepEqual(h.rows(`SELECT actor, action FROM mail_read_log`).map((r) => [r.actor, r.action]), [["usr_maya01", "login"]]);
});

test("a refused IMAP sign-in connects nothing and says so plainly", async () => {
  const h = harness();
  bindImapSession(h.ctx, replayFactory);
  for (const host of ["bad.example", "unrecorded.example"]) {
    await assert.rejects(
      () => connect(h.ctx, { provider: "imap", address: "bad@vyre.test", idempotencyKey: `k-${host}`, imap: { ...IMAP, host, username: "bad@vyre.test" } }),
      (e: unknown) => codeOf(e) === "provider.auth_failed" && (e as Error).message === "The mailbox did not accept the sign-in.",
    );
  }
  assert.equal(h.rows(`SELECT id FROM mail_mailbox`).length, 0);
  assert.equal(h.rows(`SELECT "mailboxId" FROM mail_imap`).length, 0);
});

test("an IMAP connection on a server with no IMAP set up is unavailable, not a bad password", async () => {
  const h = harness();
  setDefaultImapSession(null);   // nothing bound to this context and no module default
  await assert.rejects(() => connect(h.ctx, { provider: "imap", address: "sam@vyre.test", idempotencyKey: "k", imap: IMAP }), (e) => codeOf(e) === "internal.unavailable");
});

// ---- mail.sync_now

async function imapBox(h: Harness): Promise<string> {
  bindImapSession(h.ctx, replayFactory);
  return (await connect(h.ctx, { provider: "imap", address: "sam@vyre.test", idempotencyKey: "imap", imap: IMAP })).mailbox.id;
}

test("sync_now replays the recorded catch-up fetch, the Sent folder and IDLE through mail.ingest", async () => {
  const h = harness({ contacts: { "pat@acme.test": [{ recordId: "rec_pat01", score: 0.9 }] } });
  const mbx = await imapBox(h);
  const out = await syncNow(h.ctx, { mailboxId: mbx });
  assert.match(out.runId, /^run_[a-z0-9]+$/);
  assert.deepEqual(contractErrors("mail.sync_now", "out", out), []);
  assert.equal(h.rows(`SELECT id FROM mail_message`).length, 3);
  const done = h.named("mailbox.sync_completed")[0]!;
  assert.deepEqual([done.payload.received, done.payload.sent], [2, 1]);
  const box = h.rows(`SELECT state, "lastSyncAt" FROM mail_mailbox WHERE id = ?`, mbx)[0]!;
  assert.deepEqual([box.state, box.lastSyncAt], ["syncing", NOW]);
  const imap = h.rows(`SELECT "uidValidity", cursor FROM mail_imap WHERE "mailboxId" = ?`, mbx)[0]!;
  assert.equal(imap.uidValidity, 7);
  assert.deepEqual(JSON.parse(String(imap.cursor)), { INBOX: 11, Sent: 3 });
  // the reply from the Sent folder sits in the thread of the mail it answers
  const threads = h.rows(`SELECT subject, "threadId", status FROM mail_message`);
  const hello = threads.find((r) => r.subject === "First hello")!;
  const reply = threads.find((r) => r.subject === "Re: First hello")!;
  assert.equal(reply.threadId, hello.threadId);
  assert.equal(reply.status, "sent");
  assert.deepEqual(h.rows(`SELECT actor, action FROM mail_read_log`).map((r) => r.action).sort(), ["ingest", "ingest", "ingest", "login", "sync"].sort());
});

test("a second sync_now starts after the saved UID watermark and lands nothing twice", async () => {
  const h = harness();
  const mbx = await imapBox(h);
  await syncNow(h.ctx, { mailboxId: mbx });
  await syncNow(h.ctx, { mailboxId: mbx });
  assert.equal(h.rows(`SELECT id FROM mail_message`).length, 3);
  const second = h.named("mailbox.sync_completed")[1]!;
  assert.deepEqual([second.payload.received, second.payload.sent], [0, 0]);
});

test("a changed UIDVALIDITY restarts the watermark; dedupe absorbs the re-read", async () => {
  const h = harness();
  const mbx = await imapBox(h);
  await syncNow(h.ctx, { mailboxId: mbx });
  h.ctx.db.run(`UPDATE mail_imap SET "uidValidity" = ? WHERE "mailboxId" = ?`, 5, mbx);
  await syncNow(h.ctx, { mailboxId: mbx });
  assert.equal(h.rows(`SELECT id FROM mail_message`).length, 3);
  const again = h.named("mailbox.sync_completed")[1]!;
  assert.deepEqual([again.payload.received, again.payload.sent], [0, 0]);
  assert.equal(h.rows(`SELECT "uidValidity" FROM mail_imap`)[0]?.uidValidity, 7);
});

test("a paused mailbox does not sync and says why", async () => {
  const h = harness();
  const mbx = await imapBox(h);
  h.ctx.db.run(`UPDATE mail_mailbox SET paused = ?, state = ? WHERE id = ?`, 1, "paused", mbx);
  const out = await syncNow(h.ctx, { mailboxId: mbx });
  assert.ok(out.runId);
  assert.match(String(h.named("mailbox.sync_failed")[0]?.payload.reason), /paused/);
  assert.equal(h.rows(`SELECT id FROM mail_message`).length, 0);
});

test("a sign-in that stops working marks the mailbox in error and tells the owner what to do", async () => {
  const h = harness();
  const mbx = await imapBox(h);
  h.ctx.db.run(`UPDATE mail_imap SET host = ? WHERE "mailboxId" = ?`, "bad.example", mbx);
  const out = await syncNow(h.ctx, { mailboxId: mbx });
  assert.ok(out.runId);
  assert.equal(h.rows(`SELECT state FROM mail_mailbox WHERE id = ?`, mbx)[0]?.state, "error");
  assert.match(String(h.named("mailbox.sync_failed")[0]?.payload.reason), /sign-in/);
  assert.equal(h.named("mailbox.sync_completed").length, 0);
});

test("sync_now uses the run the host started, and refuses an unknown or malformed mailbox", async () => {
  const h = harness({ run: "run_fromhost01" });
  const mbx = await imapBox(h);
  assert.equal((await syncNow(h.ctx, { mailboxId: mbx })).runId, "run_fromhost01");
  await assert.rejects(() => syncNow(h.ctx, { mailboxId: "mbx_nope" }), (e) => codeOf(e) === "validation.not_found");
  await assert.rejects(() => syncNow(h.ctx, { mailboxId: "nope" }), (e) => codeOf(e) === "validation.bad_input");
});

test("Google and Microsoft mailboxes are pulled by their connectors, which sync_now asks", async () => {
  const h = harness();
  const g = await mailbox(h, "maya@vyre.test");
  const ms = (await connect(h.ctx, { provider: "microsoft", address: "maya@corp.test", idempotencyKey: "ms" })).mailbox.id;
  const one = await syncNow(h.ctx, { mailboxId: g });
  const two = await syncNow(h.ctx, { mailboxId: ms });
  assert.deepEqual(h.calls("google.receive_push")[0]!.input, { kind: "gmail", messageId: `sync_${one.runId}`, mailbox: "maya@vyre.test" });
  assert.equal(h.calls("ms.receive_notification")[0]!.input.notificationId, `sync_${two.runId}`);
  assert.equal(h.named("mailbox.sync_failed").length, 0);
});
