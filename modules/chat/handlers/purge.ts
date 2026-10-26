// Erase a chat thread or a channel for good, and remove old messages past retention (governance; P-CC_39). A thread goes whole: its messages and blocks (the words), plans, agents, members, sequence counter
// and the field clocks of each, and the inline threads under it. A channel goes with its main thread and every thread that names it. A private chat's per-turn audit rows go too when that table exists.
// DECISION: attachments in a message are Files files the people own; they are not deleted here (governance finds files on its own). The search index follows the events.
// DECISION: the age purge deletes canonical transcript rows and messages (with their blocks) older than the cutoff, in threads not listed in skipThreadIds (governance passes held threads), oldest first. The thread row and its title stay.
import { ensure } from "../projections.ts";
import type { ChatCtx } from "../projections.ts";

type Row = Record<string, unknown>;
const DEFAULT_LIMIT = 500;

/** A statement on a table a later packet adds (the private chat audit): a missing table is not an error. */
function ifTable<T>(run: () => T, otherwise: T): T {
  try { return run(); } catch (e) { if (!/no such table/i.test(e instanceof Error ? e.message : String(e))) throw e; return otherwise; }
}

/** The thread, and the inline threads under it, deepest first. */
function family(ctx: ChatCtx, root: string): string[] {
  const out: string[] = [];
  const walk = (id: string): void => {
    for (const c of ctx.db.all(`SELECT id FROM chat_thread WHERE "parentThreadId" = ?`, id) as Row[]) walk(String(c["id"]));
    out.push(id);
  };
  walk(root);
  return out;
}

function dropThread(ctx: ChatCtx, id: string): void {
  for (const m of ctx.db.all(`SELECT id FROM chat_message WHERE thread = ?`, id) as Row[]) ctx.db.run(`DELETE FROM chat_message__fm WHERE id = ?`, String(m["id"]));
  ctx.db.run(`DELETE FROM chat_message WHERE thread = ?`, id);
  ctx.db.run(`DELETE FROM chat_block WHERE thread = ?`, id);
  ctx.db.run(`DELETE FROM chat_plan WHERE thread = ?`, id);
  for (const t of ["chat_thread_agent", "chat_thread_member"] as const) {
    for (const r of ctx.db.all(`SELECT id FROM ${t} WHERE thread = ?`, id) as Row[]) ctx.db.run(`DELETE FROM ${t}__fm WHERE id = ?`, String(r["id"]));
    ctx.db.run(`DELETE FROM ${t} WHERE thread = ?`, id);
  }
  ctx.db.run(`DELETE FROM chat_thread_seq WHERE thread = ?`, id);
  // tables other packets create when first used: the canonical transcript and its summary (the words of the turns), read markers, and the private chat key record and its per-turn audit rows
  for (const t of ["chat_transcript_row", "chat_transcript_summary", "chat_thread_read", "chat_private_turn", "chat_private"]) ifTable(() => ctx.db.run(`DELETE FROM ${t} WHERE thread = ?`, id), { changes: 0 });
  ctx.db.run(`DELETE FROM chat_thread__fm WHERE id = ?`, id);
  ctx.db.run(`DELETE FROM chat_thread WHERE id = ?`, id);
}

export async function threadErase(ctx: ChatCtx, input: { threadId: string; idempotencyKey: string }) {
  ensure(ctx.db);
  if ((ctx.db.all(`SELECT id FROM chat_thread WHERE id = ?`, input.threadId) as Row[]).length === 0) return { erased: false };
  for (const id of family(ctx, input.threadId)) dropThread(ctx, id);
  ctx.emit("thread.erased", `entity/${input.threadId}`, { threadId: input.threadId });
  return { erased: true };
}

export async function channelErase(ctx: ChatCtx, input: { channelId: string; idempotencyKey: string }) {
  ensure(ctx.db);
  const ch = (ctx.db.all(`SELECT * FROM chat_channel WHERE id = ?`, input.channelId) as Row[])[0];
  if (!ch) return { erased: false };
  const roots = new Set<string>();
  if (ch["mainThread"]) roots.add(String(ch["mainThread"]));
  for (const t of ctx.db.all(`SELECT id FROM chat_thread WHERE "channelId" = ?`, input.channelId) as Row[]) roots.add(String(t["id"]));
  const seen = new Set<string>();
  for (const r of roots) for (const id of family(ctx, r)) if (!seen.has(id)) { seen.add(id); dropThread(ctx, id); }
  ctx.db.run(`DELETE FROM chat_channel WHERE id = ?`, input.channelId);
  ctx.emit("channel.erased", `entity/${input.channelId}`, { channelId: input.channelId });
  return { erased: true };
}

export async function transcriptPurge(ctx: ChatCtx, input: { before: number; limit?: number; skipThreadIds?: string[]; idempotencyKey: string }) {
  ensure(ctx.db);
  const limit = input.limit ?? DEFAULT_LIMIT;
  const skip = new Set(input.skipThreadIds ?? []);
  // the canonical transcript rows first (they hold the turns' words, oldest first), then the messages; both count against the one batch limit
  const turns = ifTable(() => ctx.db.all(`SELECT thread, idx, at FROM chat_transcript_row`) as Row[], [])
    .filter((r) => Number(r["at"]) < input.before && !skip.has(String(r["thread"])))
    .sort((a, b) => Number(a["at"]) - Number(b["at"]) || String(a["thread"]).localeCompare(String(b["thread"])) || Number(a["idx"]) - Number(b["idx"]));
  const turnBatch = turns.slice(0, limit);
  for (const r of turnBatch) ctx.db.run(`DELETE FROM chat_transcript_row WHERE thread = ? AND idx = ?`, String(r["thread"]), Number(r["idx"]));
  const room = limit - turnBatch.length;
  const due = (ctx.db.all(`SELECT id, thread, "createdAt" FROM chat_message`) as Row[])
    .filter((m) => Number(m["createdAt"]) < input.before && !skip.has(String(m["thread"])))
    .sort((a, b) => Number(a["createdAt"]) - Number(b["createdAt"]) || String(a["id"]).localeCompare(String(b["id"])));
  const batch = due.slice(0, room);
  for (const m of batch) {
    const id = String(m["id"]);
    ctx.db.run(`DELETE FROM chat_block WHERE message = ?`, id);
    ctx.db.run(`DELETE FROM chat_message__fm WHERE id = ?`, id);
    ctx.db.run(`DELETE FROM chat_message WHERE id = ?`, id);
  }
  const removed = batch.length + turnBatch.length;
  ctx.emit("transcripts.purged", `entity/${removed}`, { removed });
  return { removed, more: turns.length > turnBatch.length || due.length > batch.length };
}
