// chat.rewind (chat gap G36, G37; DESIGN-chat-system item 20): go back in a private chat with an agent to a point the person picked. The engine puts the agent's work folder back and hides what came after from the
// agents (engine.rewind); this leaves the chat's own line: "<name> went back to before ...", with what it did and what it never does. Every message stays in the chat. In a chat with other people each person
// goes back only to their own turn, and the line tells everyone who did it. Only the person themselves, never an agent for them.
import { askerOf, ensure, isMember, membersOf, messageBy, raise } from "../projections.ts";
import type { ChatCtx } from "../projections.ts";
import { load } from "./g24a.ts";
import { postLinkCard } from "./link-card.ts";

/** What going back leaves alone, in the words the line carries. */
export const LEAVES = "Messages stay. Anything already sent stays sent.";

export async function chatRewind(ctx: ChatCtx, input: { threadId: string; pointId: string; idempotencyKey: string }) {
  ensure(ctx.db);
  const t = load(ctx, input.threadId);
  if (ctx.principal.kind !== "person") raise(ctx, "permission.role_lacks_permission", "Only a person goes back.");
  const asker = askerOf(ctx);
  if (t.kind !== "chat" || t.channelId !== undefined)
    raise(ctx, "validation.precondition_failed", "Only a chat with an agent goes back.");
  // a guest is only ever in a channel, so never reaches here. Someone who is in a shared chat but may not post (load() refused them above) cannot go back either.
  if (membersOf(ctx.db, t.id).length > 0 && !isMember(ctx.db, t.id, asker) && t.starter !== asker)
    raise(ctx, "validation.not_found", "That chat does not exist or is not yours.");
  if (!ctx.call) raise(ctx, "internal.unavailable", "Going back is not available just now.");
  const listed = (await ctx.call("engine.rewind.points", { threadId: t.id })) as {
    available: boolean;
    points: Array<{ pointId: string; at: number; after?: string; messageId?: string; undo?: boolean }>;
  };
  const point = listed.points.find((p) => p.pointId === input.pointId);
  if (!listed.available || !point) raise(ctx, "validation.not_found", "That point is not in this chat.");
  // the agents stop reading from the person's message that began the turn: going back is to before it. An undo point has none: it brings back what the rewind hid.
  const began = point!.messageId ? messageBy(ctx.db, point!.messageId) : null;
  // in a shared chat a person goes back only to their own turn (the points are in their own work folder, and the line says who did it)
  if (began && began.thread === t.id && began.author !== asker)
    raise(ctx, "validation.precondition_failed", "You can only go back to your own message.");
  const afterSeq = Math.max(0, (began && began.thread === t.id ? began.seq : 1) - 1);
  const last = ctx.db.all("SELECT MAX(threadSeq) AS top FROM chat_message WHERE thread = ?", t.id) as Array<
    Record<string, unknown>
  >;
  const uptoSeq = Math.max(afterSeq, Number(last[0]?.["top"] ?? afterSeq));
  const done = (await ctx.call("engine.rewind.to", {
    threadId: t.id,
    pointId: input.pointId,
    afterSeq,
    uptoSeq,
  })) as { restored: number; removed: number; failed?: number; undid: boolean };
  const files = done.restored + done.removed;
  const n = (files === 1 ? "1 file" : `${files} files`) + (done.failed ? `, ${done.failed} could not be put back` : "");
  postLinkCard(
    ctx,
    t.id,
    done.undid
      ? {
          icon: "reply",
          lead: "Came back",
          by: asker,
          title: "To where you were before going back",
          sub: `${n} put back. The agents read the later messages again. ${LEAVES}`,
        }
      : {
          icon: "reply",
          lead: "Went back",
          by: asker,
          title: point!.after ? `Before "${point!.after}"` : "To an earlier point",
          sub: `${n} put back. ${LEAVES}`,
        },
    done.undid ? "Came back to where you were" : `Went back${point!.after ? ` to before "${point!.after}"` : ""}`,
  );
  return { restored: done.restored, removed: done.removed, failed: done.failed ?? 0, at: point!.at, undid: done.undid };
}
