// Moving in-flight records to another version of a Journey (spec 2.12, ARCH 7.7). Records stay on the version they started on; a migration moves them through a stage mapping that is
// previewed first: every in-flight record has a destination or the migration is refused.
// DECISION: a stage with the same key in the new version is mapped to itself unless the mapping says otherwise; a mapping cannot point into a final stage (finish those records instead).
// DECISION: a migration is a Run of kind journey_migrate. It moves records one at a time and looks at the Run between records, so a stop ends it cleanly and the records already moved stay moved.
import { byOrder, clean, emitJ, getJourney, inFlight, me, raise, saveRecord, stagesOf } from "../projections.ts";
import type { Journey, JourneysCtx, JRecord, Stage } from "../projections.ts";
import { moveTo } from "./stages.ts";

type In = Record<string, any>;   // eslint-disable-line @typescript-eslint/no-explicit-any

export interface Plan {
  fromVersion: number; toVersion: number; affected: JRecord[]; toStages: Stage[] | undefined;
  moves: { from: string; to: string | null; records: number }[]; unmapped: string[]; blockers: string[];
}

export function planMigration(ctx: JourneysCtx, j: Journey, toVersion: number, stageMap: Record<string, string> | undefined, recordIds?: readonly string[]): Plan {
  const map = stageMap ?? {};
  const blockers: string[] = [];
  const toStages = toVersion > j.version ? undefined : stagesOf(ctx.db, j, toVersion);
  if (!toStages) blockers.push(`Version ${toVersion} of this Journey does not exist.`);
  const all = inFlight(ctx.db, j.id);
  if (recordIds) {
    const known = new Set(all.map((r) => r.recordId));
    for (const id of recordIds) if (!known.has(id)) blockers.push(`${id} is not an in-flight record of this Journey.`);
  }
  const affected = all.filter((r) => r.version !== toVersion && (!recordIds || recordIds.includes(r.recordId)));
  const keys = new Set((toStages ?? []).map((s) => s.key));
  const finals = new Set((toStages ?? []).filter((s) => s.final).map((s) => s.key));
  const counts = new Map<string, number>();
  for (const r of affected) counts.set(r.stage, (counts.get(r.stage) ?? 0) + 1);
  const moves: Plan["moves"] = [];
  const unmapped: string[] = [];
  for (const [from, records] of [...counts.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const to = map[from] ?? (keys.has(from) ? from : null);
    moves.push({ from, to, records });
    if (to === null) unmapped.push(from);
    else if (toStages && !keys.has(to)) blockers.push(`Stage ${from} maps to ${to}, which version ${toVersion} does not have.`);
    else if (finals.has(to)) blockers.push(`Stage ${from} maps to ${to}, the last stage. Finish those records instead.`);
  }
  const fromVersion = affected.length ? Math.min(...affected.map((r) => r.version)) : toVersion;
  return { fromVersion, toVersion, affected, toStages, moves, unmapped, blockers };
}

export async function previewMigrate(ctx: JourneysCtx, input: In): Promise<unknown> {
  const j = getJourney(ctx, input.journeyId);
  const p = planMigration(ctx, j, input.toVersion, input.stageMap);
  return { fromVersion: p.fromVersion, toVersion: p.toVersion, recordsAffected: p.affected.length, moves: p.moves, unmapped: p.unmapped, blockers: p.blockers };
}

export async function migrate(ctx: JourneysCtx, input: In): Promise<unknown> {
  const j = getJourney(ctx, input.journeyId);
  const p = planMigration(ctx, j, input.toVersion, input.stageMap, input.recordIds);
  if (p.blockers.length) raise(ctx, "validation.precondition_failed", p.blockers[0]!, { reason: "blocked", blockers: p.blockers });
  if (p.unmapped.length) raise(ctx, "validation.precondition_failed", `Map ${p.unmapped.join(", ")} to a stage of version ${input.toVersion} first.`, { reason: "unmapped", stages: p.unmapped });
  if (p.affected.length === 0) raise(ctx, "validation.precondition_failed", "No in-flight record needs to move.", { reason: "nothing_to_migrate" });
  if (!ctx.call) raise(ctx, "internal.unavailable", "Runs are not available right now.");
  const toStages = byOrder(p.toStages!);
  const dest = new Map(p.moves.map((m) => [m.from, m.to!] as const));
  const started = (await ctx.call("runs.start", {
    kind: "journey_migrate", name: `Move ${j.name} to version ${input.toVersion}`, owner: me(ctx), subject: { type: "record_type", id: j.recordType }, definitionVersion: input.toVersion,
    idempotencyKey: `jrn-mig:${j.id}:${input.toVersion}:${ctx.now()}:${p.affected.length}`,
  })) as { runId: string };
  let moved = 0;
  let failure: { code: string; message: string } | undefined;
  for (const rec of p.affected) {
    const run = (await ctx.call("runs.get", { runId: started.runId }).catch(() => undefined)) as { run?: { status?: string } } | undefined;
    if (run?.run?.status === "stopped") break;
    const to = toStages.find((s) => s.key === dest.get(rec.stage))!;
    const onNew: JRecord = { ...rec, version: input.toVersion };
    try {
      if (to.key === rec.stage) saveRecord(ctx.db, onNew);
      else await moveTo(ctx, j, onNew, to, { manual: false, reason: `Migrated to version ${input.toVersion}`, stages: toStages });
      moved += 1;
    } catch (e) {
      // a record that cannot move ends the Run as failed (it lands in the owner's Needs you); the records already moved stay moved and are reported
      const er = (e as { error?: { code?: string; message?: string } } | null)?.error;
      failure = { code: er?.code ?? "migrate.failed", message: `${rec.recordId}: ${er?.message ?? (e as Error).message ?? "it could not be moved."}` };
      break;
    }
  }
  if (moved > 0) emitJ(ctx, "journey.migrated", `entity/${j.id}`, { journeyId: j.id, fromVersion: p.fromVersion, toVersion: input.toVersion, records: moved, runId: started.runId });
  const end = failure
    ? { runId: started.runId, status: "failed", error: failure }
    : clean({ runId: started.runId, status: "succeeded", summary: `${moved} record${moved === 1 ? "" : "s"} moved to version ${input.toVersion}` });
  await ctx.call("runs.finish", end).catch(() => undefined);
  return { runId: started.runId };
}
