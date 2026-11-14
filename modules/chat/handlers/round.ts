// chat.round.decide (chat gap G57): after a message asked several agents and each answered, the person goes with one answer. One quiet line is left in the chat ("Decided: going with Nova's answer"),
// authored by the person, and no agent is woken by it. The round table card folds because a message of theirs now follows the answers. Only the person who asked decides, only for an agent that answered
// after their message, and a replay with the same key is the same line.
import { addAgent, agentsOf, askerOf, ensure, messageBy, raise } from "../projections.ts";
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
    const got = (await ctx.call?.("agents.get", { agentId })) as { agent?: { name?: string } } | undefined;
    const n = got?.agent?.name;
    if (n) return n.split(" ")[0] ?? n;
  } catch {
    /* fall through to the search index */
  }
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

const SHOWN = 400;

/** The agents' first plain answers after a message, in the order they came. */
function answersAfter(ctx: ChatCtx, threadId: string, seq: number): Array<{ agentId: string; text: string }> {
  const rows = ctx.db.all(
    "SELECT author, body FROM chat_message WHERE thread = ? AND threadSeq > ? AND kind = 'agent' AND deleted_at IS NULL ORDER BY threadSeq",
    threadId,
    seq,
  ) as Array<Record<string, unknown>>;
  const out: Array<{ agentId: string; text: string }> = [];
  for (const r of rows) {
    const agentId = String(r["author"]);
    const text = String(r["body"] ?? "").trim();
    if (text === "" || out.some((o) => o.agentId === agentId)) continue;
    out.push({ agentId, text: text.length > SHOWN ? `${text.slice(0, SHOWN - 1)}\u2026` : text });
  }
  return out;
}

/**
 * chat.round.discuss: the agents talk it over under the message. A thread under the person's message (the one inline thread, made if it is not there) gets one message from the person: the answers as
 * they stand and a request to take one short turn each and end on one line that starts "Decided:". The first agent is tagged; it tags the next, so the engine's own hand-off limits cap the talk
 * (three hand-offs after the first turn: four turns at most) and no agent talks to itself. It runs on the asker's account like any turn, and it is the asker's own message, so it opens no outward act.
 */
export async function discussRound(
  ctx: ChatCtx,
  input: { threadId: string; messageId: string; idempotencyKey: string },
) {
  ensure(ctx.db);
  const t = load(ctx, input.threadId);
  const m = messageBy(ctx.db, input.messageId);
  if (!m || m.thread !== t.id) raise(ctx, "validation.not_found", "That message is not in this chat.");
  if (m.author !== askerOf(ctx)) raise(ctx, "validation.bad_input", "Only the person who asked starts the discussion.");
  const answers = answersAfter(ctx, t.id, m.seq);
  if (answers.length < 2) raise(ctx, "validation.bad_input", "At least two agents have to answer first.");
  if (!ctx.call) raise(ctx, "internal.unavailable", "The discussion is not available just now.");
  const opened = (await ctx.call("chat.thread", { threadId: t.id, messageId: m.id })) as {
    thread?: { threadId?: string };
  };
  const threadId = opened.thread?.threadId;
  if (!threadId) raise(ctx, "internal.unexpected", "The discussion could not be opened.");
  // every agent in the discussion is in the thread before the first turn, so the hand-off from one to the next reaches an agent the engine already knows
  const here = new Set(agentsOf(ctx.db, threadId).map((a) => a.agentId));
  for (const a of answers) {
    if (here.has(a.agentId)) continue;
    addAgent(ctx, threadId, { agentId: a.agentId, mode: "listen", addedBy: askerOf(ctx) });
    ctx.emit("agent.engaged", threadId, { threadId, agentId: a.agentId, mode: "listen", by: askerOf(ctx) });
  }
  const named = await Promise.all(answers.map(async (a) => ({ ...a, name: await nameOf(ctx, a.agentId) })));
  const [first, next] = [named[0]!, named[1]!];
  const body = [
    `${named.map((a) => a.name).join(" and ")}, you answered on your own. Talk it over here.`,
    ...named.map((a) => `${a.name}: ${a.text}`),
    `Take one short turn each and read the others first. ${first.name}, go first, then tag ${next.name}. Whoever speaks last ends on one line that starts "Decided:" with the answer you agree on, or "Decided: no agreement" and why.`,
  ].join("\n\n");
  await ctx.call(
    "chat.post",
    {
      threadId,
      body,
      mentions: [{ kind: "agent", id: first.agentId }],
      idempotencyKey: `${input.idempotencyKey}:discuss`,
    },
    { idempotencyKey: `${input.idempotencyKey}:discuss` },
  );
  return { threadId };
}
