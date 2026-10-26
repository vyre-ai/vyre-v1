// Thread reads and housekeeping (spec 2.5, 3.2; ARCH 6.1): get, list, close, reopen, rename, agents, members, work folder, plan mode, read cursor.
//   The pipeline has already checked the capability level on the thread. Here a private chat (or Ask pane) also answers to its members, so another person gets "not found", never "not yours".
//   The read cursor lives in chat_thread_read (one row per thread and person). Channels count unread messages from it through unreadOf.
import {
  addAgent, addMember, agentsOf, askerOf, ensure, isMember, membersOf, raise, threadBy, threadOut,
} from "../projections.ts";
import type { ChatCtx, Mode, ThreadKind, ThreadRec } from "../projections.ts";
import { canSpeak, rootOf } from "./post.ts";

type Row = Record<string, unknown>;
const MAX_AGENTS = 20;
const MAX_TITLE = 200;
const DEFAULT_LIMIT = 50;
const KINDS: readonly ThreadKind[] = ["chat", "channel", "thread", "ask", "run", "helper", "console"];

// ---- the read cursor table --------------------------------------------------------------------------------------------------------------------------

const READ_TABLE = 'CREATE TABLE IF NOT EXISTS "chat_thread_read" ("thread" TEXT NOT NULL, "principal" TEXT NOT NULL, "seq" INTEGER NOT NULL DEFAULT 0, PRIMARY KEY ("thread", "principal"))';
const readReady = new WeakSet<object>();

/** Make sure chat_thread_read exists. Runs the CREATE once per database handle, on first use. */
export function ensureReadTable(ctx: Pick<ChatCtx, "db">): void {
  if (readReady.has(ctx.db)) return;
  ctx.db.run(READ_TABLE);
  readReady.add(ctx.db);
}

/** How far a person has read a thread (0 when never). */
function cursorOf(ctx: Pick<ChatCtx, "db">, threadId: string, person: string): number {
  const r = (ctx.db.all("SELECT seq FROM chat_thread_read WHERE thread = ? AND principal = ?", threadId, person) as Row[])[0];
  return r ? Number(r["seq"]) : 0;
}

/** Messages after the person's read cursor, not written by the person. Channels use this for their unread count. */
export function unreadOf(ctx: Pick<ChatCtx, "db">, threadId: string, person: string): number {
  ensureReadTable(ctx);
  const n = (ctx.db.all('SELECT COUNT(*) AS n FROM chat_message WHERE "thread" = ? AND threadSeq > ? AND author <> ? AND deleted_at IS NULL', threadId, cursorOf(ctx, threadId, person), person) as Row[])[0]?.["n"];
  return Number(n ?? 0);
}

// ---- shared -----------------------------------------------------------------------------------------------------------------------------------------

/** The thread, or "not found" when it does not exist or is a private chat of other people. */
function load(ctx: ChatCtx, threadId: string): ThreadRec {
  ensure(ctx.db);
  const t = threadBy(ctx.db, threadId);
  if (!t || !canSpeak(ctx, t)) raise(ctx, "validation.not_found", "That chat does not exist or is not yours.");
  return t;
}

const out = (ctx: ChatCtx, id: string) => ({ thread: threadOut(ctx.db, threadBy(ctx.db, id)!) });
const touch = (ctx: ChatCtx, id: string, set: string, ...args: unknown[]): void => {
  ctx.db.run(`UPDATE chat_thread SET ${set}, version = version + 1, updated_at = ? WHERE id = ?`, ...args, ctx.now(), id);
};
const isPrivateRoot = (root: ThreadRec): boolean => root.kind === "chat" || root.kind === "ask";

// ---- reads ------------------------------------------------------------------------------------------------------------------------------------------

export async function get(ctx: ChatCtx, input: { threadId: string }) {
  return out(ctx, load(ctx, input.threadId).id);
}

export async function list(ctx: ChatCtx, input: { kind?: string[]; folderId?: string; parentThreadId?: string; recordId?: string; limit?: number; cursor?: string }) {
  ensure(ctx.db);
  for (const k of input.kind ?? []) if (!KINDS.includes(k as ThreadKind)) raise(ctx, "validation.bad_input", "That is not a thread kind.", { kind: k });
  const limit = input.limit ?? DEFAULT_LIMIT;
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) raise(ctx, "validation.bad_input", "The limit is between 1 and 500.");
  const where = ["deleted_at IS NULL"];
  const args: unknown[] = [];
  if (input.kind !== undefined && input.kind.length > 0) { where.push(`kind IN (${input.kind.map(() => "?").join(", ")})`); args.push(...input.kind); }
  if (input.folderId !== undefined) { where.push("folderId = ?"); args.push(input.folderId); }
  if (input.parentThreadId !== undefined) { where.push("parentThreadId = ?"); args.push(input.parentThreadId); }
  if (input.recordId !== undefined) { where.push("recordId = ?"); args.push(input.recordId); }
  // With no filter the list is the sidebar: only listed threads. A filter reaches the unlisted ones (Ask panes, runs, inline threads).
  if (args.length === 0) where.push("listed = 1");
  const rows = ctx.db.all(`SELECT * FROM chat_thread WHERE ${where.join(" AND ")} ORDER BY createdAt DESC, id DESC LIMIT 5000`, ...args) as Row[];
  const seen: ThreadRec[] = [];
  for (const r of rows) {
    const t = threadBy(ctx.db, String(r["id"]))!;
    if (canSpeak(ctx, t)) seen.push(t);
  }
  let from = 0;
  if (input.cursor !== undefined) {
    const at = seen.findIndex((t) => t.id === input.cursor);
    if (at < 0) raise(ctx, "validation.bad_input", "That cursor is not from this list.");
    from = at + 1;
  }
  const page = seen.slice(from, from + limit);
  const more = from + limit < seen.length;
  return { threads: page.map((t) => threadOut(ctx.db, t)), total: seen.length, ...(more ? { next: page[page.length - 1]!.id } : {}) };
}

// ---- close and reopen -------------------------------------------------------------------------------------------------------------------------------

export async function close(ctx: ChatCtx, input: { threadId: string }) {
  const t = load(ctx, input.threadId);
  if (t.closedAt !== undefined) return out(ctx, t.id);
  if (t.kind === "channel") raise(ctx, "validation.bad_input", "A channel is archived, not closed.");
  if (ctx.db.all("SELECT 1 AS x FROM chat_block WHERE thread = ? AND state = 'waiting'", t.id).length > 0) {
    raise(ctx, "validation.bad_input", "Something in this thread still waits for an answer. Answer it first.");
  }
  touch(ctx, t.id, "closedAt = ?", ctx.now());
  ctx.emit("thread.closed", t.id, { threadId: t.id });
  return out(ctx, t.id);
}

export async function reopen(ctx: ChatCtx, input: { threadId: string }) {
  const t = load(ctx, input.threadId);
  if (t.closedAt === undefined) return out(ctx, t.id);
  touch(ctx, t.id, "closedAt = NULL");
  ctx.emit("thread.reopened", t.id, { threadId: t.id });
  return out(ctx, t.id);
}

// ---- title, folder, plan mode -----------------------------------------------------------------------------------------------------------------------

export async function update(ctx: ChatCtx, input: { threadId: string; title: string }) {
  const t = load(ctx, input.threadId);
  const title = input.title.trim().replace(/\s+/g, " ");
  if (title === "") raise(ctx, "validation.bad_input", "Give the thread a name.");
  if (title.length > MAX_TITLE) raise(ctx, "validation.bad_input", `A name can be at most ${MAX_TITLE} characters.`);
  if (t.kind === "channel") raise(ctx, "validation.bad_input", "A channel keeps its own name.");
  if (title === t.title) return out(ctx, t.id);
  touch(ctx, t.id, "title = ?", title);
  ctx.emit("thread.updated", t.id, { threadId: t.id, fields: ["title"] });
  return out(ctx, t.id);
}

export async function setFolder(ctx: ChatCtx, input: { threadId: string; folderId: string | null }) {
  const t = load(ctx, input.threadId);
  if (input.folderId !== null && !/^fld_[a-z0-9]+$/.test(input.folderId)) raise(ctx, "validation.bad_input", "That is not a folder.");
  if ((input.folderId ?? undefined) === t.folderId) return out(ctx, t.id);
  touch(ctx, t.id, "folderId = ?", input.folderId);
  ctx.emit("thread.updated", t.id, { threadId: t.id, fields: ["folderId"] });
  return out(ctx, t.id);
}

export async function setPlanMode(ctx: ChatCtx, input: { threadId: string; planMode: boolean }) {
  const t = load(ctx, input.threadId);
  if (typeof input.planMode !== "boolean") raise(ctx, "validation.bad_input", "Plan mode is on or off.");
  if (input.planMode === t.planMode) return out(ctx, t.id);
  touch(ctx, t.id, "modePlan = ?", input.planMode ? 1 : 0);
  ctx.emit("thread.plan_mode_changed", t.id, { threadId: t.id, planMode: input.planMode, by: askerOf(ctx) });
  return out(ctx, t.id);
}

// ---- agents -----------------------------------------------------------------------------------------------------------------------------------------

/** An agent changes the line-up only as the lead of the thread (and may always remove itself). */
function agentMayChange(ctx: ChatCtx, t: ThreadRec, removing?: string): boolean {
  if (ctx.principal.kind !== "agent") return true;
  if (removing === ctx.principal.id) return true;
  return agentsOf(ctx.db, t.id).some((a) => a.agentId === ctx.principal.id && a.mode === "lead");
}

export async function addAgentTo(ctx: ChatCtx, input: { threadId: string; agentId: string; mode?: Mode }) {
  const t = load(ctx, input.threadId);
  if (!input.agentId.startsWith("agt_")) raise(ctx, "validation.bad_input", "That is not an agent.", { agentId: input.agentId });
  if (input.mode !== undefined && input.mode !== "lead" && input.mode !== "listen") raise(ctx, "validation.bad_input", "An agent leads or listens.");
  if (!agentMayChange(ctx, t)) raise(ctx, "permission.role_lacks_permission", "Only the lead agent of a thread adds agents to it.");
  if (t.closedAt !== undefined) raise(ctx, "validation.precondition_failed", "This thread is closed. Reopen it first.");
  const now = agentsOf(ctx.db, t.id);
  const by = askerOf(ctx);
  const have = now.find((a) => a.agentId === input.agentId);
  // The only agent leads; later ones listen, and so does anyone added to a channel, unless the caller says otherwise.
  const mode: Mode = input.mode ?? (have?.mode ?? (now.length === 0 && t.kind !== "channel" ? "lead" : "listen"));
  if (have && have.mode === mode) return out(ctx, t.id);
  if (!have && now.length >= MAX_AGENTS) raise(ctx, "validation.bad_input", `A chat can have at most ${MAX_AGENTS} agents.`);
  if (mode === "lead") {
    // One lead at a time: the one before steps back to listening.
    for (const a of now) if (a.mode === "lead" && a.agentId !== input.agentId) setMode(ctx, t.id, a.agentId, "listen");
  }
  if (have) setMode(ctx, t.id, input.agentId, mode);
  else addAgent(ctx, t.id, { agentId: input.agentId, mode, addedBy: by });
  ctx.emit("agent.engaged", t.id, { threadId: t.id, agentId: input.agentId, mode, by });
  return out(ctx, t.id);
}

function setMode(ctx: ChatCtx, thread: string, agentId: string, mode: Mode): void {
  ctx.db.run("UPDATE chat_thread_agent SET mode = ?, version = version + 1, updated_at = ? WHERE thread = ? AND agentId = ? AND deleted_at IS NULL", mode, ctx.now(), thread, agentId);
}

export async function removeAgent(ctx: ChatCtx, input: { threadId: string; agentId: string }) {
  const t = load(ctx, input.threadId);
  if (!input.agentId.startsWith("agt_")) raise(ctx, "validation.bad_input", "That is not an agent.", { agentId: input.agentId });
  if (!agentMayChange(ctx, t, input.agentId)) raise(ctx, "permission.role_lacks_permission", "Only the lead agent of a thread removes agents from it.");
  if (!agentsOf(ctx.db, t.id).some((a) => a.agentId === input.agentId)) raise(ctx, "validation.not_found", "That agent is not in this thread.");
  ctx.db.run("UPDATE chat_thread_agent SET deleted_at = ?, version = version + 1, updated_at = ? WHERE thread = ? AND agentId = ? AND deleted_at IS NULL", ctx.now(), ctx.now(), t.id, input.agentId);
  ctx.emit("agent.disengaged", t.id, { threadId: t.id, agentId: input.agentId, by: askerOf(ctx) });
  return out(ctx, t.id);
}

// ---- members ----------------------------------------------------------------------------------------------------------------------------------------

export async function membersAdd(ctx: ChatCtx, input: { threadId: string; personId: string }) {
  const t = load(ctx, input.threadId);
  if (!input.personId.startsWith("usr_")) raise(ctx, "validation.bad_input", "That is not a person.", { personId: input.personId });
  if (isPrivateRoot(rootOf(ctx, t))) {
    raise(ctx, "validation.precondition_failed", "A private chat never gains people. Make it a channel to bring someone in.", { offer: "threads.make_channel", threadId: t.id });
  }
  if (isMember(ctx.db, t.id, input.personId)) return out(ctx, t.id);
  addMember(ctx, t.id, input.personId);
  ctx.emit("channel.member_added", input.personId, { personId: input.personId, by: askerOf(ctx), threadId: t.id, ...(t.channelId !== undefined ? { channelId: t.channelId } : {}) });
  return out(ctx, t.id);
}

export async function membersRemove(ctx: ChatCtx, input: { threadId: string; personId: string }) {
  const t = load(ctx, input.threadId);
  if (!input.personId.startsWith("usr_")) raise(ctx, "validation.bad_input", "That is not a person.", { personId: input.personId });
  if (!isMember(ctx.db, t.id, input.personId)) raise(ctx, "validation.not_found", "That person is not in this thread.");
  const asker = askerOf(ctx);
  if (input.personId !== asker) {
    const mine = (ctx.db.all("SELECT role FROM chat_thread_member WHERE thread = ? AND principal = ? AND deleted_at IS NULL", t.id, asker) as Row[])[0];
    if (String(mine?.["role"]) !== "owner") raise(ctx, "permission.no_grant", "Only the owner removes other people.");
  }
  if (membersOf(ctx.db, t.id).filter((p) => p.startsWith("usr_")).length <= 1) raise(ctx, "validation.bad_input", "A thread keeps at least one person.");
  ctx.db.run("UPDATE chat_thread_member SET deleted_at = ?, version = version + 1, updated_at = ? WHERE thread = ? AND principal = ? AND deleted_at IS NULL", ctx.now(), ctx.now(), t.id, input.personId);
  ctx.emit("channel.member_removed", input.personId, { personId: input.personId, by: asker, threadId: t.id, ...(t.channelId !== undefined ? { channelId: t.channelId } : {}) });
  return out(ctx, t.id);
}

// ---- read cursor ------------------------------------------------------------------------------------------------------------------------------------

export async function markRead(ctx: ChatCtx, input: { threadId: string; upto?: number }) {
  const t = load(ctx, input.threadId);
  if (input.upto !== undefined && (!Number.isInteger(input.upto) || input.upto < 0)) raise(ctx, "validation.bad_input", "A sequence number is a whole number from 0.");
  ensureReadTable(ctx);
  const person = askerOf(ctx);
  const top = Number((ctx.db.all('SELECT MAX(threadSeq) AS top FROM chat_message WHERE "thread" = ? AND deleted_at IS NULL', t.id) as Row[])[0]?.["top"] ?? 0);
  // The cursor only moves forward, and never past the newest message.
  const seq = Math.max(cursorOf(ctx, t.id, person), Math.min(input.upto ?? top, top));
  if (ctx.db.run("UPDATE chat_thread_read SET seq = ? WHERE thread = ? AND principal = ?", seq, t.id, person).changes === 0) {
    ctx.db.run("INSERT INTO chat_thread_read (thread, principal, seq) VALUES (?, ?, ?)", t.id, person, seq);
  }
  return { unread: unreadOf(ctx, t.id, person) };
}

export const g24aHandlers = {
  "threads.get": get,
  "threads.list": list,
  "threads.close": close,
  "threads.reopen": reopen,
  "threads.update": update,
  "threads.add_agent": addAgentTo,
  "threads.remove_agent": removeAgent,
  "threads.members.add": membersAdd,
  "threads.members.remove": membersRemove,
  "threads.set_folder": setFolder,
  "threads.set_plan_mode": setPlanMode,
  "threads.mark_read": markRead,
};
