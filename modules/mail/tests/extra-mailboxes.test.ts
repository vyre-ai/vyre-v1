// mail.mailbox.list / get / create / update / set_privacy / pause / resume / disconnect and mail.auto_connect_members (P-L5_01c).
// A mailbox is an inbox. These tests drive the handlers on an in-memory database and check every answer against the frozen contract
// and every event against its frozen payload schema.
import test from "node:test";
import assert from "node:assert/strict";
import {
  autoConnectMembers, mailboxCreate, mailboxDisconnect, mailboxGet, mailboxList, mailboxPause, mailboxResume, mailboxSetPrivacy, mailboxUpdate,
} from "../handlers/extra/mailboxes.ts";
import { connect, ingest } from "../handlers/ingest.ts";
import { eventErrors } from "../handlers/extra/kit.ts";
import { codeOf, contractErrors, harness, letter, NOW, seedMailbox } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";

const ME = "usr_maya01";
let keys = 0;
const key = (): string => `idem-box-${++keys}`;
const box = (h: Harness, id: string) => h.rows(`SELECT * FROM mail_mailbox WHERE id = ?`, id)[0]!;

function setup(opts: Parameters<typeof harness>[0] = {}): Harness {
  const h = harness(opts);
  seedMailbox(h, "mbx_maya", "maya@vyre.test", { kind: "personal", provider: "google", ownerId: ME, privacy: "private" });
  return h;
}

const conforms = (h: Harness): void => assert.deepEqual(eventErrors(h), []);

test("create makes a shared inbound-only mailbox the creator owns, live at once", async () => {
  const h = setup();
  const out = await mailboxCreate(h.ctx, { kind: "shared", address: "Hello@Vyre.test", title: "Hello", idempotencyKey: key() });
  assert.deepEqual(contractErrors("mail.mailbox.create", "out", out), []);
  const m = out.mailbox;
  assert.deepEqual([m.kind, m.address, m.title, m.provider, m.privacy, m.state, m.ownerId], ["shared", "hello@vyre.test", "Hello", "inbound_only", "space", "syncing", ME]);
  assert.equal(h.named("mailbox.created").length, 1);
  assert.deepEqual(h.named("mailbox.created")[0]!.payload, { mailboxId: m.id, kind: "shared", address: "hello@vyre.test" });
  conforms(h);
});

test("create with the same key answers the first mailbox and adds nothing", async () => {
  const h = setup();
  const k = key();
  const a = await mailboxCreate(h.ctx, { kind: "service", address: "support@vyre.test", title: "Support", idempotencyKey: k });
  const b = await mailboxCreate(h.ctx, { kind: "service", address: "support@vyre.test", title: "Support", idempotencyKey: k });
  assert.equal(b.mailbox.id, a.mailbox.id);
  assert.equal(h.rows(`SELECT id FROM mail_mailbox`).length, 2);
  assert.equal(h.named("mailbox.created").length, 1);
});

test("create: an agent mailbox needs its agent, others refuse one", async () => {
  const h = setup();
  const ok = await mailboxCreate(h.ctx, { kind: "agent", address: "scout@vyre.test", title: "Scout", agentId: "agt_scout01", idempotencyKey: key() });
  assert.equal(ok.mailbox.agentId, "agt_scout01");
  assert.deepEqual(contractErrors("mail.mailbox.create", "out", ok), []);
  await assert.rejects(mailboxCreate(h.ctx, { kind: "agent", address: "x@vyre.test", title: "x", idempotencyKey: key() }), (e) => codeOf(e) === "validation.bad_input");
  await assert.rejects(mailboxCreate(h.ctx, { kind: "shared", address: "y@vyre.test", title: "y", agentId: "agt_scout01", idempotencyKey: key() }), (e) => codeOf(e) === "validation.bad_input");
  await assert.rejects(mailboxCreate(h.ctx, { kind: "agent", address: "z@vyre.test", title: "z", agentId: "scout", idempotencyKey: key() }), (e) => codeOf(e) === "validation.bad_input");
});

test("create refuses a taken address, a bad address, an IMAP provider and a bad privacy", async () => {
  const h = setup();
  await assert.rejects(mailboxCreate(h.ctx, { kind: "shared", address: "MAYA@vyre.test", title: "dup", idempotencyKey: key() }), (e) => codeOf(e) === "validation.duplicate");
  await assert.rejects(mailboxCreate(h.ctx, { kind: "shared", address: "not-an-email", title: "x", idempotencyKey: key() }), (e) => codeOf(e) === "validation.bad_input");
  await assert.rejects(mailboxCreate(h.ctx, { kind: "shared", address: "i@vyre.test", title: "x", provider: "imap" as never, idempotencyKey: key() }), (e) => codeOf(e) === "validation.bad_input");
  await assert.rejects(mailboxCreate(h.ctx, { kind: "shared", address: "p@vyre.test", title: "x", privacy: "secret" as never, idempotencyKey: key() }), (e) => codeOf(e) === "validation.bad_input");
  await assert.rejects(mailboxCreate(h.ctx, { kind: "personal" as never, address: "q@vyre.test", title: "x", idempotencyKey: key() }), (e) => codeOf(e) === "validation.bad_input");
  assert.equal(h.rows(`SELECT id FROM mail_mailbox`).length, 1);
});

test("create: a Google mailbox starts Pending, an empty title falls back to the address name, an agent leaves ownership to the Space", async () => {
  const h = setup({ principal: { kind: "agent", id: "agt_scout01" } });
  const out = await mailboxCreate(h.ctx, { kind: "service", address: "billing@vyre.test", title: "  ", provider: "google", privacy: "people", idempotencyKey: key() });
  assert.deepEqual([out.mailbox.state, out.mailbox.title, out.mailbox.privacy, out.mailbox.ownerId], ["pending", "billing", "people", undefined]);
  assert.deepEqual(contractErrors("mail.mailbox.create", "out", out), []);
});

test("get returns the mailbox with its sync state; a bad or unknown id is refused", async () => {
  const h = setup();
  h.ctx.db.run(`UPDATE mail_mailbox SET "lastSyncAt" = ?, state = ? WHERE id = ?`, NOW - 5000, "syncing", "mbx_maya");
  const out = await mailboxGet(h.ctx, { mailboxId: "mbx_maya" });
  assert.deepEqual(contractErrors("mail.mailbox.get", "out", out), []);
  assert.deepEqual([out.mailbox.state, out.mailbox.lastSyncAt, out.mailbox.ownerId, out.mailbox.provider], ["syncing", NOW - 5000, ME, "google"]);
  await assert.rejects(mailboxGet(h.ctx, { mailboxId: "mbx_nope" }), (e) => codeOf(e) === "validation.not_found");
  await assert.rejects(mailboxGet(h.ctx, { mailboxId: "box-1" }), (e) => codeOf(e) === "validation.bad_input");
});

test("list: scopes mine, shared and all, the kind filter, and the hidden mailboxes", async () => {
  const h = setup({ denied: new Set(["mbx_secret"]) });
  seedMailbox(h, "mbx_hello", "hello@vyre.test", { kind: "shared", privacy: "space" });
  seedMailbox(h, "mbx_pat", "pat@vyre.test", { kind: "personal", provider: "google", ownerId: "usr_pat01", privacy: "private" });
  seedMailbox(h, "mbx_secret", "secret@vyre.test", { kind: "shared", privacy: "people" });
  const ids = async (input: Parameters<typeof mailboxList>[1]): Promise<string[]> => (await mailboxList(h.ctx, input)).mailboxes.map((m) => m.id);
  assert.deepEqual(await ids({ scope: "mine" }), ["mbx_maya"]);
  assert.deepEqual(await ids({ scope: "shared" }), ["mbx_hello"]);   // not mine, not private, not denied
  assert.deepEqual(await ids({}), ["mbx_hello", "mbx_maya", "mbx_pat"]);   // all the caller may view, by address
  assert.deepEqual(await ids({ kind: "shared" }), ["mbx_hello"]);
  const page = await mailboxList(h.ctx, {});
  assert.deepEqual(contractErrors("mail.mailbox.list", "out", page), []);
  assert.equal(page.total, 3);
  await assert.rejects(mailboxList(h.ctx, { scope: "everyone" as never }), (e) => codeOf(e) === "validation.bad_input");
  await assert.rejects(mailboxList(h.ctx, { kind: "team" as never }), (e) => codeOf(e) === "validation.bad_input");
});

test("list pages with a cursor and reports the total", async () => {
  const h = setup();
  for (const n of ["a", "b", "c", "d"]) seedMailbox(h, `mbx_${n}`, `${n}@vyre.test`, { kind: "shared", privacy: "space" });
  const first = await mailboxList(h.ctx, { limit: 2 });
  assert.deepEqual([first.mailboxes.map((m) => m.address), first.next, first.total], [["a@vyre.test", "b@vyre.test"], "2", 5]);
  const second = await mailboxList(h.ctx, { limit: 2, cursor: first.next! });
  assert.deepEqual([second.mailboxes.map((m) => m.address), second.next], [["c@vyre.test", "d@vyre.test"], "4"]);
  const last = await mailboxList(h.ctx, { limit: 2, cursor: second.next! });
  assert.deepEqual([last.mailboxes.map((m) => m.address), last.next], [["maya@vyre.test"], undefined]);
  await assert.rejects(mailboxList(h.ctx, { limit: 0 }), (e) => codeOf(e) === "validation.bad_input");
  await assert.rejects(mailboxList(h.ctx, { cursor: "x" }), (e) => codeOf(e) === "validation.bad_input");
});

test("update renames and changes the agent, bumps the version once, and leaves an unchanged call alone", async () => {
  const h = setup();
  seedMailbox(h, "mbx_hello", "hello@vyre.test", { kind: "shared", privacy: "space" });
  const out = await mailboxUpdate(h.ctx, { mailboxId: "mbx_hello", title: " Front desk ", agentId: "agt_scout01" });
  assert.deepEqual(contractErrors("mail.mailbox.update", "out", out), []);
  assert.deepEqual([out.mailbox.title, out.mailbox.agentId, box(h, "mbx_hello").version], ["Front desk", "agt_scout01", 2]);
  await mailboxUpdate(h.ctx, { mailboxId: "mbx_hello", title: "Front desk", agentId: "agt_scout01" });
  assert.equal(box(h, "mbx_hello").version, 2);
});

test("update refuses an empty title, a bad agent id, and an agent on a personal mailbox", async () => {
  const h = setup();
  await assert.rejects(mailboxUpdate(h.ctx, { mailboxId: "mbx_maya", title: "  " }), (e) => codeOf(e) === "validation.bad_input");
  await assert.rejects(mailboxUpdate(h.ctx, { mailboxId: "mbx_maya", agentId: "bot" }), (e) => codeOf(e) === "validation.bad_input");
  await assert.rejects(mailboxUpdate(h.ctx, { mailboxId: "mbx_maya", agentId: "agt_scout01" }), (e) => codeOf(e) === "validation.precondition_failed");
  await assert.rejects(mailboxUpdate(h.ctx, { mailboxId: "mbx_gone", title: "x" }), (e) => codeOf(e) === "validation.not_found");
});

test("set_privacy moves the mailbox and announces it to the participants; the same value announces nothing", async () => {
  const h = setup();
  const out = await mailboxSetPrivacy(h.ctx, { mailboxId: "mbx_maya", privacy: "space" });
  assert.deepEqual(contractErrors("mail.mailbox.set_privacy", "out", out), []);
  assert.equal(out.mailbox.privacy, "space");
  assert.deepEqual(h.named("mailbox.privacy_changed").map((e) => [e.payload, e.vis]), [[{ mailboxId: "mbx_maya", privacy: "space" }, "participants"]]);
  await mailboxSetPrivacy(h.ctx, { mailboxId: "mbx_maya", privacy: "space" });
  assert.equal(h.named("mailbox.privacy_changed").length, 1);
  await assert.rejects(mailboxSetPrivacy(h.ctx, { mailboxId: "mbx_maya", privacy: "world" as never }), (e) => codeOf(e) === "validation.bad_input");
  conforms(h);
});

test("set_privacy to private stops filing for new mail; mail already stored keeps its mark", async () => {
  const h = setup();
  await mailboxSetPrivacy(h.ctx, { mailboxId: "mbx_maya", privacy: "space" });
  const before = await ingest(h.ctx, letter("pat@acme.test", "<a@x>", "p-1", { mailboxId: "mbx_maya" }));
  assert.equal(h.calls("inbox.link_message").length, 1);
  await mailboxSetPrivacy(h.ctx, { mailboxId: "mbx_maya", privacy: "private" });
  await ingest(h.ctx, letter("pat@acme.test", "<b@x>", "p-2", { mailboxId: "mbx_maya" }));
  assert.equal(h.calls("inbox.link_message").length, 1);   // the second message was not offered to the linking step
  assert.equal(h.rows(`SELECT "isPrivate" FROM mail_message WHERE id = ?`, before.messageId)[0]!.isPrivate, 0);
});

test("pause stops sync and filing, announces once, and a second pause changes nothing", async () => {
  const h = setup();
  const out = await mailboxPause(h.ctx, { mailboxId: "mbx_maya" });
  assert.deepEqual(contractErrors("mail.mailbox.pause", "out", out), []);
  assert.deepEqual([out.mailbox.state, box(h, "mbx_maya").paused], ["paused", 1]);
  const again = await mailboxPause(h.ctx, { mailboxId: "mbx_maya" });
  assert.equal(again.mailbox.state, "paused");
  assert.deepEqual(h.named("mailbox.paused").map((e) => [e.payload, e.vis]), [[{ mailboxId: "mbx_maya" }, "participants"]]);
  assert.equal(box(h, "mbx_maya").version, 2);
  conforms(h);
});

test("resume returns a mailbox that synced before to syncing and a never-synced one to Pending", async () => {
  const h = setup();
  seedMailbox(h, "mbx_new", "new@vyre.test", { kind: "personal", provider: "google", ownerId: ME });
  h.ctx.db.run(`UPDATE mail_mailbox SET "lastSyncAt" = ? WHERE id = ?`, NOW - 1000, "mbx_maya");
  await mailboxPause(h.ctx, { mailboxId: "mbx_maya" });
  await mailboxPause(h.ctx, { mailboxId: "mbx_new" });
  const a = await mailboxResume(h.ctx, { mailboxId: "mbx_maya" });
  const b = await mailboxResume(h.ctx, { mailboxId: "mbx_new" });
  assert.deepEqual(contractErrors("mail.mailbox.resume", "out", a), []);
  assert.deepEqual([a.mailbox.state, b.mailbox.state, box(h, "mbx_maya").paused], ["syncing", "pending", 0]);
  assert.equal(h.named("mailbox.resumed").length, 2);
  await mailboxResume(h.ctx, { mailboxId: "mbx_maya" });   // already running: no second notice
  assert.equal(h.named("mailbox.resumed").length, 2);
  conforms(h);
});

test("pause and resume refuse a disconnected mailbox", async () => {
  const h = setup();
  h.ctx.db.run(`UPDATE mail_mailbox SET state = ? WHERE id = ?`, "disconnected", "mbx_maya");
  await assert.rejects(mailboxPause(h.ctx, { mailboxId: "mbx_maya" }), (e) => codeOf(e) === "validation.precondition_failed");
  await assert.rejects(mailboxResume(h.ctx, { mailboxId: "mbx_maya" }), (e) => codeOf(e) === "validation.precondition_failed");
});

test("disconnect removes the connection, drops the IMAP sign-in, keeps the filed mail, and allows connecting again", async () => {
  const h = setup();
  await mailboxSetPrivacy(h.ctx, { mailboxId: "mbx_maya", privacy: "space" });   // a private mailbox files nothing, so there would be no link to keep
  const m = await ingest(h.ctx, letter("pat@acme.test", "<a@x>", "p-1", { mailboxId: "mbx_maya" }));
  h.ctx.db.run(`INSERT INTO mail_imap ("mailboxId", host, port, secure, username, "passwordHandle", "uidValidity", cursor) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, "mbx_maya", "h", 993, 1, "u", "#Imap.Sam", null, null);
  const out = await mailboxDisconnect(h.ctx, { mailboxId: "mbx_maya" });
  assert.deepEqual(contractErrors("mail.mailbox.disconnect", "out", out), []);
  assert.deepEqual(out, { disconnected: true });
  assert.deepEqual([box(h, "mbx_maya").state, box(h, "mbx_maya").deleted_at], ["disconnected", NOW]);
  assert.equal(h.rows(`SELECT "mailboxId" FROM mail_imap`).length, 0);
  assert.equal(h.rows(`SELECT id FROM mail_message WHERE id = ?`, m.messageId).length, 1);   // the message and its link stay
  assert.equal(h.rows(`SELECT "messageId" FROM mail_link WHERE "messageId" = ?`, m.messageId).length, 1);
  await assert.rejects(mailboxGet(h.ctx, { mailboxId: "mbx_maya" }), (e) => codeOf(e) === "validation.not_found");
  assert.deepEqual(h.named("mailbox.disconnected").map((e) => [e.payload, e.vis]), [[{ mailboxId: "mbx_maya" }, "participants"]]);
  // A retry succeeds quietly and the address can be connected again.
  assert.deepEqual(await mailboxDisconnect(h.ctx, { mailboxId: "mbx_maya" }), { disconnected: true });
  assert.equal(h.named("mailbox.disconnected").length, 1);
  const again = await connect(h.ctx, { provider: "google", address: "maya@vyre.test", idempotencyKey: key() });
  assert.equal(again.mailbox.state, "pending");
  await assert.rejects(mailboxDisconnect(h.ctx, { mailboxId: "mbx_unknown" }), (e) => codeOf(e) === "validation.not_found");
  conforms(h);
});

test("auto-connect creates one Pending mailbox and one notice for each new member, and skips the rest", async () => {
  const h = setup();
  seedMailbox(h, "mbx_kim", "kim@vyre.test", { kind: "personal", provider: "google", ownerId: "usr_kim01" });
  const out = await autoConnectMembers(h.ctx, {
    provider: "google", idempotencyKey: key(),
    members: [
      { userId: "usr_kim01", email: "kim@vyre.test" },     // already connected
      { userId: "usr_pat01", email: "Pat@Vyre.test" },
      { userId: "usr_lee01", email: "lee@vyre.test" },
      { userId: "usr_pat02", email: "pat@vyre.test" },     // the same address twice
      { userId: "bad", email: "zed@vyre.test" },           // not a member id
      { userId: "usr_zed01", email: "zed" },               // not an address
    ],
  });
  assert.deepEqual(contractErrors("mail.auto_connect_members", "out", out), []);
  assert.deepEqual(out, { created: 2, notified: 2, skipped: 4 });
  const rows = h.rows(`SELECT * FROM mail_mailbox WHERE kind = ?`, "personal").filter((r) => r.id !== "mbx_maya" && r.id !== "mbx_kim");
  assert.deepEqual(rows.map((r) => [r.address, r.ownerId, r.provider, r.state, r.privacy]).sort(), [
    ["lee@vyre.test", "usr_lee01", "google", "pending", "space"], ["pat@vyre.test", "usr_pat01", "google", "pending", "space"],
  ]);
  const notices = h.named("mailbox.connected");
  assert.equal(notices.length, 2);
  assert.deepEqual(notices.map((e) => [e.payload.memberId, e.payload.provider, e.payload.auto, e.vis]).sort(), [
    ["usr_lee01", "google", true, "participants"], ["usr_pat01", "google", true, "participants"],
  ]);
  conforms(h);
});

test("auto-connect with the same key answers the first counts and adds nothing; Microsoft is a different provider", async () => {
  const h = setup();
  const k = key();
  const members = [{ userId: "usr_pat01", email: "pat@vyre.test" }];
  const first = await autoConnectMembers(h.ctx, { provider: "google", members, idempotencyKey: k });
  const replay = await autoConnectMembers(h.ctx, { provider: "google", members, idempotencyKey: k });
  assert.deepEqual([first, replay], [{ created: 1, notified: 1, skipped: 0 }, { created: 1, notified: 1, skipped: 0 }]);
  assert.equal(h.named("mailbox.connected").length, 1);
  const ms = await autoConnectMembers(h.ctx, { provider: "microsoft", members, idempotencyKey: key() });
  assert.deepEqual(ms, { created: 1, notified: 1, skipped: 0 });
  await assert.rejects(autoConnectMembers(h.ctx, { provider: "yahoo" as never, members, idempotencyKey: key() }), (e) => codeOf(e) === "validation.bad_input");
  await assert.rejects(autoConnectMembers(h.ctx, { provider: "google", members: "all" as never, idempotencyKey: key() }), (e) => codeOf(e) === "validation.bad_input");
  await assert.rejects(mailboxCreate(h.ctx, { kind: "shared", address: "a@vyre.test", title: "a", idempotencyKey: "" }), (e) => codeOf(e) === "validation.bad_input");
});
