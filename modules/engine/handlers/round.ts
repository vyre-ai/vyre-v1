// engine.round.get (chat gap G56/G61, C-chat.md): who is on each message right now, read from the engine queue and never stored, so nothing stays stuck after a restart. One row per agent that
// was asked by that message. States: working (its turn runs), waiting (queued behind an earlier turn of its own agent: agents asked together run together), replied (its turn ended), stopped (a person stopped it).
// Rows that were dropped unrun carry no stop reason and are left out. Only the thread's own readers reach it (the manifest's thread scope), so a round in a chat names agents to people who may read the chat.
import { ensure } from "../projections.ts";
import type { EngineCtx } from "../projections.ts";

type Row = Record<string, unknown>;
export type RoundState = "working" | "waiting" | "replied" | "stopped";
export interface RoundAgent {
  agentId: string;
  state: RoundState;
}

const MAX_MESSAGES = 50;

export async function roundGet(
  ctx: EngineCtx,
  input: { threadId: string; messageIds: string[] },
): Promise<{ rounds: Array<{ messageId: string; agents: RoundAgent[] }> }> {
  ensure(ctx.db);
  const wanted = [...new Set(input.messageIds)].slice(0, MAX_MESSAGES);
  if (wanted.length === 0) return { rounds: [] };
  const rows = ctx.db.all(
    "SELECT qseq, message_id, agent_id, state, stop_reason FROM engine_thread_queue WHERE thread_id = ? AND message_id IS NOT NULL ORDER BY qseq",
    input.threadId,
  ) as Row[];
  const want = new Set(wanted);
  const by = new Map<string, Map<string, RoundAgent>>();
  for (const r of rows) {
    const messageId = String(r["message_id"]);
    if (!want.has(messageId)) continue;
    const agentId = String(r["agent_id"]);
    const state = String(r["state"]);
    let agent: RoundAgent | undefined;
    if (state === "running") agent = { agentId, state: "working" };
    else if (state === "queued") {
      // one turn per agent: a queued row waits only behind an earlier turn of its own agent, never behind another agent
      agent = { agentId, state: "waiting" };
    } else if (state === "done") agent = { agentId, state: "replied" };
    else if (state === "stopping" || (state === "cancelled" && r["stop_reason"] != null && r["stop_reason"] !== ""))
      agent = { agentId, state: "stopped" };
    if (!agent) continue;
    const m = by.get(messageId) ?? new Map<string, RoundAgent>();
    m.set(agentId, agent); // a later row of the same agent for the same message (a retry) is the newer state
    by.set(messageId, m);
  }
  // a person's private Assistant (or an outside agent they connected) works for them alone: another reader of the chat is not told it is working. An agent that cannot be read is left out too.
  const me = ctx.principal.id;
  const shown = new Map<string, boolean>();
  const mayShow = async (agentId: string): Promise<boolean> => {
    if (!shown.has(agentId)) {
      let ok = false;
      try {
        const a = (
          (await ctx.call("agents.get", { agentId })) as {
            agent?: { kind?: string; runtime?: string; ownerId?: string };
          } | null
        )?.agent;
        ok = a !== undefined && (!(a.kind === "assistant" || a.runtime === "outside") || a.ownerId === me);
      } catch {
        ok = false;
      }
      shown.set(agentId, ok);
    }
    return shown.get(agentId)!;
  };
  const rounds: Array<{ messageId: string; agents: RoundAgent[] }> = [];
  for (const id of wanted) {
    if (!by.has(id)) continue;
    const agents: RoundAgent[] = [];
    for (const a of by.get(id)!.values()) if (await mayShow(a.agentId)) agents.push(a);
    if (agents.length > 0) rounds.push({ messageId: id, agents });
  }
  return { rounds };
}
