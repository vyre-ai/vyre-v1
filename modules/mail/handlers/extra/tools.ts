// The tool models are shown for a sent message's delivery (mail.delivery_state). With a messageId it gives that message's trail. With none (the first call a model makes, knowing nothing) it lists the
// sent messages that need a look: bounced, marked as spam, failed, or still being retried, newest first, so the next call can name one. Templates and inbox health are actions of mail.configure.
import { can, num, readParties, readStrings, rowsOf, str } from "../../projections.ts";
import type { MailCtx } from "../../projections.ts";
import { ensureAll } from "./common.ts";
import { ensureDelivery, trail } from "./delivery.ts";

const LIMIT = 20;
const NEEDS_A_LOOK = ["bounced", "complained", "failed"];

export async function delivery(ctx: MailCtx, input: { messageId?: string }): Promise<{ result: unknown }> {
  if (input.messageId !== undefined) return { result: await trail(ctx, { messageId: input.messageId }) };
  ensureAll(ctx);
  ensureDelivery(ctx);
  const ids = new Set<string>();
  for (const status of NEEDS_A_LOOK)
    for (const r of rowsOf(
      ctx.db.all(
        `SELECT id FROM mail_message WHERE direction = ? AND status = ? AND deleted_at IS NULL`,
        "out",
        status,
      ),
    ))
      ids.add(str(r, "id"));
  for (const r of rowsOf(ctx.db.all(`SELECT "messageId" FROM mail_delivery_retry WHERE state = ?`, "pending")))
    ids.add(str(r, "messageId"));
  for (const r of rowsOf(ctx.db.all(`SELECT "messageId" FROM mail_delivery_retry WHERE state = ?`, "held")))
    ids.add(str(r, "messageId"));
  const messages: { messageId: string; to: string[]; subject: string; status: string; at: number }[] = [];
  for (const id of ids) {
    const m = rowsOf(ctx.db.all(`SELECT * FROM mail_message WHERE id = ? AND deleted_at IS NULL`, id))[0];
    if (!m) continue;
    const boxes = readStrings(str(m, "inboxIds"));
    const doors = boxes.length ? boxes : [str(m, "mailboxId")];
    if (!doors.some((b) => can(ctx, "view", { type: "mailbox", id: b }))) continue; // a message the person may not see is not listed
    messages.push({
      messageId: id,
      to: readParties(str(m, "toAddresses")).map((p) => p.address),
      subject: str(m, "subject"),
      status: str(m, "status"),
      at: num(m, "sentAt"),
    });
  }
  messages.sort((a, b) => b.at - a.at);
  return {
    result: {
      messages: messages.slice(0, LIMIT),
      next: "Call again with a messageId from this list for its whole trail.",
    },
  };
}
