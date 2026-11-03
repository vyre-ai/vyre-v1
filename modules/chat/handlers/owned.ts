// Agents a chat made for itself, and the grants a chat gave an outside agent (lane l-addsheet). Both end with the chat or when the agent is taken out of it.
//   owned     chat_thread_agent.owned = 1: the agent was made with threads.agent.create. It goes to Trash (agents.delete) when the chat is deleted or erased, or when it is removed from the chat, and comes
//             back with threads.restore. A person who may not delete it cannot move it: the call is tolerated, never swallowed (a warning says so).
//   grants    chat_thread_agent.grants: the resources threads.outside_agent.add shared with the agent, each with the source tag chat:<threadId>. Removing the agent takes them back at once.
import { ensure } from "../projections.ts";
import type { ChatCtx } from "../projections.ts";

type Row = Record<string, unknown>;
export const sourceOf = (threadId: string): string => `chat:${threadId}`;
export interface Granted { type: string; id: string; level: string }

const warn = (ctx: ChatCtx, what: string, e: unknown, attrs: Record<string, unknown>): void =>
  ctx.log.warn(what, { ...attrs, error: e instanceof Error ? e.message.slice(0, 200) : String((e as { error?: { code?: string } } | null)?.error?.code ?? e) });

/** The agents these chats made for themselves and still hold. */
export function ownedIn(ctx: ChatCtx, threads: readonly string[]): string[] {
  ensure(ctx.db);
  if (threads.length === 0) return [];
  const marks = threads.map(() => "?").join(", ");
  return [...new Set((ctx.db.all(`SELECT "agentId" FROM chat_thread_agent WHERE "thread" IN (${marks}) AND "owned" = 1 AND "deleted_at" IS NULL`, ...threads) as Row[]).map((r) => String(r["agentId"])))];
}

/** Move the agents these chats made to Trash (or back out of it). Answers how many moved. */
export async function trashOwned(ctx: ChatCtx, agents: readonly string[], back = false): Promise<number> {
  if (!ctx.call) return 0;
  let n = 0;
  for (const agentId of agents) {
    try { await ctx.call(back ? "agents.restore" : "agents.delete", { agentId }); n += 1; } catch (e) { warn(ctx, back ? "a chat's own agent could not be restored" : "a chat's own agent could not be moved to Trash", e, { agentId }); }
  }
  return n;
}

export function grantsOf(ctx: ChatCtx, threadId: string, agentId: string): Granted[] {
  ensure(ctx.db);
  const raw = (ctx.db.all(`SELECT "grants" FROM chat_thread_agent WHERE "thread" = ? AND "agentId" = ? AND "deleted_at" IS NULL`, threadId, agentId) as Row[])[0]?.["grants"];
  try { const v = JSON.parse(String(raw ?? "[]")) as unknown; return Array.isArray(v) ? (v as Granted[]) : []; } catch { return []; }
}

/** Take back every grant the chat gave this agent, each by its source tag. A failure stops the removal and is said: access never stays behind in silence. Answers how many grants went. */
export async function revokeGrants(ctx: ChatCtx, threadId: string, agentId: string, granted: readonly Granted[]): Promise<number> {
  if (!ctx.call) return 0;
  let revoked = 0;
  for (const g of granted) {
    try {
      const r = (await ctx.call("access.unshare", { resource: { type: g.type, id: g.id }, subject: { kind: "agent", id: agentId }, source: sourceOf(threadId) })) as { revoked?: number } | null;
      revoked += Number(r?.revoked ?? 0);
    } catch (e) { warn(ctx, "a grant given to an outside agent could not be taken back", e, { threadId, agentId, resource: `${g.type}:${g.id}` }); throw e; }
  }
  return revoked;
}
