// What a press on Tasks does. One status path for every door (a list row, a board card, the page, a key, a drag): the row changes at once, tasks.transition decides, and a refusal puts the row back and says why.
// Every write here is one capability call and every failure reaches the person's line.
import type { MenuEntry } from "../../../../../../ui/src/Menu/index.tsx";
import { TASK_STATES } from "../../../../../../ui/src/TaskPage/model.ts";
import type { TaskState } from "../../../../../../ui/src/TaskPage/model.ts";
import type { TaskRow, Who } from "./model.ts";
import { DAY, PRIORITIES } from "./model.ts";
import type { TaskStore } from "./store.ts";

type Call = (cap: string, input: unknown) => Promise<unknown>;
export interface Say { (text: string, undo?: () => void): void }
export interface ActEnv { call: Call; say: Say; store: TaskStore; newKey(): string; now(): number; offsetMin: number }

export const failure = (e: unknown, fallback: string): string => (e instanceof Error && e.message !== "" ? e.message : fallback);

/** The status change of one task, from any door. */
export async function setStatus(env: ActEnv, row: Pick<TaskRow, "id" | "state">, to: TaskState, note?: string): Promise<boolean> {
  if (row.state === to) return true;
  const back = env.store.patch([row.id], (r) => ({ ...r, state: to }));
  try { await env.call("tasks.transition", { taskId: row.id, to, expectedFrom: row.state, ...(note ? { note } : {}) }); return true; }
  catch (e) { back(); env.say(failure(e, "The status could not be changed.")); return false; }
}

/** Do one thing to many tasks, eight at a time. What was refused is counted and the first reason is said. */
export async function forEach(env: ActEnv, ids: readonly string[], one: (id: string) => Promise<unknown>, done: string): Promise<number> {
  let ok = 0, reason = "";
  const queue = [...ids];
  const worker = async (): Promise<void> => { for (let id = queue.shift(); id !== undefined; id = queue.shift()) { try { await one(id); ok += 1; } catch (e) { reason ||= failure(e, "It could not be changed."); } } };
  await Promise.all(Array.from({ length: Math.min(8, ids.length) }, worker));
  env.say(ok === ids.length ? done : `${ok} of ${ids.length} changed. ${reason}`);
  return ok;
}

export function bulkStatus(env: ActEnv, ids: readonly string[], to: TaskState): Promise<number> {
  const title = TASK_STATES.find((s) => s.key === to)?.title ?? to;
  return forEach(env, ids, (id) => { const row = env.store.byId(id); return row ? setOne(env, row, to) : Promise.resolve(); }, `${ids.length} ${ids.length === 1 ? "task" : "tasks"} moved to ${title}`);
}
const setOne = async (env: ActEnv, row: TaskRow, to: TaskState): Promise<void> => {
  if (row.state === to) return;
  const back = env.store.patch([row.id], (r) => ({ ...r, state: to }));
  try { await env.call("tasks.transition", { taskId: row.id, to, expectedFrom: row.state }); } catch (e) { back(); throw e; }
};

export const bulkAssign = (env: ActEnv, ids: readonly string[], to: Who, name: string): Promise<number> => {
  env.store.patch(ids, (r) => ({ ...r, assigned: to }));
  return forEach(env, ids, (id) => env.call("tasks.assign", { taskId: id, slot: "assigned", to }), `${ids.length === 1 ? "Given" : `${ids.length} tasks given`} to ${name}`);
};
export const bulkDue = (env: ActEnv, ids: readonly string[], due: number | null, words: string): Promise<number> => forEach(env, ids, (id) => env.call("tasks.update", { taskId: id, due }), `${ids.length === 1 ? "Due" : `${ids.length} tasks due`} ${words}`);
export const bulkPriority = (env: ActEnv, ids: readonly string[], priority: string, words: string): Promise<number> => forEach(env, ids, (id) => env.call("tasks.update", { taskId: id, priority }), `${ids.length === 1 ? "Priority" : `Priority of ${ids.length} tasks`} set to ${words}`);
export const bulkLabel = (env: ActEnv, ids: readonly string[], label: string, add: boolean): Promise<number> => forEach(env, ids, (id) => {
  const row = env.store.byId(id);
  const labels = add ? [...new Set([...(row?.labels ?? []), label])] : (row?.labels ?? []).filter((l) => l !== label);
  return env.call("tasks.update", { taskId: id, labels });
}, add ? `Labeled ${label}` : `Removed ${label}`);
export const bulkMove = (env: ActEnv, ids: readonly string[], recordId: string, name: string): Promise<number> => forEach(env, ids, (id) => env.call("tasks.links.add", { taskId: id, recordId }), `Moved to ${name}`);

/** Delete with Undo: gone now, and Undo brings every one back. */
export async function bulkDelete(env: ActEnv, ids: readonly string[]): Promise<void> {
  const back = env.store.remove(ids);
  const gone: string[] = [];
  let reason = "";
  for (const id of ids) { try { await env.call("tasks.delete", { taskId: id }); gone.push(id); } catch (e) { reason ||= failure(e, "It could not be deleted."); } }
  if (gone.length < ids.length) back();
  if (gone.length === 0) { env.say(reason); return; }
  env.say(`${gone.length} ${gone.length === 1 ? "task" : "tasks"} deleted${reason ? `. ${reason}` : ""}`, () => { for (const id of gone) void env.call("tasks.restore", { taskId: id }).catch((e: unknown) => env.say(failure(e, "It could not be brought back."))); back(); });
}

const noonIn = (days: number, now: number, offsetMin: number): number => Math.floor((now + offsetMin * 60_000) / DAY) * DAY + days * DAY + DAY - 60_000 - offsetMin * 60_000;
export function dueEntries(env: Pick<ActEnv, "now" | "offsetMin">, choose: (at: number | null, words: string) => void): MenuEntry[] {
  const now = env.now();
  const dow = new Date(now + env.offsetMin * 60_000).getUTCDay();
  const friday = (5 - dow + 7) % 7 || 7, monday = (1 - dow + 7) % 7 || 7;
  return [
    { label: "Today", onSelect: () => choose(noonIn(0, now, env.offsetMin), "today") },
    { label: "Tomorrow", onSelect: () => choose(noonIn(1, now, env.offsetMin), "tomorrow") },
    { label: "Friday", onSelect: () => choose(noonIn(friday, now, env.offsetMin), "Friday") },
    { label: "Next week", onSelect: () => choose(noonIn(monday, now, env.offsetMin), "next week") },
    { separator: true },
    { label: "No date", onSelect: () => choose(null, "with no date") },
  ];
}
export const priorityEntries = (current: string | undefined, choose: (key: string, words: string) => void): MenuEntry[] => PRIORITIES.map((p) => ({ label: p.title, checked: (current ?? "normal") === p.key, onSelect: () => choose(p.key, p.title) }));

/** Keep, snooze, let go: the three answers to a task nobody has moved. */
export async function keepQuiet(env: ActEnv, ids: readonly string[]): Promise<void> {
  // a note counts as a move, so the task leaves the quiet line and comes back only if it goes quiet again
  await forEach(env, ids, (id) => env.call("tasks.working_notes.set", { taskId: id, key: "quiet.kept", value: new Date(env.now()).toISOString().slice(0, 10) }), ids.length === 1 ? "Kept" : `Kept ${ids.length} tasks`);
}
export const snoozeQuiet = (env: ActEnv, ids: readonly string[], until: number, words: string): Promise<number> => {
  const back = env.store.remove(ids);
  return forEach(env, ids, (id) => env.call("tasks.snooze", { taskId: id, until }), `Snoozed ${ids.length === 1 ? "it" : `${ids.length} tasks`} ${words}`).then((n) => { if (n === 0) back(); return n; });
};
export const letGo = (env: ActEnv, ids: readonly string[]): Promise<number> => {
  const back = env.store.remove(ids);
  return forEach(env, ids, (id) => env.call("tasks.withdraw", { taskId: id, note: "Let go after it went quiet." }), `Let ${ids.length === 1 ? "it" : `${ids.length} tasks`} go`).then((n) => { if (n === 0) back(); return n; });
};
