// Evidence first, by events, in seconds (lane r42-alive, living tasks). A task can carry one "done when": a Vault item with a name, a message sent to a contact, a meeting that ended, a connection made.
// When the event that proves it arrives, the task closes Done with the proof as its note ("It is in the Vault: Hosting key."), through tasks.transition as the host, so the history, the baton and a waiting Run
// all behave as for any other close. Every event can arrive twice: a closed or archived task is left alone.
import { findTask, isOpen, raise, saveTask, visibleTo, whoIs } from "../projections.ts";
import type { DoneWhenKind, Task, TasksCtx } from "../projections.ts";
import { DONE_WHEN_KINDS } from "../projections.ts";
import { isTrustedService } from "../../../lib/trust.ts";
import { mayLetGo } from "./state.ts";
import { out } from "../projections.ts";

type In = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type Ev = { name: string; payload: Record<string, unknown> };

const norm = (v: string): string => v.trim().toLowerCase();

/** What an event proves: its kind, the key a task named, and the words of the proof. */
export function proofOf(e: Ev): { kind: DoneWhenKind; key: string; words: string } | null {
  const s = (v: unknown): string => (typeof v === "string" ? v : "");
  switch (e.name) {
    case "vault.item_created":
      return s(e.payload["name"]) === ""
        ? null
        : { kind: "vault_item", key: s(e.payload["name"]), words: `It is in the Vault: ${s(e.payload["name"])}.` };
    case "message.sent":
      return s(e.payload["contactId"]) === ""
        ? null
        : { kind: "message_sent", key: s(e.payload["contactId"]), words: "The message went out." };
    case "meeting.ended":
      return s(e.payload["meetingId"]) === ""
        ? null
        : { kind: "meeting_ended", key: s(e.payload["meetingId"]), words: "The meeting ended." };
    case "connection.created":
      return s(e.payload["connector"]) === ""
        ? null
        : { kind: "connection_on", key: s(e.payload["connector"]), words: "The connection is on." };
    default:
      return null;
  }
}

/** Evidence never settles a held act, an Approve task or anything the Gate or a Run waits on: those are decided with their own approval, never by an event. */
export function heldOrApproval(t: Task): boolean {
  return t.kind === "approve" || t.source?.kind === "gate" || t.source?.kind === "run" || t.payloadHash !== undefined;
}

/** The people and agents on the task: only what one of them does can close it, so the task closing never tells its setter about what someone else did out of their sight. */
function onTheTask(t: Task, actor: string | undefined): boolean {
  if (!actor) return false;
  const ids = [t.assigned, t.reviewer, t.approver].flatMap((a) =>
    a && (a.kind === "person" || a.kind === "agent") ? [a.id] : [],
  );
  return ids.includes(actor) || actor === t.takenBy || actor === t.createdBy || actor === t.createdFor;
}

/**
 * Close the open tasks the event proves done. Each is closed on its own: one refusal never stops the others, and a redelivery tries only what is still open. A task closes only when the event is the doing of someone
 * on the task (vault items, messages), or is a Space-wide fact (a connection made for the Space); a meeting is checked when the proof is set.
 */
export async function onEvidence(ctx: TasksCtx, event: Ev & { actor?: string }): Promise<string[]> {
  const p = proofOf(event);
  if (!p || !ctx.call) return [];
  const rows = ctx.db.all("SELECT task_id FROM tasks_proof WHERE kind = ? AND key = ?", p.kind, norm(p.key)) as {
    task_id: string;
  }[];
  const closed: string[] = [];
  for (const r of rows) {
    const t = findTask(ctx.db, r.task_id);
    if (!t || !isOpen(t.state) || t.archived !== undefined || heldOrApproval(t)) continue;
    const spaceWide = p.kind === "connection_on" && event.payload["ownerKind"] === "space";
    if (p.kind !== "meeting_ended" && !spaceWide && !onTheTask(t, event.actor)) continue;
    try {
      await ctx.call("tasks.transition", { taskId: t.id, to: "done", note: p.words });
      closed.push(t.id);
    } catch {
      /* this one refused (a precondition): the others still close */
    }
  }
  return closed;
}

/** tasks.done_when: say what proves a task done, or clear it (no kind). Only someone on the task. */
export async function doneWhen(ctx: TasksCtx, input: In): Promise<unknown> {
  const t = findTask(ctx.db, input.taskId);
  if (!t || (!isTrustedService(whoIs(ctx)) && !visibleTo(ctx, t)))
    raise(ctx, "permission.not_found", "That task is not available.");
  if (!isTrustedService(whoIs(ctx)) && !mayLetGo(ctx, t))
    raise(ctx, "validation.precondition_failed", "Only someone on this task can say what proves it done.", {
      reason: "wrong_actor",
    });
  if (input.kind !== undefined && heldOrApproval(t))
    raise(
      ctx,
      "validation.precondition_failed",
      "A held act or an Approve task is decided by its own approval, not by an event.",
      {
        reason: "held_act",
      },
    );
  if (input.kind === "meeting_ended" && typeof input.key === "string" && ctx.call) {
    // a proof may only name what its setter may read: a meeting they cannot open is not theirs to wait for
    try {
      await ctx.call("records.get", { recordId: input.key.trim() });
    } catch {
      raise(ctx, "validation.precondition_failed", "That meeting is not one you can open.", {
        reason: "proof_unreadable",
      });
    }
  }
  if (input.kind === undefined) {
    ctx.db.run("DELETE FROM tasks_proof WHERE task_id = ?", t.id);
    delete t.doneWhen;
  } else {
    if (!DONE_WHEN_KINDS.includes(input.kind) || typeof input.key !== "string" || input.key.trim() === "")
      raise(ctx, "validation.precondition_failed", "Say what to wait for: a kind and a name or id.", {
        reason: "bad_proof",
      });
    t.doneWhen = { kind: input.kind, key: norm(input.key) };
  }
  saveTask(ctx.db, t);
  return { task: out(ctx, t) };
}
