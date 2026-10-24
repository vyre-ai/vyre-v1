// Connector replay for mail.ingest. The static fixture URLs and @reads lines put the JSON and SQL
// in the import graph. A change to them selects this file. Unreferenced data would run every test,
// including ui screens Node cannot load as .tsx.
// @reads /modules/mail/fixtures/imap/same-message.json
// @reads /modules/mail/fixtures/imap/replay.example.json
// @reads /modules/mail/fixtures/imap/bad.example.json
// @reads /modules/mail/migrations/0001_mail_core.sql
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { memoryDb } from "../fixtures/memory-db.ts";
import type { MailCtx, MailDb, Party } from "../fixtures/db.ts";
import { connect, ingest, rememberAddress, syncNow } from "../handlers/ingest.ts";
import type { IngestIn } from "../handlers/ingest.ts";

const read = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

const sameMessage = JSON.parse(read("../fixtures/imap/same-message.json")) as {
  rfcMessageId: string;
  from: Party;
  to: Party[];
  subject: string;
  text: string;
  receivedAt: number;
  copies: { source: IngestIn["source"]; providerId: string }[];
};
const replayExample = JSON.parse(read("../fixtures/imap/replay.example.json")) as {
  login: boolean;
  unseen: unknown[];
  idle: { exists: number; messages: unknown[] }[];
};
const badExample = JSON.parse(read("../fixtures/imap/bad.example.json")) as { login: boolean };
const migrationSql = read("../migrations/0001_mail_core.sql");

interface Ev {
  name: string;
}

function makeCtx(): { ctx: MailCtx; events: Ev[] } {
  const events: Ev[] = [];
  const db = memoryDb();
  const ctx: MailCtx = {
    space: "spc_mailtest",
    principal: { kind: "person", id: "usr_maya01" },
    trace: { traceId: "trc_mailtest01" },
    now: () => 1760000000000,
    db,
    emit(name) {
      events.push({ name });
      return null;
    },
    async call(cap, input) {
      if (cap === "contacts.resolve") return { sure: [], unsure: [] };
      if (cap === "mail.ingest") return ingest(ctx, input as IngestIn);
      throw new Error(`unexpected capability ${cap}`);
    },
    authorize() {
      return { effect: "allow", reason: "ok", decisionId: "dec_mailtest01" };
    },
    vault: {
      use(handle) {
        if (!handle.startsWith("#")) throw new Error("bad handle");
        return { handle };
      },
    },
    log: { info() {}, warn() {} },
  };
  return { ctx, events };
}

function rows(db: MailDb, sql: string, ...args: unknown[]): Record<string, string | number | null>[] {
  return db.all(sql, ...args) as Record<string, string | number | null>[];
}

function letter(from: string, rfcMessageId: string, providerId: string): IngestIn {
  return {
    source: "google",
    providerId,
    rfcMessageId,
    from: { address: from },
    to: [{ address: "maya@vyre.test" }],
    subject: "Hello",
    text: "Hello",
    receivedAt: 1760000000000,
  };
}

const imap = {
  host: "replay.example",
  port: 993,
  secure: true,
  username: "sam@vyre.test",
  passwordHandle: "#Imap.Sam",
};

test("migration creates the dedupe tables", () => {
  assert.match(migrationSql, /CREATE TABLE IF NOT EXISTS mail_seen/);
  assert.match(migrationSql, /CREATE TABLE IF NOT EXISTS mail_rfc/);
  assert.equal(replayExample.login, true);
  assert.equal(badExample.login, false);
  assert.equal(sameMessage.copies.length, 2);
});

test("the same provider id is one record", async () => {
  const { ctx } = makeCtx();
  const input = letter("pat@acme.test", "<once@acme.test>", "gmailhist1");
  const first = await ingest(ctx, input);
  const second = await ingest(ctx, input);
  assert.equal(first.deduped, false);
  assert.equal(second.deduped, true);
  assert.equal(first.messageId, second.messageId);
  assert.equal(rows(ctx.db, `SELECT id FROM mail_message`).length, 1);
  assert.equal(rows(ctx.db, `SELECT "providerId" FROM mail_seen`).length, 1);
});

test("the same message in two inboxes is one record", async () => {
  const { ctx } = makeCtx();
  const maya = await connect(ctx, { provider: "google", address: "maya@vyre.test", idempotencyKey: "idem-maya" });
  const sam = await connect(ctx, { provider: "google", address: "sam@vyre.test", idempotencyKey: "idem-sam" });
  const [googleCopy, imapCopy] = sameMessage.copies;
  assert.ok(googleCopy && imapCopy);
  const first = await ingest(ctx, {
    source: googleCopy.source,
    mailboxId: maya.mailbox.id,
    providerId: googleCopy.providerId,
    rfcMessageId: sameMessage.rfcMessageId,
    from: sameMessage.from,
    to: sameMessage.to,
    subject: sameMessage.subject,
    text: sameMessage.text,
    receivedAt: sameMessage.receivedAt,
  });
  const second = await ingest(ctx, {
    source: imapCopy.source,
    mailboxId: sam.mailbox.id,
    providerId: imapCopy.providerId,
    rfcMessageId: sameMessage.rfcMessageId,
    from: sameMessage.from,
    to: sameMessage.to,
    subject: sameMessage.subject,
    text: sameMessage.text,
    receivedAt: sameMessage.receivedAt,
  });
  assert.equal(first.deduped, false);
  assert.equal(second.deduped, true);
  assert.equal(first.messageId, second.messageId);
  assert.equal(rows(ctx.db, `SELECT id FROM mail_message`).length, 1);
  assert.equal(rows(ctx.db, `SELECT "rfcMessageId" FROM mail_rfc`).length, 1);
  assert.equal(rows(ctx.db, `SELECT "providerId" FROM mail_seen`).length, 2);
  const stored = rows(ctx.db, `SELECT "inboxIds" FROM mail_message`);
  const ids = JSON.parse(String(stored[0]?.inboxIds)) as string[];
  assert.deepEqual(ids.slice().sort(), [maya.mailbox.id, sam.mailbox.id].sort());
});

test("a sure address links and an unsure match goes to Needs you", async () => {
  const { ctx } = makeCtx();
  rememberAddress(ctx, "lee@acme.test", "rec_lee01", 0.95);
  rememberAddress(ctx, "pat@acme.test", "rec_pata", 0.4);
  rememberAddress(ctx, "pat@acme.test", "rec_patb", 0.55);
  const sure = await ingest(ctx, letter("lee@acme.test", "<sure@acme.test>", "gmailhist-sure"));
  assert.equal(sure.linked, "sure");
  assert.equal(sure.contactId, "rec_lee01");
  assert.equal(sure.taskId, undefined);
  const unsure = await ingest(ctx, letter("pat@acme.test", "<unsure@acme.test>", "gmailhist-unsure"));
  assert.equal(unsure.linked, "unsure");
  assert.equal(unsure.contactId, undefined);
  assert.ok(unsure.taskId);
  const needs = rows(ctx.db, `SELECT id, state, address FROM mail_needs WHERE id = ?`, unsure.taskId);
  assert.equal(needs.length, 1);
  assert.equal(needs[0]?.state, "open");
  assert.equal(needs[0]?.address, "pat@acme.test");
});

test("sync_now replays recorded IMAP including IDLE", async () => {
  const { ctx, events } = makeCtx();
  const sam = await connect(ctx, {
    provider: "imap",
    address: "sam@vyre.test",
    idempotencyKey: "idem-imap",
    imap,
  });
  const sync = await syncNow(ctx, { mailboxId: sam.mailbox.id });
  const landed = replayExample.unseen.length + replayExample.idle.reduce((n, step) => n + step.messages.length, 0);
  assert.equal(landed, 2);
  assert.ok(sync.runId.startsWith("run_"));
  assert.equal(rows(ctx.db, `SELECT id FROM mail_message`).length, landed);
  assert.equal(rows(ctx.db, `SELECT state FROM mail_mailbox WHERE id = ?`, sam.mailbox.id)[0]?.state, "syncing");
  assert.ok(events.some((event) => event.name === "mailbox.sync_completed"));
});

test("a recorded LOGIN failure does not connect the mailbox", async () => {
  const { ctx } = makeCtx();
  await assert.rejects(
    () => connect(ctx, {
      provider: "imap",
      address: "bad@vyre.test",
      idempotencyKey: "idem-bad",
      imap: { ...imap, host: "bad.example", username: "bad@vyre.test", passwordHandle: "#Imap.Bad" },
    }),
    (err: unknown) => {
      assert.ok(err && typeof err === "object");
      const shaped = err as { message?: string; error?: { code?: string } };
      assert.equal(shaped.error?.code, "provider.auth_failed");
      assert.equal(shaped.message, "The mailbox did not accept the sign-in.");
      return true;
    },
  );
  assert.equal(rows(ctx.db, `SELECT id FROM mail_mailbox`).length, 0);
});
