// A routine's run makes its agent act (spec 2.6). The agents module starts the run (on schedule, from Run Now) and says so with agent.routine_run_started; this wakes the agent with the
// routine's instructions as its turn's input, in the routine's chat: the channel it posts results to, else one chat of its own with the agent, kept for every run. The turn runs for the routine's
// owner, on their account, and the reply is labelled "Sent by <agent> on a routine <person> set". Nothing is posted in the owner's name: the instructions are the engine's input only.
//   once   a run is acted on once (engine_routine_runs), however many times the event is read.
import type { TurnEngine } from "../../../agent/src/turn-engine/engine.ts";
import type { EngineCtx } from "../projections.ts";
import { queueHeldNote } from "../held-notes.ts";

type Obj = Record<string, unknown>;
export interface RoutineRunEvent { payload: { agentId: string; routineId: string; runId: string; ownerId: string; requestedBy?: string } }
export interface RoutineHost { call(cap: string, input: unknown, as?: string): Promise<unknown>; log?: (msg: string, attrs?: Record<string, unknown>) => void }

const TABLE = 'CREATE TABLE IF NOT EXISTS "engine_routine_runs" ("run_id" TEXT PRIMARY KEY, "routine_id" TEXT NOT NULL, "thread_id" TEXT, "at" INTEGER NOT NULL)';
const CHATS = 'CREATE TABLE IF NOT EXISTS "engine_routine_chats" ("routine_id" TEXT PRIMARY KEY, "thread_id" TEXT NOT NULL)';
const str = (v: unknown): string => (typeof v === "string" ? v : "");

/** What the agent is told when its routine is due: what to do, and that nobody is waiting in the chat for an answer to a question. */
export function routineNote(r: { title: string; prompt: string }): string {
  return `Your routine "${r.title}" is due now. Do what it says and post the result here. Nobody asked this in the chat; it is the routine's own instruction:\n${r.prompt}`;
}

/** The routine's chat: the channel it posts to, else one chat with the agent for this routine, made once and kept. */
async function chatOf(ctx: EngineCtx, host: RoutineHost, r: { routineId: string; agentId: string; title: string; channelId?: string }, owner: string): Promise<string> {
  if (r.channelId) return ((await host.call("channels.get", { channelId: r.channelId }, owner)) as { channel: { mainThreadId: string } }).channel.mainThreadId;
  ctx.db.run(CHATS);
  const kept = str((ctx.db.all('SELECT thread_id FROM engine_routine_chats WHERE routine_id = ?', r.routineId)[0] as Obj | undefined)?.["thread_id"]);
  if (kept) {
    try { await host.call("threads.get", { threadId: kept }, owner); return kept; } catch { /* deleted since: a new one below */ }
  }
  const made = (await host.call("chat.start", { kind: "chat", agentIds: [r.agentId], title: r.title, idempotencyKey: `routine-chat:${r.routineId}:${ctx.now()}` }, owner)) as { thread: { threadId: string } };
  ctx.db.run('INSERT OR REPLACE INTO engine_routine_chats (routine_id, thread_id) VALUES (?, ?)', r.routineId, made.thread.threadId);
  return made.thread.threadId;
}

export async function onRoutineRun(ctx: EngineCtx, host: RoutineHost, engine: TurnEngine, open: (threadId: string, person: string) => Promise<unknown>, e: RoutineRunEvent): Promise<string[]> {
  const p = e.payload;
  // a watcher's run is answered where the message came in (it names the message); this is the clock's and Run Now's
  if (!p.runId || !p.ownerId?.startsWith("usr_") || str(p.requestedBy).startsWith("watch:")) return [];
  ctx.db.run(TABLE);
  if (ctx.db.all('SELECT 1 AS x FROM engine_routine_runs WHERE run_id = ?', p.runId).length > 0) return [];
  const list = (await host.call("agents.routines.list", { agentId: p.agentId }, p.ownerId)) as { routines?: Array<{ routineId: string; agentId: string; title: string; prompt: string; channelId?: string }> };
  const r = (list.routines ?? []).find((x) => x.routineId === p.routineId);
  if (!r) { host.log?.("a routine run names a routine its owner no longer has", { routineId: p.routineId, runId: p.runId }); return []; }
  const threadId = await chatOf(ctx, host, r, p.ownerId);
  ctx.db.run('INSERT OR IGNORE INTO engine_routine_runs (run_id, routine_id, thread_id, at) VALUES (?, ?, ?, ?)', p.runId, r.routineId, threadId, ctx.now());
  queueHeldNote(threadId, r.agentId, routineNote(r));
  await open(threadId, p.ownerId);
  engine.wake(threadId, r.agentId, { routine: true, from: p.ownerId });
  return [p.runId];
}
