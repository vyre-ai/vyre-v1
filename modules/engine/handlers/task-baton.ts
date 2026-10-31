// Waking on the baton (work baton, item 3). A work task passes from its Assigned to its Reviewer to its Approver. When the baton lands on an agent, this wakes that agent in the task's thread:
// an engine turn whose context has a "Your task" section (modules/engine/context.ts) with the role, the brief and the baton tools, so the agent knows what to do and how to finish.
//
//   consumer   engine.task_baton on the task events that can move the baton (created, assigned, transitioned, delegated, escalated, taken, released, withdrawn).
//   once       a row per task (engine_task_baton) keeps the signature of the baton last woken for: state, review loop, holder. The same signature is never woken twice, however many events say it.
//   holder     an agent holder is woken. A group or role holder is offered to its agent members (the first tasks.take holds it and the rest stop). A person holder is left to their Needs you.
//   answers    a child Answer or Unblock task that finished wakes the holder of its parent again, once, because the work was waiting on it.
//   asker      the turn runs for a person: the one who asked for the work, else the owner of the agent, else the owner of the automation run. Without a person nothing is woken and the log says so.
//   no secret  nothing here reads or writes a Vault value; the turn's context names tools and ids only.
import type { TurnEngine } from "../../../agent/src/turn-engine/engine.ts";
import type { EngineAgent } from "../../../agent/src/turn-engine/types.ts";
import { ensure, sqlMessages, withMessageId } from "../projections.ts";
import type { EngineCtx } from "../projections.ts";

type Obj = Record<string, unknown>;
export interface Who { kind: string; id: string }
export interface BatonTask {
  id: string; kind: string; title: string; state: string; assigned: Who; reviewer?: Who; approver?: Who; takenBy?: string; parentTaskId?: string; threadId?: string;
  createdBy: string; reviewLoops: number; source?: { kind: string; id: string }; workingNotes: Record<string, string>; recordId?: string;
}
export interface BatonHost { call(cap: string, input: unknown, as?: string): Promise<unknown>; log?: (msg: string, attrs?: Record<string, unknown>) => void }

const MAX_OFFERED = 5;
const HISTORY = 30;
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const isPerson = (id: unknown): id is string => typeof id === "string" && id.startsWith("usr_");

const ensureBaton = ensure;

export interface BatonRow { taskId: string; sig: string; woken: string[]; answered: string[]; threadId?: string; asker?: string; wokeAt: number; turnEndedAt?: number; nudgedAt?: number; escalatedAt?: number }
const arr = (v: unknown): string[] => { try { const p = JSON.parse(String(v)) as unknown; return Array.isArray(p) ? p.filter((x): x is string => typeof x === "string") : []; } catch { return []; } };
export function batonRow(db: EngineCtx["db"], taskId: string): BatonRow | undefined {
  ensureBaton(db);
  const r = db.all("SELECT * FROM engine_task_baton WHERE task_id = ?", taskId)[0] as Obj | undefined;
  if (!r) return undefined;
  const n = (v: unknown): number | undefined => (typeof v === "number" ? v : undefined);
  return {
    taskId, sig: str(r["sig"]), woken: arr(r["woken"]), answered: arr(r["answered"]), ...(r["thread_id"] ? { threadId: str(r["thread_id"]) } : {}), ...(r["asker"] ? { asker: str(r["asker"]) } : {}),
    wokeAt: Number(r["woke_at"]), ...(n(r["turn_ended_at"]) !== undefined ? { turnEndedAt: n(r["turn_ended_at"])! } : {}), ...(n(r["nudged_at"]) !== undefined ? { nudgedAt: n(r["nudged_at"])! } : {}),
    ...(n(r["escalated_at"]) !== undefined ? { escalatedAt: n(r["escalated_at"])! } : {}),
  };
}
export function saveBaton(db: EngineCtx["db"], b: BatonRow): void {
  ensureBaton(db);
  db.run(
    "INSERT OR REPLACE INTO engine_task_baton (task_id, sig, woken, answered, thread_id, asker, woke_at, turn_ended_at, nudged_at, escalated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    b.taskId, b.sig, JSON.stringify(b.woken), JSON.stringify(b.answered), b.threadId ?? null, b.asker ?? null, b.wokeAt, b.turnEndedAt ?? null, b.nudgedAt ?? null, b.escalatedAt ?? null,
  );
}
export function dropBaton(db: EngineCtx["db"], taskId: string): void { ensureBaton(db); db.run("DELETE FROM engine_task_baton WHERE task_id = ?", taskId); }

/** Whose move it is: the Assigned while the work is open, the Reviewer in review, the Approver in approval. Nobody once the task is finished. */
export function holderOf(t: Pick<BatonTask, "state" | "assigned" | "reviewer" | "approver">): { role: "assigned" | "reviewer" | "approver"; who: Who } | null {
  if (t.state === "todo" || t.state === "doing") return { role: "assigned", who: t.assigned };
  if (t.state === "in_review" && t.reviewer) return { role: "reviewer", who: t.reviewer };
  if (t.state === "awaiting_approval" && t.approver) return { role: "approver", who: t.approver };
  return null;
}
export const signatureOf = (t: BatonTask, h: { role: string; who: Who }): string => `${h.role}|${t.reviewLoops}|${h.who.kind}:${h.who.id}`;

/** The person responsible for an agent: its owner. */
async function ownerOfAgent(ctx: EngineCtx, agentId: string): Promise<string | undefined> {
  try {
    const owner = ((await ctx.call("access.principals.get", { principal: { kind: "agent", id: agentId } })) as { principal?: { owner?: unknown } } | null)?.principal?.owner;
    return isPerson(owner) ? owner : undefined;
  } catch { return undefined; }
}

/** The person a turn runs for: who asked for the work, else the owner of the agent that does it, else the person behind the automation run. */
export async function askerOf(ctx: EngineCtx, t: BatonTask): Promise<string | undefined> {
  for (const id of [t.createdBy, t.workingNotes["baton.owner"]]) if (isPerson(id)) return id;
  for (const w of [t.assigned, t.reviewer, t.approver]) {
    if (w?.kind !== "agent") continue;
    const owner = await ownerOfAgent(ctx, w.id);
    if (owner) return owner;
  }
  if (t.source?.kind === "run") {
    try {
      const run = ((await ctx.call("runs.get", { runId: t.source.id })) as { run?: { owner?: string; startedBy?: string } }).run;
      for (const id of [run?.owner, run?.startedBy]) if (isPerson(id)) return id;
    } catch { /* the run is gone; the other ways were tried */ }
  }
  for (const w of [t.reviewer, t.approver]) if (w?.kind === "person" && isPerson(w.id)) return w.id;
  return undefined;
}

async function agentMembers(ctx: EngineCtx, who: Who): Promise<string[]> {
  try {
    const members = who.kind === "group"
      ? ((await ctx.call("access.groups.get", { groupId: who.id })) as { group?: { members?: Array<{ kind?: string; id?: string }> } }).group?.members
      : ((await ctx.call("access.roles.get", { roleId: who.id })) as { holders?: Array<{ kind?: string; id?: string }> }).holders;
    return (members ?? []).filter((m) => m.kind === "agent" && typeof m.id === "string").map((m) => m.id as string).slice(0, MAX_OFFERED);
  } catch { return []; }
}

/** The agents to wake for a holder. A taken group task is held by the one who took it, who is already working, so nobody else is woken. */
export async function agentsToWake(ctx: EngineCtx, t: BatonTask, who: Who): Promise<string[]> {
  if (who.kind === "agent") return [who.id];
  if ((who.kind === "group" || who.kind === "role") && t.takenBy === undefined) return agentMembers(ctx, who);
  return [];
}

async function readTask(ctx: EngineCtx, id: string): Promise<BatonTask | undefined> {
  try { return ((await ctx.call("tasks.get", { taskId: id })) as { task?: BatonTask }).task; } catch { return undefined; }
}

interface ThreadOut { thread: { kind?: string; agents: Array<{ agentId: string; mode: "lead" | "listen"; model?: string; accountRef?: string; watches?: unknown }> } }
type Reader = (cap: string, input: unknown) => Promise<unknown>;

/** The thread of a task, made when the task has none. chat.start is one thread per task, so asking again returns the same one. */
async function threadOf(ctx: EngineCtx, host: BatonHost, t: BatonTask, agentIds: string[], asker: string): Promise<string | undefined> {
  if (t.threadId) return t.threadId;
  try {
    const made = (await host.call("chat.start", { kind: "chat", agentIds, scopeType: "task", scopeId: t.id, title: t.title, idempotencyKey: `task-thread:${t.id}` }, asker)) as { thread?: { threadId?: string } };
    return made.thread?.threadId;
  } catch (e) { host.log?.("the thread of a task could not be made", { taskId: t.id, error: e instanceof Error ? e.message : String(e) }); return undefined; }
}

/** Open the task's thread in the engine for this asker, with the agents chat knows, and the agent that is about to be woken among them. */
async function openThread(ctx: EngineCtx, host: BatonHost, engine: TurnEngine, threadId: string, agentId: string, asker: string): Promise<boolean> {
  const read: Reader = (cap, input) => host.call(cap, input, asker);
  let open = true;
  try { engine.agents(threadId); } catch (e) { if (!(e instanceof RangeError)) throw e; open = false; }
  let got: ThreadOut;
  try { got = (await read("threads.get", { threadId })) as ThreadOut; } catch (e) { host.log?.("the thread of a task could not be read", { threadId, error: e instanceof Error ? e.message : String(e) }); return false; }
  if (!got.thread.agents.some((a) => a.agentId === agentId)) {
    try { await host.call("threads.add_agent", { threadId, agentId, mode: "listen" }, asker); got.thread.agents.push({ agentId, mode: "listen" }); }
    catch (e) { host.log?.("an agent could not join the thread of its task", { threadId, agentId, error: e instanceof Error ? e.message : String(e) }); return false; }
  }
  const agents: EngineAgent[] = [];
  for (const a of got.thread.agents) {
    let model = a.model;
    if (!model) { try { model = ((await read("agents.get", { agentId: a.agentId })) as { agent?: { model?: string } } | null)?.agent?.model; } catch { /* the agent's account default */ } }
    agents.push({ id: a.agentId, mode: "listen", ...(model ? { model } : {}), ...(a.accountRef ? { accountRef: a.accountRef } : {}) });
  }
  if (open) {
    for (const a of agents) engine.engage(threadId, a);
    engine.setStarter(threadId, asker);
    return true;
  }
  // first time this host sees the thread: the window the agent reads as history, oldest first, under chat's own ids
  const store = sqlMessages(ctx.db, ctx.now);
  if (store.recent(threadId, 1).length === 0) {
    try {
      const list = (await read("chat.messages.list", { threadId, limit: HISTORY })) as { messages: Array<{ messageId: string; threadSeq?: number; author: { id: string }; body: string; depth?: number }> };
      for (const r of [...list.messages].sort((a, b) => (a.threadSeq ?? 0) - (b.threadSeq ?? 0))) {
        if (store.get(r.messageId)) continue;
        withMessageId(r.messageId, () => store.append({ id: r.messageId, threadId, author: { kind: r.author.id.startsWith("agt_") ? "agent" : "person", id: r.author.id }, mentions: [], depth: r.depth ?? 0, body: r.body }));
      }
    } catch { /* an empty history still gives the agent its task section */ }
  }
  try { engine.openThread({ id: threadId, kind: "thread", starter: asker, agents }); } catch (e) { if (!(e instanceof RangeError)) throw e; }
  return true;
}

export interface TaskEvent { name: string; id?: string; payload: Obj }

/**
 * One task event. Reads the task, works out whose move it is, and wakes the agent when the baton is new. Returns the agents woken (for the log and the tests).
 * `engine` is null where the runtime is not running on this host; nothing is recorded then, so a host that has it wakes the agent when it reads the event.
 */
export async function onTaskEvent(ctx: EngineCtx, host: BatonHost, engine: TurnEngine | null, event: TaskEvent): Promise<string[]> {
  ensureBaton(ctx.db);
  const taskId = str(event.payload["taskId"]);
  if (taskId === "" || !engine) return [];
  let task = await readTask(ctx, taskId);
  if (!task) return [];
  let answeredChild: string | undefined;
  // a question or a block that finished: the work it waited on goes on
  if ((task.kind === "answer" || task.kind === "unblock") && task.parentTaskId && (task.state === "done" || task.state === "canceled")) {
    answeredChild = task.id;
    task = await readTask(ctx, task.parentTaskId);
    if (!task) return [];
  }
  if (task.kind !== "work") return [];
  const holder = holderOf(task);
  const before = batonRow(ctx.db, task.id);
  if (!holder) { if (before) dropBaton(ctx.db, task.id); return []; }
  const sig = signatureOf(task, holder);
  const fresh = before?.sig !== sig;
  if (!fresh && !(answeredChild && !before?.answered.includes(answeredChild))) return [];
  const targets = await agentsToWake(ctx, task, holder.who);
  const answered = [...(fresh ? [] : before?.answered ?? []), ...(answeredChild ? [answeredChild] : [])].slice(-50);
  const asker = await askerOf(ctx, task);
  const now = ctx.now();
  if (targets.length === 0) {
    saveBaton(ctx.db, { taskId: task.id, sig, woken: [], answered, wokeAt: now, ...(asker ? { asker } : {}) });
    return [];
  }
  if (!asker) {
    host.log?.("an agent holds the baton of a task nobody asked for, so it was not woken", { taskId: task.id, role: holder.role });
    return [];
  }
  const threadId = await threadOf(ctx, host, task, targets, asker);
  if (!threadId) return [];
  const woken: string[] = [];
  for (const agentId of targets) {
    if (!(await openThread(ctx, host, engine, threadId, agentId, asker))) continue;
    engine.wake(threadId, agentId);
    woken.push(agentId);
  }
  saveBaton(ctx.db, { taskId: task.id, sig, woken, answered, threadId, asker, wokeAt: now });
  return woken;
}
