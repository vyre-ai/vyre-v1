// P-CC_39: mail.message.erase removes one message for good: row (subject, snippet, body), body table, attachment blobs, contact link, send-log rows naming its recipients, and its inbox entry. The provider id stays
// in mail_seen (no content) so the next sync does not bring it back. Another message is untouched, and erasing twice is `erased: false`.
// @reads /modules/mail/migrations/0001_mail_core.sql
// @reads /modules/mail/handlers/purge.ts
import test from "node:test";
import assert from "node:assert/strict";
import { ingest } from "../handlers/ingest.ts";
import { messageErase } from "../handlers/purge.ts";
import { contractErrors, harness, letter, seedMailbox } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";

function setup(): { h: Harness; blobsDeleted: string[]; erasedEntries: string[] } {
  const h = harness({ contacts: { "lee@acme.test": [{ recordId: "rec_lee01", score: 0.95 }] } });
  seedMailbox(h, "mbx_maya", "maya@vyre.test", { kind: "personal", provider: "google", ownerId: "usr_maya01" });
  const blobsDeleted: string[] = [];
  const erasedEntries: string[] = [];
  const prior = h.ctx.call.bind(h.ctx);
  h.ctx.call = async (cap, input) => {
    if (cap === "inbox.item.erase") { erasedEntries.push(String((input as Record<string, unknown>)["refId"])); return { erased: true }; }
    return prior(cap, input);
  };
  (h.ctx as unknown as { blobs: unknown }).blobs = { delete: async (id: string) => { blobsDeleted.push(id); return true; } };
  return { h, blobsDeleted, erasedEntries };
}

const count = (h: Harness, table: string): number => h.rows(`SELECT * FROM ${table}`).length;

test("erase removes the message, its body, links, attachment blobs and inbox entry, keeps the provider id marker, and leaves other mail", async () => {
  const { h, blobsDeleted, erasedEntries } = setup();
  const gone = await ingest(h.ctx, letter("lee@acme.test", "<gone@acme.test>", "prov-gone", { subject: "My divorce", text: "Please keep this quiet", attachments: [{ name: "settlement.pdf", mime: "application/pdf", size: 10, blobId: "blb_att00001" }] }));
  const keep = await ingest(h.ctx, letter("lee@acme.test", "<keep@acme.test>", "prov-keep", { subject: "Lunch", text: "Noon works" }));
  const goneId = (gone as unknown as { messageId: string }).messageId;
  const keepId = (keep as unknown as { messageId: string }).messageId;
  assert.equal(count(h, "mail_message"), 2);
  h.ctx.db.run(`INSERT INTO mail_send_log (id, "mailboxId", "throttleKey", address, "messageId", at) VALUES (?, ?, ?, ?, ?, ?)`, "msl_1", "mbx_maya", "k", "lee@acme.test", goneId, 1);

  const out = await messageErase(h.ctx, { messageId: goneId, idempotencyKey: "k1" });
  assert.deepEqual(out, { erased: true });
  assert.deepEqual(contractErrors("mail.message.erase", "out", out), []);
  assert.deepEqual(h.rows(`SELECT id FROM mail_message`).map((r) => r.id), [keepId]);
  assert.deepEqual(h.rows(`SELECT "messageId" FROM mail_body`).map((r) => r.messageId), [keepId]);
  assert.deepEqual(h.rows(`SELECT "messageId" FROM mail_link`).map((r) => r.messageId), [keepId]);
  assert.equal(count(h, "mail_send_log"), 0);
  assert.equal(h.rows(`SELECT * FROM mail_rfc WHERE "messageId" = ?`, goneId).length, 0);
  assert.equal(h.rows(`SELECT * FROM mail_seen WHERE "providerId" = ?`, "prov-gone").length, 1, "the marker stays so a sync does not bring the message back");
  assert.deepEqual(blobsDeleted, ["blb_att00001"]);
  assert.deepEqual(erasedEntries, [goneId]);
  assert.ok(!JSON.stringify([h.rows(`SELECT * FROM mail_message`), h.rows(`SELECT * FROM mail_body`), h.emitted]).includes("divorce"), "the words are gone and the event carries ids only");
  assert.deepEqual(h.named("mail.message_erased").map((e) => e.payload), [{ messageId: goneId }]);
  assert.deepEqual(await messageErase(h.ctx, { messageId: goneId, idempotencyKey: "k2" }), { erased: false });
  assert.equal(h.named("mail.message_erased").length, 1);
});
