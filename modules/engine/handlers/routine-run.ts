// A routine's run makes its agent act (spec 2.6). The agents module starts the run (on schedule, from Run Now, or a watcher on a new message) and says so with agent.routine_run_started; this wakes
// the agent with the routine's instructions as its turn's input. The turn runs for the routine's owner, on their account, and the reply is labelled "Sent by <agent> on a routine <person> set".
// Nothing is posted in the owner's name: the instructions are the engine's input only.
//   where    a schedule or Run Now answers in the routine's chat: the channel it posts results to, else one chat of its own with the agent, kept for every run. A watcher answers in the thread
//            the new message came in, and its input carries that message.
//   loops    a watcher never fires on its agent's own words or on a routine's post (agents/handlers/routines.ts onMessageReceived), and this reply is a routine's post, so it wakes no watcher.
//   once     a run is acted on once (engine_routine_runs), however many times the event is read.
//   finish   when the turn the run woke ends, the run is finished: succeeded, failed or stopped, with the turn named on the run's step log, so the routine's Last run says how it went.
import type { TurnEngine } from "../../../agent/src/turn-engine/engine.ts";
import type { EngineCtx } from "../projections.ts";
import { queueHeldNote } from "../held-notes.ts";

type Obj = Record<string, unknown>;
export interface RoutineRunEvent { payload: { agentId: string; routineId: string; runId: string; ownerId: string; requestedBy?: string } }
export interface RoutineHost { call(cap: string, input: unknown, as?: string): Promise<unknown>; log?: (msg: string, attrs?: Record<string, unknown>) => void }

const TABLE = 'CREATE TABLE IF NOT EXISTS "engine_routine_runs" ("run_id" TEXT PRIMARY KEY, "routine_id" TEXT NOT NULL, "thread_id" TEXT, "at" INTEGER NOT NULL)';
const TURNS = 'CREATE TABLE IF NOT EXISTS "engine_routine_turns" ("run_id" TEXT PRIMARY KEY, "thread_id" TEXT NOT NULL, "agent_id" TEXT NOT NULL, "qseq" INTEGER NOT NULL, "owner" TEXT NOT NULL, "state" TEXT NOT NULL)';
const CHATS = 'CREATE TABLE IF NOT EXISTS "engine_routine_chats" ("routine_id" TEXT PRIMARY KEY, "thread_id" TEXT NOT NULL)';
const str = (v: unknown): string => (typeof v === "string" ? v : "");

/** What the agent is told when its routine is due: what to do, and that nobody is waiting in the chat for an answer to a question. */
export function routineNote(r: { title: string; prompt: string }): string {
  return `Your routine "${r.title}" is due now. Do what it says and post the result here. Nobody asked this in the chat; it is the routine's own instruction:\n${r.prompt}`;
}

/** What a watcher's agent is told: the new message that woke it, who wrote it, and the routine's instructions for it. It answers in that thread, once. */
export function watcherNote(r: { title: string; prompt: string }, m: { who: string; body: string; where: string }): string {
  return `Your watcher "${r.title}" was woken by a new message in ${m.where} from ${m.who}:\n"""\n${m.body.slice(0, 4000)}\n"""\nDo what the watcher says for this message and answer here, once. Its instruction:\n${r.prompt}`;
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

/** The message a watcher's run was started for, as its agent is told it. Null when the run names none or it cannot be read as the owner. */
async function triggerOf(host: RoutineHost, runId: string, owner: string): Promise<{ threadId: string; body: string; who: string; where: string } | null> {
  const run = ((await host.call("runs.get", { runId }, owner)) as { run?: { trigger?: { messageId?: string; threadId?: string; channelId?: string } } }).run;
  const t = run?.trigger;
  if (!t?.messageId || !t.threadId) return null;
  const m = ((await host.call("chat.message.get", { threadId: t.threadId, messageId: t.messageId }, owner)) as { message?: { body?: string; author?: { id?: string } } }).message;
  let who = "someone";
  if (m?.author?.id) {
    try { const n = ((await host.call("access.principals.get", { principal: { kind: m.author.id.startsWith("agt_") ? "agent" : "person", id: m.author.id } })) as { principal?: { name?: unknown } }).principal?.name; if (typeof n === "string" && n.trim()) who = n.trim(); }
    catch { /* a plain word is enough */ }
  }
  let where = "the channel";
  if (t.channelId) {
    try { const c = ((await host.call("channels.get", { channelId: t.channelId }, owner)) as { channel?: { name?: string } }).channel; if (c?.name) where = `#${c.name}`; } catch { /* the channel */ }
  }
  return { threadId: t.threadId, body: m?.body ?? "", who, where };
}

export async function onRoutineRun(ctx: EngineCtx, host: RoutineHost, engine: TurnEngine, open: (threadId: string, person: string) => Promise<unknown>, e: RoutineRunEvent): Promise<string[]> {
  const p = e.payload;
  if (!p.runId || !p.ownerId?.startsWith("usr_")) return [];
  ctx.db.run(TABLE);
  ctx.db.run(TURNS);
  if (ctx.db.all('SELECT 1 AS x FROM engine_routine_runs WHERE run_id = ?', p.runId).length > 0) return [];
  const list = (await host.call("agents.routines.list", { agentId: p.agentId }, p.ownerId)) as { routines?: Array<{ routineId: string; agentId: string; title: string; prompt: string; channelId?: string }> };
  const r = (list.routines ?? []).find((x) => x.routineId === p.routineId);
  if (!r) { host.log?.("a routine run names a routine its owner no longer has", { routineId: p.routineId, runId: p.runId }); return []; }
  const watcher = str(p.requestedBy).startsWith("watch:");
  let threadId: string;
  if (watcher) {
    const trig = await triggerOf(host, p.runId, p.ownerId);
    if (!trig) { host.log?.("a watcher run names no message", { routineId: p.routineId, runId: p.runId }); return []; }
    threadId = trig.threadId;
    queueHeldNote(threadId, r.agentId, watcherNote(r, trig));
  } else {
    threadId = await chatOf(ctx, host, r, p.ownerId);
    queueHeldNote(threadId, r.agentId, routineNote(r));
  }
  ctx.db.run('INSERT OR IGNORE INTO engine_routine_runs (run_id, routine_id, thread_id, at) VALUES (?, ?, ?, ?)', p.runId, r.routineId, threadId, ctx.now());
  await open(threadId, p.ownerId);
  // a watcher's agent need not be in the channel it watches: it answers there for the person who set the watcher
  engine.engage(threadId, { id: r.agentId, mode: "listen" });
  const qseq = engine.wake(threadId, r.agentId, { routine: true, from: p.ownerId });
  ctx.db.run('INSERT OR REPLACE INTO engine_routine_turns (run_id, thread_id, agent_id, qseq, owner, state) VALUES (?, ?, ?, ?, ?, ?)', p.runId, threadId, r.agentId, qseq, p.ownerId, "queued");
  return [p.runId];
}

/** The status a run ends with, from how its turn ended. */
export const runStatusOf = (ended: "turn.completed" | "turn.failed" | "turn.cancelled"): "succeeded" | "failed" | "stopped" =>
  ended === "turn.completed" ? "succeeded" : ended === "turn.failed" ? "failed" : "stopped";

/**
 * A turn ended: if a routine's run woke it, the run is finished the way the turn went, with the turn named in its step log. A turn no run woke, or one already finished, is left alone.
 * Called by the runtime for every turn.completed, turn.failed and turn.cancelled.
 */
export async function finishRoutineRun(ctx: Pick<EngineCtx, "db">, host: RoutineHost, ev: { type: "turn.completed" | "turn.failed" | "turn.cancelled"; turnId: string; threadId: string; qseq?: number; code?: string; message?: string }, qseqOf: (turnId: string) => number | undefined): Promise<string | null> {
  ctx.db.run(TURNS);
  const qseq = ev.qseq ?? qseqOf(ev.turnId);
  if (qseq === undefined) return null;
  const row = ctx.db.all("SELECT run_id, owner FROM engine_routine_turns WHERE thread_id = ? AND qseq = ? AND state = 'queued'", ev.threadId, qseq)[0] as Obj | undefined;
  if (!row) return null;
  const runId = str(row["run_id"]);
  ctx.db.run("UPDATE engine_routine_turns SET state = 'done' WHERE run_id = ?", runId);
  const status = runStatusOf(ev.type);
  try {
    await host.call("runs.record_step", { runId, step: "agent turn", attempt: 1, state: status, outputRef: `turn:${ev.turnId}` });
  } catch (e) { host.log?.("a routine run's turn was not linked", { runId, error: e instanceof Error ? e.message : String(e) }); }
  try {
    await host.call("runs.finish", {
      runId, status, ...(status === "succeeded" ? { summary: "The agent answered" } : {}),
      ...(status === "failed" ? { error: { code: ev.code ?? "turn_failed", message: (ev.message ?? "The agent's turn did not finish.").slice(0, 300), step: "agent turn" } } : {}),
    });
  } catch (e) { host.log?.("a routine run was not finished", { runId, error: e instanceof Error ? e.message : String(e) }); return null; }
  return runId;
}
