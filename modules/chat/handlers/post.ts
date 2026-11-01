// chat.post and the delivery every message shares (spec 2.5, 3.2, 4.6; ARCH 6.1, 7.2).
//   One message in a thread or channel, numbered by the thread (gap-free), with its hop depth, its blocks and its mentions. The turn engine reads message.received (ids and counts only, never the
//   text) and routes to the lead agent or the @mentioned agents; this module does not start turns. People get message.mentioned, message.direct and thread.replied.
import {
  MAX_BLOCKS, MAX_BODY, MAX_MENTIONS, agentsOf, askerOf, encOf, ensure, hopLimit, insertMessage, isMember, lastMessage, membersOf, messageBy, messageOut, mintId, raise, refOf, refuseUnseenAgents, threadBy,
} from "../projections.ts";
import type { ChatCtx, MessageRec, ThreadRec } from "../projections.ts";
import { unarchiveForMention } from "./archive-state.ts";
import { saveScreen } from "./screen.ts";

export interface Mention { kind: "person" | "agent"; id: string }
export interface PostInput {
  threadId: string; body: string; blocks?: Array<{ type: string; v: number; data: unknown }>; attachments?: string[]; replyTo?: string; mentions?: Mention[]; via?: { routineOwner: string };
  clientId?: string; idempotencyKey?: string;
  /** Where the person sent this from (ScreenContext); kept beside the message for the agent's turn. */
  screen?: unknown;
}

const BLOCK_TYPE = /^[a-z][a-z0-9_]*$/;
/** Blocks that wait for an answer have their own tools (they need a row to answer against); a plain post cannot carry them. */
const OWN_TOOL = new Set(["question", "plan"]);

/** The top of a thread chain: the chat, Ask pane or channel an inline thread hangs under. */
export function rootOf(ctx: Pick<ChatCtx, "db">, t: ThreadRec): ThreadRec {
  let cur = t;
  for (let i = 0; i < 8 && cur.parentThreadId; i++) {
    const up = threadBy(ctx.db, cur.parentThreadId);
    if (!up) break;
    cur = up;
  }
  return cur;
}

const isPrivateRoot = (root: ThreadRec): boolean => root.kind === "chat" || root.kind === "ask";

/** Who may speak in a thread. Channels and their threads answer to grants (the pipeline already checked them); a private chat answers to its members and the agents in it. */
export function canSpeak(ctx: ChatCtx, thread: ThreadRec): boolean {
  const root = rootOf(ctx, thread);
  if (!isPrivateRoot(root)) return true;
  const asker = askerOf(ctx);
  if (isMember(ctx.db, root.id, asker) || root.starter === asker) return true;
  if (ctx.principal.kind === "agent") return agentsOf(ctx.db, root.id).some((a) => a.agentId === ctx.principal.id) || agentsOf(ctx.db, thread.id).some((a) => a.agentId === ctx.principal.id);
  return false;
}

/** Exactly two people and a chat, no channel: a direct message. */
export function isDirect(ctx: Pick<ChatCtx, "db">, t: ThreadRec): boolean {
  if (t.kind !== "chat" || t.channelId !== undefined) return false;
  return membersOf(ctx.db, t.id).filter((p) => !p.startsWith("agt_")).length === 2;
}

function cleanMentions(ctx: ChatCtx, raw: Mention[] | undefined): Mention[] {
  const out: Mention[] = [];
  if ((raw?.length ?? 0) > MAX_MENTIONS) raise(ctx, "validation.bad_input", `A message can mention at most ${MAX_MENTIONS} people and agents.`);
  for (const m of raw ?? []) {
    const want = m.kind === "agent" ? "agt_" : "usr_";
    if (!m.id.startsWith(want)) raise(ctx, "validation.bad_input", `That is not ${m.kind === "agent" ? "an agent" : "a person"} you can mention.`, { id: m.id });
    if (!out.some((o) => o.kind === m.kind && o.id === m.id)) out.push({ kind: m.kind, id: m.id });
  }
  return out;
}

function cleanBlocks(ctx: ChatCtx, raw: PostInput["blocks"]): Array<Record<string, unknown>> {
  if ((raw?.length ?? 0) > MAX_BLOCKS) raise(ctx, "validation.bad_input", `A message can carry at most ${MAX_BLOCKS} blocks.`);
  return (raw ?? []).map((b) => {
    if (!BLOCK_TYPE.test(b.type)) raise(ctx, "validation.bad_input", "That is not a block type.", { type: b.type });
    if (OWN_TOOL.has(b.type)) raise(ctx, "validation.bad_input", "Questions and plans are made with ask_question and plan_propose, so they can be answered.", { type: b.type });
    return { type: b.type, v: b.v, id: mintId("blk", ctx.now()), data: b.data, state: "done", traceId: ctx.trace.traceId };
  });
}

/**
 * What a message sets in motion, once it is stored: message.received for the engine and the replicas, then the notices people get.
 * `author` is who the event names (the call's principal); a mention of a person who cannot see the thread notifies nobody (a private chat never gains people).
 * `notify: false` sends message.received only. chat.start declares no message.direct, so the first message of a new direct message cannot notify the other person from there (a contract gap, see the packet comment).
 */
export function deliver(ctx: ChatCtx, thread: ThreadRec, m: MessageRec, mentions: Mention[], author: { kind: "person" | "agent" | "actor" | "service"; id: string }, opts: { notify?: boolean } = {}): void {
  ctx.emit("message.received", thread.id, {
    messageId: m.id, threadId: thread.id, threadSeq: m.seq, author, kind: m.kind, depth: m.depth, mentions, hasBlocks: m.blocks.length > 0,
    ...(m.via ? { via: m.via.routineOwner } : {}),
    // an agent speaks for the person it works for: the engine reads a private thread as that person when nobody has spoken in it yet
    ...(author.kind === "agent" && ctx.actingFor?.startsWith("usr_") ? { actingFor: ctx.actingFor } : {}),
  });
  if (opts.notify === false) return;
  const root = rootOf(ctx, thread);
  const direct = author.kind === "person" && isDirect(ctx, root) ? membersOf(ctx.db, root.id).find((p) => !p.startsWith("agt_") && p !== author.id) : undefined;
  if (direct !== undefined) ctx.emit("message.direct", thread.id, { messageId: m.id, threadId: thread.id, personId: direct, author });
  for (const mention of mentions) {
    // an @mention is the one new message that brings an archived chat back into that person's list (a direct message gets message.direct instead, but the mention still counts)
    if (mention.kind === "person" && mention.id !== author.id) unarchiveForMention(ctx, root.id, mention.id);
    if (mention.kind !== "person" || mention.id === author.id || mention.id === direct) continue;
    if (isPrivateRoot(root) && !isMember(ctx.db, root.id, mention.id)) continue;
    ctx.emit("message.mentioned", thread.id, { messageId: m.id, threadId: thread.id, personId: mention.id, author, inThread: thread.kind === "thread" });
  }
  if (thread.kind === "thread") {
    // The people who follow an inline thread: whoever wrote the message above it and everyone who already replied in it.
    const follow = new Set<string>();
    const parent = thread.parentMessageId ? messageBy(ctx.db, thread.parentMessageId) : null;
    if (parent && refOf(parent.author).kind === "person") follow.add(parent.author);
    for (const r of ctx.db.all("SELECT DISTINCT author FROM chat_message WHERE thread = ? AND deleted_at IS NULL", thread.id) as Array<Record<string, unknown>>) {
      const a = String(r["author"]);
      if (refOf(a).kind === "person") follow.add(a);
    }
    follow.delete(author.id);
    for (const personId of follow) {
      ctx.emit("thread.replied", thread.id, { threadId: thread.id, ...(thread.parentThreadId !== undefined ? { parentThreadId: thread.parentThreadId } : {}), messageId: m.id, personId });
    }
  }
}

/** A crew teammate's thread: a helper thread whose line in the chat that started it says `crew`. People and the lead steer it directly; a plain helper thread takes no messages. */
function isCrewThread(ctx: ChatCtx, thread: ThreadRec): boolean {
  const line = thread.parentMessageId ? messageBy(ctx.db, thread.parentMessageId) : null;
  return line?.blocks.some((b) => b["type"] === "helper" && (b["data"] as Record<string, unknown> | undefined)?.["crew"] === true && (b["data"] as Record<string, unknown>)["helperThreadId"] === thread.id) ?? false;
}

/**
 * A finished crew job reports to the chat that started it with one message carrying a `crew_result` block. That is work coming back, not agents answering each other, so it does not count as a hop: a crew that
 * runs while nobody is at the keyboard would otherwise stop after a few results. Only the real thing counts: the block names a crew teammate thread under this chat, and the poster is that teammate.
 */
function isCrewResult(ctx: ChatCtx, thread: ThreadRec, authorId: string, blocks: Array<Record<string, unknown>>): boolean {
  for (const b of blocks) {
    if (b["type"] !== "crew_result") continue;
    const helperId = (b["data"] as Record<string, unknown> | undefined)?.["threadId"];
    const helper = typeof helperId === "string" ? threadBy(ctx.db, helperId) : null;
    if (helper && helper.kind === "helper" && helper.parentThreadId === thread.id && isCrewThread(ctx, helper) && agentsOf(ctx.db, helper.id).some((a) => a.agentId === authorId)) return true;
  }
  return false;
}

export async function post(ctx: ChatCtx, input: PostInput) {
  ensure(ctx.db);
  const thread = threadBy(ctx.db, input.threadId);
  if (!thread || !canSpeak(ctx, thread)) raise(ctx, "validation.not_found", "That chat does not exist or is not yours to write in.");
  const author = ctx.principal;
  if (thread.kind === "helper" && !isCrewThread(ctx, thread) && !(author.kind === "agent" && agentsOf(ctx.db, thread.id).some((a) => a.agentId === author.id))) {
    raise(ctx, "validation.bad_input", "A helper chat takes no messages. Steer the helper from the chat that started it.");
  }
  if (thread.closedAt !== undefined) raise(ctx, "validation.bad_input", "This thread is closed. Reopen it to write in it.");

  const body = input.body;
  const blocks = cleanBlocks(ctx, input.blocks);
  const attachments = [...new Set(input.attachments ?? [])];
  if (body.trim() === "" && blocks.length === 0 && attachments.length === 0) raise(ctx, "validation.bad_input", "Write something, or attach a file.");
  if (body.length > MAX_BODY) raise(ctx, "validation.bad_input", `A message can hold at most ${MAX_BODY} characters.`);
  const mentions = cleanMentions(ctx, input.mentions);
  await refuseUnseenAgents(ctx, mentions.filter((m) => m.kind === "agent").map((m) => m.id));
  if (input.via !== undefined && author.kind !== "agent") raise(ctx, "validation.bad_input", "Only an agent posts on a routine.");

  // A resent message (the offline queue replays) carries the id the device gave it: the same id in the same thread is the same message.
  if (input.clientId !== undefined) {
    const prior = messageBy(ctx.db, input.clientId);
    if (prior) {
      if (prior.thread !== thread.id) raise(ctx, "validation.bad_input", "That message id belongs to another thread.");
      return { message: messageOut(prior, encOf(ctx.db, thread)) };
    }
  }
  let replyTo: MessageRec | null = null;
  if (input.replyTo !== undefined) {
    replyTo = messageBy(ctx.db, input.replyTo);
    if (!replyTo || replyTo.thread !== thread.id) raise(ctx, "validation.bad_input", "The message you reply to is not in this thread.");
  }

  // Hops: an agent answering another agent is one hop further from the last person who spoke; a person's message starts again at 0.
  let depth = 0;
  if (author.kind === "agent" && !isCrewResult(ctx, thread, author.id, blocks)) {
    const prev = replyTo ?? lastMessage(ctx.db, thread.id);
    if (prev && refOf(prev.author).kind === "agent") depth = prev.author === author.id ? prev.depth : prev.depth + 1;
    if (depth >= 1) {
      const limit = await hopLimit(ctx);
      if (depth > limit) raise(ctx, "permission.limit", `The agents have handed this back and forth ${limit} times. A person has to reply before they go on.`, { limit, depth });
    }
  }

  const m = insertMessage(ctx, thread.id, {
    ...(input.clientId !== undefined ? { id: input.clientId } : {}), author: author.id, kind: author.kind === "agent" ? "agent" : "text", body, blocks,
    ...(input.replyTo !== undefined ? { replyTo: input.replyTo } : {}), ...(input.via ? { via: { routineOwner: input.via.routineOwner } } : {}), depth, attachments,
  });
  saveScreen(ctx, thread.id, m.id, input.screen);
  deliver(ctx, thread, m, mentions, { kind: author.kind, id: author.id });
  return { message: messageOut(m, encOf(ctx.db, thread)) };
}
