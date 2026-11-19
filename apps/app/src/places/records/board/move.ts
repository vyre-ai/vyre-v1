// The one call a board makes to move a card: through the Journeys module when the type is a Journey's (it holds the stage gates), by writing the lane field otherwise. It resolves when the
// card is in its new lane, and rejects with a GateError (the stage wants fields) or an Error whose message is the plain reason.
import type { RecordsData } from "../sidebar/data.tsx";
import { GateError, gateOf, moveInJourney } from "../journey/model.ts";
import type { JourneyBinding } from "../journey/model.ts";
import { laneOfRow, lanesOf, movePatch } from "../views-a/model.ts";
import { moveError } from "../views-a/actions.ts";
import type { FieldDef, Lane, RecordRow } from "../views-a/model.ts";

export { GateError };

/** The card changed after the copy this person held was made: someone moved it (to `stage`), or edited it. */
export class StaleError extends Error {
  readonly kind: "moved" | "changed";
  readonly stage: string;
  constructor(kind: "moved" | "changed", stage: string) {
    super(kind === "moved" ? "It was moved first." : "It changed first. Look at the card and try again.");
    this.name = "StaleError";
    this.kind = kind;
    this.stage = stage;
  }
}

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
    // a Journey move carries no version of its own, so the card is read first: newer than the copy held means someone got there first
    const fresh = await data
      .call("records.get", { type, recordId: row.id })
      .then((o) => (o as { record?: RecordRow }).record ?? null)
      .catch(() => null);
    if (fresh && fresh.version !== version) {
      const now = laneOfRow(field, fresh, lanesOf(field)).key;
      const was = laneOfRow(field, row, lanesOf(field)).key;
      throw new StaleError(now !== was && now !== to.key ? "moved" : "changed", now);
    }
    return moveInJourney(data.call, journey.journeyId, row, to.key);
  }
  if (laneOfRow(field, row, lanesOf(field)).key === to.key) return false;
  try {
    await data.call("records.update", {
      type,
      recordId: row.id,
      patch: movePatch(field, to),
      baseVersion: row.version,
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
