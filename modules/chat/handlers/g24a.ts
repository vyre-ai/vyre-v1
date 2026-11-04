// Thread reads and housekeeping (spec 2.5, 3.2; ARCH 6.1): get, list, close, reopen, rename, agents, members, work folder, plan mode, read cursor.
//   The pipeline has already checked the capability level on the thread. Here a private chat (or Ask pane) also answers to its members, so another person gets "not found", never "not yours".
//   The read cursor lives in chat_thread_read (one row per thread and person). Channels count unread messages from it through unreadOf.
import {
  addAgent, addMember, agentsOf, askerOf, encOf, ensure, isMember, membersOf, raise, refOf, threadBy, threadOut,
} from "../projections.ts";
import type { ChatCtx, Mode, ThreadKind, ThreadRec } from "../projections.ts";
import { canSpeak, mayGovernChannel, rootOf } from "./post.ts";
import { applyMode } from "./modes.ts";
import { followMode, placeOf } from "./follow.ts";
import { grantsOf, revokeGrants, shareOwnedWith, unshareOwnedFrom, trashOwned } from "./owned.ts";

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
export function load(ctx: ChatCtx, threadId: string, o: { govern?: boolean } = {}): ThreadRec {
  ensure(ctx.db);
  const t = threadBy(ctx.db, threadId);
  // governance of an invite-only channel (adding or removing people) reaches the channel's main thread only, and nothing in it to read
  const governing = o.govern === true && t !== null && t.kind === "channel" && t.channelId !== undefined && mayGovernChannel(ctx, t.channelId);
  if (!t || (!canSpeak(ctx, t) && !governing)) raise(ctx, "validation.not_found", "That chat does not exist or is not yours.");
  return t;
}

export const out = (ctx: ChatCtx, id: string) => ({ thread: threadOut(ctx.db, threadBy(ctx.db, id)!) });
export const touch = (ctx: ChatCtx, id: string, set: string, ...args: unknown[]): void => {
  ctx.db.run(`UPDATE chat_thread SET ${set}, version = version + 1, updated_at = ? WHERE id = ?`, ...args, ctx.now(), id);
};
const isPrivateRoot = (root: ThreadRec): boolean => root.kind === "chat" || root.kind === "ask";

// ---- reads ------------------------------------------------------------------------------------------------------------------------------------------

export async function get(ctx: ChatCtx, input: { threadId: string }) {
  return out(ctx, load(ctx, input.threadId).id);
}

export interface ListInput {
  kind?: string[]; folderId?: string; parentThreadId?: string; recordId?: string; limit?: number; cursor?: string;
  /** only the threads the asker is in */
  mine?: boolean;
  /** newest first by when the thread started (the default), or by its latest message */
  order?: "created" | "latest";
  /** leave out threads tied to these kinds of object (scopeType) */
  exceptScope?: string[];
}

export async function list(ctx: ChatCtx, input: ListInput) {
  ensure(ctx.db);
  for (const k of input.kind ?? []) if (!KINDS.includes(k as ThreadKind)) raise(ctx, "validation.bad_input", "That is not a kind of chat.", { kind: k });
  const limit = input.limit ?? DEFAULT_LIMIT;
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) raise(ctx, "validation.bad_input", "The limit is between 1 and 500.");
  if (input.order !== undefined && input.order !== "created" && input.order !== "latest") raise(ctx, "validation.bad_input", "Order by created or latest.");
  const asker = askerOf(ctx);
  const where = ["t.deleted_at IS NULL"];
  const args: unknown[] = [];
  if (input.kind !== undefined && input.kind.length > 0) { where.push(`t.kind IN (${input.kind.map(() => "?").join(", ")})`); args.push(...input.kind); }
  if (input.folderId !== undefined) { where.push("t.folderId = ?"); args.push(input.folderId); }
  if (input.parentThreadId !== undefined) { where.push("t.parentThreadId = ?"); args.push(input.parentThreadId); }
  if (input.recordId !== undefined) { where.push("t.recordId = ?"); args.push(input.recordId); }
  if (input.mine === true) { where.push("t.id IN (SELECT thread FROM chat_thread_member WHERE principal = ? AND deleted_at IS NULL)"); args.push(asker); }
  const except = (input.exceptScope ?? []).filter((x) => x !== "");
  if (except.length > 0) { where.push(`(t.scopeType IS NULL OR t.scopeType NOT IN (${except.map(() => "?").join(", ")}))`); args.push(...except); }
  // With no filter the list is the sidebar: only listed threads. A filter reaches the unlisted ones (Ask panes, runs, inline threads).
  if (args.length === 0) where.push("t.listed = 1");
  // the latest message decides the order of the Threads page: a thread with a new reply comes to the top
  const order = input.order === "latest"
    ? 'COALESCE((SELECT MAX(m."createdAt") FROM chat_message m WHERE m."thread" = t.id AND m.deleted_at IS NULL), t.createdAt) DESC, t.id DESC'
    : "t.createdAt DESC, t.id DESC";
  const rows = ctx.db.all(`SELECT t.id AS id FROM chat_thread t WHERE ${where.join(" AND ")} ORDER BY ${order} LIMIT 5000`, ...args) as Row[];
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
  return { threads: page.map((t) => listRow(ctx, t, asker)), total: seen.length, ...(more ? { next: page[page.length - 1]!.id } : {}) };
}

/** One row of threads.list: the thread, and for an inline thread what the asker sees of it (what is new, who wrote, where it hangs, the newest line). */
function listRow(ctx: ChatCtx, t: ThreadRec, asker: string): Record<string, unknown> {
  const row = threadOut(ctx.db, t);
  if (t.kind !== "thread") return row;
  const inIt = isMember(ctx.db, t.id, asker);
  const mode = followMode(ctx, t.id, asker);
  row["unread"] = mode === "mute" ? 0 : unreadOf(ctx, t.id, asker);
  row["following"] = inIt && mode !== "mute";
  if (inIt && mode === "mute") row["muted"] = true;
  const authors = ctx.db.all('SELECT author FROM chat_message WHERE "thread" = ? AND deleted_at IS NULL GROUP BY author ORDER BY MAX(threadSeq) DESC LIMIT 3', t.id) as Row[];
  row["repliers"] = authors.map((r) => refOf(String(r["author"])));
  if (t.parentThreadId !== undefined) row["parentTitle"] = placeOf(ctx, t);
  // the newest line, where the server may read it: never a private chat's
  if (encOf(ctx.db, t) === 0) {
    const last = (ctx.db.all('SELECT body FROM chat_message WHERE "thread" = ? AND deleted_at IS NULL ORDER BY threadSeq DESC LIMIT 1', t.id) as Row[])[0];
    const line = last ? String(last["body"] ?? "").split("\n").map((x) => x.trim()).find((x) => x !== "") : undefined;
    if (line) row["preview"] = line.length > 140 ? `${line.slice(0, 139)}…` : line;
  }
  return row;
}

// ---- close and reopen -------------------------------------------------------------------------------------------------------------------------------

export async function close(ctx: ChatCtx, input: { threadId: string }) {
  const t = load(ctx, input.threadId);
  if (t.closedAt !== undefined) return out(ctx, t.id);
  if (t.kind === "channel") raise(ctx, "validation.bad_input", "A channel is archived, not closed.");
  if (ctx.db.all("SELECT 1 AS x FROM chat_block WHERE thread = ? AND state = 'waiting'", t.id).length > 0) {
    raise(ctx, "validation.bad_input", "Something in this chat still waits for an answer. Answer it first.");
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
  if (title === "") raise(ctx, "validation.bad_input", "Give the chat a name.");
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

/** The older on or off switch. On is Plan. Off leaves Plan for Ask first; a chat that is on Auto is not in plan mode, so off leaves it alone. */
export async function setPlanMode(ctx: ChatCtx, input: { threadId: string; planMode: boolean }) {
  const t = load(ctx, input.threadId);
  if (typeof input.planMode !== "boolean") raise(ctx, "validation.bad_input", "Plan mode is on or off.");
  if (input.planMode) applyMode(ctx, t, "plan");
  else if (t.mode === "plan") applyMode(ctx, t, "ask");
  return out(ctx, t.id);
}

// ---- agents -----------------------------------------------------------------------------------------------------------------------------------------

/** An agent changes the line-up only as the lead of the thread (and may always remove itself). */
export function agentMayChange(ctx: ChatCtx, t: ThreadRec, removing?: string): boolean {
  if (ctx.principal.kind !== "agent") return true;
  if (removing === ctx.principal.id) return true;
  return agentsOf(ctx.db, t.id).some((a) => a.agentId === ctx.principal.id && a.mode === "lead");
}

export async function addAgentTo(ctx: ChatCtx, input: { threadId: string; agentId: string; mode?: Mode }) {
  const t = load(ctx, input.threadId);
  if (!input.agentId.startsWith("agt_")) raise(ctx, "validation.bad_input", "That is not an agent.", { agentId: input.agentId });
  if (input.mode !== undefined && input.mode !== "lead" && input.mode !== "listen") raise(ctx, "validation.bad_input", "An agent leads or listens.");
  if (!agentMayChange(ctx, t)) raise(ctx, "permission.role_lacks_permission", "Only the lead agent of a chat adds agents to it.");
  if (t.closedAt !== undefined) raise(ctx, "validation.precondition_failed", "This chat is closed. Reopen it first.");
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
  if (!agentMayChange(ctx, t, input.agentId)) raise(ctx, "permission.role_lacks_permission", "Only the lead agent of a chat removes agents from it.");
  const have = agentsOf(ctx.db, t.id).find((a) => a.agentId === input.agentId);
  if (!have) raise(ctx, "validation.not_found", "That agent is not in this chat.");
  // an outside agent loses what bringing it in gave it first, at once: if that cannot be done the agent stays, so no access is left behind
  await revokeGrants(ctx, t.id, input.agentId, grantsOf(ctx, t.id, input.agentId));
  ctx.db.run("UPDATE chat_thread_agent SET deleted_at = ?, version = version + 1, updated_at = ? WHERE thread = ? AND agentId = ? AND deleted_at IS NULL", ctx.now(), ctx.now(), t.id, input.agentId);
  ctx.emit("agent.disengaged", t.id, { threadId: t.id, agentId: input.agentId, by: askerOf(ctx) });
  // an agent the chat made for itself goes with its place in it
  if (have.owned === true) await trashOwned(ctx, [input.agentId]);
  return out(ctx, t.id);
}

// ---- members ----------------------------------------------------------------------------------------------------------------------------------------

export async function membersAdd(ctx: ChatCtx, input: { threadId: string; personId: string; fromStart?: boolean }) {
  const t = load(ctx, input.threadId, { govern: true });
  if (!input.personId.startsWith("usr_")) raise(ctx, "validation.bad_input", "That is not a person.", { personId: input.personId });
  const root = rootOf(ctx, t);
  // Owner ruling (4 Nov 2026): a private chat gains people, and becomes a group chat. The newcomer reads from now on unless the adder says "Include earlier messages"; a goal chat shows its history.
  // A channel's own people keep reading everything it holds.
  const fromStart = input.fromStart ?? (!isPrivateRoot(root) || root.scopeType === "goal");
  const known = isMember(ctx.db, t.id, input.personId);
  if (known) {
    // asked again with earlier messages on, the person's reading widens to the start
    if (input.fromStart === true) ctx.db.run("UPDATE chat_thread_member SET fromAt = NULL, version = version + 1, updated_at = ? WHERE thread = ? AND principal = ? AND deleted_at IS NULL", ctx.now(), t.id, input.personId);
    return out(ctx, t.id);
  }
  addMember(ctx, t.id, input.personId);
  if (!fromStart) ctx.db.run("UPDATE chat_thread_member SET fromAt = ? WHERE thread = ? AND principal = ? AND deleted_at IS NULL", ctx.now(), t.id, input.personId);
  // the agents this chat made for itself are visible to everyone who reads the chat
  await shareOwnedWith(ctx, t.id, input.personId);
  ctx.emit("channel.member_added", input.personId, { personId: input.personId, by: askerOf(ctx), threadId: t.id, ...(t.channelId !== undefined ? { channelId: t.channelId } : {}) });
  return out(ctx, t.id);
}

export async function membersRemove(ctx: ChatCtx, input: { threadId: string; personId: string }) {
  const t = load(ctx, input.threadId, { govern: true });
  if (!input.personId.startsWith("usr_")) raise(ctx, "validation.bad_input", "That is not a person.", { personId: input.personId });
  if (!isMember(ctx.db, t.id, input.personId)) raise(ctx, "validation.not_found", "That person is not in this chat.");
  const asker = askerOf(ctx);
  if (input.personId !== asker) {
    const mine = (ctx.db.all("SELECT role FROM chat_thread_member WHERE thread = ? AND principal = ? AND deleted_at IS NULL", t.id, asker) as Row[])[0];
    const governs = t.kind === "channel" && t.channelId !== undefined && mayGovernChannel(ctx, t.channelId);
    if (String(mine?.["role"]) !== "owner" && !governs) raise(ctx, "permission.no_grant", "Only the owner removes other people.");
  }
  if (membersOf(ctx.db, t.id).filter((p) => p.startsWith("usr_")).length <= 1) raise(ctx, "validation.bad_input", "A chat keeps at least one person.");
  ctx.db.run("UPDATE chat_thread_member SET deleted_at = ?, version = version + 1, updated_at = ? WHERE thread = ? AND principal = ? AND deleted_at IS NULL", ctx.now(), ctx.now(), t.id, input.personId);
  await unshareOwnedFrom(ctx, t.id, input.personId);
  ctx.emit("channel.member_removed", input.personId, { personId: input.personId, by: asker, threadId: t.id, ...(t.channelId !== undefined ? { channelId: t.channelId } : {}) });
  return out(ctx, t.id);
}

// ---- read cursor ------------------------------------------------------------------------------------------------------------------------------------

export async function markRead(ctx: ChatCtx, input: { threadId: string; upto?: number; unread?: boolean }) {
  const t = load(ctx, input.threadId);
  if (input.upto !== undefined && (!Number.isInteger(input.upto) || input.upto < 0)) raise(ctx, "validation.bad_input", "A sequence number is a whole number from 0.");
  if (input.upto !== undefined && input.unread === true) raise(ctx, "validation.bad_input", "Mark as Unread takes no sequence number.");
  ensureReadTable(ctx);
  const person = askerOf(ctx);
  const top = Number((ctx.db.all('SELECT MAX(threadSeq) AS top FROM chat_message WHERE "thread" = ? AND deleted_at IS NULL', t.id) as Row[])[0]?.["top"] ?? 0);
  const was = cursorOf(ctx, t.id, person);
  let seq: number;
  if (input.unread === true) {
    // Mark as Unread: the newest message someone else wrote counts as new again. A chat with nothing from anyone else has nothing to be new, so the cursor stays.
    const theirs = Number((ctx.db.all('SELECT MAX(threadSeq) AS s FROM chat_message WHERE "thread" = ? AND author <> ? AND deleted_at IS NULL', t.id, person) as Row[])[0]?.["s"] ?? 0);
    seq = theirs > 0 ? Math.min(was, theirs - 1) : was;
  } else {
    // The cursor only moves forward, and never past the newest message.
    seq = Math.max(was, Math.min(input.upto ?? top, top));
  }
  if (ctx.db.run("UPDATE chat_thread_read SET seq = ? WHERE thread = ? AND principal = ?", seq, t.id, person).changes === 0) {
    ctx.db.run("INSERT INTO chat_thread_read (thread, principal, seq) VALUES (?, ?, ?)", t.id, person, seq);
  }
  return { unread: unreadOf(ctx, t.id, person) };
}

/** Mark unread from one message on: the person's read point goes to just before it. The point only moves back (a point already before it stays), never past the newest message. */
export async function markUnreadFrom(ctx: ChatCtx, input: { threadId: string; seq: number }) {
  const t = load(ctx, input.threadId);
  if (!Number.isInteger(input.seq) || input.seq < 1) raise(ctx, "validation.bad_input", "A sequence number is a whole number from 1.");
  ensureReadTable(ctx);
  const person = askerOf(ctx);
  const was = cursorOf(ctx, t.id, person);
  const seq = Math.min(was, input.seq - 1);
  if (ctx.db.run("UPDATE chat_thread_read SET seq = ? WHERE thread = ? AND principal = ?", seq, t.id, person).changes === 0) {
    ctx.db.run("INSERT INTO chat_thread_read (thread, principal, seq) VALUES (?, ?, ?)", t.id, person, seq);
  }
  return { unread: unreadOf(ctx, t.id, person) };
}

/** Move a chat into a project. A plain chat only (a channel, a thread under a chat and the like keep the place they have); the person needs Manage on the chat (the pipeline checked it) and edit on the project. */
export async function move(ctx: ChatCtx, input: { threadId: string; projectId: string }) {
  const t = load(ctx, input.threadId);
  if (t.kind !== "chat" && t.kind !== "ask") raise(ctx, "validation.precondition_failed", "Only a chat moves into a project.");
  if (!ctx.call) raise(ctx, "internal.unavailable", "Projects are not available just now.");
  let project: { project?: { recordId?: string } } | null | undefined;
  try { project = (await ctx.call("projects.get", { projectId: input.projectId })) as { project?: { recordId?: string } }; } catch { project = null; }
  const recordId = project?.project?.recordId;
  if (!recordId) raise(ctx, "validation.not_found", "That project does not exist or you cannot see it.");
  const host = ctx as ChatCtx & { authorize?: (action: { perm: string | null; level: string }, resource: { type: string; id: string | null }) => { effect?: string } };
  const resource = { type: "project", id: input.projectId };
  const effect = typeof host.authorize === "function"
    ? host.authorize({ perm: null, level: "edit" }, resource).effect
    : ((await ctx.call("access.check", { principal: { kind: "person", id: askerOf(ctx) }, action: { level: "edit" }, resource })) as { decision?: { effect?: string } } | null | undefined)?.decision?.effect;
  if (effect !== "allow") raise(ctx, "permission.role_lacks_permission", "You cannot add things to that project.");
  if (t.recordId === recordId) return out(ctx, t.id);
  touch(ctx, t.id, "recordId = ?", recordId);
  ctx.emit("thread.updated", t.id, { threadId: t.id, fields: ["recordId"] });
  return out(ctx, t.id);
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
  "threads.mark_unread_from": markUnreadFrom,
  "threads.move": move,
};
