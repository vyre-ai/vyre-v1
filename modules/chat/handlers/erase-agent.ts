// Delete an agent for good, chat's half (F77). A chat only that agent and one person were in goes whole, with its messages, attachments links, threads, drafts, read state and search entries (the same erase
// governance uses). In a chat or channel shared with other people or agents its messages stay as the chat's record, shown under its name with a quiet "deleted" mark; what was private behind them (its
// thinking, its tool traces, the turns' own words) is erased. The agent's rows in its chats, its direct-message rows and its trash marks go.
// Also here: an agent that comes back from Trash comes back into the chats it was taken out of (A: restore brings every one of those back as it was).
import { eraseWhere, tryAll, tryRun } from "../../../lib/erase-agent.ts";
import type { EraseInput, Footprint } from "../../../lib/erase-agent.ts";
import { ensure } from "../projections.ts";
import type { ChatCtx } from "../projections.ts";
import { threadErase } from "./purge.ts";

type Row = Record<string, unknown>;
const TRASHED = `CREATE TABLE IF NOT EXISTS chat_agent_trashed ("agentId" TEXT NOT NULL, "thread" TEXT NOT NULL, "at" INTEGER NOT NULL, PRIMARY KEY ("agentId", "thread"))`;
const KINDS_PRIVATE = `('thinking','reasoning','tool','tool_use','tool_call','tool_result','trace','activity')`;

/** At agent.deleted: which chats the agent was taken out of, so a restore puts it back in exactly those. */
export function noteTrashed(ctx: ChatCtx, agentId: string, threads: string[]): void {
  ctx.db.run(TRASHED);
  for (const th of threads)
    ctx.db.run(`INSERT OR IGNORE INTO chat_agent_trashed ("agentId", "thread", "at") VALUES (?, ?, ?)`, agentId, th, ctx.now());
}

/** agent.restored: the agent is back in the chats it left with Trash, one line in each; a chat that was erased or an agent removed from it by a person since stays as it is. */
export function onAgentRestored(ctx: ChatCtx, event: { payload: { agentId?: string; name?: string } }): string[] {
  const agent = event.payload.agentId;
  if (typeof agent !== "string" || !agent.startsWith("agt_")) return [];
  ensure(ctx.db);
  ctx.db.run(TRASHED);
  const back: string[] = [];
  const now = ctx.now();
  for (const r of ctx.db.all(`SELECT "thread" FROM chat_agent_trashed WHERE "agentId" = ?`, agent) as Row[]) {
    const th = String(r["thread"]);
    const n = ctx.db.run(
      `UPDATE chat_thread_agent SET "deleted_at" = NULL, "version" = "version" + 1, "updated_at" = ? WHERE "thread" = ? AND "agentId" = ? AND "deleted_at" IS NOT NULL`,
      now,
      th,
      agent,
    ).changes;
    if (n > 0) {
      ctx.emit("agent.engaged", th, { threadId: th, agentId: agent, by: agent });
      back.push(th);
    }
  }
  ctx.db.run(`DELETE FROM chat_agent_trashed WHERE "agentId" = ?`, agent);
  return back;
}

/** The chats an agent was ever in, sorted into: its own one-to-one chats (only this agent, only one person, no channel) and the shared ones. */
function chatsOf(ctx: ChatCtx, agentId: string): { own: string[]; shared: string[] } {
  const threads = tryAll(ctx.db, `SELECT DISTINCT "thread" FROM chat_thread_agent WHERE "agentId" = ?`, agentId).map((r) => String(r["thread"]));
  const own: string[] = [];
  const shared: string[] = [];
  for (const th of threads) {
    const t = (ctx.db.all(`SELECT "kind", "parentThreadId", "channelId" FROM chat_thread WHERE "id" = ?`, th) as Row[])[0];
    if (!t) continue;
    const agents = new Set(tryAll(ctx.db, `SELECT "agentId" FROM chat_thread_agent WHERE "thread" = ?`, th).map((r) => String(r["agentId"])));
    const people = new Set(tryAll(ctx.db, `SELECT "principal" FROM chat_thread_member WHERE "thread" = ?`, th).map((r) => String(r["principal"])));
    const alone = t["kind"] === "chat" && !t["channelId"] && agents.size === 1 && people.size <= 1;
    // a thread under a chat follows its parent: it is erased with the chat, so it is not counted twice
    if (t["parentThreadId"] !== null && t["parentThreadId"] !== undefined) continue;
    (alone ? own : shared).push(th);
  }
  return { own, shared };
}

export async function eraseAgent(ctx: ChatCtx, i: EraseInput): Promise<Footprint> {
  ensure(ctx.db);
  const { own, shared } = chatsOf(ctx, i.agentId);
  if (i.dry) return { chats: own.length, sharedChats: shared.length };
  for (const th of own) await threadErase(ctx, { threadId: th, idempotencyKey: `agent-erase:${i.agentId}:${th}` });
  // shared: the messages stay, what was private behind them goes
  for (const th of shared) {
    tryRun(ctx.db, `DELETE FROM chat_transcript_row WHERE "thread" = ? AND "author" = ?`, th, i.agentId);
    tryRun(
      ctx.db,
      `DELETE FROM chat_block WHERE "type" IN ${KINDS_PRIVATE} AND "message" IN (SELECT "id" FROM chat_message WHERE "thread" = ? AND "author" = ?)`,
      th,
      i.agentId,
    );
  }
  for (const r of tryAll(ctx.db, `SELECT "id" FROM chat_thread_agent WHERE "agentId" = ?`, i.agentId))
    tryRun(ctx.db, `DELETE FROM chat_thread_agent__fm WHERE "id" = ?`, String(r["id"]));
  eraseWhere(ctx.db, i.agentId, [
    ["chat_thread_agent", "agentId"],
    ["chat_agent_dm", "agent"],
    ["chat_agent_dm", "teammate"],
    ["chat_agent_dm_mute", "teammate"],
    ["chat_agent_trashed", "agentId"],
  ]);
  return { chats: own.length, sharedChats: shared.length };
}
