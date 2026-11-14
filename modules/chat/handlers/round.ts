// chat.round.decide (chat gap G57): after a message asked several agents and each answered, the person goes with one answer. One quiet line is left in the chat ("Decided: going with Nova's answer"),
// authored by the person, and no agent is woken by it. The round table card folds because a message of theirs now follows the answers. Only the person who asked decides, only for an agent that answered
// after their message, and a replay with the same key is the same line.
import { askerOf, ensure, messageBy, raise } from "../projections.ts";
import type { ChatCtx } from "../projections.ts";
import { load } from "./g24a.ts";
import { postLinkCard } from "./link-card.ts";

export async function decideRound(ctx: ChatCtx, input: { threadId: string; messageId: string; agentId: string }) {
  ensure(ctx.db);
  const t = load(ctx, input.threadId);
  const m = messageBy(ctx.db, input.messageId);
  if (!m || m.thread !== t.id) raise(ctx, "validation.not_found", "That message is not in this chat.");
  const asker = askerOf(ctx);
  if (m.author !== asker)
    raise(ctx, "validation.bad_input", "Only the person who asked decides which answer to go with.");
  const answered = (
    ctx.db.all(
      "SELECT 1 AS x FROM chat_message WHERE thread = ? AND author = ? AND threadSeq > ? AND kind = 'agent' AND deleted_at IS NULL LIMIT 1",
      t.id,
      input.agentId,
      m.seq,
    ) as unknown[]
  ).length;
  if (answered === 0)
    raise(ctx, "validation.bad_input", "That agent has not answered this message.", { agentId: input.agentId });
  const name = await nameOf(ctx, input.agentId);
  const line = `Going with ${name}'s answer`;
  const card = postLinkCard(
    ctx,
    t.id,
    {
      icon: "check",
      lead: "Decided",
      title: line,
      who: asker,
      target: { type: "message", id: m.id },
    },
    `Decided: ${line}`,
  );
  return { messageId: card.id };
}

async function nameOf(ctx: ChatCtx, agentId: string): Promise<string> {
  try {
    const hit = (
      (await ctx.call?.("search.resolve", { kind: "agent", itemId: agentId })) as
        | { hit?: { title?: string } }
        | undefined
    )?.hit?.title;
    if (hit) return hit.split(" ")[0] ?? hit;
  } catch {
    /* the name is not readable: a plain word, never the id */
  }
  return "that agent";
}
