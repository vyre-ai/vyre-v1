// A person's own Gmail and Outlook on a booted daemon with the real Vault, Space seal, mail, google and microsoft modules and host seams. Google and Microsoft themselves are stand-ins
// (test/support/fake-mail-providers.ts). Run on Node 24 (the identity module needs Argon2id). It proves what the sign-in promises, as the people who live it:
//   - Team: an admin files the OAuth app in the Vault; two members each sign in to their own mailbox; each mailbox is private to its owner (the admin, the other member and the other member's
//     agent cannot read it); the refresh tokens are in no Vault item, no answer and no file; a poll with the vault locked still works; send goes out as the person; disconnect removes the token.
//   - A lost sign-in (revoked at the provider): the mailbox says Needs attention, the owner gets one Needs you item, nobody else does, and signing in again clears it.
//   - Personal: one person, mail files like any other, and quitting and reopening catches up on what arrived while it was closed.
import test from "node:test";
import assert from "node:assert/strict";
import { bootMailWorld, connectClaude, makeAgent, ask, everything, lockVault, setSignInApp, signInAs, unlockVault, until } from "./support/mail-world.ts";
import type { MailWorld, Person } from "./support/mail-world.ts";
import { standIn } from "./memory-live-kit.ts";

const CLIENT = { id: "live-client.apps.googleusercontent.com", secret: "live-client-secret-GOCSPX" };
const MS_CLIENT = { id: "11111111-2222-3333-4444-555555555555", secret: "live-ms-secret~Q8" };

const boxes = async (who: Person, scope = "all"): Promise<{ id: string; address: string; state: string; provider: string; privacy: string }[]> => (await who.ok("mail.mailbox.list", { scope })).mailboxes;
const count = async (who: Person, mailboxId: string): Promise<number> => ((await who.call("mail.message.list", { mailboxId })).data.messages ?? []).length;
const waitCount = (who: Person, mailboxId: string, n: number): Promise<number> => until(async () => ((await count(who, mailboxId)) >= n ? n : null), `${n} messages in ${mailboxId}`);
const needs = async (who: Person): Promise<{ id: string; title: string; kind: string; blocks: { type: string }[] }[]> => (await who.ok("tasks.needs_you", {})).items.map((i: { task: unknown }) => i.task);

async function assertNoSecret(w: MailWorld, secrets: string[], vaultNames: string[]): Promise<void> {
  const items = (await w.owner.ok("vault.items.list", {})).items as { id: string; name: string }[];
  assert.deepEqual(items.map((i) => i.name).sort(), vaultNames.sort(), "the Vault holds the apps and nothing else");
  const shown = JSON.stringify(await Promise.all(items.map((i) => w.owner.ok("vault.item.reveal", { itemId: i.id }))));
  w.d.sink.flush();
  for (const s of secrets) {
    assert.ok(!shown.includes(s), "no Vault item holds a token");
    for (const bytes of everything(w.dir)) assert.equal(bytes.includes(Buffer.from(s)), false, "the plaintext token is in no file");
  }
}

test("Team: two members sign in to their own Gmail; each mailbox is private to its owner; sealed tokens; locked-vault poll; send; disconnect", async () => {
  const w = await bootMailWorld({ kind: "team", engineOpenSession: standIn });
  try {
    await unlockVault(w);
    const account = await connectClaude(w);
    w.fake.open("google", "ana@gmail.test", [{ from: "pat@acme.test", subject: "For Ana", text: "Ana's private note" }, { from: "kim@acme.test", subject: "Also Ana", text: "Second" }]);
    w.fake.open("google", "bo@gmail.test", [{ from: "lee@acme.test", subject: "For Bo", text: "Bo's private note" }]);
    w.fake.open("google", "olivia@gmail.test", [{ from: "kim@acme.test", subject: "For Olivia", text: "The admin's own note" }]);

    // the admin files the app once; members see only that it is set
    assert.equal((await w.owner.ok("google.user.app_status", {})).configured, false);
    await setSignInApp(w, "google", CLIENT);
    const ana = await w.join("ana");
    const bo = await w.join("bo");
    const status = await ana.ok("google.user.app_status", {});
    assert.equal(status.configured, true);
    assert.ok(!JSON.stringify(status).includes(CLIENT.secret));

    const anaIn = await signInAs(w, ana, "google", "ana@gmail.test");
    const boIn = await signInAs(w, bo, "google", "bo@gmail.test");
    const adminIn = await signInAs(w, w.owner, "google", "olivia@gmail.test");
    assert.match(anaIn.accountId, /^gua_/);
    assert.ok(anaIn.mailboxId && boIn.mailboxId);

    // each mailbox is private to its owner
    assert.deepEqual((await boxes(ana)).map((b) => [b.address, b.privacy, b.provider]), [["ana@gmail.test", "private", "google"]]);
    assert.deepEqual((await boxes(bo)).map((b) => b.address), ["bo@gmail.test"]);
    assert.deepEqual((await boxes(w.owner)).map((b) => b.address), ["olivia@gmail.test"], "the admin sees their own mailbox and no member's");
    await waitCount(ana, anaIn.mailboxId!, 2);
    await waitCount(bo, boIn.mailboxId!, 1);
    assert.equal(await count(bo, anaIn.mailboxId!), 0, "Bo reads none of Ana's mail");
    assert.equal(await count(w.owner, anaIn.mailboxId!), 0, "nor does the admin");
    assert.equal((await bo.call("mail.message.search", { q: "Ana" })).data.messages?.length ?? 0, 0, "search shows Bo nothing of Ana's");
    assert.deepEqual((await ana.ok("google.user.list", {})).accounts.map((a: { email: string }) => a.email), ["ana@gmail.test"]);
    assert.notEqual((await bo.call("google.user.remove", { accountId: anaIn.accountId })).status, 200, "Bo cannot remove Ana's sign-in");
    assert.notEqual((await bo.call("mail.send_as", { mailboxId: anaIn.mailboxId, to: [{ address: "x@y.test" }], subject: "s", text: "t", idempotencyKey: "bo-as-ana" })).status, 200, "Bo cannot send as Ana");

    // an assistant acts with the access of whoever asked: Ana's reads Ana's mailbox and never Bo's; the admin's reads the admin's and never a member's
    const list = (mailboxId: string | undefined) => `TOOL mail_message_list ${JSON.stringify({ mailboxId })}`;
    const anaHelper = await makeAgent(ana, "Ana helper", account);
    const own = await ask(w, ana, anaHelper, list(anaIn.mailboxId));
    assert.ok(own.includes("For Ana"), `Ana's assistant reads Ana's mailbox: ${own.slice(0, 300)}`);
    const other = await ask(w, ana, anaHelper, list(boIn.mailboxId));
    assert.ok(!other.includes("For Bo") && !other.includes("Bo's private"), `Ana's assistant does not read Bo's mailbox: ${other.slice(0, 300)}`);
    const adminHelper = await makeAgent(w.owner, "Olivia helper", account);
    assert.ok((await ask(w, w.owner, adminHelper, list(adminIn.mailboxId))).includes("For Olivia"), "the admin's assistant reads the admin's mailbox");
    for (const mailboxId of [anaIn.mailboxId, boIn.mailboxId]) {
      const reply = await ask(w, w.owner, adminHelper, list(mailboxId));
      assert.ok(!/For Ana|Ana's private|For Bo|Bo's private/.test(reply), `the admin's assistant reads no member's mailbox: ${reply.slice(0, 300)}`);
    }

    // tokens: sealed, in no Vault item, no file
    await assertNoSecret(w, [w.fake.refreshOf("ana@gmail.test"), w.fake.refreshOf("bo@gmail.test"), w.fake.refreshOf("olivia@gmail.test")], ["Anthropic", "Google_Sign_In"]);

    // nobody has the vault open: new mail still arrives on the sealed token, only what changed is fetched
    await lockVault(w);
    w.fake.deliver("ana@gmail.test", { from: "sam@acme.test", subject: "Third", text: "Newest for Ana" });
    await ana.ok("mail.sync_now", { mailboxId: anaIn.mailboxId });
    await waitCount(ana, anaIn.mailboxId!, 3);
    assert.equal(await count(bo, boIn.mailboxId!), 1, "Bo's mailbox did not move");
    assert.equal(w.fake.calls("gmail.googleapis.com", "/gmail/v1/users/me/messages").filter((c) => c.method === "GET" && c.account === "ana@gmail.test" && c.path.endsWith("/messages")).length, 1, "the recent mail was listed once, then history");
    await unlockVault(w);

    // send goes out as the person
    await ana.ok("mail.send_as", { mailboxId: anaIn.mailboxId, to: [{ address: "pat@acme.test" }], subject: "Re: For Ana", text: "Thanks Pat" });
    assert.deepEqual(w.fake.sent.map((m) => [m.email, m.to, m.subject]), [["ana@gmail.test", ["pat@acme.test"], "Re: For Ana"]]);

    // disconnect: the account and token go, Google is told, Bo is untouched
    await ana.ok("mail.mailbox.disconnect", { mailboxId: anaIn.mailboxId });
    assert.deepEqual((await ana.ok("google.user.list", {})).accounts, []);
    assert.deepEqual((await bo.ok("google.user.list", {})).accounts.map((a: { email: string }) => a.email), ["bo@gmail.test"]);
    assert.ok(w.fake.calls("oauth2.googleapis.com", "/revoke").length >= 1, "Google was asked to revoke");
    assert.equal(w.fake.refreshOf("ana@gmail.test") !== "", true);
    w.d.sink.flush();
    for (const bytes of everything(w.dir)) assert.equal(bytes.includes(Buffer.from(w.fake.refreshOf("ana@gmail.test"))), false, "Ana's token is gone from disk");
  } finally { await w.stop(); }
});

test("Team: the module's own door holds now that conversations and messages are registered in access: nobody but Ana reaches Ana's private mail through any path", async () => {
  const w = await bootMailWorld({ kind: "team", engineOpenSession: standIn });
  try {
    await unlockVault(w);
    w.fake.open("google", "ana@gmail.test", [{ from: "pat@acme.test", subject: "For Ana", text: "Ana's private note" }]);
    w.fake.open("google", "bo@gmail.test", [{ from: "lee@acme.test", subject: "For Bo", text: "Bo's private note" }]);
    await setSignInApp(w, "google", CLIENT);
    const ana = await w.join("ana");
    const bo = await w.join("bo");
    const anaIn = await signInAs(w, ana, "google", "ana@gmail.test");
    const boIn = await signInAs(w, bo, "google", "bo@gmail.test");
    await waitCount(ana, anaIn.mailboxId!, 1);
    await waitCount(bo, boIn.mailboxId!, 1);
    const [mine] = (await ana.ok("mail.message.list", { mailboxId: anaIn.mailboxId })).messages as { id: string; threadId: string }[];
    assert.ok(mine, "Ana has a message");
    const ghost = "eml_0000000000000000000000000000ffff";
    const denied = async (who: Person, cap: string, input: Record<string, unknown>): Promise<{ status: number; code: string | undefined; body: string }> => {
      const r = await who.call(cap, { idempotencyKey: `door-${cap}-${who.username}`, ...input });
      return { status: r.status, code: r.error?.code, body: JSON.stringify(r.data) };
    };
    for (const other of [bo, w.owner]) {
      // a message by id: refused exactly as an id that does not exist is, so its existence is not leaked
      const real = await denied(other, "mail.message.get", { messageId: mine.id });
      const none = await denied(other, "mail.message.get", { messageId: ghost });
      assert.notEqual(real.status, 200, `${other.username} cannot read Ana's message`);
      assert.deepEqual([real.status, real.code], [none.status, none.code], "the same answer as for a message that is not there");
      assert.ok(!real.body.includes("Ana's private note") && !real.body.includes("For Ana"));
      // saving its attachment: the same refusal
      const save = await denied(other, "mail.attachment.save", { messageId: mine.id, attachmentId: "att_1" });
      const saveNone = await denied(other, "mail.attachment.save", { messageId: ghost, attachmentId: "att_1" });
      assert.notEqual(save.status, 200);
      assert.deepEqual([save.status, save.code], [saveNone.status, saveNone.code]);
      // the Inbox: no conversation, thread or unmatched sender of Ana's mail appears
      const unmatched = JSON.stringify((await other.call("inbox.unmatched", {})).data);
      assert.ok(!unmatched.includes("pat@acme.test"), "Ana's sender is not in anyone's Unmatched");
      const thread = await denied(other, "inbox.list_by_thread", { threadId: mine.threadId });
      assert.ok(!thread.body.includes("For Ana"), `no thread of Ana's: ${thread.body.slice(0, 200)}`);
      const byAddress = await denied(other, "inbox.thread", { conversationId: "cnv_0000000000000000000000000000ffff" });
      assert.notEqual(byAddress.status, 200);
      // search
      assert.equal((await other.call("mail.message.search", { q: "Ana" })).data.messages?.length ?? 0, 0);
      const found = JSON.stringify((await other.call("search.query", { q: "For Ana" })).data);
      assert.ok(!found.includes("For Ana") && !found.includes("Ana's private note"), `search shows ${other.username} nothing of Ana's`);
    }
    // and Ana herself still reads it
    assert.equal((await ana.call("mail.message.get", { messageId: mine.id })).status, 200, "Ana reads her own message");
  } finally { await w.stop(); }
});

test("a revoked sign-in: the mailbox needs attention, the owner gets one Needs you item and nobody else does, and signing in again clears it", async () => {
  const w = await bootMailWorld({ kind: "team" });
  try {
    await unlockVault(w);
    w.fake.open("google", "ana@gmail.test", [{ from: "pat@acme.test", subject: "Hi", text: "Hello" }]);
    w.fake.open("google", "bo@gmail.test", [{ from: "lee@acme.test", subject: "Hi Bo", text: "Hello" }]);
    await setSignInApp(w, "google", CLIENT);
    const ana = await w.join("ana");
    const bo = await w.join("bo");
    const anaIn = await signInAs(w, ana, "google", "ana@gmail.test");
    const boIn = await signInAs(w, bo, "google", "bo@gmail.test");
    await waitCount(ana, anaIn.mailboxId!, 1);

    w.fake.revoke("ana@gmail.test");   // Ana removes the app's access in her Google account
    w.clock.t += 2 * 3_600_000;        // the access token made at sign-in has ended
    await ana.ok("mail.sync_now", { mailboxId: anaIn.mailboxId });
    const fix = await until(async () => { const n = (await needs(ana)).filter((t) => /Sign in to ana@gmail.test again/.test(t.title)); return n.length ? n : null; }, "Ana's Needs you item");
    assert.equal(fix.length, 1);
    assert.equal(fix[0]!.kind, "unblock");
    assert.equal(fix[0]!.blocks[0]!.type, "mail_signin");
    assert.equal((await boxes(ana)).find((b) => b.address === "ana@gmail.test")!.state, "error");
    assert.deepEqual((await needs(bo)).filter((t) => /Sign in to/.test(t.title)), [], "Bo has nothing to fix");
    assert.deepEqual((await needs(w.owner)).filter((t) => /Sign in to/.test(t.title)), [], "nor does the admin");

    await ana.ok("mail.sync_now", { mailboxId: anaIn.mailboxId });
    await new Promise((r) => setTimeout(r, 500));
    assert.equal((await needs(ana)).filter((t) => /Sign in to ana@gmail.test again/.test(t.title)).length, 1, "one item however many pulls fail");
    assert.equal((await boxes(bo)).find((b) => b.address === "bo@gmail.test")!.state !== "error", true);

    w.fake.restore("ana@gmail.test");
    const again = await signInAs(w, ana, "google", "ana@gmail.test");
    assert.equal(again.accountId, anaIn.accountId, "the same account and mailbox");
    await until(async () => ((await needs(ana)).filter((t) => /Sign in to ana@gmail.test again/.test(t.title)).length === 0 ? true : null), "the item is cleared");
    assert.notEqual((await boxes(ana)).find((b) => b.address === "ana@gmail.test")!.state, "error");
    void boIn;
  } finally { await w.stop(); }
});

test("Personal: Gmail and Outlook for one person, mail files like any other, and quitting and reopening catches up", async () => {
  const w = await bootMailWorld({ kind: "personal" });
  try {
    await unlockVault(w);
    w.fake.open("google", "olivia@gmail.test", [{ from: "pat@acme.test", subject: "First", text: "Hello" }]);
    w.fake.open("microsoft", "olivia@outlook.test", [{ from: "kim@acme.test", subject: "From Outlook", text: "Hi" }]);
    await setSignInApp(w, "google", CLIENT);
    await setSignInApp(w, "microsoft", MS_CLIENT);
    const g = await signInAs(w, w.owner, "google", "olivia@gmail.test");
    const m = await signInAs(w, w.owner, "microsoft", "olivia@outlook.test");
    const mine = await boxes(w.owner, "mine");
    assert.deepEqual(mine.map((b) => [b.address, b.privacy]).sort(), [["olivia@gmail.test", "space"], ["olivia@outlook.test", "space"]], "one person: nothing to keep private from");
    await waitCount(w.owner, g.mailboxId!, 1);
    await waitCount(w.owner, m.mailboxId!, 1);
    assert.ok(w.fake.calls("graph.microsoft.com", "/v1.0/me").length > 0);
    assert.equal(w.fake.calls("graph.microsoft.com", "/v1.0/users").length, 0, "Outlook is read through /me");

    // quit; mail arrives while nothing runs; open again hours later
    const before = w.fake.seen.length;
    await w.restart();
    w.fake.deliver("olivia@gmail.test", { from: "sam@acme.test", subject: "While closed", text: "Waiting for you" });
    w.fake.deliver("olivia@outlook.test", { from: "lee@acme.test", subject: "Outlook while closed", text: "Waiting too" });
    assert.equal(w.fake.seen.length, before, "nothing talked to Google or Microsoft in between");
    w.clock.t += 3 * 3_600_000;
    await unlockVault(w);
    await waitCount(w.owner, g.mailboxId!, 2);
    await waitCount(w.owner, m.mailboxId!, 2);
    assert.equal(await count(w.owner, g.mailboxId!), 2, "no mail doubled");

    // reply from the person's own address
    await w.owner.ok("mail.send_as", { mailboxId: m.mailboxId, to: [{ address: "kim@acme.test" }], subject: "Re: From Outlook", text: "Thanks Kim" });
    assert.deepEqual(w.fake.sent.map((x) => x.email), ["olivia@outlook.test"]);
  } finally { await w.stop(); }
});
