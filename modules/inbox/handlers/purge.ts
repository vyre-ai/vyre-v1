// Erase the conversation entries of one message, text or call (governance erase; P-CC_39). inbox_item keeps a preview, a subject and the participants of what it indexes, so erasing the message in mail
// or telephony without this would leave its words here. The conversation keeps only what the items that remain still say.
// DECISION: a conversation left with no items is deleted with its match task and undo rows: it holds only the sender's address and name, the words of the person the erase is about. A new message opens a new one. Erasing an item that has no entry answers `erased: false`.
import { ensure, first, rowsOf, str } from "../projections.ts";
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
    ctx.db.run(`DELETE FROM inbox_match_task WHERE "conversationId" = ?`, id);
    ctx.db.run(`DELETE FROM inbox_undo WHERE "sourceId" = ?`, id);
    ctx.db.run(`DELETE FROM inbox_undo WHERE "targetId" = ?`, id);
    ctx.db.run(`DELETE FROM inbox_conversation WHERE id = ?`, id);
  }
  ctx.emit("inbox.item_erased", `entity/${input.refId}`, { refId: input.refId, removed: rows.length });
  return { erased: true };
}
