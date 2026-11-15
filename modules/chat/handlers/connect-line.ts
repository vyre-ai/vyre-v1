// The line a connect card leaves after it is answered (b-connect2, 15 Nov 2026; b-connect3, 16 Nov 2026): one quiet line, written as the agent that asked and not as the person who answered, so it is no message of theirs
// (not in their messages, their search or their export) and carries no name. It still starts the agent's turn: the agent is mentioned on it, as the person it works for.
// The caller gives only the answered request's id. The chat, the agent, the asker and the words come from that request (vault.connect_card.line), never from the caller; only the person the card was asked for may call it,
// the agent must be one of the chat's, and the line is never the person's typed words (the review of 77603b1d6, blocker 1).
import { insertMessage, raise, threadBy } from "../projections.ts";
import type { ChatCtx } from "../projections.ts";
import { agentsOf } from "../projections.ts";
import { canSpeak, deliver, rootOf } from "./post.ts";

export async function connectLine(ctx: ChatCtx, input: { requestId: string }) {
  const refuse = (): never => raise(ctx, "permission.no_grant", "That is not yours to answer.");
  if (ctx.principal.kind !== "person" || ctx.actingFor !== undefined) return refuse();
  if (!ctx.call) return refuse();
  let line: { state?: string; service?: string; asker?: string; threadId?: string; agentId?: string };
  try {
    line = (await ctx.call("vault.connect_card.line", { requestId: input.requestId })) as typeof line;
  } catch {
    return refuse();
  }
  if (line.asker !== ctx.principal.id || !line.threadId || !line.agentId || !line.service) return refuse();
  if (line.state !== "connected" && line.state !== "declined") return refuse();
  const t = threadBy(ctx.db, line.threadId);
  if (!t || !canSpeak(ctx, t)) raise(ctx, "validation.not_found", "That chat does not exist or is not yours.");
  const agentId = line.agentId;
  const root = rootOf(ctx, t);
  if (
    !agentsOf(ctx.db, t.id).some((a) => a.agentId === agentId) &&
    !agentsOf(ctx.db, root.id).some((a) => a.agentId === agentId)
  )
    return refuse();
  const body =
    line.state === "connected"
      ? `${line.service} is connected.`
      : `Not connecting ${line.service} now. Carry on without it.`;
  const m = insertMessage(ctx, t.id, { author: agentId, kind: "quiet", body });
  deliver(
    ctx,
    t,
    m,
    [{ kind: "agent", id: agentId }],
    { kind: "person", id: line.asker },
    { notify: false, quiet: true },
  );
  return { messageId: m.id };
}
