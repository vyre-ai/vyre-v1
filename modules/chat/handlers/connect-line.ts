// The line a connect card leaves after it is answered (b-connect2, 15 Nov 2026; b-connect3, 16 Nov 2026): one quiet line, written as the agent that asked and not as the person who answered, so it is no message of theirs
// (not in their messages, their search or their export) and carries no name. It still starts the agent's turn: the agent is mentioned on it, as the person it works for.
// The caller gives only the answered request's id. The chat, the agent, the asker and the words come from that request (vault.connect_card.line), never from the caller; only the person the card was asked for may call it,
// the agent must be one of the chat's, and the line is never the person's typed words (the review of 77603b1d6, blocker 1).
import { insertMessage, messageBy, raise, threadBy } from "../projections.ts";
import type { ChatCtx } from "../projections.ts";
import { agentsOf } from "../projections.ts";
import { canSpeak, deliver, rootOf } from "./post.ts";

/** A message id (`msg_` and 32 hex digits) that is the same for the same request and answer: four seeded 32-bit mixes of the text. */
function lineId(requestId: string, answer: string): string {
  const text = `${requestId}|${answer}`;
  let out = "";
  for (const seed of [0x811c9dc5, 0x01000193, 0x9e3779b1, 0x85ebca6b]) {
    let h = seed >>> 0;
    for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
    h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0;
    out += h.toString(16).padStart(8, "0");
  }
  return `msg_${out}`;
}

export async function connectLine(ctx: ChatCtx, input: { requestId: string }) {
  const refuse = (): never => raise(ctx, "permission.no_grant", "That is not yours to answer.");
  if (ctx.principal.kind !== "person" || ctx.actingFor !== undefined) return refuse();
  if (!ctx.call) return refuse();
  let line: {
    answeredAt?: number;
    state?: string;
    service?: string;
    asker?: string;
    threadId?: string;
    agentId?: string;
  };
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
  // the service's title is text a connector's publisher wrote: one line, no control characters, at most 60 characters, before it goes into the words an agent is woken with
  const title = line.service
    .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60)
    .trim();
  if (title === "") return refuse();
  const body =
    line.state === "connected" ? `${title} is connected.` : `Not connecting ${title} now. Carry on without it.`;
  // one line per answer: its message id is made from the request's id, the answer and when it was given, so a replay of the same answer finds the line that exists and posts and wakes nothing, while a later answer
  // (a card folded with Not now, opened again and connected) is a new line
  const id = lineId(input.requestId, `${line.state}:${line.answeredAt ?? 0}`);
  const had = messageBy(ctx.db, id);
  if (had) return { messageId: had.id };
  const m = insertMessage(ctx, t.id, { id, author: agentId, kind: "quiet", body });
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
