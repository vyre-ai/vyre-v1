// Erase the conversation entries of one message, text or call (governance erase; P-CC_39). inbox_item keeps a preview, a subject and the participants of what it indexes, so erasing the message in mail
// or telephony without this would leave its words here. The conversation keeps only what the items that remain still say: a conversation left with no items shows no preview and nothing unread.
// DECISION: the conversation row stays (it is the contact's), the entries go. Erasing an item that has no entry answers `erased: false`.
import { ensure, first, getConversation, nextVersion, rowsOf, str } from "../projections.ts";
import type { InboxCtx } from "../projections.ts";
import { refresh } from "./match.ts";

export async function itemErase(ctx: InboxCtx, input: { refId: string; idempotencyKey: string }) {
  ensure(ctx);
  const rows = rowsOf(ctx.db.all(`SELECT * FROM inbox_item WHERE "refId" = ?`, input.refId));
  if (rows.length === 0) return { erased: false };
  const conversations = [...new Set(rows.map((r) => str(r, "conversationId")))];
  for (const r of rows) ctx.db.run(`DELETE FROM inbox_item WHERE id = ?`, str(r, "id"));
  for (const id of conversations) {
    if (first(ctx.db.all(`SELECT id FROM inbox_item WHERE "conversationId" = ?`, id))) { refresh(ctx, id); continue; }
    const conv = getConversation(ctx, id);
    if (!conv) continue;
    ctx.db.run(`UPDATE inbox_conversation SET "lastMessageAt" = ?, "lastChannel" = ?, "lastPreview" = ?, "unreadCount" = ?, version = ?, updated_at = ? WHERE id = ?`, null, null, "", 0, nextVersion(conv), ctx.now(), id);
  }
  ctx.emit("inbox.item_erased", `entity/${input.refId}`, { refId: input.refId, removed: rows.length });
  return { erased: true };
}
