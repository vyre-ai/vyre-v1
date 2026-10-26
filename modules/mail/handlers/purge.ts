// Erase one mail message for good (governance erase; P-CC_39): the message row with its subject, snippet and body, the body table, the attachment blobs, the links to a contact and conversation, the
// send-log rows that name its recipients, and its conversation entry in the inbox.
// DECISION: mail_seen keeps the provider id of an erased message (no content) so the next sync does not bring it back. The copy at the provider (Gmail, Outlook, IMAP) is theirs and is not touched.
// DECISION: a draft's attachment is a Files file the person owns; it is not deleted here (governance finds files on their own). An ingested attachment is a blob this module stored; it goes.
import { ensure, first, str } from "../projections.ts";
import type { MailCtx } from "../projections.ts";
import { readAttachments } from "./extra/messages.ts";

const codeOf = (e: unknown): string => ((e as { error?: { code?: string } } | null)?.error?.code ?? "");

export async function messageErase(ctx: MailCtx, input: { messageId: string; idempotencyKey: string }) {
  ensure(ctx);
  const row = first(ctx.db.all(`SELECT * FROM mail_message WHERE id = ?`, input.messageId));
  if (!row) return { erased: false };
  const id = str(row, "id");
  const blobs = (ctx as { blobs?: { delete(id: string): Promise<boolean> } }).blobs;
  for (const a of readAttachments(row["attachments"])) if (a.blobId && blobs) await blobs.delete(a.blobId);
  try { await ctx.call("inbox.item.erase", { refId: id, idempotencyKey: `mail-erase:${id}` }); } catch (e) { if (codeOf(e) !== "validation.not_found" && codeOf(e) !== "permission.not_found") throw e; }
  const rfc = str(row, "rfcMessageId");
  if (rfc) ctx.db.run(`DELETE FROM mail_rfc WHERE "rfcMessageId" = ?`, rfc);
  ctx.db.run(`DELETE FROM mail_body WHERE "messageId" = ?`, id);
  ctx.db.run(`DELETE FROM mail_link WHERE "messageId" = ?`, id);
  for (const t of ["mail_send_log", "mail_idem"] as const) {
    const col = t === "mail_idem" ? "refId" : "messageId";
    try { ctx.db.run(`DELETE FROM ${t} WHERE "${col}" = ?`, id); } catch (e) { if (!/no (such )?table/i.test(e instanceof Error ? e.message : String(e))) throw e; }   // created by a later migration
  }
  ctx.db.run(`DELETE FROM mail_message WHERE id = ?`, id);
  ctx.emit("mail.message_erased", `entity/${id}`, { messageId: id });
  return { erased: true };
}
