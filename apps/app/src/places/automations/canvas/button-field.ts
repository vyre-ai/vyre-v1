// A button trigger starts when someone presses a Button field on a record, so the record type must have one (r40 audit, gap 6). These are the two questions the Flow builder asks about that:
// does the type have a Button field, and what schema change adds one that runs this Flow. Pure.
import { fieldKeyFor } from "../journeys/model.ts";

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v);

/** What schema.describe says about one type: its Button fields (key and the Automation each runs). */
export function buttonFieldsOf(described: unknown): { key: string; automation?: string }[] {
  const types = isRec(described) && Array.isArray(described["types"]) ? described["types"] : [];
  const fields = isRec(types[0]) && Array.isArray(types[0]["fields"]) ? (types[0]["fields"] as unknown[]) : [];
  return fields.flatMap((f) => {
    if (!isRec(f) || f["type"] !== "button" || typeof f["key"] !== "string") return [];
    const automation =
      isRec(f["options"]) && typeof f["options"]["automation"] === "string" ? f["options"]["automation"] : undefined;
    return [{ key: f["key"], ...(automation ? { automation } : {}) }];
  });
}

/** The keys of every field of the type, so a new one does not take a name that is in use. */
export function fieldKeysOf(described: unknown): string[] {
  const types = isRec(described) && Array.isArray(described["types"]) ? described["types"] : [];
  const fields = isRec(types[0]) && Array.isArray(types[0]["fields"]) ? (types[0]["fields"] as unknown[]) : [];
  return fields.flatMap((f) => (isRec(f) && typeof f["key"] === "string" ? [f["key"]] : []));
}

/** The change that adds a Button field to the type, running this Flow when pressed. */
export function addButtonOps(
  type: string,
  title: string,
  taken: readonly string[],
  automationId?: string,
): { ops: Rec[]; key: string } {
  const key = fieldKeyFor(title, taken) || "run_flow";
  const options: Rec = { label: title, ...(automationId ? { automation: automationId } : {}) };
  return {
    key,
    ops: [{ op: "field.add", type, field: key, def: { title, type: "button", required: false, options } }],
  };
}
