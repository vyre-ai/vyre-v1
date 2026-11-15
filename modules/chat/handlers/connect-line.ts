// The line a connect card leaves after it is answered (b-connect2, 15 Nov 2026): one quiet line, written as the agent that asked and not as the person who answered, so it is no message of theirs (not in their
// messages, their search or their export) and carries no name. It still starts the agent's turn: the agent is mentioned on it, as the person it works for. Only the engine writes it (agent: false, no tool).
import { insertMessage, raise, threadBy } from "../projections.ts";
import type { ChatCtx } from "../projections.ts";
import { canSpeak, deliver } from "./post.ts";

export async function connectLine(
  ctx: ChatCtx,
  input: { threadId: string; agentId: string; asker: string; body: string },
) {
  const t = threadBy(ctx.db, input.threadId);
  if (!t || !canSpeak(ctx, t)) raise(ctx, "validation.not_found", "That chat does not exist or is not yours.");
  const body = input.body.replace(/\s+/g, " ").trim();
  if (body === "") raise(ctx, "validation.bad_input", "Say what happened.");
  const m = insertMessage(ctx, t.id, { author: input.agentId, kind: "quiet", body });
  deliver(ctx, t, m, [{ kind: "agent", id: input.agentId }], { kind: "person", id: input.asker }, { notify: false });
  return { messageId: m.id };
}
