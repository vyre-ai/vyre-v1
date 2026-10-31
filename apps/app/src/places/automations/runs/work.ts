// The work of a Run (work baton, lane W2): the tasks a Run made for people and agents, and who holds the baton of each. A Run waiting on an agent's task shows the holder's face and what they are doing,
// so "who is it with" is answered on the Runs list and on the Run itself without opening anything. Pure helpers and one read; nothing here writes.
export interface Seat { kind: string; id: string }
export interface WorkTask {
  id: string; kind: string; title: string; state: string; blocked?: boolean;
  assigned: Seat; reviewer?: Seat; approver?: Seat; takenBy?: string; source?: { kind: string; id: string };
}
export interface WorkMark { taskId: string; who: Seat; word: string; step: "work" | "review" | "approve" }

const OPEN = new Set(["todo", "doing", "in_review", "awaiting_approval"]);

/** Who holds the baton of one task and what they are doing; nothing for a finished task or one that is not work. */
export function markOf(t: WorkTask): WorkMark | null {
  if (t.kind !== "work" || !OPEN.has(t.state)) return null;
  if (t.state === "in_review" && t.reviewer) return { taskId: t.id, who: t.reviewer, word: "Reviewing", step: "review" };
  if (t.state === "awaiting_approval" && t.approver) return { taskId: t.id, who: t.approver, word: "Approving", step: "approve" };
  if (t.state === "todo" || t.state === "doing") return { taskId: t.id, who: t.takenBy ? { kind: t.assigned.kind === "role" ? "person" : t.assigned.kind, id: t.takenBy } : t.assigned, word: t.state === "todo" ? "Next up" : "Doing", step: "work" };
  return null;
}

/** The mark of each Run that has open work: the task that has waited longest comes first, so the list shows the oldest hand-over. */
export function marksByRun(tasks: readonly WorkTask[]): ReadonlyMap<string, WorkMark> {
  const out = new Map<string, WorkMark>();
  for (const t of tasks) {
    if (t.source?.kind !== "run") continue;
    const m = markOf(t);
    if (m && !out.has(t.source.id)) out.set(t.source.id, m);
  }
  return out;
}

export const workLabel = (m: WorkMark, name: string): string => `${m.word}: ${name}`;

/** Open work tasks Runs made, for the Work column. A task list that cannot be read is no work, never an error on the Runs list. */
export async function loadOpenWork(call: (cap: string, input: unknown) => Promise<unknown>): Promise<readonly WorkTask[]> {
  try {
    const out = (await call("tasks.list", { scope: "all", kinds: ["work"], states: ["todo", "doing", "in_review", "awaiting_approval"], limit: 200 })) as { tasks?: WorkTask[] };
    return (out.tasks ?? []).filter((t) => t.source?.kind === "run");
  } catch { return []; }
}

/** The tasks of one Run, newest first as the server gives them. */
export async function loadRunWork(call: (cap: string, input: unknown) => Promise<unknown>, runId: string): Promise<readonly WorkTask[]> {
  try {
    const out = (await call("tasks.list", { scope: "run", runId, kinds: ["work"], limit: 50 })) as { tasks?: WorkTask[] };
    return out.tasks ?? [];
  } catch { return []; }
}
