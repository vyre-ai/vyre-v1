// engine.round.get (chat gap G56/G61, C-chat.md): who is on each message right now, read from the engine queue and never stored, so nothing stays stuck after a restart. One row per agent that
// was asked by that message. States: working (its turn runs), waiting (queued behind another turn of this chat; `on` names the agent in front), replied (its turn ended), stopped (a person stopped it).
// Rows that were dropped unrun carry no stop reason and are left out. Only the thread's own readers reach it (the manifest's thread scope), so a round in a chat names agents to people who may read the chat.
import { ensure } from "../projections.ts";
import type { EngineCtx } from "../projections.ts";

type Row = Record<string, unknown>;
export type RoundState = "working" | "waiting" | "replied" | "stopped";
export interface RoundAgent {
  agentId: string;
  state: RoundState;
  on?: string;
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
  const running = rows.filter((r) => r["state"] === "running").map((r) => String(r["agent_id"]));
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
      const front = running.find((a) => a !== agentId);
      agent = { agentId, state: "waiting", ...(front ? { on: front } : {}) };
    } else if (state === "done") agent = { agentId, state: "replied" };
    else if (state === "stopping" || (state === "cancelled" && r["stop_reason"] != null && r["stop_reason"] !== ""))
      agent = { agentId, state: "stopped" };
    if (!agent) continue;
    const m = by.get(messageId) ?? new Map<string, RoundAgent>();
    m.set(agentId, agent); // a later row of the same agent for the same message (a retry) is the newer state
    by.set(messageId, m);
  }
  return {
    rounds: wanted.filter((id) => by.has(id)).map((id) => ({ messageId: id, agents: [...by.get(id)!.values()] })),
  };
}
