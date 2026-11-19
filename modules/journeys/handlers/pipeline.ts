// Moving a Journey onto a pipeline (rc.41): the records of the subject type carry the stage themselves, and the per-subject Journey records are folded into them.
// The model is an explicit state machine, so a stop at any point resumes and nothing is lost:
//   Journey:  subject --journeys.to_pipeline--> migrating --(every record done)--> pipeline
//   a record: planned -> wrote_stage -> moved_links -> done          (a failure in any step makes it `failed`; the next call starts it again from planned)
// Every step of a record can run twice with the same result: the stage field is set to a value, the links are re-filed by id, the Journey record row changes its id in one statement.
// While the Journey is `migrating` nothing moves, starts or advances it (refuseWhileMigrating), so no change lands on a record that was already copied.
// Nothing is deleted: the old record type, its records, their channels and folders stay where they were. A moved record remembers its old id (legacyRecordId), and the Journey the old type.
import {
  allJourneys,
  clean,
  emitJ,
  findRecord,
  getJourney,
  inFlight,
  me,
  migrationRows,
  out,
  pipelineOfType,
  raise,
  refileLinks,
  saveJourney,
  saveMigration,
  saveRecord,
  countInFlight,
} from "../projections.ts";
import type { Journey, JourneysCtx, MigrationRow } from "../projections.ts";
import { bindStageField, stageFieldOf } from "./stages.ts";

type In = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const plural = (n: number, w: string): string => `${n} ${w}${n === 1 ? "" : "s"}`;
const message = (e: unknown): string =>
  (e as { error?: { message?: string } } | null)?.error?.message ?? (e instanceof Error ? e.message : "it failed");

/** The rows of every Journey record, old ones included: a finished Journey record moves too, so the board shows where the work ended. */
function allOf(ctx: JourneysCtx, j: Journey): { recordId: string; subjectRecordId: string }[] {
  const rows = (
    ctx.db.all(
      "SELECT record_id, subject_record_id FROM journeys_records WHERE journey_id = ? ORDER BY record_id",
      j.id,
    ) as {
      record_id: string;
      subject_record_id: string;
    }[]
  ).map((r) => ({ recordId: r.record_id, subjectRecordId: r.subject_record_id }));
  return rows;
}

function stateOf(rows: readonly MigrationRow[]): {
  total: number;
  done: number;
  failed: { recordId: string; error: string }[];
} {
  return {
    total: rows.length,
    done: rows.filter((r) => r.state === "done").length,
    failed: rows
      .filter((r) => r.state === "failed")
      .map((r) => ({ recordId: r.legacyRecordId, error: r.error ?? "it failed" })),
  };
}

/** Journeys a run is stepping now: a Retry and the background tick never step the same Journey at once. */
const RUNNING = new Set<string>();

export async function toPipeline(ctx: JourneysCtx, input: In): Promise<unknown> {
  const j = getJourney(ctx, input.journeyId);
  if (RUNNING.has(j.id))
    return { journey: out(j, countInFlight(ctx.db, j.id)), ...stateOf(migrationRows(ctx.db, j.id)), finished: false };
  RUNNING.add(j.id);
  try {
    return await toPipelineNow(ctx, input, j);
  } finally {
    RUNNING.delete(j.id);
  }
}

async function toPipelineNow(ctx: JourneysCtx, input: In, j: Journey): Promise<unknown> {
  if (j.mode === "pipeline")
    return { journey: out(j, countInFlight(ctx.db, j.id)), ...stateOf(migrationRows(ctx.db, j.id)), finished: true };
  const other = pipelineOfType(ctx.db, j.subjectType);
  if (other && other.id !== j.id)
    raise(ctx, "validation.duplicate", `${other.name} already runs this record type.`, {
      reason: "type_has_journey",
      recordType: j.subjectType,
    });
  if (!ctx.call) raise(ctx, "internal.unavailable", "Records are not available right now.");
  const subjectType = j.subjectType;
  const oldType = j.legacyType ?? j.recordType;
  // plan: one migration row per Journey record, once (a resumed run keeps the rows and their states)
  if (j.mode !== "migrating") {
    const field =
      typeof input.stageField === "string" && input.stageField ? input.stageField : (j.stageField ?? "journey_stage");
    const next: Journey = { ...j, stageField: field };
    // the stage field is bound first: if that is refused nothing has changed
    await bindStageField(ctx, { ...next, recordType: subjectType }, { useExisting: input.useExisting === true });
    j.stageField = field;
    j.mode = "migrating";
    j.legacyType = oldType;
    j.updatedAt = ctx.now();
    saveJourney(ctx.db, j);
  }
  const have = new Map(migrationRows(ctx.db, j.id).map((m) => [m.legacyRecordId, m]));
  for (const r of allOf(ctx, j))
    if (!have.has(r.recordId) && !findRecord(ctx.db, r.subjectRecordId)?.legacyRecordId)
      saveMigration(ctx.db, {
        journeyId: j.id,
        legacyRecordId: r.recordId,
        subjectRecordId: r.subjectRecordId,
        state: "planned",
        at: ctx.now(),
      });
  for (const m of migrationRows(ctx.db, j.id)) await step(ctx, j, m);
  const rows = migrationRows(ctx.db, j.id);
  const st = stateOf(rows);
  const finished = st.failed.length === 0 && rows.every((r) => r.state === "done");
  if (!finished && st.failed.length > 0) {
    // records that did not move are tried again by the next tick; after MAX_TRIES in a row the reason is kept and the Journey waits for Retry
    j.migrateTries = (j.migrateTries ?? 0) + 1;
    if (j.migrateTries >= MAX_TRIES)
      j.migrateNote = `${plural(st.failed.length, "record")} could not be moved: ${st.failed[0]!.error}`;
    saveJourney(ctx.db, j);
  }
  if (finished) {
    delete j.migrateNote;
    delete j.migrateTries;
    j.mode = "pipeline";
    j.recordType = subjectType;
    j.updatedAt = ctx.now();
    saveJourney(ctx.db, j);
    emitJ(ctx, "journey.designed", `entity/${j.id}`, {
      journeyId: j.id,
      version: j.version,
      stages: j.stages.map((s) => s.key),
      by: me(ctx),
    });
  }
  return { journey: out(j, countInFlight(ctx.db, j.id)), ...st, finished };
}

/** Advance one record as far as it goes; a failure is kept on its row and does not stop the others. */
async function step(ctx: JourneysCtx, j: Journey, m: MigrationRow): Promise<void> {
  let cur: MigrationRow = m.state === "failed" ? { ...m, state: "planned" } : m;
  const keep = (state: MigrationRow["state"], error?: string): void => {
    cur = clean({ ...cur, state, error, at: ctx.now() }) as MigrationRow;
    if (error === undefined) delete (cur as { error?: string }).error;
    saveMigration(ctx.db, cur);
  };
  try {
    if (cur.state === "planned") {
      const old = findRecord(ctx.db, cur.legacyRecordId);
      // already folded in by a run that stopped before it wrote the row: the record under the subject's id says which Journey record it replaced
      const moved = findRecord(ctx.db, cur.subjectRecordId);
      if (!old && moved?.legacyRecordId === cur.legacyRecordId) return keep("done");
      if (!old) throw new Error("The Journey record is gone.");
      await ctx.call!("records.update", {
        type: j.subjectType,
        recordId: cur.subjectRecordId,
        patch: { [stageFieldOf(j)]: old.stage },
        // a system move: no Automation starts for it, however many listen for a record change
        quiet: true,
      });
      keep("wrote_stage");
    }
    if (cur.state === "wrote_stage") {
      refileLinks(ctx.db, cur.legacyRecordId, cur.subjectRecordId);
      keep("moved_links");
    }
    if (cur.state === "moved_links") {
      const old = findRecord(ctx.db, cur.legacyRecordId);
      if (old) {
        const clash = findRecord(ctx.db, cur.subjectRecordId);
        if (clash && clash.recordId !== cur.legacyRecordId) throw new Error("The record is already in a Journey.");
        // one statement: the row changes its id and remembers the old one
        ctx.db.run(
          "UPDATE journeys_records SET record_id = ?, legacy_record_id = ? WHERE record_id = ?",
          cur.subjectRecordId,
          cur.legacyRecordId,
          cur.legacyRecordId,
        );
      }
      keep("done");
    }
  } catch (e) {
    keep("failed", message(e));
  }
}

/** Where a move onto the pipeline stands: how many records are done and which failed and why. */
export async function migrationState(ctx: JourneysCtx, input: In): Promise<unknown> {
  const j = getJourney(ctx, input.journeyId);
  const rows = migrationRows(ctx.db, j.id);
  const counts: Record<string, number> = {};
  for (const r of rows) counts[r.state] = (counts[r.state] ?? 0) + 1;
  return {
    mode: j.mode ?? "subject",
    ...stateOf(rows),
    states: counts,
    pending: j.mode === "migrating" ? inFlight(ctx.db, j.id).length : 0,
  };
}

/**
 * The records a type already had when it became a pipeline: each one whose stage field holds one of the Journey's stages takes its place in the Journey where it stands, a page at a time.
 * Nothing is run for them (no tasks, no Automations, no events): they were already there. A record that is enrolled is skipped, so a page can be run again and a stop loses nothing.
 */
export async function adopt(ctx: JourneysCtx, input: In): Promise<unknown> {
  const j = getJourney(ctx, input.journeyId);
  if (j.mode !== "pipeline")
    raise(ctx, "validation.precondition_failed", `${j.name} is not a pipeline yet.`, { reason: "not_a_pipeline" });
  if (!ctx.call) raise(ctx, "internal.unavailable", "Records are not available right now.");
  const page = (await ctx.call("records.query", {
    type: j.recordType,
    ...(typeof input.cursor === "string" ? { cursor: input.cursor } : {}),
    limit: typeof input.limit === "number" ? input.limit : 200,
  })) as { rows?: { id: string; fields?: Record<string, unknown> }[]; next?: string };
  const keys = new Map(j.stages.map((s) => [s.key, s]));
  const field = stageFieldOf(j);
  const now = ctx.now();
  let adopted = 0;
  let skipped = 0;
  for (const row of page.rows ?? []) {
    const v = row.fields?.[field];
    const stage = typeof v === "string" ? keys.get(v) : undefined;
    if (!stage || findRecord(ctx.db, row.id)) {
      skipped += 1;
      continue;
    }
    saveRecord(ctx.db, {
      recordId: row.id,
      journeyId: j.id,
      subjectRecordId: row.id,
      version: j.version,
      stage: stage.key,
      startStage: stage.key,
      enteredAt: now,
      ...(stage.final ? { completedAt: now } : {}),
      ownerId: me(ctx),
      startKey: `adopt:${j.id}:${row.id}`,
      startedAt: now,
    });
    adopted += 1;
  }
  return { adopted, skipped, ...(page.next ? { next: page.next } : {}) };
}

/**
 * After an upgrade nobody presses anything: every minute this takes the next Journey still on the old model and moves it onto its subject type, one Journey at a time, and the next minute the next.
 * A Journey that cannot be moved (its type already has a Journey, or some records would not move) keeps the reason in `migrateNote` and is left alone until a person presses Retry in Console,
 * which is journeys.to_pipeline itself. A stop between ticks loses nothing: a Journey that is `migrating` is picked up again from its journal.
 */
export async function autoPipeline(ctx: JourneysCtx): Promise<string[]> {
  if (!ctx.call) return [];
  const todo = allJourneys(ctx.db)
    .filter((j) => (j.mode ?? "subject") !== "pipeline" && j.migrateNote === undefined)
    .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))[0];
  if (!todo) return [];
  try {
    await ctx.call("journeys.to_pipeline", { journeyId: todo.id });
  } catch (e) {
    const j = getJourney(ctx, todo.id);
    const code = (e as { error?: { code?: string } } | null)?.error?.code ?? "";
    // a refusal that will not change by itself (the type already has a Journey, the field does not fit) is kept at once; a failure that may pass (the records module was busy) is tried again, five ticks in a row
    if (code.startsWith("validation.")) j.migrateNote = message(e);
    else {
      j.migrateTries = (j.migrateTries ?? 0) + 1;
      if (j.migrateTries >= MAX_TRIES) j.migrateNote = `${message(e)} (tried ${MAX_TRIES} times)`;
    }
    saveJourney(ctx.db, j);
  }
  return [todo.id];
}
/** Ticks in a row a Journey's move may fail for a reason that may pass before it waits for Retry. */
export const MAX_TRIES = 5;
