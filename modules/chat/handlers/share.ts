// chat.share (rc.9, "Share this"): a message from one chat goes to another chat (a channel's main thread, or a chat with a person) as a card, and the chat it came from gets a one-line card saying where
// it went. Both cards link to the other chat. The sharer must be able to read the message and to write in the place it goes: a share widens nothing they could not already do by hand.
import { askerOf, ensure, messageBy, raise } from "../projections.ts";
import type { ChatCtx } from "../projections.ts";
import { load } from "./g24a.ts";
import { postLinkCard } from "./link-card.ts";

const LINE = 100;
const QUOTE = 1500;

/** The first line of a message, cut to fit a card. */
const firstLine = (body: string): string => {
  const one = (body.trim().split(/\n/)[0] ?? "").trim();
  return (one.length > LINE ? `${one.slice(0, LINE - 3)}...` : one) || "A message";
};

export async function share(ctx: ChatCtx, input: { threadId: string; messageId: string; toThreadId: string; to?: string; idempotencyKey: string }) {
  ensure(ctx.db);
  const from = load(ctx, input.threadId);
  const m = messageBy(ctx.db, input.messageId);
  if (!m || m.thread !== from.id) raise(ctx, "validation.not_found", "That message is not in this chat.");
  if (m.kind === "system" || m.kind === "quiet") raise(ctx, "validation.bad_input", "Share something someone said, not a notice.");
  if (input.toThreadId === from.id) raise(ctx, "validation.bad_input", "Pick another chat to share it to.");
  const to = load(ctx, input.toThreadId);   // refused unless the sharer may write there
  if (to.closedAt !== undefined) raise(ctx, "validation.precondition_failed", "That chat is closed.");
  const asker = askerOf(ctx);
  const title = firstLine(m.body);
  const multi = m.body.trim().length > title.length;
  const sent = postLinkCard(ctx, to.id, { icon: "thread", lead: "Shared", by: asker, title, target: { type: "thread", id: from.id }, ...(multi ? { body: m.body.trim().slice(0, QUOTE) } : {}) }, `Shared: ${title}`);
  postLinkCard(ctx, from.id, { icon: "thread", lead: "Shared", to: input.to ?? to.id, title, target: { type: "thread", id: to.id } }, `Shared: ${title}`);
  return { messageId: sent.id, toThreadId: to.id };
}
