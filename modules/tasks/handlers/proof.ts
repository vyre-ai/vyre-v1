// What may carry a "done when" proof (lane r42-alive): never a held act, an Approve task or anything the Gate or a Run holds, and a meeting only if the setter can open it. Kept apart from state.ts and evidence.ts so both can use it.
import { DONE_WHEN_KINDS, raise } from "../projections.ts";
import type { Task, TasksCtx } from "../projections.ts";

/** Evidence never settles a held act, an Approve task or anything the Gate or a Run waits on: those are decided with their own approval, never by an event. */
export function heldOrApproval(t: Task): boolean {
  return t.kind === "approve" || t.source?.kind === "gate" || t.source?.kind === "run" || t.payloadHash !== undefined;
}

/** A proof may be set only on a task an event may settle, naming a kind and a key, and (for a meeting) one its setter can open. Raises the refusal. */
export async function checkProof(ctx: TasksCtx, t: Task, kind: unknown, key: unknown): Promise<void> {
  if (heldOrApproval(t))
    raise(
      ctx,
      "validation.precondition_failed",
      "A held act or an Approve task is decided by its own approval, not by an event.",
      { reason: "held_act" },
    );
  if (kind === "meeting_ended" && typeof key === "string" && ctx.call) {
    // a proof may only name what its setter may read: a meeting they cannot open is not theirs to wait for
    try {
      await ctx.call("meetings.get", { meetingId: key.trim() });
    } catch {
      raise(ctx, "validation.precondition_failed", "That meeting is not one you can open.", {
        reason: "proof_unreadable",
      });
    }
  }
  if (!DONE_WHEN_KINDS.includes(kind as never) || typeof key !== "string" || key.trim() === "")
    raise(ctx, "validation.precondition_failed", "Say what to wait for: a kind and a name or id.", {
      reason: "bad_proof",
    });
}
