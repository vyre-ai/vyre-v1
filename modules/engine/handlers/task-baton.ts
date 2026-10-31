// Waking on the baton (work baton, item 3). A work task passes from its Assigned to its Reviewer to its Approver. When the baton lands on an agent, this wakes that agent in the task's thread:
// an engine turn whose context has a "Your task" section (modules/engine/context.ts) with the role, the brief and the baton tools, so the agent knows what to do and how to finish.
//
//   consumer   engine.task_baton on the task events that can move the baton (created, assigned, transitioned, delegated, escalated, taken, released, withdrawn).
//   once       a row per task (engine_task_baton) keeps the signature of the baton last woken for: state, review loop, holder. The same signature is never woken twice, however many events say it.
//   holder     an agent holder is woken. A group or role holder is offered to its agent members (the first tasks.take holds it and the rest stop). A person holder is left to their Needs you.
//   answers    a child Answer or Unblock task that finished wakes the holder of its parent again, once, because the work was waiting on it.
//   asker      the turn runs for a person: the one who asked for the work, else the owner of the agent, else the owner of the automation run. Without a person nothing is woken and the log says so.
//   no silent stop  a woken agent whose turn ends with the baton where it was (no submit, ask, block, review or decide) is nudged once in the thread and woken again. If the baton still has not moved
//                   after nudgeMinutes (the step's, default 30), a person gets a task in Needs you: the one the task escalates to, else the person who asked.
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
/** What the baton needs of the server: a way to call a capability (as the server, or as a person), the clock, and a log. The consumer, the clock job and the turn-end hook all pass one, so none of them
 *  holds on to the ctx of a call that has finished. */
export interface BatonHost { call(cap: string, input: unknown, as?: string): Promise<unknown>; now?: () => number; log?: (msg: string, attrs?: Record<string, unknown>) => void }
type Db = EngineCtx["db"];
const clockOf = (host: BatonHost): number => (host.now ?? Date.now)();

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
async function ownerOfAgent(host: BatonHost, agentId: string): Promise<string | undefined> {
  try {
    const owner = ((await host.call("access.principals.get", { principal: { kind: "agent", id: agentId } })) as { principal?: { owner?: unknown } } | null)?.principal?.owner;
    return isPerson(owner) ? owner : undefined;
  } catch { return undefined; }
}

/** The person a turn runs for: who asked for the work, else the owner of the agent that does it, else the person behind the automation run. */
export async function askerOf(host: BatonHost, t: BatonTask): Promise<string | undefined> {
  for (const id of [t.createdBy, t.workingNotes["baton.owner"]]) if (isPerson(id)) return id;
  for (const w of [t.assigned, t.reviewer, t.approver]) {
    if (w?.kind !== "agent") continue;
    const owner = await ownerOfAgent(host, w.id);
    if (owner) return owner;
  }
  if (t.source?.kind === "run") {
    try {
      const run = ((await host.call("runs.get", { runId: t.source.id })) as { run?: { owner?: string; startedBy?: string } }).run;
      for (const id of [run?.owner, run?.startedBy]) if (isPerson(id)) return id;
    } catch { /* the run is gone; the other ways were tried */ }
  }
  for (const w of [t.reviewer, t.approver]) if (w?.kind === "person" && isPerson(w.id)) return w.id;
  return undefined;
}

async function agentMembers(host: BatonHost, who: Who): Promise<string[]> {
  try {
    const members = who.kind === "group"
      ? ((await host.call("access.groups.get", { groupId: who.id })) as { group?: { members?: Array<{ kind?: string; id?: string }> } }).group?.members
      : ((await host.call("access.roles.get", { roleId: who.id })) as { holders?: Array<{ kind?: string; id?: string }> }).holders;
    return (members ?? []).filter((m) => m.kind === "agent" && typeof m.id === "string").map((m) => m.id as string).slice(0, MAX_OFFERED);
  } catch { return []; }
}

/** The agents to wake for a holder. A taken group task is held by the one who took it, who is already working, so nobody else is woken. */
export async function agentsToWake(host: BatonHost, t: BatonTask, who: Who): Promise<string[]> {
  if (who.kind === "agent") return [who.id];
  if ((who.kind === "group" || who.kind === "role") && t.takenBy === undefined) return agentMembers(host, who);
  return [];
}

async function readTask(host: BatonHost, id: string): Promise<BatonTask | undefined> {
  try { return ((await host.call("tasks.get", { taskId: id })) as { task?: BatonTask }).task; } catch { return undefined; }
}

interface ThreadOut { thread: { kind?: string; agents: Array<{ agentId: string; mode: "lead" | "listen"; model?: string; accountRef?: string; watches?: unknown }> } }
type Reader = (cap: string, input: unknown) => Promise<unknown>;

/** The thread of a task, made when the task has none. chat.start is one thread per task, so asking again returns the same one. */
async function threadOf(host: BatonHost, t: BatonTask, agentIds: string[], asker: string): Promise<string | undefined> {
  if (t.threadId) return t.threadId;
  try {
    const made = (await host.call("chat.start", { kind: "chat", agentIds, scopeType: "task", scopeId: t.id, title: t.title, idempotencyKey: `task-thread:${t.id}` }, asker)) as { thread?: { threadId?: string } };
    return made.thread?.threadId;
  } catch (e) { host.log?.("the thread of a task could not be made", { taskId: t.id, error: e instanceof Error ? e.message : String(e) }); return undefined; }
}

/** Open the task's thread in the engine for this asker, with the agents chat knows, and the agent that is about to be woken among them. */
async function openThread(db: Db, host: BatonHost, engine: TurnEngine, threadId: string, agentId: string, asker: string): Promise<boolean> {
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
  const store = sqlMessages(db, () => clockOf(host));
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
export async function onTaskEvent(ctx: Pick<EngineCtx, "db">, host: BatonHost, engine: TurnEngine | null, event: TaskEvent): Promise<string[]> {
  ensureBaton(ctx.db);
  const taskId = str(event.payload["taskId"]);
  if (taskId === "" || !engine) return [];
  let task = await readTask(host, taskId);
  if (!task) return [];
  let answeredChild: string | undefined;
  // a question or a block that finished: the work it waited on goes on
  if ((task.kind === "answer" || task.kind === "unblock") && task.parentTaskId && (task.state === "done" || task.state === "canceled")) {
    answeredChild = task.id;
    task = await readTask(host, task.parentTaskId);
    if (!task) return [];
  }
  if (task.kind !== "work") return [];
  const holder = holderOf(task);
  const before = batonRow(ctx.db, task.id);
  if (!holder) { if (before) dropBaton(ctx.db, task.id); return []; }
  const sig = signatureOf(task, holder);
  const fresh = before?.sig !== sig;
  if (!fresh && !(answeredChild && !before?.answered.includes(answeredChild))) return [];
  const targets = await agentsToWake(host, task, holder.who);
  const answered = [...(fresh ? [] : before?.answered ?? []), ...(answeredChild ? [answeredChild] : [])].slice(-50);
  const asker = await askerOf(host, task);
  const now = clockOf(host);
  if (targets.length === 0) {
    saveBaton(ctx.db, { taskId: task.id, sig, woken: [], answered, wokeAt: now, ...(asker ? { asker } : {}) });
    return [];
  }
  if (!asker) {
    host.log?.("an agent holds the baton of a task nobody asked for, so it was not woken", { taskId: task.id, role: holder.role });
    return [];
  }
  const threadId = await threadOf(host, task, targets, asker);
  if (!threadId) return [];
  const woken: string[] = [];
  for (const agentId of targets) {
    if (!(await openThread(ctx.db, host, engine, threadId, agentId, asker))) continue;
    engine.wake(threadId, agentId);
    woken.push(agentId);
  }
  saveBaton(ctx.db, { taskId: task.id, sig, woken, answered, threadId, asker, wokeAt: now });
  return woken;
}

// ---- no silent stops ----

export const DEFAULT_NUDGE_MINUTES = 30;
const MINUTE = 60_000;
const FINISH: Readonly<Record<string, string>> = {
  assigned: "task_submit when the work is done, task_ask if only a person can tell you something, task_block if something stops you",
  reviewer: "task_review: approve, or send_back with numbered fixes",
  approver: "task_decide: approve, or reject with a reason",
};
export interface TurnEnd { type: "turn.completed" | "turn.failed" | "turn.cancelled"; threadId: string; agentId: string }

const nudgeMinutesOf = (t: BatonTask): number => { const n = Number(t.workingNotes["baton.nudge_minutes"]); return Number.isFinite(n) && n >= 1 ? n : DEFAULT_NUDGE_MINUTES; };
const rowsOfThread = (db: Db, threadId: string): BatonRow[] => {
  ensureBaton(db);
  return (db.all("SELECT task_id FROM engine_task_baton WHERE thread_id = ?", threadId) as Obj[]).map((r) => batonRow(db, str(r["task_id"]))).filter((r): r is BatonRow => r !== undefined);
};

/** Is the work still waiting on this agent? Yes when the baton has not moved and the task is not parked on a question or a block someone else must answer. */
async function stillOnAgent(host: BatonHost, row: BatonRow, agentId: string): Promise<{ task: BatonTask; role: string } | undefined> {
  const task = await readTask(host, row.taskId);
  if (!task || task.kind !== "work" || (task as BatonTask & { blocked?: boolean }).blocked === true) return undefined;
  const holder = holderOf(task);
  if (!holder || signatureOf(task, holder) !== row.sig) return undefined;
  const effective = holder.who.kind === "agent" ? holder.who.id === agentId : task.takenBy === agentId;
  return effective ? { task, role: holder.role } : undefined;
}

/**
 * A woken agent's turn ended. If the baton did not move, that is a silent stop: say so once in the thread and wake the agent again. A failed turn is not nudged (it would fail the same way) but
 * starts the same clock; a turn a person stopped is theirs and starts nothing. Returns what it did, for the log and the tests.
 */
export async function onTurnEnded(ctx: Pick<EngineCtx, "db">, host: BatonHost, engine: TurnEngine, ev: TurnEnd): Promise<"nudged" | "waiting" | "stopped" | "moved" | "other"> {
  let result: "nudged" | "waiting" | "stopped" | "moved" | "other" = "other";
  for (const row of rowsOfThread(ctx.db, ev.threadId)) {
    if (!row.woken.includes(ev.agentId) || row.escalatedAt !== undefined) continue;
    const now = clockOf(host);
    if (ev.type === "turn.cancelled") { saveBaton(ctx.db, { ...row, nudgedAt: row.nudgedAt ?? now, escalatedAt: now }); result = "stopped"; continue; }
    const on = await stillOnAgent(host, row, ev.agentId);
    if (!on) { result = "moved"; continue; }
    const next: BatonRow = { ...row, turnEndedAt: row.turnEndedAt ?? now };
    if (ev.type === "turn.failed" || row.nudgedAt !== undefined) {
      saveBaton(ctx.db, { ...next, nudgedAt: next.nudgedAt ?? now });
      result = "waiting";
      continue;
    }
    saveBaton(ctx.db, { ...next, nudgedAt: now });
    try {
      await host.call("chat.post", { threadId: ev.threadId, body: `Your turn ended without handing the task on. Finish with exactly one baton call: ${FINISH[on.role]}.`, idempotencyKey: `baton-nudge:${row.taskId}:${row.sig}` });
      engine.wake(ev.threadId, ev.agentId);
      result = "nudged";
    } catch (e) { host.log?.("the nudge on a task could not be sent", { taskId: row.taskId, error: e instanceof Error ? e.message : String(e) }); }
  }
  return result;
}

/** The clock: a baton that has sat with an agent that stopped for nudgeMinutes goes to a person. Returns the tasks it escalated. */
export async function sweepBaton(ctx: Pick<EngineCtx, "db">, host: BatonHost, engine: TurnEngine | null): Promise<string[]> {
  ensureBaton(ctx.db);
  const out: string[] = [];
  const now = clockOf(host);
  for (const r of ctx.db.all("SELECT task_id FROM engine_task_baton WHERE turn_ended_at IS NOT NULL AND escalated_at IS NULL") as Obj[]) {
    const row = batonRow(ctx.db, str(r["task_id"]));
    if (!row || row.turnEndedAt === undefined) continue;
    const task = await readTask(host, row.taskId);
    const holder = task ? holderOf(task) : null;
    if (!task || !holder || signatureOf(task, holder) !== row.sig || (task as BatonTask & { blocked?: boolean }).blocked === true) { if (!task || !holder) dropBaton(ctx.db, row.taskId); continue; }
    if (now - row.turnEndedAt < nudgeMinutesOf(task) * MINUTE) continue;
    // an agent still working on it, or parked on an approval, is not stopped
    try { if (engine && row.threadId && engine.turns(row.threadId).some((t) => (t.state === "running" || t.state === "waiting") && row.woken.includes(t.agentId))) continue; } catch { /* a thread this host does not hold */ }
    if (await escalate(ctx, host, task, holder.role, row)) out.push(task.id);
  }
  return out;
}

/** A person task in Needs you for work an agent stopped on. Its answer wakes the agent again, through the same path as any finished question. */
async function escalate(ctx: Pick<EngineCtx, "db">, host: BatonHost, task: BatonTask, role: string, row: BatonRow): Promise<boolean> {
  let to: Who | undefined;
  try { const named = JSON.parse(task.workingNotes["baton.escalate_to"] ?? "null") as Who | null; if (named && typeof named.id === "string" && typeof named.kind === "string") to = named; } catch { /* the asker */ }
  const asker = row.asker ?? (await askerOf(host, task));
  if (!to && asker) to = { kind: "person", id: asker };
  if (!to) { host.log?.("a stopped agent task has nobody to escalate to", { taskId: task.id }); return false; }
  const minutes = nudgeMinutesOf(task);
  try {
    await host.call("tasks.create", {
      kind: "unblock", title: `An agent stopped on "${task.title}"`, summary: `The ${role === "assigned" ? "doer" : role} ended its turn ${minutes} minutes ago without handing the task on. Look at the thread, then mark this done to wake it again.`,
      assigned: to, parentTaskId: task.id, ...(task.recordId ? { recordId: task.recordId } : {}), idempotencyKey: `baton-escalate:${task.id}:${row.sig}`,
    });
  } catch (e) { host.log?.("a stopped agent task could not be escalated", { taskId: task.id, error: e instanceof Error ? e.message : String(e) }); return false; }
  saveBaton(ctx.db, { ...row, escalatedAt: clockOf(host) });
  if (row.threadId) await host.call("chat.post", { threadId: row.threadId, body: `No hand-over after ${minutes} minutes, so this went to a person.`, idempotencyKey: `baton-escalated:${task.id}:${row.sig}` }).catch(() => undefined);
  return true;
}
