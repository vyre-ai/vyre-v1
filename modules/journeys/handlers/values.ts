// Values a Journey carries from stage to stage for one record (rc.41). The Journey declares the keys; Automation steps read them as {{journey.plan}} and write them with the "Remember for the Journey" step.
// A record that is in no Journey has none: reading answers empty, writing is refused (there is nowhere to keep it).
import { findRecord, getJourney, getValues, me, putValue, raise } from "../projections.ts";
import type { JourneysCtx } from "../projections.ts";
import { refuseWhileMigrating } from "./stages.ts";

type In = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
/** The longest value one key keeps: a carried value is a small fact (a plan, a date, a name), not a document. */
export const VALUE_MAX = 4000;

export async function valuesGet(ctx: JourneysCtx, input: In): Promise<unknown> {
  const rec = findRecord(ctx.db, input.recordId);
  return { values: rec ? getValues(ctx.db, rec.recordId) : {} };
}

export async function valuesSet(ctx: JourneysCtx, input: In): Promise<unknown> {
  const rec = findRecord(ctx.db, input.recordId);
  if (!rec)
    raise(
      ctx,
      "validation.precondition_failed",
      "That record is not on a Journey, so there is nowhere to keep the value.",
      { reason: "not_on_journey" },
    );
  const j = getJourney(ctx, rec.journeyId);
  refuseWhileMigrating(ctx, j);
  const key = String(input.key);
  const declared = j.variables ?? [];
  if (!declared.some((v) => v.key === key))
    raise(
      ctx,
      "validation.precondition_failed",
      declared.length
        ? `${j.name} does not carry "${key}". It carries ${declared.map((v) => v.title).join(", ")}.`
        : `${j.name} does not carry any values yet.`,
      { reason: "not_declared", key },
    );
  const text = JSON.stringify(input.value ?? null);
  if (text.length > VALUE_MAX)
    raise(ctx, "validation.precondition_failed", `A carried value can be up to ${VALUE_MAX} characters.`, {
      reason: "too_long",
      key,
    });
  putValue(ctx.db, rec.recordId, key, input.value ?? null, ctx.now(), me(ctx));
  return { recordId: rec.recordId, key };
}
