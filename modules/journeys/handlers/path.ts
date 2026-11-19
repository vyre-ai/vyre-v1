// Reading and trying a Journey as a path (rc.41): where one record is on it, and a test of the whole path on one record. Neither changes a record.
import { byOrder, findRecord, getJourney, HOUR, raise, stagesOf } from "../projections.ts";
import type { JourneysCtx } from "../projections.ts";

type In = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const message = (e: unknown): string =>
  (e as { error?: { message?: string } } | null)?.error?.message ?? (e instanceof Error ? e.message : "it failed");

/** Where a record is on its Journey: the path with the stage it is in, how long it has been there against the stage's limit, and the Automations of each stage. */
export async function where(ctx: JourneysCtx, input: In): Promise<unknown> {
  const j = getJourney(ctx, input.journeyId);
  const rec = findRecord(ctx.db, input.recordId);
  if (!rec || rec.journeyId !== j.id) raise(ctx, "permission.not_found", "That record is not on this Journey.");
  const stages = byOrder(stagesOf(ctx.db, j, rec.version) ?? j.stages);
  const here = stages.findIndex((s) => s.key === rec.stage);
  const cur = stages[here];
  const hoursIn = Math.max(0, Math.floor((ctx.now() - rec.enteredAt) / HOUR));
  const limit = cur?.timeLimit;
  return {
    journeyId: j.id,
    recordId: rec.recordId,
    stage: rec.stage,
    stageTitle: cur?.title ?? rec.stage,
    enteredAt: rec.enteredAt,
    hoursIn,
    completed: rec.completedAt !== undefined,
    ...(limit ? { limitHours: limit.hours, overByHours: Math.max(0, hoursIn - limit.hours) } : {}),
    ...(limit?.escalateTo ? { thenAsks: limit.escalateTo } : {}),
    path: stages.map((s, i) => ({
      key: s.key,
      title: s.title,
      state: i < here ? "done" : i === here ? "here" : "next",
      final: s.final === true,
      automations: s.automations,
    })),
  };
}

/**
 * Try the whole path on one record: each stage's Automations, in stage order, as a test (reads run, sends and writes are held), so a person sees where the path would stop before it runs for real.
 * A test that cannot start is reported on its own line and does not stop the others.
 */
export async function testPath(ctx: JourneysCtx, input: In): Promise<unknown> {
  const j = getJourney(ctx, input.journeyId);
  if (!ctx.call) raise(ctx, "internal.unavailable", "Automations are not available right now.");
  const runs: { stage: string; automationId: string; runId?: string; error?: string }[] = [];
  for (const s of byOrder(j.stages))
    for (const automationId of s.automations) {
      try {
        const r = (await ctx.call("automations.test", {
          automationId,
          ...(typeof input.recordId === "string" ? { recordId: input.recordId, recordType: j.recordType } : {}),
        })) as { runId?: string };
        runs.push(
          r?.runId
            ? { stage: s.key, automationId, runId: r.runId }
            : { stage: s.key, automationId, error: "It did not start." },
        );
      } catch (e) {
        runs.push({ stage: s.key, automationId, error: message(e) });
      }
    }
  return { runs };
}
