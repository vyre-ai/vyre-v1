// engine.time_convert: a time between zones, so a model never does the arithmetic (owner, 4 Nov: the Assistant got "Thursday 5 Nov 2pm PST" wrong by a day working from epoch numbers).
// lib/time-convert.ts does the work. The person's zone is their profile.timezone; day words ("tomorrow") count from their now, the clock time is in the zone it was given in.
import { convert } from "../../../lib/time-convert.ts";
import type { EngineCtx } from "../projections.ts";

export async function timeConvert(ctx: EngineCtx, input: { when: string; from?: string; to?: string[]; zone?: string }): Promise<Record<string, unknown>> {
  let person = input.zone;
  if (!person) {
    const row = await (ctx.call("settings.get", { key: "profile.timezone" }) as Promise<{ row?: { value?: unknown } }>).then((r) => r.row?.value, () => undefined);
    person = typeof row === "string" && row !== "" ? row : "UTC";
  }
  try {
    const c = convert({ when: input.when, ...(input.from ? { from: input.from } : {}), to: input.to ?? [], person, now: ctx.now() });
    return { instant: c.instantIso, given: c.given, ...(c.zones.length > 0 ? { zones: c.zones } : {}), inYourZone: c.person, personZone: person, ...(c.note ? { note: c.note } : {}) };
  } catch (e) {
    const message = e instanceof Error ? e.message : "That time could not be read.";
    const err = new Error(message) as Error & { code?: string };
    err.code = "validation.bad_input";
    throw err;
  }
}
