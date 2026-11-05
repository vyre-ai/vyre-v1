// engine.now (owner D24, 3 Nov): which agents are working right now, for whom and where, for the team "Now" view (collapsed in the Chats sidebar, open on Console Overview).
// DECISION: a turn's chat is named only to someone who may read that chat (threads.get as the caller decides); everyone else sees "in a private chat". The agent, the person it works for
//   and where it runs are the same for every member: that is what the team view is for.
import type { EngineCtx } from "../projections.ts";

type Row = Record<string, unknown>;
export interface NowRow { agentId: string; forPerson: string; where: "space" | "computer" | "server"; since: number; threadId?: string; title?: string; channelId?: string; kind?: string }

/** Where a turn runs, from the thread's lease holder: the Space's server, a person's computer, or one of their servers. */
export function whereOf(holder: string | null | undefined): NowRow["where"] {
  if (!holder) return "space";
  if (holder.startsWith("device:") || holder.startsWith("dev_")) return "computer";
  if (holder.startsWith("node:") || holder.startsWith("cmt_") || holder.startsWith("server:")) return "server";
  return "space";
}

/** The turns running now, with their chats and who asked: for the host's own use (the update screen names the reply it waits for, and ends it). Not for people: it names every chat. */
export async function runningHere(ctx: EngineCtx, _input: Record<string, never>): Promise<{ turns: Array<{ threadId: string; agentId: string; asker: string; turnId?: string }> }> {
  let rows: Row[] = [];
  try { rows = ctx.db.all("SELECT thread_id AS thread, agent_id AS agent, from_principal AS asker, qseq AS qseq FROM engine_thread_queue WHERE state = 'running' ORDER BY enqueued_at, thread_id") as Row[]; } catch { return { turns: [] }; }
  return { turns: rows.filter((r) => String(r["agent"]).startsWith("agt_")).map((r) => {
    // the turn behind the queue row, so "Continue" after the update can run exactly that turn again
    let turnId: string | undefined;
    try { const t = (ctx.db.all("SELECT turn_id FROM engine_turns WHERE thread_id = ? AND qseq = ? ORDER BY started_at DESC LIMIT 1", String(r["thread"]), Number(r["qseq"])) as Row[])[0]; if (t) turnId = String(t["turn_id"]); } catch { /* no turn row yet */ }
    return { threadId: String(r["thread"]), agentId: String(r["agent"]), asker: String(r["asker"] ?? ""), ...(turnId ? { turnId } : {}) };
  }) };
}

export async function now(ctx: EngineCtx, _input: Record<string, never>): Promise<{ working: NowRow[] }> {
  let rows: Row[] = [];
  try {
    rows = ctx.db.all(
      `SELECT q.thread_id AS thread, q.agent_id AS agent, q.from_principal AS asker, q.enqueued_at AS at, l.holder AS holder
         FROM engine_thread_queue q LEFT JOIN engine_thread_lease l ON l.thread_id = q.thread_id
        WHERE q.state = 'running' ORDER BY q.enqueued_at, q.thread_id`,
    ) as Row[];
  } catch { return { working: [] }; }
  const out: NowRow[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    const agentId = String(r["agent"]), thread = String(r["thread"]);
    if (!agentId.startsWith("agt_") || seen.has(`${agentId}\n${thread}`)) continue;
    seen.add(`${agentId}\n${thread}`);
    const asker = String(r["asker"] ?? "");
    const row: NowRow = { agentId, forPerson: asker.startsWith("usr_") ? asker : "", where: whereOf(r["holder"] as string | null), since: Number(r["at"] ?? 0) };
    try {
      const t = ((await ctx.call("threads.get", { threadId: thread })) as { thread?: { title?: string; channelId?: string; kind?: string } } | null)?.thread;
      if (t) { row.threadId = thread; if (t.title) row.title = t.title; if (t.channelId) row.channelId = t.channelId; if (t.kind) row.kind = t.kind; }
    } catch { /* a chat the caller may not read stays unnamed */ }
    out.push(row);
  }
  return { working: out };
}
