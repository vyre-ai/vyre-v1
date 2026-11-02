// Who holds a task when the person or agent holding it is gone (hole 10). A task never points at someone who cannot act: what a removed person held moves to whoever made the task, else the owner of the
// Space; what a deleted agent held moves to the person responsible for it; and a request a deleted agent raised ends, because nobody is waiting on the answer. One line of history says why. At least once:
// a second delivery finds nothing to move.
import { allTasks, emitTask, isRequest, sameAssignee, touch } from "../projections.ts";
import type { Assignee, Slot, Task, TasksCtx } from "../projections.ts";
import { syncThread } from "./thread.ts";

const OPEN = "c.state NOT IN ('done', 'canceled')";
const SLOTS: readonly Slot[] = ["assigned", "reviewer", "approver"];

async function spaceOwner(ctx: TasksCtx): Promise<string | undefined> {
  try { return ((await ctx.call?.("spaces.get", {})) as { space?: { owner?: string } } | null)?.space?.owner; } catch { return undefined; }
}

/** The first person who can take it: someone responsible, whoever made the task, the Space's owner. Never the one who left. */
function heirOf(t: Task, gone: Assignee, owner: string | undefined): Assignee | null {
  for (const id of [t.responsible, t.createdBy, owner]) if (id?.startsWith("usr_") && !sameAssignee({ kind: "person", id }, gone)) return { kind: "person", id };
  return null;
}

async function moveSlots(ctx: TasksCtx, t: Task, gone: Assignee, heir: Assignee, note: string): Promise<boolean> {
  let moved = false;
  for (const slot of SLOTS) {
    const from = t[slot];
    if (!from || !sameAssignee(from, gone)) continue;
    // a second seat for the person doing the work checks nothing: the seat is dropped unless the task is standing in it
    const standing = (slot === "reviewer" && t.state === "in_review") || (slot === "approver" && t.state === "awaiting_approval");
    if (slot !== "assigned" && sameAssignee(t.assigned, heir) && !standing) delete t[slot];
    else t[slot] = heir;
    if (slot === "assigned") { delete t.takenBy; delete t.takenAt; delete t.responsible; }
    touch(ctx, ctx.db, t);
    emitTask(ctx, ctx.db, "task.assigned", t, { slot, to: t[slot] ?? null, from }, { type: "assigned", by: ctx.principal.id, note });
    moved = true;
  }
  if (moved) await syncThread(ctx, t).catch((e: unknown) => ctx.log.warn("tasks: a thread could not follow a task that moved", { taskId: t.id, error: e instanceof Error ? e.message : "error" }));
  return moved;
}

export async function onPersonLeft(ctx: TasksCtx, event: { payload: { personId?: string } }): Promise<string[]> {
  const person = event.payload.personId;
  if (typeof person !== "string" || !person.startsWith("usr_")) return [];
  const gone: Assignee = { kind: "person", id: person };
  const held = allTasks(ctx.db, OPEN).filter((t) => SLOTS.some((s) => sameAssignee(t[s], gone)));
  if (held.length === 0) return [];
  const owner = await spaceOwner(ctx);
  const moved: string[] = [];
  for (const t of held) {
    const heir = heirOf(t, gone, owner);
    if (heir && await moveSlots(ctx, t, gone, heir, "The person holding this left the Space.")) moved.push(t.id);
  }
  return moved;
}

export async function onAgentDeleted(ctx: TasksCtx, event: { payload: { agentId?: string } }): Promise<string[]> {
  const agent = event.payload.agentId;
  if (typeof agent !== "string" || !agent.startsWith("agt_")) return [];
  const gone: Assignee = { kind: "agent", id: agent };
  const open = allTasks(ctx.db, OPEN);
  const touched: string[] = [];
  const owner = open.some((t) => SLOTS.some((s) => sameAssignee(t[s], gone))) ? await spaceOwner(ctx) : undefined;
  for (const t of open) {
    if (t.createdBy === agent && isRequest(t.kind)) {
      // a question or a request nobody is left to read the answer to
      const note = "The agent that asked was deleted.";
      t.state = "canceled";
      delete t.snoozedUntil;
      touch(ctx, ctx.db, t);
      emitTask(ctx, ctx.db, "task.withdrawn", t, { note, sourceKind: t.source?.kind, sourceId: t.source?.id }, { type: "withdrawn", by: ctx.principal.id, note });
      touched.push(t.id);
      continue;
    }
    const heir = SLOTS.some((s) => sameAssignee(t[s], gone)) ? heirOf(t, gone, owner) : null;
    if (heir && await moveSlots(ctx, t, gone, heir, "The agent holding this was deleted.")) touched.push(t.id);
  }
  return touched;
}
