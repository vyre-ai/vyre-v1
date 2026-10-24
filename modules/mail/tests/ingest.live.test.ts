// The live IMAP session (impl.ts) driven against a fake imapflow: the connection options, read-only folder locks, the UID watermark and the
// "N:*" quirk, the Sent folder, header carry-over, IDLE wake-ups and their cleanup, logout. Also the module's handler map against the registry.
import test from "node:test";
import assert from "node:assert/strict";
import { createLiveImapFactory, handlers, projections, setImapSecretResolver, vaultSecret } from "../impl.ts";
import type { FlowClient, FlowCtor, FlowFetched, LiveImapDeps, ParsedMail } from "../impl.ts";
import { registry } from "../../../generated/registry.ts";
import { codeOf, harness, IMAP, seedMailbox } from "../fixtures/harness.ts";

interface Seen { options: Record<string, unknown>; locks: { path: string; readOnly: boolean | undefined; released: boolean }[]; ranges: string[]; listeners: Set<() => void>; loggedOut: boolean; closed: boolean }

function fake(folders: Record<string, FlowFetched[]>, o: { sentPath?: string; logoutThrows?: boolean; wakeAfterMs?: number } = {}) {
  const seen: Seen = { options: {}, locks: [], ranges: [], listeners: new Set(), loggedOut: false, closed: false };
  class Flow implements FlowClient {
    mailbox: false | { uidValidity: bigint | number } = false;
    private current = "INBOX";
    constructor(opts: Record<string, unknown>) { seen.options = opts; }
    async connect(): Promise<void> {}
    async noop(): Promise<void> {}
    async logout(): Promise<void> { seen.loggedOut = true; if (o.logoutThrows) throw new Error("socket gone"); }
    close(): void { seen.closed = true; }
    async getMailboxLock(path: string, opts?: { readOnly?: boolean }) {
      this.current = path;
      this.mailbox = { uidValidity: 7n };
      const lock = { path, readOnly: opts?.readOnly, released: false };
      seen.locks.push(lock);
      return { release: () => { lock.released = true; } };
    }
    async list() {
      return [{ path: "INBOX" }, ...(o.sentPath ? [{ path: o.sentPath, specialUse: "\\Sent" }] : []), { path: "Drafts", specialUse: "\\Drafts" }];
    }
    async *fetch(range: string): AsyncIterable<FlowFetched> {
      seen.ranges.push(`${this.current} ${range}`);
      const from = Number(range.split(":")[0]);
      const all = folders[this.current] ?? [];
      const hit = all.filter((m) => m.uid >= from);
      // the server answers "N:*" with the newest message even when it is older than N
      for (const m of hit.length ? hit : all.slice(-1)) yield m;
    }
    idle(): Promise<unknown> {
      if (o.wakeAfterMs !== undefined) setTimeout(() => seen.listeners.forEach((cb) => cb()), o.wakeAfterMs);
      return new Promise(() => {});
    }
    on(_event: "exists", cb: () => void): unknown { seen.listeners.add(cb); return this; }
    off(_event: "exists", cb: () => void): unknown { seen.listeners.delete(cb); return this; }
  }
  return { Flow: Flow as unknown as FlowCtor, seen };
}

const mail = (uid: number, id: string, subject: string, extra: Partial<FlowFetched> = {}): FlowFetched => ({
  uid, envelope: { messageId: id, subject, from: [{ name: "Pat Lee", address: "pat@acme.test" }], to: [{ address: "sam@vyre.test" }] },
  internalDate: new Date(1_760_000_000_000 + uid), source: new Uint8Array([uid]), ...extra,
});

function deps(Flow: FlowCtor, parsed: ParsedMail = { text: "the body", html: false }, secret = async () => "s3cret"): LiveImapDeps & { secrets: string[] } {
  const secrets: string[] = [];
  return { loadImapflow: async () => Flow, parseMail: async () => parsed, secret: async (handle, ctx) => { secrets.push(handle); return secret(); }, secrets };
}

const ctx = () => harness().ctx;

test("connect signs in with the Vault value, quietly, and reports the folder epoch", async () => {
  const { Flow, seen } = fake({ INBOX: [] });
  const d = deps(Flow);
  const session = createLiveImapFactory(d)(IMAP, ctx());
  assert.deepEqual(await session.connect(), { uidValidity: 7 });
  assert.deepEqual(seen.options, { host: "replay.example", port: 993, secure: true, auth: { user: "sam@vyre.test", pass: "s3cret" }, logger: false });
  assert.deepEqual(d.secrets, ["#Imap.Sam"]);
  await session.noop();
  await session.logout();
  assert.equal(seen.loggedOut, true);
});

test("a vault refusal fails the sign-in before the library is loaded", async () => {
  let loaded = false;
  const refuse = createLiveImapFactory({ loadImapflow: async () => { loaded = true; throw new Error("not reached"); }, parseMail: async () => ({}), secret: vaultSecret });
  setImapSecretResolver(null);
  await assert.rejects(() => refuse(IMAP, ctx()).connect(), (e) => codeOf(e) === "provider.auth_failed");
  assert.equal(loaded, false);
  setImapSecretResolver(async () => "from-the-vault");
  const { Flow, seen } = fake({ INBOX: [] });
  await createLiveImapFactory({ loadImapflow: async () => Flow, parseMail: async () => ({}), secret: vaultSecret })(IMAP, ctx()).connect();
  assert.deepEqual(seen.options.auth, { user: "sam@vyre.test", pass: "from-the-vault" });
  setImapSecretResolver(null);
});

test("fetchAfter reads INBOX and the Sent folder past each watermark, read-only, without the N:* leftover", async () => {
  const { Flow, seen } = fake(
    { INBOX: [mail(4, "<old@acme.test>", "Old"), mail(5, "<new@acme.test>", "New")], "Sent Items": [mail(2, "<out@vyre.test>", "Re: New", { envelope: { messageId: "<out@vyre.test>", subject: "Re: New", from: [{ address: "sam@vyre.test" }], to: [{ address: "pat@acme.test" }, { name: "Kim", address: "kim@acme.test" }], cc: [{ address: "lee@acme.test" }] } })] },
    { sentPath: "Sent Items" },
  );
  const parsed: ParsedMail = { text: "the body", html: "<p>the body</p>", inReplyTo: "<new@acme.test>", references: ["<a@x>", "<b@x>"] };
  const session = createLiveImapFactory(deps(Flow, parsed))(IMAP, ctx());
  await session.connect();
  const got = await session.fetchAfter({ INBOX: 4 });
  assert.deepEqual(got.map((m) => m.providerId), ["INBOX:7:5", "Sent Items:7:2"]);
  const inbound = got[0]!;
  assert.deepEqual([inbound.direction, inbound.folder, inbound.uid, inbound.rfcMessageId, inbound.subject], ["in", "INBOX", 5, "<new@acme.test>", "New"]);
  assert.deepEqual(inbound.from, { address: "pat@acme.test", name: "Pat Lee" });
  assert.deepEqual([inbound.text, inbound.html, inbound.receivedAt], ["the body", "<p>the body</p>", 1_760_000_000_005]);
  assert.deepEqual(inbound.headers, { "in-reply-to": "<new@acme.test>", references: "<a@x> <b@x>" });
  const outbound = got[1]!;
  assert.equal(outbound.direction, "out");
  assert.deepEqual(outbound.to, [{ address: "pat@acme.test" }, { address: "kim@acme.test", name: "Kim" }]);
  assert.deepEqual(outbound.cc, [{ address: "lee@acme.test" }]);
  // every folder was opened read-only, and every lock was given back
  assert.ok(seen.locks.length >= 3 && seen.locks.every((l) => l.readOnly === true && l.released));
  assert.ok(seen.ranges.includes("INBOX 5:*") && seen.ranges.includes("Sent Items 1:*"));
  // caught up: the server still answers "N:*" with the newest message, and the watermark check drops it
  assert.deepEqual(await session.fetchAfter({ INBOX: 5, "Sent Items": 2 }), []);
});

test("with no Sent folder only INBOX is read, and a message with no id gets a stable one", async () => {
  const { Flow } = fake({ INBOX: [mail(1, "", "No id", { envelope: { subject: "No id", from: [{ address: "pat@acme.test" }], to: [{ address: "sam@vyre.test" }] } })] });
  const session = createLiveImapFactory(deps(Flow, { text: "x" }))(IMAP, ctx());
  await session.connect();
  const got = await session.fetchAfter({});
  assert.equal(got.length, 1);
  assert.equal(got[0]!.rfcMessageId, "<INBOX:7:1@replay.example>");
});

test("IDLE hands each wake-up to the caller, ends at the deadline and leaves no listener behind", async () => {
  const { Flow, seen } = fake({ INBOX: [] }, { wakeAfterMs: 5 });
  const session = createLiveImapFactory(deps(Flow))(IMAP, ctx());
  await session.connect();
  let woke = 0;
  await session.idle(async () => { woke += 1; seen.listeners.clear(); }, 60);
  assert.ok(woke >= 1);
  assert.equal(seen.listeners.size, 0);
  assert.ok(seen.locks.every((l) => l.released));
});

test("IDLE with nothing arriving returns at the deadline without calling the caller", async () => {
  const { Flow, seen } = fake({ INBOX: [] });
  const session = createLiveImapFactory(deps(Flow))(IMAP, ctx());
  await session.connect();
  let woke = 0;
  const t0 = Date.now();
  await session.idle(async () => { woke += 1; }, 30);
  assert.equal(woke, 0);
  assert.ok(Date.now() - t0 < 1000);
  assert.equal(seen.listeners.size, 0);
});

test("logout closes the socket when the goodbye fails and is safe to repeat", async () => {
  const { Flow, seen } = fake({ INBOX: [] }, { logoutThrows: true });
  const session = createLiveImapFactory(deps(Flow))(IMAP, ctx());
  await session.connect();
  await session.logout();
  assert.equal(seen.closed, true);
  await session.logout();
  await assert.rejects(() => session.noop(), /not connected/);
});

test("the handler map covers exactly the capabilities this module has built, each in the registry", () => {
  const names = Object.keys(handlers).sort();
  assert.deepEqual(names, ["mail.connect", "mail.draft", "mail.drafts.discard", "mail.drafts.list", "mail.ingest", "mail.sync_now"]);
  const known = new Set(registry.capabilities.filter((c) => c.module === "mail").map((c) => c.name));
  for (const n of names) assert.ok(known.has(n), `${n} is a mail capability`);
  assert.deepEqual(Object.keys(projections), ["inline", "consumers"]);
});

test("the handlers run through the host handler signature", async () => {
  const h = harness();
  seedMailbox(h, "mbx_maya", "maya@vyre.test", { kind: "personal", provider: "google", ownerId: "usr_maya01" });
  // the host passes its Ctx; the harness ctx has the same shape for what mail uses
  const asHost = h.ctx as unknown as Parameters<(typeof handlers)[string]>[0];
  const made = (await handlers["mail.draft"]!(asHost, { mailboxId: "mbx_maya", subject: "Via the map", idempotencyKey: "k" })) as { draftId: string };
  const listed = (await handlers["mail.drafts.list"]!(asHost, {})) as { drafts: { id: string }[] };
  assert.deepEqual(listed.drafts.map((d) => d.id), [made.draftId]);
  assert.deepEqual(await handlers["mail.drafts.discard"]!(asHost, { draftId: made.draftId }), { discarded: true });
});
