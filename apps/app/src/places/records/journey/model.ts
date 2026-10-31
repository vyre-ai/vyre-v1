// Records > Journeys, the pure part. A Journey's records type is a record type in the Journeys group whose status field is the stage. Its default view is a board of the stages; a card moves
// through journeys.move_stage (the stage field is written only by the Journeys module, so records.update would be refused), and a new card is a subject record started into a stage.
import type { MenuEntry } from "../../../../../../ui/src/Menu/index.tsx";
import type { CapMap } from "../../../../../../generated/types.ts";
import type { FieldDef, RecordRow, TypeDef } from "../table/model.ts";

export const JOURNEYS_GROUP = "Journeys";
export type Call = (cap: string, input: unknown) => Promise<unknown>;

/** The stages of a Journey type as the record type holds them: option keys and titles, in order. */
export interface StageOption { key: string; title: string }

/** What a Journey board needs on top of an ordinary board: the stage field to run on, and the three things that differ (move, add, the lane menu). */
export interface JourneyBinding {
  journeyId: string;
  subjectType: string;
  field: FieldDef;
  /** Moves a record to a stage. Rejects with plain words. */
  move(row: RecordRow, stage: string): Promise<void>;
  /** The menu for "add a record at this stage": the subject records that are not in the Journey yet; choosing one starts it. A null stage is the first one. */
  addChoices(stage: string | null, done: (message: string | null) => void): Promise<MenuEntry[]>;
}

/** A Journey's record type: in the Journeys group, with a status field to run the stages on. */
export function isJourneyDef(def: Pick<TypeDef, "group" | "statusField" | "fields">): boolean {
  return def.group === JOURNEYS_GROUP && stageFieldOf(def) !== undefined;
}
export function stageFieldOf(def: Pick<TypeDef, "statusField" | "fields">): FieldDef | undefined {
  const f = def.fields.find((x) => x.key === (def.statusField ?? "stage"));
  return f && f.type === "status" ? f : undefined;
}

type ListOut = CapMap["journeys.list"]["out"];

/** The Journey that owns a record type, or null. */
export async function journeyOfType(call: Call, type: string): Promise<{ id: string; subjectType: string } | null> {
  const out = (await call("journeys.list", {})) as ListOut;
  const j = out.journeys.find((x) => x.recordType === type);
  return j ? { id: j.id, subjectType: j.subjectType } : null;
}

/** The words for a refusal on the board. */
export function moveWords(e: unknown): string {
  const msg = e instanceof Error ? e.message.toLowerCase() : "";
  if (/required task|tasks? (are|is) not done|exit/.test(msg)) return "Finish the required tasks in this stage first.";
  if (/permission|denied|forbidden|not allowed/.test(msg)) return "You do not have permission to move this record.";
  if (/duplicate|already/.test(msg)) return "That record is already in this Journey.";
  return "Could not move it. Try again.";
}

export async function moveInJourney(call: Call, journeyId: string, row: RecordRow, stage: string): Promise<boolean> {
  if (row.fields["stage"] === stage) return false;
  try { await call("journeys.move_stage", { journeyId, recordId: row.id, toStage: stage, reason: "Moved on the board" }); } catch (e) { throw new Error(moveWords(e)); }
  return true;
}

export async function startInJourney(call: Call, journeyId: string, subjectRecordId: string, stage: string): Promise<void> {
  try { await call("journeys.start", { journeyId, subjectRecordId, startStage: stage, idempotencyKey: `board-start-${journeyId}-${subjectRecordId}` }); } catch (e) { throw new Error(moveWords(e)); }
}

/** How many subject records the add menu offers. */
export const ADD_CHOICES = 30;

/** The title of a subject record: its type's title field. */
export async function subjectTitles(call: Call, subjectType: string): Promise<{ id: string; title: string }[]> {
  const d = (await call("schema.describe", { type: subjectType })) as CapMap["schema.describe"]["out"];
  const titleField = d.types.find((t) => t.key === subjectType)?.titleField ?? "name";
  const q = (await call("records.query", { type: subjectType, offset: 0, limit: ADD_CHOICES })) as CapMap["records.query"]["out"];
  return (q.rows as unknown as RecordRow[]).map((r) => ({ id: r.id, title: String(r.fields[titleField] ?? "") || "Untitled" }));
}
