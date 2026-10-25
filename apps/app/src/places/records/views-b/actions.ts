// The writes of the views of part B. A record dropped on a day, or a bar moved on the timeline, is one records.update of its date fields. A task of a project goes through projects.reschedule
// instead, and when the move makes later tasks slip the plan answers with a cascade: the tasks that would move, ready to Apply or to Keep dates.
import type { RecordsData } from "../sidebar/data.tsx";
import { datePatch, projectIdOf } from "./model.ts";
import type { Cascade, FieldDef, Range, RecordRow, TypeDef } from "./model.ts";

/** Writes new values for some of a record's fields. */
export async function patchRecord(data: RecordsData, type: string, row: RecordRow, patch: Record<string, unknown>): Promise<void> {
  await data.call("records.update", { type, recordId: row.id, patch, baseVersion: row.version });
}

/** Drops a record on a day: its date field takes that day. */
export async function dropRecord(data: RecordsData, type: string, row: RecordRow, field: FieldDef, ms: number): Promise<void> {
  await patchRecord(data, type, row, { [field.key]: ms });
}

export interface Moved { cascade: Cascade | null; projectId: string | null }

/** Moves a bar to new dates. Records of a project are rescheduled through the plan, which may propose a cascade; the rest are updated in place. */
export async function moveBar(data: RecordsData, def: TypeDef, range: Range, row: RecordRow, next: { start: number; end: number }): Promise<Moved> {
  const patch = datePatch(range, row, next);
  const projectId = projectIdOf(def, row);
  if (!projectId) {
    await patchRecord(data, def.key, row, patch);
    return { cascade: null, projectId: null };
  }
  const start = patch[range.start.key] as number;
  const due = range.end ? (patch[range.end.key] as number) : undefined;
  const out = (await data.call("projects.reschedule", { projectId, taskId: row.id, start, ...(due !== undefined ? { due } : {}) })) as { proposalId?: string };
  if (!out.proposalId) return { cascade: null, projectId };
  const cascade = (await data.call("projects.cascade", { projectId, taskId: row.id, start, ...(due !== undefined ? { due } : {}) })) as Cascade;
  return { cascade: cascade.moves.length > 0 ? cascade : null, projectId };
}

/** Apply moves the later tasks; Keep dates leaves them where they are. Resolves with how many moved. */
export async function decideCascade(data: RecordsData, projectId: string, cascade: Cascade, decision: "apply" | "keep"): Promise<number> {
  const out = (await data.call("projects.apply_cascade", { projectId, proposalId: cascade.proposalId, decision, idempotencyKey: `cascade-${cascade.proposalId}-${decision}` })) as { moved: number };
  return out.moved;
}

/** The words for a move that was refused. */
export function moveError(e: unknown): string {
  const msg = e instanceof Error ? e.message : "";
  return msg ? `Could not change the dates: ${msg}` : "Could not change the dates.";
}
