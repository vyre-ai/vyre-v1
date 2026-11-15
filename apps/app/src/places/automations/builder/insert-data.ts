// What the trigger and each earlier step GIVE, by step, in words, with a sample value from the last real event at the right (AUTOMATIONS-BUILD-RC29 round three, item 1). The "Insert data" menu draws these;
// choosing one puts a chip in the field (stored as the engine's reference). Pure: no id, no schema key reaches a person.
export interface GiveRow {
  /** The reference the engine reads, without braces: "trigger.email" or "steps.find.out.email". */
  ref: string;
  /** The step that gives it, in its own words. */
  source: string;
  /** What it is, in words: "Email", "First name". */
  name: string;
  /** A sample from the last real event or the schema's own example; "" when there is none. */
  sample: string;
}

interface StepLike {
  id: string;
  key: string;
  title?: string;
}

const isRec = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Words for a field key: "firstName" is "First name"; an id is never offered by its key (the field it points at is named instead). */
export function wordsOf(key: string): string | null {
  if (/^id$/i.test(key) || /Ids?$/.test(key) || /_ids?$/.test(key)) return null;
  const w = key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_.-]+/g, " ")
    .trim()
    .toLowerCase();
  return w === "" ? null : w.charAt(0).toUpperCase() + w.slice(1);
}

const sampleOf = (v: unknown): string => {
  if (typeof v === "string") return v.length > 40 ? `${v.slice(0, 40)}...` : v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return "";
};

/** The properties of an output schema, with the example the schema gives for each. */
function schemaRows(schema: unknown): { key: string; sample: string }[] {
  if (!isRec(schema) || !isRec(schema["properties"])) return [];
  return Object.entries(schema["properties"]).map(([key, raw]) => {
    const ex = isRec(raw) && Array.isArray(raw["examples"]) ? raw["examples"][0] : undefined;
    return { key, sample: sampleOf(ex) };
  });
}

export function givenBy(input: {
  /** The trigger's own words ("A form is submitted"). */
  triggerTitle: string;
  /** The last real event's payload, or the trigger's own sample. */
  event: unknown;
  steps: readonly StepLike[];
  titleOf(step: StepLike): string;
  outputOf(key: string): unknown;
}): GiveRow[] {
  const rows: GiveRow[] = [];
  if (isRec(input.event))
    for (const [key, value] of Object.entries(input.event)) {
      const name = wordsOf(key);
      if (name === null) continue;
      rows.push({ ref: `trigger.${key}`, source: input.triggerTitle, name, sample: sampleOf(value) });
    }
  for (const st of input.steps)
    for (const { key, sample } of schemaRows(input.outputOf(st.key))) {
      const name = wordsOf(key);
      if (name === null) continue;
      rows.push({ ref: `steps.${st.id}.out.${key}`, source: input.titleOf(st), name, sample });
    }
  return rows;
}
