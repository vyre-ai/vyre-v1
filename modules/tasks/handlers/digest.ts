// tasks.digest: what an agent keeps in mind about its work, every turn, for almost nothing. The task bound to this thread, its parent and siblings in a line each, then the agent's own open tasks: the top five and a
// count. A hard cap of about 300 tokens; the hash lets the engine send it only when it changed. Detail stays one tasks_get away. The asker's reach limits it: a task the asker cannot see is not named.
import { allTasks, actionableSlot, findTask, isOpen, visibleTo } from "../projections.ts";
import type { Task, TasksCtx } from "../projections.ts";

type In = Record<string, any>;   // eslint-disable-line @typescript-eslint/no-explicit-any

/** About four characters a token. */
export const CHARS_PER_TOKEN = 4;
export const DIGEST_TOKENS = 300;
export const DIGEST_CHARS = DIGEST_TOKENS * CHARS_PER_TOKEN;
const TOP = 5;
const MAX_LINES = 8;
const TITLE = 60;

const cut = (s: string, n: number): string => (s.length <= n ? s : `${s.slice(0, n - 1)}…`);
const flat = (s: string): string => s.replace(/\s+/g, " ").trim();
const STATE: Record<string, string> = { todo: "to do", doing: "doing", in_review: "in review", awaiting_approval: "awaiting approval", done: "done", canceled: "canceled" };
export const lineOf = (t: Pick<Task, "id" | "key" | "title" | "state">): string => `${t.key ?? t.id} ${cut(flat(t.title), TITLE)} [${STATE[t.state] ?? t.state}]`;

/** Small and stable: the same words give the same mark, in any process. */
export function hashOf(text: string): string {
  let a = 0x811c9dc5, b = 0x1000193;
  for (let i = 0; i < text.length; i++) { const c = text.charCodeAt(i); a = Math.imul(a ^ c, 16777619) >>> 0; b = Math.imul(b + c, 2654435761) >>> 0; }
  return `${a.toString(36)}${b.toString(36)}`;
}

export interface DigestParts { bound?: Task | undefined; parent?: Task | undefined; siblings: readonly Task[]; children: readonly Task[]; mine: readonly Task[]; mineTotal: number }

/** The words, inside the cap whatever the numbers: a part that does not fit is left out, and the count says how many more there are. */
export function renderDigest(p: DigestParts): string {
  const lines: string[] = [];
  const room = (s: string): boolean => lines.join("\n").length + s.length + 1 <= DIGEST_CHARS;
  const push = (s: string): boolean => { if (!room(s)) return false; lines.push(s); return true; };
  if (p.bound) push(`On this thread: ${lineOf(p.bound)}`);
  if (p.parent) push(`Parent: ${lineOf(p.parent)}`);
  const near = (head: string, rows: readonly Task[]): void => {
    if (rows.length === 0) return;
    const done = rows.filter((t) => !isOpen(t.state)).length;
    push(`${head} (${done} of ${rows.length} finished):`);
    let left = rows.length;
    for (const t of rows.filter((x) => isOpen(x.state)).slice(0, MAX_LINES)) { if (!push(`- ${lineOf(t)}`)) break; left -= 1; }
  };
  near("Siblings", p.siblings);
  near("Children", p.children);
  if (p.mineTotal > 0) {
    push(`Your open tasks (${p.mineTotal}):`);
    let shown = 0;
    for (const t of p.mine.slice(0, TOP)) { if (!push(`- ${lineOf(t)}`)) break; shown += 1; }
    if (p.mineTotal > shown) push(`and ${p.mineTotal - shown} more; tasks_list shows them.`);
  }
  return lines.join("\n");
}

const rank = (t: Task): number => (t.state === "doing" ? 0 : t.state === "in_review" || t.state === "awaiting_approval" ? 1 : 2);

export async function digest(ctx: TasksCtx, input: In): Promise<unknown> {
  const agent = String(input.agentId);
  const thread = typeof input.threadId === "string" ? input.threadId : undefined;
  const open = "c.state NOT IN ('done', 'canceled')";
  const can = (t: Task | undefined): t is Task => t !== undefined && visibleTo(ctx, t);
  // the task of this thread: its own thread, or the crew job or helper thread doing it. A chat can hold several parents; the newest open one is the one in hand.
  const bound = thread ? allTasks(ctx.db, `(m.thread_id = ? OR c.worker_thread = ?) AND m.kind = 'work'`, thread, thread).filter(can).sort((a, b) => Number(isOpen(b.state)) - Number(isOpen(a.state)))[0] : undefined;
  const parent = bound?.parentTaskId ? findTask(ctx.db, bound.parentTaskId) : undefined;
  const siblings = parent ? allTasks(ctx.db, "m.parent_task = ? AND m.kind = 'work'", parent.id).filter((t) => t.id !== bound?.id) : [];
  const children = bound ? allTasks(ctx.db, "m.parent_task = ? AND m.kind = 'work'", bound.id) : [];
  const held = allTasks(ctx.db, `${open} AND m.kind = 'work' AND (m.assigned LIKE ? OR m.reviewer LIKE ? OR m.approver LIKE ?)`, `%${agent}%`, `%${agent}%`, `%${agent}%`).filter((t) => {
    const slot = actionableSlot(t.state);
    return slot !== null && t[slot]?.id === agent && t.id !== bound?.id && visibleTo(ctx, t);
  }).sort((a, b) => rank(a) - rank(b) || (a.due ?? Infinity) - (b.due ?? Infinity) || b.updatedAt - a.updatedAt);
  const text = renderDigest({ bound, parent: can(parent) ? parent : undefined, siblings: siblings.filter(can), children: children.filter(can), mine: held.slice(0, TOP), mineTotal: held.length });
  // a crew job or helper thread is the task's thread for the one working in it; a chat that holds a parent is still a chat
  return { text, hash: hashOf(text), ...(bound && bound.workerThread === thread ? { workerTaskId: bound.id } : {}) };
}
