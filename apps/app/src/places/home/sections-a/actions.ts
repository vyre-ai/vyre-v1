// What a press does on Home, apart from drawing: each action is one capability call, then one quiet line with Undo where the change can be taken back.
// The components call these through `useActions`; the tests call them directly against the sample replica.
import { useMemo } from "react";
import { useHomeData, useHomeLine, usePrincipals } from "./data.tsx";
import type { DigestItem, NeedsItem, Ref, Task } from "./model.ts";

export interface ActionDeps {
  call(cap: string, input: unknown): Promise<unknown>;
  /** the quiet line under the greeting */
  note(text: string, undo: () => Promise<void> | void): void;
  me: string;
  nameOf(id: string): string;
}

/** A write that can fail: a failure becomes the quiet line "Could not ...", never a thrown error from a click. */
async function attempt(d: ActionDeps, what: string, fn: () => Promise<void>): Promise<boolean> {
  try { await fn(); return true; } catch { d.note(`Could not ${what}. Try again.`, () => undefined); return false; }
}

/** Approve (or any inline action) on a Needs you item. The task leaves Needs you and the next one moves up. Undo puts it back where it was. */
export function act(d: ActionDeps, item: NeedsItem, actionKey: string, label: string): Promise<boolean> {
  const before = item.task.state;
  return attempt(d, label.toLowerCase(), async () => {
    await d.call("tasks.act", { taskId: item.task.id, action: actionKey });
    d.note(`${label}: ${item.task.title}`, () => attempt(d, "undo that", async () => { await d.call("tasks.transition", { taskId: item.task.id, to: before }); }).then(() => undefined));
  });
}

/** The circle: mark a task done. Undo moves it back to the state it was in. */
export function complete(d: ActionDeps, t: Pick<Task, "id" | "title" | "state">): Promise<boolean> {
  const before = t.state;
  return attempt(d, "complete that task", async () => {
    await d.call("tasks.transition", { taskId: t.id, to: "done" });
    d.note(`Done: ${t.title}`, () => attempt(d, "undo that", async () => { await d.call("tasks.transition", { taskId: t.id, to: before }); }).then(() => undefined));
  });
}

/** A face menu choice. The task moves to their My work and they are notified by their own rules; Undo hands it back. */
export function assign(d: ActionDeps, t: Pick<Task, "id" | "title" | "assigned">, to: Ref | null): Promise<boolean> {
  const before = t.assigned;
  return attempt(d, "assign that task", async () => {
    await d.call("tasks.assign", { taskId: t.id, slot: "assigned", to });
    d.note(to ? `Assigned to ${d.nameOf(to.id)}: ${t.title}` : `Unassigned: ${t.title}`, () => attempt(d, "undo that", async () => { await d.call("tasks.assign", { taskId: t.id, slot: "assigned", to: before }); }).then(() => undefined));
  });
}

/** The Plan timeline moved a bar: the task's end (due) and length (effort, in days) change. The Plan shows its own line with Undo, so no quiet line here. */
export function reschedule(d: ActionDeps, t: Pick<Task, "id" | "title">, due: number, effort: number): Promise<boolean> {
  return attempt(d, `move ${t.title}`, async () => { await d.call("tasks.update", { taskId: t.id, due, effort }); });
}

/** The Plan changed a task's state (review requested, reopened, done). */
export function transition(d: ActionDeps, t: Pick<Task, "id" | "title">, to: Task["state"]): Promise<boolean> {
  return attempt(d, `update ${t.title}`, async () => { await d.call("tasks.transition", { taskId: t.id, to }); });
}

/** A new task for me. From the Plan it carries the project it was added under and a due day, so it lands on the timeline once the live query returns it. */
export function createTask(d: ActionDeps, title: string, o: { recordId?: string; due?: number; effort?: number } = {}): Promise<boolean> {
  return attempt(d, "create that task", async () => {
    await d.call("tasks.create", { kind: "work", title, assigned: { kind: "person", id: d.me }, ...(o.recordId ? { recordId: o.recordId } : {}), ...(o.due !== undefined ? { due: o.due } : {}), ...(o.effort !== undefined ? { effort: o.effort } : {}) });
  });
}

/** Mark the digest seen; it resets. Offline this is queued by the capability (offline: queue). */
export function markDigestSeen(d: ActionDeps, digestId: string): Promise<boolean> {
  return attempt(d, "mark that seen", async () => { await d.call("home.mark_digest_seen", { digestId }); });
}

/** Undo what an agent decided for me: the capability the digest item carries. */
export function undoDigestItem(d: ActionDeps, it: Pick<DigestItem, "undo">): Promise<boolean> {
  const u = it.undo;
  if (!u) return Promise.resolve(false);
  return attempt(d, "undo that", async () => { await d.call(u.cap, u.input); });
}

export function useActions(): { deps: ActionDeps } & {
  act: (item: NeedsItem, key: string, label: string) => Promise<boolean>;
  complete: (t: Pick<Task, "id" | "title" | "state">) => Promise<boolean>;
  assign: (t: Pick<Task, "id" | "title" | "assigned">, to: Ref | null) => Promise<boolean>;
  createTask: (title: string, o?: { recordId?: string; due?: number; effort?: number }) => Promise<boolean>;
  reschedule: (t: Pick<Task, "id" | "title">, due: number, effort: number) => Promise<boolean>;
  transition: (t: Pick<Task, "id" | "title">, to: Task["state"]) => Promise<boolean>;
  markDigestSeen: (digestId: string) => Promise<boolean>;
  undoDigestItem: (it: Pick<DigestItem, "undo">) => Promise<boolean>;
} {
  const data = useHomeData();
  const { note } = useHomeLine();
  const { name } = usePrincipals();
  return useMemo(() => {
    const deps: ActionDeps = { call: data.call, note, me: data.me.id, nameOf: name };
    return {
      deps,
      act: (item, key, label) => act(deps, item, key, label),
      complete: (t) => complete(deps, t),
      assign: (t, to) => assign(deps, t, to),
      createTask: (title, o) => createTask(deps, title, o),
      reschedule: (t, due, effort) => reschedule(deps, t, due, effort),
      transition: (t, to) => transition(deps, t, to),
      markDigestSeen: (id) => markDigestSeen(deps, id),
      undoDigestItem: (it) => undoDigestItem(deps, it),
    };
  }, [data, note, name]);
}
