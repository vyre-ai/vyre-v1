// The small per-person tables behind archive and delete, and the three helpers other handlers need (the mention that brings a chat back, the retention purge). Kept apart from archive.ts so post.ts and
// purge.ts can use them without importing the handlers.
import type { ChatCtx } from "../projections.ts";

type Row = Record<string, unknown>;

// ---- the per-person archive table (one row per chat and person) ------------------------------------------------------------------------------------

const ARCHIVE_TABLE = 'CREATE TABLE IF NOT EXISTS "chat_thread_archive" ("thread" TEXT NOT NULL, "principal" TEXT NOT NULL, "at" INTEGER NOT NULL, PRIMARY KEY ("thread", "principal"))';
const DELETED_TABLE = 'CREATE TABLE IF NOT EXISTS "chat_thread_deleted" ("thread" TEXT NOT NULL PRIMARY KEY, "principal" TEXT NOT NULL, "at" INTEGER NOT NULL)';
const ready = new WeakSet<object>();

/** Make sure the two small tables exist. Runs the CREATEs once per database handle, on first use (the read cursor table does the same). */
export function ensureArchiveTables(ctx: Pick<ChatCtx, "db">): void {
  if (ready.has(ctx.db)) return;
  ctx.db.run(ARCHIVE_TABLE);
  ctx.db.run(DELETED_TABLE);
  ready.add(ctx.db);
}

/** The chats a person has archived. */
export function archivedIds(ctx: Pick<ChatCtx, "db">, person: string): Set<string> {
  ensureArchiveTables(ctx);
  return new Set((ctx.db.all('SELECT "thread" FROM chat_thread_archive WHERE "principal" = ?', person) as Row[]).map((r) => String(r["thread"])));
}

/** An @mention of a person puts the chat back in their list; any other new message leaves it archived. Called with the mention that was just delivered. */
export function unarchiveForMention(ctx: ChatCtx, threadId: string, person: string): void {
  ensureArchiveTables(ctx);
  if (ctx.db.run('DELETE FROM chat_thread_archive WHERE "thread" = ? AND "principal" = ?', threadId, person).changes > 0) {
    ctx.emit("thread.unarchived", threadId, { person, threadId, reason: "mention" });
  }
}

/** Soft-deleted chats older than the cutoff, newest last: the retention purge removes them for good (purge.ts). */
export function deletedBefore(ctx: Pick<ChatCtx, "db">, before: number, skip: ReadonlySet<string>, limit: number): string[] {
  ensureArchiveTables(ctx);
  return (ctx.db.all('SELECT "thread" FROM chat_thread_deleted WHERE "at" < ? ORDER BY "at" ASC LIMIT ?', before, limit + skip.size) as Row[]).map((r) => String(r["thread"])).filter((id) => !skip.has(id)).slice(0, limit);
}
/** A chat is gone for good: its delete record goes with it. */
export function forgetDeleted(ctx: Pick<ChatCtx, "db">, thread: string): void {
  ensureArchiveTables(ctx);
  ctx.db.run('DELETE FROM chat_thread_deleted WHERE "thread" = ?', thread);
  ctx.db.run('DELETE FROM chat_thread_archive WHERE "thread" = ?', thread);
}

