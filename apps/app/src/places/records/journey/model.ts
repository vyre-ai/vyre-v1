// Records > Journeys, the pure part. A Journey's records type is a record type in the Journeys group whose status field is the stage. Its default view is a board of the stages; a card moves
// through journeys.move_stage (the stage field is written only by the Journeys module, so records.update would be refused), and a new card is a subject record started into a stage.
import type { MenuEntry } from "../../../../../../ui/src/Menu/index.tsx";
import type { CapMap } from "../../../../../../generated/types.ts";
import type { FieldDef, RecordRow, TypeDef } from "../table/model.ts";
import { editKind, parseInput } from "../recordpage/model.ts";

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

/** A field a stage is waiting on before a record may move. */
export interface MissingField { key: string; title: string; stage: string; when: "enter" | "leave" }

/** The refusal of a move that is waiting on fields. It carries the list, so a sheet can ask for exactly those. */
export class GateError extends Error {
  readonly missing: readonly MissingField[];
  readonly toStage: string;
  constructor(missing: readonly MissingField[], toStage: string) {
    super(`Fill these first: ${missing.map((m) => m.title).join(", ")}.`);
    this.name = "GateError";
    this.missing = missing;
    this.toStage = toStage;
  }
}

/** The fields a refusal names, from the error the gateway throws (details on it or under `error`), or null when the refusal is about something else. */
export function gateOf(e: unknown): GateError | null {
  if (e instanceof GateError) return e;
  const x = e as { details?: Record<string, unknown>; error?: { details?: Record<string, unknown> } } | null | undefined;
  const d = x?.details ?? x?.error?.details;
  if (!d || d["reason"] !== "fields_required" || !Array.isArray(d["fields"])) return null;
  const missing = (d["fields"] as Partial<MissingField>[]).filter((m) => typeof m.key === "string").map((m) => ({ key: m.key!, title: m.title ?? m.key!, stage: m.stage ?? "", when: m.when === "leave" ? "leave" as const : "enter" as const }));
  return missing.length > 0 ? new GateError(missing, typeof d["toStage"] === "string" ? d["toStage"] : "") : null;
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
  try { await call("journeys.move_stage", { journeyId, recordId: row.id, toStage: stage, reason: "Moved on the board" }); } catch (e) { throw gateOf(e) ?? new Error(moveWords(e)); }
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

// ---------------------------------------------------------------- gates: fill what is missing, then move

export type Entered = Record<string, string | boolean>;
export type FillResult = { ok: true } | { ok: false; message: string; missing?: readonly MissingField[] };

/** The value a typed answer becomes for one field, or the words for what is wrong with it. Empty is not an answer. */
function answerOf(f: FieldDef, got: string | boolean | undefined): { ok: true; value: unknown } | { ok: false; message: string } {
  if (editKind(f) === "checkbox") return typeof got === "boolean" ? { ok: true, value: got } : { ok: false, message: `${f.title}: choose Yes or No.` };
  const text = typeof got === "string" ? got : "";
  if (text.trim() === "") return { ok: false, message: `${f.title} needs an answer.` };
  const parsed = parseInput(f, text);
  return parsed.ok ? { ok: true, value: parsed.value } : { ok: false, message: parsed.message };
}

/**
 * Write the answers to the record, then ask for the move again: one step for the person. Nothing is written when any answer is missing or wrong. If the stage wants more than was asked
 * (a field filled by someone since, or a second gate), the new list comes back for the sheet to show.
 */
export async function fillAndMove(call: Call, o: { journeyId: string; type: string; row: RecordRow; def: Pick<TypeDef, "fields">; missing: readonly MissingField[]; entered: Entered; toStage: string }): Promise<FillResult> {
  const patch: Record<string, unknown> = {};
  for (const m of o.missing) {
    const f = o.def.fields.find((x) => x.key === m.key);
    if (!f) return { ok: false, message: `${m.title} is not a field of this record.` };
    const a = answerOf(f, o.entered[m.key]);
    if (!a.ok) return { ok: false, message: a.message };
    patch[m.key] = a.value;
  }
  try {
    await call("records.update", { type: o.type, recordId: o.row.id, patch, baseVersion: o.row.version });
  } catch (e) { return { ok: false, message: e instanceof Error && e.message ? e.message : "Could not save those fields." }; }
  try {
    await call("journeys.move_stage", { journeyId: o.journeyId, recordId: o.row.id, toStage: o.toStage, reason: "Moved after filling the required fields" });
  } catch (e) {
    const gate = gateOf(e);
    return gate ? { ok: false, message: gate.message, missing: gate.missing } : { ok: false, message: moveWords(e) };
  }
  return { ok: true };
}
