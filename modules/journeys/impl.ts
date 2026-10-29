// Journeys module (lane L6). The host loads these handlers once the manifest status is live (ARCH 12.4).
// `compileStartRule` is what the designer shows as "this Journey starts when ..."; `planMigration` is shared by the preview and the migration.
import { handlers } from "./handlers/index.ts";
import { taskOfRun } from "./projections.ts";
import type { JourneysCtx } from "./projections.ts";

export { handlers };
export { compileStartRule, moveTo } from "./handlers/stages.ts";
export { planMigration } from "./handlers/migrate.ts";

// ---- consumers ----

type Ev = { payload: Record<string, unknown> };

/**
 * A Run finished well: if it is the Run of an Automation that completes a Journey task, the task is done. A Run that fails leaves the task open for a person.
 * A task that was already done, withdrawn or moved on is left alone.
 */
async function doneByRun(ctx: JourneysCtx, ev: Ev): Promise<string[]> {
  const runId = typeof ev.payload["runId"] === "string" ? ev.payload["runId"] : "";
  const link = runId ? taskOfRun(ctx.db, runId) : undefined;
  if (!link || !ctx.call) return [];
  try {
    await ctx.call("tasks.transition", { taskId: link.taskId, to: "done", note: "Done by its Automation." });
    return [link.taskId];
  } catch (e) {
    ctx.log?.warn("journeys: the task its Automation finished could not be marked done", { taskId: link.taskId, reason: (e as { error?: { message?: string } } | null)?.error?.message ?? "it failed" });
    return [];
  }
}

/** A Journey task reached Done: the record's stage advances when its required tasks are all done. */
async function advanceOnTask(ctx: JourneysCtx, ev: Ev): Promise<string[]> {
  const source = ev.payload["source"] as { kind?: unknown; id?: unknown } | undefined;
  if (source?.kind !== "journey" || typeof source.id !== "string" || !ctx.call) return [];
  await ctx.call("journeys.advance", { recordId: source.id });
  return [source.id];
}

export const consumers = {
  "journeys.task_done_by_run": { on: ["run.succeeded"], run: doneByRun },
  "journeys.advance_on_task": { on: ["task.completed"], run: advanceOnTask },
};
