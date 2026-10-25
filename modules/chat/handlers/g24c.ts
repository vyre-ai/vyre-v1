// Reading and marking messages (spec 2.5, 3.2; ARCH 6.1, 7.2): the message list, one message, edit, delete, reactions, pins, Recent and the composer.
//   chat.messages.list / chat.message.get / chat.pins.list   reads of one thread, newest window first
//   chat.edit / chat.delete_message                          only the author; the row stays (deleted_at) for the audit trail
//   chat.react / chat.pin / chat.unpin                       markers on a message; a repeat changes nothing and emits nothing
//   chat.recent / chat.composer.suggest                      the sidebar and the @ # / tables, built from chat rows only
//   chat.open_tab                                            an agent opens a side tab for the person it acts for and leaves a line
// Private chats and Ask panes (enc=2) hold what the device gave the server: edit stores the new text as given, reads return it as stored, and Recent shows no preview of it.
import {
  agentsOf, askerOf, channelBy, encOf, ensure, insertMessage, lastMessage, membersOf, messageBy, messageOf, messageOut, mintId, raise, threadBy,
} from "../projections.ts";
import type { ChatCtx, MessageRec, ThreadRec } from "../projections.ts";
import { canSpeak, deliver } from "./post.ts";

type Row = Record<string, unknown>;
const MAX_BODY = 100_000;
const MAX_EMOJI = 64;
const MAX_REACTIONS = 50;
const DAY = 86_400_000;

/** The thread, if it exists and the caller may be in it. A private chat that is not yours does not exist for you. */
function openThread(ctx: ChatCtx, threadId: string): ThreadRec {
  ensure(ctx.db);
  const t = threadBy(ctx.db, threadId);
  if (!t || !canSpeak(ctx, t)) raise(ctx, "validation.not_found", "That chat does not exist or is not yours to open.");
  return t;
}

function messageIn(ctx: ChatCtx, t: ThreadRec, messageId: string): MessageRec {
  const m = messageBy(ctx.db, messageId);
  if (!m || m.thread !== t.id) raise(ctx, "validation.not_found", "That message is not in this chat.");
  return m;
}

// ---- reads ------------------------------------------------------------------------------------------------------------------------------------------

export async function messagesList(ctx: ChatCtx, input: { threadId: string; before?: number; after?: number; limit?: number }) {
  const t = openThread(ctx, input.threadId);
  const limit = input.limit ?? 50;
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) raise(ctx, "validation.bad_input", "The limit is a whole number from 1 to 200.");
  const { before, after } = input;
  // after alone reads forward from that number; everything else reads the newest window below `before` (or the newest of all).
  const forward = after !== undefined && before === undefined;
  const where = ["thread = ?", "deleted_at IS NULL"];
  const args: unknown[] = [t.id];
  if (after !== undefined) { where.push("threadSeq > ?"); args.push(after); }
  if (before !== undefined) { where.push("threadSeq < ?"); args.push(before); }
  const rows = ctx.db.all(`SELECT * FROM chat_message WHERE ${where.join(" AND ")} ORDER BY threadSeq ${forward ? "ASC" : "DESC"} LIMIT ?`, ...args, limit + 1) as Row[];
  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit).map(messageOf);
  if (!forward) page.reverse();
  const enc = encOf(ctx.db, t);
  return { messages: page.map((m) => messageOut(m, enc)), hasMore };
}

export async function messageGet(ctx: ChatCtx, input: { threadId: string; messageId: string }) {
  const t = openThread(ctx, input.threadId);
  return { message: messageOut(messageIn(ctx, t, input.messageId), encOf(ctx.db, t)) };
}

export async function pinsList(ctx: ChatCtx, input: { threadId: string }) {
  const t = openThread(ctx, input.threadId);
  const rows = ctx.db.all("SELECT * FROM chat_message WHERE thread = ? AND pinned = 1 AND deleted_at IS NULL ORDER BY threadSeq", t.id) as Row[];
  const enc = encOf(ctx.db, t);
  return { messages: rows.map((r) => messageOut(messageOf(r), enc)) };
}

// ---- edit and delete --------------------------------------------------------------------------------------------------------------------------------

function ownMessage(ctx: ChatCtx, m: MessageRec, what: string): void {
  if (m.author !== ctx.principal.id) raise(ctx, "permission.no_grant", `You can only ${what} a message you wrote.`);
}

export async function edit(ctx: ChatCtx, input: { threadId: string; messageId: string; body: string }) {
  const t = openThread(ctx, input.threadId);
  const m = messageIn(ctx, t, input.messageId);
  ownMessage(ctx, m, "edit");
  if (m.kind !== "text" && m.kind !== "agent") raise(ctx, "validation.bad_input", "Only a written message can be edited.");
  if (input.body.length > MAX_BODY) raise(ctx, "validation.bad_input", `A message can hold at most ${MAX_BODY} characters.`);
  if (input.body.trim() === "" && m.blocks.length === 0 && m.attachments.length === 0) raise(ctx, "validation.bad_input", "A message needs some text, a block or a file.");
  const enc = encOf(ctx.db, t);
  if (input.body === m.body) return { message: messageOut(m, enc) };
  const now = ctx.now();
  ctx.db.run("UPDATE chat_message SET body = ?, editedAt = ?, version = version + 1, updated_at = ? WHERE id = ?", input.body, now, now, m.id);
  ctx.emit("message.edited", t.id, { messageId: m.id, threadId: t.id });
  return { message: messageOut(messageBy(ctx.db, m.id)!, enc) };
}

export async function deleteMessage(ctx: ChatCtx, input: { threadId: string; messageId: string }) {
  const t = openThread(ctx, input.threadId);
  // A repeat finds the row already marked and answers the same.
  const row = (ctx.db.all("SELECT thread, author, deleted_at FROM chat_message WHERE id = ?", input.messageId) as Row[])[0];
  if (!row || String(row["thread"]) !== t.id) raise(ctx, "validation.not_found", "That message is not in this chat.");
  if (String(row["author"]) !== ctx.principal.id) raise(ctx, "permission.no_grant", "You can only delete a message you wrote.");
  if (row["deleted_at"] !== null && row["deleted_at"] !== undefined) return { deleted: true };
  const now = ctx.now();
  ctx.db.run("UPDATE chat_message SET deleted_at = ?, pinned = 0, version = version + 1, updated_at = ? WHERE id = ?", now, now, input.messageId);
  ctx.emit("message.deleted", t.id, { messageId: input.messageId, threadId: t.id });
  return { deleted: true };
}

// ---- reactions and pins -----------------------------------------------------------------------------------------------------------------------------

export async function react(ctx: ChatCtx, input: { threadId: string; messageId: string; emoji: string; remove?: boolean }) {
  const t = openThread(ctx, input.threadId);
  const m = messageIn(ctx, t, input.messageId);
  const emoji = input.emoji.trim();
  if (emoji === "" || emoji.length > MAX_EMOJI) raise(ctx, "validation.bad_input", `A reaction is an emoji name of 1 to ${MAX_EMOJI} characters.`);
  const who = ctx.principal.id;
  const list = m.reactions.map((r) => ({ emoji: r.emoji, by: [...r.by] }));
  const entry = list.find((r) => r.emoji === emoji);
  const has = entry?.by.includes(who) ?? false;
  const remove = input.remove === true;
  if (remove === has) {
    if (remove) {
      entry!.by = entry!.by.filter((p) => p !== who);
    } else {
      if (!entry && list.length >= MAX_REACTIONS) raise(ctx, "validation.bad_input", `A message can carry at most ${MAX_REACTIONS} different reactions.`);
      if (entry) entry.by.push(who); else list.push({ emoji, by: [who] });
    }
    const next = list.filter((r) => r.by.length > 0);
    const now = ctx.now();
    ctx.db.run("UPDATE chat_message SET reactions = ?, version = version + 1, updated_at = ? WHERE id = ?", JSON.stringify(next), now, m.id);
    ctx.emit("message.reacted", t.id, { messageId: m.id, threadId: t.id, emoji, removed: remove });
    return { reactions: next };
  }
  return { reactions: list.filter((r) => r.by.length > 0) };
}

function setPinned(ctx: ChatCtx, input: { threadId: string; messageId: string }, pinned: boolean) {
  const t = openThread(ctx, input.threadId);
  const m = messageIn(ctx, t, input.messageId);
  if (m.pinned !== pinned) {
    const now = ctx.now();
    ctx.db.run("UPDATE chat_message SET pinned = ?, version = version + 1, updated_at = ? WHERE id = ?", pinned ? 1 : 0, now, m.id);
    ctx.emit("message.pinned", t.id, { messageId: m.id, threadId: t.id, pinned });
  }
  return { pinned };
}
export async function pin(ctx: ChatCtx, input: { threadId: string; messageId: string }) { return setPinned(ctx, input, true); }
export async function unpin(ctx: ChatCtx, input: { threadId: string; messageId: string }) { return setPinned(ctx, input, false); }

// ---- Recent -----------------------------------------------------------------------------------------------------------------------------------------

const RECENT_MAX = 100;
const PREVIEW = 120;

/**
 * The threads the asker belongs to, newest activity first, in Today / Yesterday / Earlier (UTC days).
 * Read cursors, stars and the working pulse live with other capabilities (threads.mark_read and the engine), so unread is 0, starred false and working false here.
 */
export async function recent(ctx: ChatCtx, input: { filter?: "all" | "unread" | "people" | "agents" }) {
  ensure(ctx.db);
  const asker = askerOf(ctx);
  const filter = input.filter ?? "all";
  const threads = ctx.db.all(
    `SELECT * FROM chat_thread WHERE deleted_at IS NULL AND listed = 1 AND closedAt IS NULL AND kind IN ('chat', 'ask', 'channel')
       AND id IN (SELECT thread FROM chat_thread_member WHERE principal = ? AND deleted_at IS NULL)`, asker,
  ) as Row[];
  const rows: Array<{ lastAt: number; row: Record<string, unknown> }> = [];
  for (const r of threads) {
    const t = threadBy(ctx.db, String(r["id"]));
    if (!t) continue;
    const agents = agentsOf(ctx.db, t.id).map((a) => a.agentId);
    const people = membersOf(ctx.db, t.id).filter((p) => !p.startsWith("agt_"));
    if (filter === "unread") continue;
    if (filter === "people" && people.length < 2) continue;
    if (filter === "agents" && agents.length === 0) continue;
    const last = lastMessage(ctx.db, t.id);
    const lastAt = last?.createdAt ?? t.createdAt;
    const title = t.title ?? (t.channelId ? channelBy(ctx.db, t.channelId)?.name : undefined) ?? (t.kind === "ask" ? "Ask" : "New chat");
    const row: Record<string, unknown> = { threadId: t.id, kind: t.kind, title, agents, unread: 0, working: false, starred: false, lastAt };
    // A sealed thread holds ciphertext: no preview of it.
    if (last && last.body.trim() !== "" && encOf(ctx.db, t) === 0) row["preview"] = last.body.trim().slice(0, PREVIEW);
    rows.push({ lastAt, row });
  }
  rows.sort((a, b) => b.lastAt - a.lastAt);
  const today = Math.floor(ctx.now() / DAY) * DAY;
  const out = { starred: [] as Row[], today: [] as Row[], yesterday: [] as Row[], earlier: [] as Row[] };
  for (const { lastAt, row } of rows.slice(0, RECENT_MAX)) (lastAt >= today ? out.today : lastAt >= today - DAY ? out.yesterday : out.earlier).push(row);
  return { ...out, nextUnread: null };
}

// ---- composer ---------------------------------------------------------------------------------------------------------------------------------------

const SUGGEST_MAX = 20;

/**
 * The tables behind the composer symbols, from chat rows only: @ the people and agents of the thread (or of the asker's threads), # the channels the asker can see.
 * Folders, records and files belong to other modules and / commands to the host; chat holds none of them, so they are not listed here.
 */
export async function composerSuggest(ctx: ChatCtx, input: { symbol: "@" | "#" | "/"; q: string; threadId?: string }) {
  ensure(ctx.db);
  const q = input.q.trim().replace(/^[@#/]+/, "").toLowerCase();
  const hit = (...s: Array<string | undefined>): boolean => q === "" || s.some((x) => x !== undefined && x.toLowerCase().includes(q));
  const items: Array<{ group: string; kind: string; id: string; title: string; detail?: string }> = [];
  const asker = askerOf(ctx);
  if (input.symbol === "@") {
    let threadIds: string[];
    if (input.threadId !== undefined) threadIds = [openThread(ctx, input.threadId).id];
    else threadIds = (ctx.db.all("SELECT thread FROM chat_thread_member WHERE principal = ? AND deleted_at IS NULL", asker) as Row[]).map((r) => String(r["thread"])).slice(0, 200);
    const seen = new Set<string>();
    for (const id of threadIds) {
      for (const p of membersOf(ctx.db, id)) {
        if (p.startsWith("agt_") || seen.has(p) || !hit(p)) continue;
        seen.add(p); items.push({ group: "People", kind: "person", id: p, title: p });
      }
    }
    for (const id of threadIds) {
      for (const a of agentsOf(ctx.db, id)) {
        if (seen.has(a.agentId) || !hit(a.agentId)) continue;
        seen.add(a.agentId); items.push({ group: "Agents", kind: "agent", id: a.agentId, title: a.agentId });
      }
    }
  } else if (input.symbol === "#") {
    const rows = ctx.db.all("SELECT * FROM chat_channel WHERE archived = 0 ORDER BY name") as Row[];
    for (const r of rows) {
      const main = String(r["mainThread"]);
      const visible = String(r["visibility"]) === "public" || membersOf(ctx.db, main).includes(asker);
      const name = String(r["name"]), topic = r["topic"] === null || r["topic"] === undefined ? undefined : String(r["topic"]);
      if (!visible || !hit(name)) continue;
      items.push({ group: "Channels", kind: "channel", id: String(r["id"]), title: name, ...(topic !== undefined ? { detail: topic } : {}) });
    }
  }
  return { items: items.slice(0, SUGGEST_MAX) };
}

// ---- open a side tab --------------------------------------------------------------------------------------------------------------------------------

/**
 * An agent opens a tab beside the chat for the person it acts for. tab.opened is delivered live to that person's devices; the thread keeps a line (a tab_opened block) so the tab can be opened again.
 * No person setting or device list is named by the contract for this, so the tab always opens. A sealed thread gets the tab type as its title: the real title stays out of a row the server cannot read.
 */
export async function openTab(ctx: ChatCtx, input: { threadId: string; targetType: string; targetId: string; title?: string }) {
  const t = openThread(ctx, input.threadId);
  if (ctx.principal.kind !== "agent") raise(ctx, "validation.bad_input", "Only an agent opens a tab for a person.");
  const personId = askerOf(ctx);
  if (!personId.startsWith("usr_")) raise(ctx, "validation.bad_input", "A tab opens for a person, and this agent is not acting for one.");
  const targetType = input.targetType.trim(), targetId = input.targetId.trim();
  if (targetType === "" || targetId === "") raise(ctx, "validation.bad_input", "Say what to open: a type and an id.");
  const sealed = encOf(ctx.db, t) !== 0;
  const title = sealed ? targetType : (input.title?.trim() || targetId);
  const agentId = ctx.principal.id;
  const blocks = [{ type: "tab_opened", v: 1, id: mintId("blk", ctx.now()), data: { targetType, targetId, title, agentId }, state: "done", traceId: ctx.trace.traceId }];
  const m = insertMessage(ctx, t.id, { author: agentId, kind: "agent", body: "", blocks });
  ctx.emit("tab.opened", t.id, { threadId: t.id, personId, targetType, targetId, agentId });
  deliver(ctx, t, m, [], { kind: "agent", id: agentId }, { notify: false });
  return { opened: true };
}

export const g24cHandlers = {
  "chat.messages.list": messagesList,
  "chat.message.get": messageGet,
  "chat.edit": edit,
  "chat.delete_message": deleteMessage,
  "chat.react": react,
  "chat.pin": pin,
  "chat.unpin": unpin,
  "chat.pins.list": pinsList,
  "chat.recent": recent,
  "chat.open_tab": openTab,
  "chat.composer.suggest": composerSuggest,
};
