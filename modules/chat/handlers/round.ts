// chat.round.decide (chat gap G57): after a message asked several agents and each answered, the person goes with one answer. One quiet line is left in the chat ("Decided: going with Nova's answer"),
// authored by the person, and no agent is woken by it. The round table card folds because a message of theirs now follows the answers. Only the person who asked decides, only for an agent that answered
// after their message, and a replay with the same key is the same line.
import { addAgent, agentsOf, askerOf, ensure, messageBy, raise, threadBy } from "../projections.ts";
import type { ChatCtx } from "../projections.ts";
import { load } from "./g24a.ts";
import { postLinkCard } from "./link-card.ts";

function personOnly(ctx: ChatCtx): void {
  if (ctx.principal.kind !== "person") raise(ctx, "permission.role_lacks_permission", "Only a person presses this.");
}

type Row = Record<string, unknown>;

/** The Decided line of a round, if one was left: the system line whose card points at the asking message. */
function decisionOf(
  ctx: ChatCtx,
  threadId: string,
  askId: string,
): { id: string; blocks: Array<Record<string, unknown>> } | null {
  const rows = ctx.db.all(
    "SELECT id, blocks FROM chat_message WHERE thread = ? AND kind = 'system' AND deleted_at IS NULL AND blocks LIKE ? AND blocks LIKE ? ORDER BY threadSeq DESC LIMIT 1",
    threadId,
    '%"lead":"Decided"%',
    `%"target":{"type":"message","id":"${askId}"}%`,
  ) as Row[];
  const r = rows[0];
  return r ? { id: String(r["id"]), blocks: JSON.parse(String(r["blocks"])) as Array<Record<string, unknown>> } : null;
}

export async function decideRound(ctx: ChatCtx, input: { threadId: string; messageId: string; agentId: string }) {
  personOnly(ctx);
  ensure(ctx.db);
  const t = load(ctx, input.threadId);
  const m = messageBy(ctx.db, input.messageId);
  if (!m || m.thread !== t.id) raise(ctx, "validation.not_found", "That message is not in this chat.");
  const asker = askerOf(ctx);
  if (m.author !== asker)
    raise(ctx, "validation.bad_input", "Only the person who asked decides which answer to go with.");
  // a round the asker has moved past (they wrote again) is over
  const moved = (
    ctx.db.all(
      "SELECT 1 AS x FROM chat_message WHERE thread = ? AND author = ? AND kind = 'text' AND threadSeq > ? AND deleted_at IS NULL LIMIT 1",
      t.id,
      asker,
      m.seq,
    ) as unknown[]
  ).length;
  if (moved > 0) raise(ctx, "validation.bad_input", "That round is over: you have written since.");
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
  // one decision per round: the same choice again is the same line, the other agent's answer replaces it
  const had = decisionOf(ctx, t.id, m.id);
  if (had) {
    const block = had.blocks[0] as { data?: { title?: string } } | undefined;
    if (block?.data?.title === line) return { messageId: had.id };
    const next = had.blocks.map((b) => ({ ...b, data: { ...((b["data"] as object) ?? {}), title: line } }));
    const now = ctx.now();
    ctx.db.run(
      "UPDATE chat_message SET body = ?, blocks = ?, version = version + 1, updated_at = ? WHERE id = ?",
      `Decided: ${line}`,
      JSON.stringify(next),
      now,
      had.id,
    );
    // an open chat sees the line change at once, as it sees an edit
    ctx.emit("message.edited", t.id, { messageId: had.id, threadId: t.id });
    return { messageId: had.id };
  }
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
/** The words that mark a discussion seed, so a second press finds the first. */
const SEED_MARK = "Talk it over, one short turn each";

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
  personOnly(ctx);
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
  // one discussion per message: when its seed is already in the thread, this press opens it and starts nothing (no more paid turns)
  const seeded = (
    ctx.db.all(
      "SELECT 1 AS x FROM chat_message WHERE thread = ? AND body LIKE ? AND deleted_at IS NULL LIMIT 1",
      threadId,
      `%${SEED_MARK}%`,
    ) as unknown[]
  ).length;
  if (seeded > 0) return { threadId };
  const named = await Promise.all(answers.map(async (a) => ({ ...a, name: await nameOf(ctx, a.agentId) })));
  const [first, next] = [named[0]!, named[1]!];
  const body = [
    ...named.map((a) => `${a.name}: ${a.text}`),
    `${SEED_MARK}. ${first.name}, go first and tag ${next.name}. Whoever speaks last ends on one line that starts "Decided:".`,
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
  // one quiet line in the chat, authored by the person: it says where the talk is, opens it, and folds the round table (the person has written since the answers)
  postLinkCard(
    ctx,
    t.id,
    {
      icon: "people",
      lead: "Discussion",
      title: `${named.map((a) => a.name).join(" and ")} are talking it over`,
      target: { type: "thread", id: threadId },
    },
    `Discussion: ${named.map((a) => a.name).join(" and ")} are talking it over`,
  );
  return { threadId };
}

/** At most this many agent turns in a discussion: the first and three hand-offs (the engine's hop limit of 4 Nov). */
const MAX_TURNS = 4;

/**
 * An agent spoke in a discussion thread (message.received). The "talking it over" line in the chat becomes the outcome: "Agents decided: ..." (an agent wrote it: "Decided" is only a person's own press) when an agent ends on a Decided line, or "They did not settle it" when
 * the talk ended without one (nobody was handed the next turn, or the cap was reached). Pressing the line still opens the thread. Quiet: it edits the one line, it posts nothing.
 */
export function onDiscussionMessage(
  ctx: ChatCtx,
  event: {
    payload: {
      threadId: string;
      messageId: string;
      author: { kind: string; id: string };
      mentions?: Array<{ kind: string; id: string }>;
    };
  },
): void {
  const p = event.payload;
  if (p.author.kind !== "agent") return;
  ensure(ctx.db);
  const t = threadBy(ctx.db, p.threadId);
  if (!t || t.kind !== "thread" || t.parentThreadId === undefined) return;
  const seeded = (
    ctx.db.all(
      "SELECT 1 AS x FROM chat_message WHERE thread = ? AND body LIKE ? AND deleted_at IS NULL LIMIT 1",
      t.id,
      `%${SEED_MARK}%`,
    ) as unknown[]
  ).length;
  if (seeded === 0) return;
  const m = messageBy(ctx.db, p.messageId);
  if (!m) return;
  const decided = /^\s*Decided:\s*(.+)$/s.exec(m.body);
  const turns = (
    ctx.db.all(
      "SELECT COUNT(*) AS n FROM chat_message WHERE thread = ? AND kind = 'agent' AND deleted_at IS NULL",
      t.id,
    ) as Array<Record<string, unknown>>
  )[0]?.["n"];
  const handedOn = (p.mentions ?? []).some((x) => x.kind === "agent");
  if (!decided && handedOn && Number(turns) < MAX_TURNS) return; // the talk goes on
  const card = ctx.db.all(
    "SELECT id, blocks FROM chat_message WHERE thread = ? AND kind = 'system' AND deleted_at IS NULL AND blocks LIKE ? AND blocks LIKE ? LIMIT 1",
    t.parentThreadId,
    '%"lead":"Discussion"%',
    `%"target":{"type":"thread","id":"${t.id}"}%`,
  ) as Array<Record<string, unknown>>;
  const row = card[0];
  if (!row) return;
  // the cap is said as the cap, so a person knows to ask again; a talk that just stopped is said as that
  const capped = !decided && handedOn && Number(turns) >= MAX_TURNS;
  const text = decided
    ? decided[1]!.trim().replace(/\s+/g, " ").slice(0, 140)
    : capped
      ? `They used their ${MAX_TURNS} turns without settling it. Ask again to go on.`
      : "They did not settle it";
  const blocks = (JSON.parse(String(row["blocks"])) as Array<Record<string, unknown>>).map((b) => ({
    ...b,
    data: { ...((b["data"] as object) ?? {}), lead: decided ? "Agents decided" : "Discussion ended", title: text },
  }));
  const now = ctx.now();
  ctx.db.run(
    "UPDATE chat_message SET body = ?, blocks = ?, version = version + 1, updated_at = ? WHERE id = ?",
    decided ? `Agents decided: ${text}` : text,
    JSON.stringify(blocks),
    now,
    String(row["id"]),
  );
  // an open chat sees the line change at once, as it sees an edit
  ctx.emit("message.edited", t.parentThreadId, { messageId: String(row["id"]), threadId: t.parentThreadId });
}
