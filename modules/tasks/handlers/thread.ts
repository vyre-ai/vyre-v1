// The thread of a task (work baton, item 1). Every task has one thread (chat.start with scopeType 'task'): the one place the work, its brief, its fixes and its answers live.
// Assigned, Reviewer and Approver are in it: people are members, agents are listeners that run only when woken or mentioned (the engine's baton consumer wakes them).
// All of it is best effort: a task never fails to exist because its thread could not be made. The thread is made again by the next call that needs it (chat.start is one thread per task).
import type { Task, TasksCtx } from "../projections.ts";

type Slotted = Pick<Task, "assigned" | "reviewer" | "approver">;

/** The people and agents who hold a slot, by id. Groups and roles hold no thread seat: whoever takes the task is added then. */
export function seatsOf(t: Slotted, extra: ReadonlyArray<{ kind: string; id: string }> = []): { people: string[]; agents: string[] } {
  const people = new Set<string>();
  const agents = new Set<string>();
  for (const a of [t.assigned, t.reviewer, t.approver, ...extra]) {
    if (!a) continue;
    if (a.kind === "person" && a.id.startsWith("usr_")) people.add(a.id);
    else if (a.kind === "agent" && a.id.startsWith("agt_")) agents.add(a.id);
  }
  return { people: [...people], agents: [...agents] };
}

const attempt = async (f: () => Promise<unknown>): Promise<boolean> => { try { await f(); return true; } catch { return false; } };

/** Make the task's thread when it has none, and put everyone who holds a slot in it. Sets t.threadId (a chat the task was made in stays reachable as the working note thread.origin); the caller stores the task. */
export async function ensureThread(ctx: TasksCtx, t: Task, origin?: string): Promise<string | undefined> {
  if (!ctx.call) return t.threadId;
  const seats = seatsOf(t);
  if (t.threadId === undefined) {
    const made = (await ctx.call("chat.start", { kind: "chat", agentIds: seats.agents, scopeType: "task", scopeId: t.id, title: t.title, idempotencyKey: `task-thread:${t.id}` }).catch(() => null)) as { thread?: { threadId?: string } } | null;
    const id = made?.thread?.threadId;
    if (!id) return undefined;
    if (origin !== undefined && origin !== id) t.workingNotes = { ...t.workingNotes, "thread.origin": origin };
    t.threadId = id;
  }
  await seat(ctx, t.threadId, seats);
  return t.threadId;
}

/** Add the people and agents of the slots to a thread that exists. Adding someone already in it changes nothing. */
export async function seat(ctx: TasksCtx, threadId: string, seats: { people: string[]; agents: string[] }): Promise<void> {
  if (!ctx.call) return;
  for (const personId of seats.people) await attempt(() => ctx.call!("threads.members.add", { threadId, personId }));
  for (const agentId of seats.agents) await attempt(() => ctx.call!("threads.add_agent", { threadId, agentId, mode: "listen" }));
}

/** After a slot changed: the new holder is in the thread. */
export async function syncThread(ctx: TasksCtx, t: Task): Promise<void> {
  if (t.threadId === undefined || !ctx.call) return;
  await seat(ctx, t.threadId, seatsOf(t));
}

/** One line in the task's thread, written by whoever is acting. It carries no mention, so no agent runs because of it. */
export async function postLine(ctx: TasksCtx, t: Pick<Task, "id" | "threadId">, body: string, key: string): Promise<void> {
  if (t.threadId === undefined || !ctx.call || body.trim() === "") return;
  await attempt(() => ctx.call!("chat.post", { threadId: t.threadId, body, idempotencyKey: `task-line:${t.id}:${key}` }));
}
