// What the engine does when whoever a piece of work belongs to is gone or paused (holes 10 and 12). A Job is running, paused, lost or stopped, and nothing runs for an agent that was deleted or for a person
// who left. Everything here repeats safely: the events are delivered at least once and a second pass finds nothing to stop.
import type { TurnEngine } from "../../../agent/src/turn-engine/engine.ts";
import { sqlQueue } from "../projections.ts";
import type { EngineCtx } from "../projections.ts";

type Row = Record<string, unknown>;
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const isOpen = (engine: TurnEngine, threadId: string): boolean => { try { engine.agents(threadId); return true; } catch { return false; } };

/** Stop one agent in one thread: through the engine when the thread is open here (a turn may be running), straight on the rows otherwise (nothing is running, the rows are what is left). */
async function stopAgentIn(ctx: EngineCtx, engine: TurnEngine | null, threadId: string, agentId: string): Promise<void> {
  if (engine && isOpen(engine, threadId)) {
    const r = await engine.stop(threadId, { agentId });
    for (const c of [...r.stopped, ...r.released]) ctx.emit("turn.cancelled", threadId, { turnId: c.turnId, threadId, agentId: c.agentId, by: ctx.principal.id });
    return;
  }
  sqlQueue(ctx.db).cancelQueued(threadId, agentId);
  ctx.db.run("UPDATE engine_thread_queue SET state = 'cancelled' WHERE thread_id = ? AND agent_id = ? AND state = 'running'", threadId, agentId);
  ctx.db.run("DELETE FROM engine_waits WHERE thread_id = ? AND agent_id = ?", threadId, agentId);
}

function workOf(ctx: EngineCtx, where: string, ...args: unknown[]): Array<{ threadId: string; agentId: string }> {
  const rows = ctx.db.all(`SELECT DISTINCT thread_id, agent_id FROM engine_thread_queue WHERE state IN ('queued', 'running') AND ${where}`, ...args) as Row[];
  return rows.map((r) => ({ threadId: str(r["thread_id"]), agentId: str(r["agent_id"]) }));
}
function parkedOf(ctx: EngineCtx, where: string, ...args: unknown[]): Array<{ threadId: string; agentId: string }> {
  return (ctx.db.all(`SELECT DISTINCT thread_id, agent_id FROM engine_waits WHERE ${where}`, ...args) as Row[]).map((r) => ({ threadId: str(r["thread_id"]), agentId: str(r["agent_id"]) }));
}

/** Everything an agent has running stops. A deleted agent's Jobs end; a paused agent's Jobs wait for it. */
export async function stopAgent(ctx: EngineCtx, engine: TurnEngine | null, agentId: string, jobs: "stopped" | "paused"): Promise<string[]> {
  const hit = [...workOf(ctx, "agent_id = ?", agentId), ...parkedOf(ctx, "agent_id = ?", agentId)];
  const threads = [...new Set(hit.map((h) => h.threadId))];
  for (const t of threads) await stopAgentIn(ctx, engine, t, agentId);
  const now = ctx.now();
  if (jobs === "stopped") {
    ctx.db.run("UPDATE engine_crew_job SET state = 'stopped', ended_at = ? WHERE agent_id = ? AND state IN ('working', 'waiting', 'paused', 'lost')", now, agentId);
    ctx.db.run("UPDATE engine_crew_wait SET state = 'stopped', ended_at = ? WHERE agent_id = ? AND state = 'pending'", now, agentId);
  } else ctx.db.run("UPDATE engine_crew_job SET state = 'paused' WHERE agent_id = ? AND state IN ('working', 'waiting')", agentId);
  return threads;
}

/** An agent came back: a Job that paused with it carries on in its own thread. */
export async function resumeAgent(ctx: EngineCtx, engine: TurnEngine | null, agentId: string, open: (threadId: string, asker: string) => Promise<void>): Promise<string[]> {
  const rows = ctx.db.all("SELECT job_id, thread_id, asker FROM engine_crew_job WHERE agent_id = ? AND state = 'paused'", agentId) as Row[];
  const woken: string[] = [];
  for (const r of rows) {
    const threadId = str(r["thread_id"]);
    ctx.db.run("UPDATE engine_crew_job SET state = 'working' WHERE job_id = ? AND state = 'paused'", str(r["job_id"]));
    if (!engine) continue;
    try { await open(threadId, str(r["asker"])); engine.wake(threadId, agentId); woken.push(threadId); }
    catch (e) { ctx.log.warn("a paused teammate could not pick up again", { threadId, error: e instanceof Error ? e.message : String(e) }); }
  }
  return woken;
}

/** A person left: nothing runs on their word or their account any more. Their Jobs stop where they stand; what they committed stays on its branch. */
export async function stopPerson(ctx: EngineCtx, engine: TurnEngine | null, person: string): Promise<string[]> {
  const hit = [...workOf(ctx, "from_principal = ?", person), ...parkedOf(ctx, "asker = ?", person)];
  for (const h of hit) await stopAgentIn(ctx, engine, h.threadId, h.agentId);
  const now = ctx.now();
  ctx.db.run("UPDATE engine_crew_job SET state = 'stopped', ended_at = ? WHERE asker = ? AND state IN ('working', 'waiting', 'paused', 'lost')", now, person);
  ctx.db.run("UPDATE engine_crew_wait SET state = 'stopped', ended_at = ? WHERE asker = ? AND state = 'pending'", now, person);
  ctx.db.run("DELETE FROM engine_unblock WHERE asker = ?", person);
  return [...new Set(hit.map((h) => h.threadId))];
}

/** Who a chat runs for changed (the person who started it left): a thread open here runs for the new owner from its next turn. */
export function ownerChanged(engine: TurnEngine | null, threadId: string, starter: string): void {
  if (engine && isOpen(engine, threadId)) engine.setStarter(threadId, starter);
}

/** How long a Job may read as working with nothing queued or running for it before it counts as lost: long enough for its first message to reach the engine. */
export const LOST_AFTER_MS = 60_000;

/**
 * A Job the server lost track of. Its turn ended without the watcher hearing (the server stopped in between), so nothing will ever move it: it reads as lost, and a person presses Run again. A turn parked at
 * the Gate is waiting, not lost.
 */
export function markLostJobs(ctx: EngineCtx): string[] {
  const rows = ctx.db.all(
    `SELECT j.job_id AS id FROM engine_crew_job j WHERE j.state = 'working' AND j.started_at < ?
       AND NOT EXISTS (SELECT 1 FROM engine_thread_queue q WHERE q.thread_id = j.thread_id AND q.state IN ('queued', 'running'))
       AND NOT EXISTS (SELECT 1 FROM engine_waits w WHERE w.thread_id = j.thread_id)`, ctx.now() - LOST_AFTER_MS,
  ) as Row[];
  const ids = rows.map((r) => str(r["id"]));
  for (const id of ids) ctx.db.run("UPDATE engine_crew_job SET state = 'lost', ended_at = ? WHERE job_id = ? AND state = 'working'", ctx.now(), id);
  return ids;
}
