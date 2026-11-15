// A hold and its approval task are made in steps: the hold row, then the task, then the task's two reserved notes, then the hold learns its task's id. The task is visible to its
// approver from the second step, so an approval pressed the instant the card appears used to meet a hold with no task id and was refused with "That hold belongs to another task"
// (finding F73, 15 Nov 2026). The hold's task id is written last, so an empty one means "still being linked": wait for it, briefly, then check as before.
import { getHold, raise } from "../projections.ts";
import type { GateCtx, Hold } from "../projections.ts";

const TRIES = 40;
const PAUSE_MS = 25;

/** The hold for this task, once it is linked. A task that is not the hold's own is refused; a hold that never finishes linking says so and may be tried again. */
export async function linkedHold(ctx: GateCtx, holdId: string, taskId: string): Promise<Hold> {
  let h = getHold(ctx, holdId);
  for (let i = 0; h.taskId === "" && h.state === "held" && i < TRIES; i++) {
    await new Promise((r) => setTimeout(r, PAUSE_MS));
    h = getHold(ctx, holdId);
  }
  if (h.taskId === "" && h.state === "held")
    raise(ctx, "internal.unavailable", "This approval is still being set up. Try again in a moment.", {
      reason: "setting_up",
    });
  if (h.taskId !== taskId)
    raise(ctx, "validation.precondition_failed", "That hold belongs to another task.", { reason: "task_mismatch" });
  return h;
}
