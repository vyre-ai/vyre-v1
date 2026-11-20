// The one call a board makes to move a card: through the Journeys module when the type is a Journey's (it holds the stage gates), by writing the lane field otherwise. It resolves when the
// card is in its new lane, and rejects with a GateError (the stage wants fields) or an Error whose message is the plain reason.
import type { RecordsData } from "../sidebar/data.tsx";
import { GateError, gateOf, moveInJourney } from "../journey/model.ts";
import type { JourneyBinding } from "../journey/model.ts";
import { laneOfRow, lanesOf, movePatch } from "../views-a/model.ts";
import { moveError } from "../views-a/actions.ts";
import type { FieldDef, Lane, RecordRow } from "../views-a/model.ts";

export { GateError };

/** Moves one card. `false` when it was already in that lane (nothing was written). `version` is the version of the card this person was looking at; a card that is newer is refused. */
export async function performMove(
  data: RecordsData,
  type: string,
  field: FieldDef,
  journey: JourneyBinding | undefined,
  row: RecordRow,
  to: Lane,
  version: number = row.version,
): Promise<boolean> {
  if (journey) {
    if (to.none) return false;
    // the Journey refuses a card that is newer than the one this person was looking at, and writes nothing
    return moveInJourney(data.call, journey.journeyId, row, to.key, version);
  }
  if (laneOfRow(field, row, lanesOf(field)).key === to.key) return false;
  try {
    await data.call("records.update", {
      type,
      recordId: row.id,
      patch: movePatch(field, to),
      baseVersion: version,
    });
  } catch (e) {
    throw gateOf(e) ?? new Error(moveError(e));
  }
  return true;
}

/** The plain words of whatever a move threw. */
export function reasonOf(e: unknown): string {
  return e instanceof Error && e.message ? e.message : "Could not move it. Try again.";
}
