// mail.message.get / list / search / set_private and mail.attachment.save (P-L5_01c).
// Messages come from the real ingest handler, so these tests also prove the read side matches what ingest stores.
import test from "node:test";
import assert from "node:assert/strict";
import { draft } from "../handlers/drafts.ts";
import { attachmentSave, messageGet, messageList, messageSearch, messageSetPrivate } from "../handlers/extra/messages.ts";
import { ingest } from "../handlers/ingest.ts";
import { hostError, script, seedDomain, seedSent } from "../handlers/extra/kit.ts";
import { codeOf, contractErrors, harness, letter, NOW, seedMailbox } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";
import type { IngestIn } from "../handlers/ingest.ts";

const ME = "usr_maya01";
const PAT = { kind: "person", id: "usr_pat01" } as const;
let keys = 0;
const key = (): string => `idem-msg-${++keys}`;

function setup(opts: Parameters<typeof harness>[0] = {}): Harness {
  const h = harness(opts);
  seedMailbox(h, "mbx_maya", "maya@vyre.test", { kind: "personal", provider: "google", ownerId: ME, privacy: "space" });
  seedMailbox(h, "mbx_hello", "hello@vyre.test", { kind: "shared", privacy: "space", ownerId: "usr_kim01" });
  return h;
}

let seq = 0;
async function mail(h: Harness, extra: Partial<IngestIn> = {}, from = "pat@acme.test"): Promise<string> {
  const n = ++seq;
  const out = await ingest(h.ctx, letter(from, `<m${n}@x>`, `g-${n}`, { mailboxId: "mbx_maya", ...extra }));
  return out.messageId;
}

/** The RFC id the last mail() call used, for a second delivery of the same message to another inbox. */
const lastRfc = (): string => `<m${seq}@x>`;
const ids = (out: { messages: { id: string }[] }): string[] => out.messages.map((m) => m.id);

test("get returns the message, both bodies, attachments, provider id and trace id", async () => {
  const h = setup();
  const id = await mail(h, {
    subject: "Quarterly report", text: "See attached.", html: "<p>See attached.</p>",
    attachments: [{ name: "report.pdf", mime: "application/pdf", size: 1200, blobId: "blb_r1" }],
  });
  const out = await messageGet(h.ctx, { messageId: id });
  assert.deepEqual(contractErrors("mail.message.get", "out", out), []);
  assert.deepEqual([out.message.id, out.message.subject, out.message.status, out.message.direction, out.message.inboxIds], [id, "Quarterly report", "received", "in", ["mbx_maya"]]);
  assert.deepEqual([out.text, out.html], ["See attached.", "<p>See attached.</p>"]);
  assert.deepEqual(out.attachments, [{ attachmentId: "att_1", name: "report.pdf", mime: "application/pdf", size: 1200 }]);
  assert.equal(out.provider.providerId, `g-${seq}`);
  assert.equal(out.provider.traceId, h.ctx.trace.traceId);
  assert.equal(out.provider.dns, undefined);   // inbound mail has no sending-domain check
});

test("get on a sent message shows the DNS check state of the domain it left from", async () => {
  const h = setup();
  seedDomain(h, { id: "dom_acme", name: "acme.test", spf: "pass", dkim: "fail", dmarc: "pending" });
  seedSent(h, { id: "eml_sent1", mailboxId: "mbx_maya", providerId: "re_1", from: "hello@acme.test" });
  const out = await messageGet(h.ctx, { messageId: "eml_sent1" });
  assert.deepEqual(contractErrors("mail.message.get", "out", out), []);
  assert.deepEqual(out.provider, { providerId: "re_1", dns: { spf: "pass", dkim: "fail", dmarc: "pending" }, traceId: h.ctx.trace.traceId });
  seedSent(h, { id: "eml_sent2", mailboxId: "mbx_maya", providerId: "re_2", from: "maya@elsewhere.test" });
  assert.equal((await messageGet(h.ctx, { messageId: "eml_sent2" })).provider.dns, undefined);
});

test("get refuses an unknown id, a bad id, and a message in no inbox the caller can open", async () => {
  const h = setup();
  const id = await mail(h);
  await assert.rejects(messageGet(h.ctx, { messageId: "eml_nope" }), (e) => codeOf(e) === "validation.not_found");
  await assert.rejects(messageGet(h.ctx, { messageId: "m-1" }), (e) => codeOf(e) === "validation.bad_input");
  h.denied.add("mbx_maya");
  await assert.rejects(messageGet(h.ctx, { messageId: id }), (e) => codeOf(e) === "permission.no_grant");
  const base = h.ctx.authorize.bind(h.ctx);
  h.ctx.authorize = (a, r) => (r.id === "mbx_maya" ? { effect: "deny", reason: "above clearance", decisionId: "dec_clear01" } : base(a, r));
  await assert.rejects(messageGet(h.ctx, { messageId: id }), (e) => codeOf(e) === "permission.above_clearance");
});

test("a message in several inboxes opens through any inbox the caller may view", async () => {
  const h = setup();
  const id = await mail(h);
  await ingest(h.ctx, letter("pat@acme.test", lastRfc(), "g-hello", { mailboxId: "mbx_hello" }));   // same RFC message lands in the shared inbox
  assert.deepEqual((await messageGet(h.ctx, { messageId: id })).message.inboxIds, ["mbx_maya", "mbx_hello"]);
  h.denied.add("mbx_maya");
  assert.equal((await messageGet(h.ctx, { messageId: id })).message.id, id);   // still opens through hello@
  h.denied.add("mbx_hello");
  await assert.rejects(messageGet(h.ctx, { messageId: id }), (e) => codeOf(e) === "permission.no_grant");
});

test("reading someone else's personal mailbox writes a per-person log row; reading your own or a shared one does not", async () => {
  const h = setup();
  const own = await mail(h);
  const shared = await ingest(h.ctx, letter("pat@acme.test", "<s1@x>", "g-s1", { mailboxId: "mbx_hello", source: "resend" }));
  const reads = (): string[] => h.rows(`SELECT action FROM mail_read_log WHERE action LIKE ?`, "read:%").map((r) => String(r.action));
  await messageGet(h.ctx, { messageId: own });
  assert.deepEqual(reads(), []);                   // the owner reads her own mail
  h.ctx.principal = PAT;
  await messageGet(h.ctx, { messageId: shared.messageId });
  assert.deepEqual(reads(), []);                   // a shared inbox is not one person's mail
  await messageGet(h.ctx, { messageId: own });
  assert.deepEqual(reads(), ["read:usr_pat01"]);
  assert.equal(h.rows(`SELECT actor FROM mail_read_log WHERE action LIKE ?`, "read:%")[0]!.actor, ME);   // keyed by the person whose mail it is
  await messageList(h.ctx, { mailboxId: "mbx_maya" });
  await messageSearch(h.ctx, { q: "hello" });
  assert.deepEqual(reads(), ["read:usr_pat01", "read:usr_pat01", "read:usr_pat01"]);   // one row per call, not per message
});

test("get describes a draft's Files attachment from Files, and falls back when Files cannot answer", async () => {
  const h = setup();
  script(h, { "files.get": (i) => {
    if (i.fileId === "fil_gone") throw hostError(h, "validation.not_found");
    return { file: { fileId: i.fileId, name: "plan.docx", mime: "application/msword", size: 77 } };
  } });
  const id = await mail(h);
  h.ctx.db.run(`UPDATE mail_message SET attachments = ? WHERE id = ?`, JSON.stringify([{ fileId: "fil_plan" }, { fileId: "fil_gone" }]), id);
  const out = await messageGet(h.ctx, { messageId: id });
  assert.deepEqual(contractErrors("mail.message.get", "out", out), []);
  assert.deepEqual(out.attachments, [
    { attachmentId: "att_1", name: "plan.docx", mime: "application/msword", size: 77, fileId: "fil_plan" },
    { attachmentId: "att_2", name: "Attachment", mime: "application/octet-stream", size: 0, fileId: "fil_gone" },
  ]);
});

test("list filters by mailbox, thread, contact and status; newest first; drafts only when asked", async () => {
  const h = setup({ contacts: { "pat@acme.test": [{ recordId: "rec_pat01", score: 0.95 }] } });
  const a = await mail(h, { receivedAt: NOW + 100, threadKey: "t1" });
  const b = await mail(h, { receivedAt: NOW + 300, threadKey: "t1" });
  const c = await mail(h, { receivedAt: NOW + 200, threadKey: "t2" }, "sam@other.test");
  seedSent(h, { id: "eml_sent1", mailboxId: "mbx_maya", providerId: "re_1", status: "delivered" });
  const d = await draft(h.ctx, { mailboxId: "mbx_maya", to: [{ address: "pat@acme.test" }], subject: "Later", text: "x", idempotencyKey: key() });

  const all = await messageList(h.ctx, { mailboxId: "mbx_maya" });
  assert.deepEqual(contractErrors("mail.message.list", "out", all), []);
  assert.deepEqual(ids(all), [b, c, a, "eml_sent1"]);   // newest first; the sent message is the oldest, at NOW
  assert.equal(all.total, 4);
  assert.deepEqual(ids(await messageList(h.ctx, { threadId: "t1" })), [b, a]);
  assert.deepEqual(ids(await messageList(h.ctx, { contactId: "rec_pat01" })), [b, a]);   // the link step filed pat's mail to the contact; sam stayed unmatched
  assert.deepEqual(ids(await messageList(h.ctx, { status: "delivered" })), ["eml_sent1"]);
  assert.deepEqual(ids(await messageList(h.ctx, { status: "received" })), [b, c, a]);
  assert.deepEqual(ids(await messageList(h.ctx, { status: "draft" })), [d.draftId]);
  assert.deepEqual(ids(await messageList(h.ctx, { mailboxId: "mbx_hello" })), []);
});

test("list pages with a cursor and never repeats or skips a row at the boundary", async () => {
  const h = setup();
  const made: string[] = [];
  for (let i = 0; i < 5; i++) made.push(await mail(h, { receivedAt: NOW + (i % 2) * 10 }));   // ties on the time
  const seen: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await messageList(h.ctx, cursor === undefined ? { limit: 2 } : { limit: 2, cursor });
    seen.push(...ids(page));
    cursor = page.next;
  } while (cursor !== undefined);
  assert.equal(seen.length, 5);
  assert.deepEqual([...seen].sort(), [...made].sort());
  await assert.rejects(messageList(h.ctx, { limit: 501 }), (e) => codeOf(e) === "validation.bad_input");
});

test("list shows a message in two inboxes once for each inbox and hides inboxes the caller cannot view", async () => {
  const h = setup();
  const both = await mail(h);
  await ingest(h.ctx, letter("pat@acme.test", lastRfc(), "g-hello", { mailboxId: "mbx_hello" }));
  const onlyHello = (await ingest(h.ctx, letter("kim@acme.test", "<k1@x>", "g-k1", { mailboxId: "mbx_hello" }))).messageId;
  assert.deepEqual(ids(await messageList(h.ctx, { mailboxId: "mbx_maya" })), [both]);
  assert.deepEqual(new Set(ids(await messageList(h.ctx, { mailboxId: "mbx_hello" }))), new Set([both, onlyHello]));
  assert.equal((await messageList(h.ctx, {})).total, 2);   // each record once across inboxes
  h.denied.add("mbx_hello");
  assert.deepEqual(ids(await messageList(h.ctx, {})), [both]);   // still open through maya's inbox
  h.denied.add("mbx_maya");
  assert.deepEqual(ids(await messageList(h.ctx, {})), []);
});

test("list refuses bad filters", async () => {
  const h = setup();
  await assert.rejects(messageList(h.ctx, { mailboxId: "box" }), (e) => codeOf(e) === "validation.bad_input");
  await assert.rejects(messageList(h.ctx, { contactId: "pat" }), (e) => codeOf(e) === "validation.bad_input");
  await assert.rejects(messageList(h.ctx, { threadId: "" }), (e) => codeOf(e) === "validation.bad_input");
  await assert.rejects(messageList(h.ctx, { status: "lost" }), (e) => codeOf(e) === "validation.bad_input");
});

test("search matches every word, in any field, ignoring case", async () => {
  const h = setup();
  const a = await mail(h, { subject: "Invoice for March", text: "Please pay the retainer." });
  const b = await mail(h, { subject: "Lunch", text: "Are you free for lunch on Friday?" }, "sam@other.test");
  const c = await mail(h, { subject: "Re: Invoice", text: "Paid." }, "billing@acme.test");
  const found = async (q: string): Promise<string[]> => ids(await messageSearch(h.ctx, { q })).sort();
  assert.deepEqual(await found("INVOICE"), [a, c].sort());
  assert.deepEqual(await found("invoice retainer"), [a]);          // both words, one message
  assert.deepEqual(await found("friday lunch"), [b]);               // any order
  assert.deepEqual(await found("billing@acme"), [c]);               // sender address
  assert.deepEqual(await found("maya@vyre"), [a, b, c].sort());    // recipient address
  assert.deepEqual(await found("zebra"), []);
  const out = await messageSearch(h.ctx, { q: "invoice" });
  assert.deepEqual(contractErrors("mail.message.search", "out", out), []);
  assert.equal(out.total, 2);
});

test("search narrows by mailbox and date, leaves out drafts, and hides mail the caller cannot view", async () => {
  const h = setup();
  const old = await mail(h, { subject: "Budget old", receivedAt: NOW - 86_400_000 });
  const fresh = await mail(h, { subject: "Budget new", receivedAt: NOW });
  const hello = (await ingest(h.ctx, letter("kim@acme.test", "<k1@x>", "g-k1", { mailboxId: "mbx_hello", subject: "Budget shared" }))).messageId;
  await draft(h.ctx, { mailboxId: "mbx_maya", to: [{ address: "pat@acme.test" }], subject: "Budget draft", text: "x", idempotencyKey: key() });
  assert.deepEqual(ids(await messageSearch(h.ctx, { q: "budget", mailboxId: "mbx_maya" })), [fresh, old]);
  assert.deepEqual(ids(await messageSearch(h.ctx, { q: "budget", mailboxId: "mbx_hello" })), [hello]);
  assert.deepEqual(ids(await messageSearch(h.ctx, { q: "budget", from: NOW - 1000 })).sort(), [fresh, hello].sort());
  assert.deepEqual(ids(await messageSearch(h.ctx, { q: "budget", to: NOW - 1000 })), [old]);
  assert.deepEqual(ids(await messageSearch(h.ctx, { q: "budget", from: NOW - 100_000_000, to: NOW - 1000 })), [old]);
  h.denied.add("mbx_hello");
  assert.equal((await messageSearch(h.ctx, { q: "budget" })).total, 2);
  const page = await messageSearch(h.ctx, { q: "budget", limit: 1 });
  assert.deepEqual([page.messages.length, page.next, page.total], [1, "1", 2]);
});

test("search refuses empty text, bad ids and an upside-down date range", async () => {
  const h = setup();
  await assert.rejects(messageSearch(h.ctx, { q: "  " }), (e) => codeOf(e) === "validation.bad_input");
  await assert.rejects(messageSearch(h.ctx, { q: "a", mailboxId: "x" }), (e) => codeOf(e) === "validation.bad_input");
  await assert.rejects(messageSearch(h.ctx, { q: "a", from: 10, to: 5 }), (e) => codeOf(e) === "validation.bad_input");
  await assert.rejects(messageSearch(h.ctx, { q: "a", from: 1.5 }), (e) => codeOf(e) === "validation.bad_input");
});

test("set_private: the inbox owner marks and clears it; the answer carries the flag; others are refused", async () => {
  const h = setup();
  const id = await mail(h);
  const marked = await messageSetPrivate(h.ctx, { messageId: id, isPrivate: true });
  assert.deepEqual(contractErrors("mail.message.set_private", "out", marked), []);
  assert.equal(marked.message.isPrivate, true);
  assert.equal(h.rows(`SELECT version FROM mail_message WHERE id = ?`, id)[0]!.version, 2);
  await messageSetPrivate(h.ctx, { messageId: id, isPrivate: true });   // no change, no new version
  assert.equal(h.rows(`SELECT version FROM mail_message WHERE id = ?`, id)[0]!.version, 2);
  assert.equal((await messageSetPrivate(h.ctx, { messageId: id, isPrivate: false })).message.isPrivate, false);

  h.ctx.principal = PAT;
  h.ctx.authorize = (a) => (a.level === "manage" ? { effect: "deny", reason: "no grant", decisionId: "dec_x00001" } : { effect: "allow", reason: "ok", decisionId: "dec_x00002" });
  await assert.rejects(messageSetPrivate(h.ctx, { messageId: id, isPrivate: true }), (e) => codeOf(e) === "permission.no_grant");
  await assert.rejects(messageSetPrivate(h.ctx, { messageId: id, isPrivate: "yes" as never }), (e) => codeOf(e) === "validation.bad_input");
  await assert.rejects(messageSetPrivate(h.ctx, { messageId: "eml_nope", isPrivate: true }), (e) => codeOf(e) === "validation.not_found");
});

test("set_private: someone who manages the inbox may mark a message in it", async () => {
  const h = setup();
  const id = (await ingest(h.ctx, letter("kim@acme.test", "<k1@x>", "g-k1", { mailboxId: "mbx_hello" }))).messageId;
  h.ctx.principal = PAT;   // not the owner of the shared inbox, but the host says they manage it
  assert.equal((await messageSetPrivate(h.ctx, { messageId: id, isPrivate: true })).message.isPrivate, true);
});

// ---- mail.attachment.save

function filesScript(h: Harness) {
  const state = { folderMade: false, nextFile: 0, names: new Map<string, Set<string>>() };
  script(h, {
    "files.resolve": (i) => {
      if (i.path === "Personal") return { kind: "folder", folderId: "fld_personal" };
      if (i.path === "Personal/Mail attachments" && state.folderMade) return { kind: "folder", folderId: "fld_mailatt" };
      throw hostError(h, "validation.not_found");
    },
    "files.folder.create": () => { state.folderMade = true; return { folder: { folderId: "fld_mailatt" } }; },
    "files.create": (i) => {
      const used = state.names.get(String(i.folderId)) ?? new Set<string>();
      if (used.has(String(i.name))) throw hostError(h, "validation.duplicate");
      used.add(String(i.name));
      state.names.set(String(i.folderId), used);
      return { file: { fileId: `fil_${++state.nextFile}` } };
    },
  });
  return state;
}

const withFiles = async (h: Harness, extra: Partial<IngestIn> = {}): Promise<string> => mail(h, {
  attachments: [
    { name: "report.pdf", mime: "application/pdf", size: 10, blobId: "blb_r1" },
    { name: "photo.png", mime: "image/png", size: 5, blobId: "blb_p1" },
  ], ...extra,
});

test("save puts the attachment in Files, making the Mail attachments folder on first use", async () => {
  const h = setup();
  filesScript(h);
  const id = await withFiles(h);
  const out = await attachmentSave(h.ctx, { messageId: id, attachmentId: "att_1", idempotencyKey: key() });
  assert.deepEqual(contractErrors("mail.attachment.save", "out", out), []);
  assert.equal(out.fileId, "fil_1");
  assert.deepEqual(h.calls("files.folder.create").map((c) => c.input), [{ parentId: "fld_personal", name: "Mail attachments" }]);
  assert.deepEqual(h.calls("files.create").map((c) => c.input), [{ folderId: "fld_mailatt", name: "report.pdf", mime: "application/pdf", content: { blobId: "blb_r1" } }]);
  const detail = await messageGet(h.ctx, { messageId: id });
  assert.deepEqual(detail.attachments.map((a) => [a.attachmentId, a.fileId]), [["att_1", "fil_1"], ["att_2", undefined]]);
});

test("save again adds no copy: the same key, or the same attachment under a new key, answers the file already saved", async () => {
  const h = setup();
  filesScript(h);
  const id = await withFiles(h);
  const k = key();
  const first = await attachmentSave(h.ctx, { messageId: id, attachmentId: "att_1", idempotencyKey: k });
  assert.equal((await attachmentSave(h.ctx, { messageId: id, attachmentId: "att_1", idempotencyKey: k })).fileId, first.fileId);
  assert.equal((await attachmentSave(h.ctx, { messageId: id, attachmentId: "att_1", idempotencyKey: key() })).fileId, first.fileId);
  assert.equal(h.calls("files.create").length, 1);
  const second = await attachmentSave(h.ctx, { messageId: id, attachmentId: "att_2", idempotencyKey: key() });
  assert.equal(second.fileId, "fil_2");
  assert.equal(h.calls("files.folder.create").length, 1);   // the folder exists by now
});

test("save into a named folder always makes a file there, and a taken name gets a number", async () => {
  const h = setup();
  filesScript(h);
  const a = await withFiles(h);
  const b = await withFiles(h);   // a second message with another report.pdf
  await attachmentSave(h.ctx, { messageId: a, attachmentId: "att_1", idempotencyKey: key() });
  const other = await attachmentSave(h.ctx, { messageId: a, attachmentId: "att_1", folderId: "fld_other", idempotencyKey: key() });
  assert.equal(other.fileId, "fil_2");
  const clash = await attachmentSave(h.ctx, { messageId: b, attachmentId: "att_1", idempotencyKey: key() });
  assert.equal(clash.fileId, "fil_3");
  assert.deepEqual(h.calls("files.create").map((c) => [c.input.folderId, c.input.name]), [
    ["fld_mailatt", "report.pdf"], ["fld_other", "report.pdf"], ["fld_mailatt", "report.pdf"], ["fld_mailatt", "report (2).pdf"],   // the third is refused as a duplicate, the fourth lands
  ]);
});

test("save keeps a file name safe and numbers one with no extension", async () => {
  const h = setup();
  filesScript(h);
  const id = await mail(h, { attachments: [
    { name: "../a/b.txt", mime: "text/plain", size: 1, blobId: "blb_1" }, { name: "README", mime: "text/plain", size: 1, blobId: "blb_2" }, { name: "README", mime: "text/plain", size: 1, blobId: "blb_3" },
  ] });
  await attachmentSave(h.ctx, { messageId: id, attachmentId: "att_1", idempotencyKey: key() });
  await attachmentSave(h.ctx, { messageId: id, attachmentId: "att_2", idempotencyKey: key() });
  await attachmentSave(h.ctx, { messageId: id, attachmentId: "att_3", idempotencyKey: key() });
  assert.deepEqual(h.calls("files.create").map((c) => c.input.name), [".._a_b.txt", "README", "README", "README (2)"]);
});

test("save refuses an unknown attachment, an attachment with no content, a bad id, and a message the caller cannot open", async () => {
  const h = setup();
  filesScript(h);
  const id = await withFiles(h);
  await assert.rejects(attachmentSave(h.ctx, { messageId: id, attachmentId: "att_9", idempotencyKey: key() }), (e) => codeOf(e) === "validation.not_found");
  await assert.rejects(attachmentSave(h.ctx, { messageId: id, attachmentId: "", idempotencyKey: key() }), (e) => codeOf(e) === "validation.bad_input");
  await assert.rejects(attachmentSave(h.ctx, { messageId: id, attachmentId: "att_1", folderId: "folder", idempotencyKey: key() }), (e) => codeOf(e) === "validation.bad_input");
  await assert.rejects(attachmentSave(h.ctx, { messageId: "eml_nope", attachmentId: "att_1", idempotencyKey: key() }), (e) => codeOf(e) === "validation.not_found");
  h.ctx.db.run(`UPDATE mail_message SET attachments = ? WHERE id = ?`, JSON.stringify([{ name: "empty.txt", mime: "text/plain", size: 0 }]), id);
  await assert.rejects(attachmentSave(h.ctx, { messageId: id, attachmentId: "att_1", idempotencyKey: key() }), (e) => codeOf(e) === "validation.precondition_failed");
  h.denied.add("mbx_maya");
  await assert.rejects(attachmentSave(h.ctx, { messageId: id, attachmentId: "att_1", idempotencyKey: key() }), (e) => codeOf(e) === "permission.no_grant");
  assert.equal(h.calls("files.create").length, 0);
});

test("save of a draft's attachment answers the Files file it already is", async () => {
  const h = setup();
  filesScript(h);
  const id = await mail(h);
  h.ctx.db.run(`UPDATE mail_message SET attachments = ? WHERE id = ?`, JSON.stringify([{ fileId: "fil_plan" }]), id);
  assert.deepEqual(await attachmentSave(h.ctx, { messageId: id, attachmentId: "att_1", idempotencyKey: key() }), { fileId: "fil_plan" });
  assert.equal(h.calls("files.create").length, 0);
});

test("save fails clearly when Personal files are unavailable", async () => {
  const h = setup();
  script(h, { "files.resolve": () => { throw hostError(h, "validation.not_found"); } });
  const id = await withFiles(h);
  await assert.rejects(attachmentSave(h.ctx, { messageId: id, attachmentId: "att_1", idempotencyKey: key() }), (e) => codeOf(e) === "validation.precondition_failed");
});

test("save finds the folder another save made a moment ago", async () => {
  const h = setup();
  let created = false;
  script(h, {
    "files.resolve": (i) => {
      if (i.path === "Personal") return { kind: "folder", folderId: "fld_personal" };
      if (created) return { kind: "folder", folderId: "fld_mailatt" };
      throw hostError(h, "validation.not_found");
    },
    "files.folder.create": () => { created = true; throw hostError(h, "validation.duplicate"); },
    "files.create": () => ({ file: { fileId: "fil_77" } }),
  });
  const id = await withFiles(h);
  assert.equal((await attachmentSave(h.ctx, { messageId: id, attachmentId: "att_1", idempotencyKey: key() })).fileId, "fil_77");
  assert.equal(h.calls("files.create")[0]!.input.folderId, "fld_mailatt");
});
