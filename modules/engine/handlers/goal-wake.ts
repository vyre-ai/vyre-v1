// Waking the lead agent of a goal (modules/goals). The goals module decides when (check-in, a task done, the number moved, an answer, the end) and emits goal.woken; this turns it into a turn of
// the lead agent in the goal's chat, for the goal's owner: their account, their access, and the placement their chats get (placeTurn picks the computer). The goal brief rides in the turn's context
// (context.ts, section "goal").
//   once     goals.wake_claim answers yes to exactly one reader of a wake-up and attempt, so a wake read twice, or by two hosts, runs one turn.
//   busy     a lead already working in the goal chat is not woken a second time: its running turn reads the brief, and the wake-up stays open until its check-in.
//   resumed  goal.resumed wakes the agents holding the goal's open tasks again, through the baton, now that goals.go says yes.
import type { TurnEngine } from "../../../agent/src/turn-engine/engine.ts";
import type { EngineCtx } from "../projections.ts";
import { onTaskEvent, openThread } from "./task-baton.ts";
import type { BatonHost } from "./task-baton.ts";

type Obj = Record<string, unknown>;
const str = (v: unknown): string => (typeof v === "string" ? v : "");
export interface GoalEvent { name: string; id?: string; payload: Obj }

export async function onGoalEvent(ctx: Pick<EngineCtx, "db">, host: BatonHost, engine: TurnEngine | null, event: GoalEvent): Promise<string[]> {
  if (!engine) return [];
  const p = event.payload;
  const goalId = str(p["goalId"]);
  if (event.name === "goal.resumed") {
    const woken: string[] = [];
    for (const taskId of Array.isArray(p["taskIds"]) ? (p["taskIds"] as unknown[]).map(str).filter((x) => x !== "") : []) {
      woken.push(...(await onTaskEvent(ctx, host, engine, { name: "task.ready", payload: { taskId } })));
    }
    return woken;
  }
  if (event.name !== "goal.woken") return [];
  const claim = (await host.call("goals.wake_claim", { goalId, wakeId: str(p["wakeId"]), attempt: Number(p["attempt"] ?? 1) }).catch((e: unknown) => {
    host.log?.("a goal wake-up could not be claimed", { goalId, error: e instanceof Error ? e.message : String(e) });
    return null;
  })) as { claimed?: boolean; threadId?: string; leadAgentId?: string; owner?: string } | null;
  if (claim?.claimed !== true || !claim.threadId || !claim.leadAgentId || !claim.owner) return [];
  const { threadId, leadAgentId: agentId, owner } = claim as { threadId: string; leadAgentId: string; owner: string };
  let busy = false;
  try { busy = engine.turns(threadId).some((t) => (t.state === "running" || t.state === "waiting") && t.agentId === agentId); } catch { /* not open on this host yet */ }
  if (busy) return [];
  if (!(await openThread(ctx.db as never, host, engine, threadId, agentId, owner, owner))) return [];
  engine.wake(threadId, agentId);
  return [agentId];
}

export type { Obj as GoalPayload };
