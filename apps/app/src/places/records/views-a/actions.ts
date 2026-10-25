// The writes of a board: a card dropped on a lane is one records.update on its lane field. The local copy takes the edit at once (the replica applies it before the server answers), so the card
// is in its new lane on the next frame; a refusal puts it back and the board says why.
import type { RecordsData } from "../sidebar/data.tsx";
import { laneOfRow, lanesOf, movePatch } from "./model.ts";
import type { FieldDef, Lane, RecordRow } from "./model.ts";

/** Moves a card to a lane. Does nothing when it is already there. Resolves with whether a write was made. */
export async function moveCard(data: RecordsData, type: string, field: FieldDef, row: RecordRow, to: Lane): Promise<boolean> {
  if (laneOfRow(field, row, lanesOf(field)).key === to.key) return false;
  await data.call("records.update", { type, recordId: row.id, patch: movePatch(field, to), baseVersion: row.version });
  return true;
}

/** The words for a move that was refused. */
export function moveError(e: unknown): string {
  const msg = e instanceof Error ? e.message : "";
  return msg ? `Could not move the card: ${msg}` : "Could not move the card.";
}
