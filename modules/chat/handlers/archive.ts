// Archive, delete and leave for a person's own chat list (rc.8). Three different things, kept apart:
//   archive   a per-person mark: the chat leaves MY list and shows in my Archived section; everyone else in a group chat still sees it. A new message from someone else does not bring it back
//             (quiet, like Slack); an @mention of me does (deliver() in post.ts calls unarchiveForMention).
//   delete    a chat only I am in (me and agents): a soft delete, hidden everywhere, kept in the audit trail and undone with threads.restore for as long as it has not been purged. Running turns stop
//             first. The existing retention purge (chat.transcript.purge) removes a deleted chat for good once it is older than the cutoff; there is no second purge path.
//   leave     a chat with other people: I stop being a member; they keep it.
// A channel is none of these: channels keep channels.archive and channels.leave. The pipeline checked the capability level; a private chat also answers to its members (load).
import { askerOf, ensure, isMember, membersOf, raise } from "../projections.ts";
import type { ChatCtx, ThreadRec } from "../projections.ts";
import { ensureArchiveTables } from "./archive-state.ts";
import { load, out } from "./g24a.ts";
import { rootOf } from "./post.ts";

type Row = Record<string, unknown>;

const isArchived = (ctx: Pick<ChatCtx, "db">, thread: string, person: string): boolean =>
  ctx.db.all('SELECT 1 AS x FROM chat_thread_archive WHERE "thread" = ? AND "principal" = ?', thread, person).length > 0;

/** Archive and delete are for a person's own chats and asks, never a channel or an inline thread (a channel is archived with channels.archive). */
function ownChat(ctx: ChatCtx, t: ThreadRec): ThreadRec {
  const root = rootOf(ctx, t);
  if (root.id !== t.id || (t.kind !== "chat" && t.kind !== "ask")) {
    raise(ctx, "validation.bad_input", t.kind === "channel" ? "A channel is archived with channels.archive." : "Only a chat can be archived or deleted.", { threadId: t.id, kind: t.kind });
  }
  return t;
}

// ---- archive ----------------------------------------------------------------------------------------------------------------------------------------

export async function archive(ctx: ChatCtx, input: { threadId: string }) {
  ensure(ctx.db);
  const t = ownChat(ctx, load(ctx, input.threadId));
  ensureArchiveTables(ctx);
  const person = askerOf(ctx);
  if (!isArchived(ctx, t.id, person)) {
    ctx.db.run('INSERT INTO chat_thread_archive ("thread", "principal", "at") VALUES (?, ?, ?)', t.id, person, ctx.now());
    ctx.emit("thread.archived", t.id, { person, threadId: t.id });
  }
  return { archived: true };
}

export async function unarchive(ctx: ChatCtx, input: { threadId: string }) {
  ensure(ctx.db);
  const t = ownChat(ctx, load(ctx, input.threadId));
  ensureArchiveTables(ctx);
  const person = askerOf(ctx);
  if (ctx.db.run('DELETE FROM chat_thread_archive WHERE "thread" = ? AND "principal" = ?', t.id, person).changes > 0) {
    ctx.emit("thread.unarchived", t.id, { person, threadId: t.id, reason: "person" });
  }
  return { archived: false };
}

// ---- delete (soft) and restore ----------------------------------------------------------------------------------------------------------------------

/** The thread and the inline threads under it, as ids. */
function family(ctx: ChatCtx, root: string): string[] {
  const ids = [root];
  for (let i = 0; i < ids.length && ids.length < 500; i++) for (const c of ctx.db.all('SELECT "id" FROM chat_thread WHERE "parentThreadId" = ?', ids[i]) as Row[]) ids.push(String(c["id"]));
  return ids;
}

/** The people in a chat, agents left out. */
const peopleOf = (ctx: Pick<ChatCtx, "db">, thread: string): string[] => membersOf(ctx.db, thread).filter((p) => p.startsWith("usr_"));

export async function deleteChat(ctx: ChatCtx, input: { threadId: string }) {
  ensure(ctx.db);
  if (ctx.principal.kind !== "person") raise(ctx, "permission.no_grant", "Only a person deletes a chat.");
  const t = ownChat(ctx, load(ctx, input.threadId));
  const person = askerOf(ctx);
  const others = peopleOf(ctx, t.id).filter((p) => p !== person);
  if (others.length > 0) raise(ctx, "validation.precondition_failed", "Other people are in this chat. Leave it instead.", { offer: "threads.leave", threadId: t.id });
  // what is running stops first, so no turn writes into a chat that is gone; a stop that cannot be made is said, never swallowed
  try { await ctx.call?.("engine.stop_all", { threadId: t.id }); } catch (e) {
    ctx.log.warn("chat delete: the running turns of this chat could not be stopped first", { threadId: t.id, error: e instanceof Error ? e.message.slice(0, 200) : "error" });
  }
  ensureArchiveTables(ctx);
  const now = ctx.now();
  for (const id of family(ctx, t.id)) {
    ctx.db.run('UPDATE chat_message SET "deleted_at" = ?, "updated_at" = ? WHERE "thread" = ? AND "deleted_at" IS NULL', now, now, id);
    ctx.db.run('UPDATE chat_thread SET "deleted_at" = ?, "updated_at" = ?, "version" = "version" + 1 WHERE "id" = ? AND "deleted_at" IS NULL', now, now, id);
  }
  ctx.db.run('INSERT OR REPLACE INTO chat_thread_deleted ("thread", "principal", "at") VALUES (?, ?, ?)', t.id, person, now);
  ctx.db.run('DELETE FROM chat_thread_archive WHERE "thread" = ?', t.id);
  ctx.emit("thread.deleted", t.id, { person, threadId: t.id });
  return { deleted: true };
}

/** Undo a delete: the same person, while the chat has not been purged. Only what the delete hid (the rows stamped with its time) comes back. */
export async function restoreChat(ctx: ChatCtx, input: { threadId: string }) {
  ensure(ctx.db);
  if (ctx.principal.kind !== "person") raise(ctx, "permission.no_grant", "Only a person restores a chat.");
  ensureArchiveTables(ctx);
  const person = askerOf(ctx);
  const gone = (ctx.db.all('SELECT "principal", "at" FROM chat_thread_deleted WHERE "thread" = ?', input.threadId) as Row[])[0];
  if (!gone || String(gone["principal"]) !== person) raise(ctx, "validation.not_found", "That chat is not there to restore.");
  const at = Number(gone["at"]);
  const now = ctx.now();
  for (const id of family(ctx, input.threadId)) {
    ctx.db.run('UPDATE chat_message SET "deleted_at" = NULL, "updated_at" = ? WHERE "thread" = ? AND "deleted_at" = ?', now, id, at);
    ctx.db.run('UPDATE chat_thread SET "deleted_at" = NULL, "updated_at" = ?, "version" = "version" + 1 WHERE "id" = ? AND "deleted_at" = ?', now, id, at);
  }
  ctx.db.run('DELETE FROM chat_thread_deleted WHERE "thread" = ?', input.threadId);
  ctx.emit("thread.restored", input.threadId, { person, threadId: input.threadId });
  return out(ctx, input.threadId);
}

// ---- leave ------------------------------------------------------------------------------------------------------------------------------------------

export async function leaveChat(ctx: ChatCtx, input: { threadId: string }) {
  ensure(ctx.db);
  if (ctx.principal.kind !== "person") raise(ctx, "permission.no_grant", "Only a person leaves a chat.");
  const t = ownChat(ctx, load(ctx, input.threadId));
  const person = askerOf(ctx);
  if (!isMember(ctx.db, t.id, person)) raise(ctx, "validation.not_found", "You are not in this chat.");
  if (peopleOf(ctx, t.id).filter((p) => p !== person).length === 0) raise(ctx, "validation.bad_input", "You are the only person in this chat. Delete it instead.", { offer: "threads.delete", threadId: t.id });
  ensureArchiveTables(ctx);
  ctx.db.run('UPDATE chat_thread_member SET "deleted_at" = ?, "version" = "version" + 1, "updated_at" = ? WHERE "thread" = ? AND "principal" = ? AND "deleted_at" IS NULL', ctx.now(), ctx.now(), t.id, person);
  ctx.db.run('DELETE FROM chat_thread_archive WHERE "thread" = ? AND "principal" = ?', t.id, person);
  ctx.emit("channel.member_removed", person, { personId: person, by: person, threadId: t.id });
  return { ok: true };
}

export const archiveHandlers = {
  "threads.archive": archive,
  "threads.unarchive": unarchive,
  "threads.delete": deleteChat,
  "threads.restore": restoreChat,
  "threads.leave": leaveChat,
};

