// The link card a handler leaves in a thread (rc.9): "Task created, assigned to Maya" and its kin. One system line per card, authored by the person the call acts for, carrying one `link_card` block
// (the shape the app draws: ui/src/blocks/link-card/model.ts). The card is written after the work it names, so a refused call leaves no card.
import { askerOf, insertMessage, mintId } from "../projections.ts";
import type { ChatCtx, MessageRec } from "../projections.ts";

export interface CardData {
  icon: string; lead: string; title: string; who?: string; target?: { type: string; id: string }; body?: string; actions?: { key: string; label: string }[];
}

/** Post the card into `threadId` as a system line (a card with a body or buttons, from an agent, is posted by the agent's own reply instead). */
export function postLinkCard(ctx: ChatCtx, threadId: string, d: CardData, line: string): MessageRec {
  return insertMessage(ctx, threadId, {
    author: askerOf(ctx), kind: "system", body: line,
    blocks: [{ type: "link_card", v: 1, id: mintId("blk", ctx.now()), data: d, state: "done", traceId: ctx.trace.traceId }],
  });
}
