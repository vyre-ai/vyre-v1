// What a step was given in a test or a run, in a person's words (AUTOMATIONS-BUILD-RC29 round three, item 4): the first two fields of its form that hold something, under the form's own labels, with the real value.
// Never an id, never a schema key, never the sample a stand-in made up.
import { fieldsOf } from "../canvas/form-table.ts";
import { wordsOf } from "./insert-data.ts";

const isRec = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export function inputValues(
  key: string,
  input: unknown,
  nameOfId: (id: string) => string,
): readonly (readonly [string, string])[] {
  if (!isRec(input)) return [];
  const order = fieldsOf(key)?.map((f) => ({ name: f.name, label: f.label })) ?? Object.keys(input).map((k) => ({ name: k, label: wordsOf(k) ?? "" }));
  const out: (readonly [string, string])[] = [];
  for (const f of order) {
    const v = input[f.name];
    let text = "";
    if (typeof v === "string") text = /^[a-z]{2,6}_[0-9a-f]{8,}$/.test(v) ? nameOfId(v) : v.split("\n")[0]!;
    else if (typeof v === "number") text = String(v);
    else if (isRec(v) && typeof v["id"] === "string") text = nameOfId(v["id"]);
    text = text.trim();
    if (f.label === "" || text === "") continue;
    out.push([f.label, text.length > 60 ? `${text.slice(0, 60)}...` : text] as const);
    if (out.length === 2) break;
  }
  return out;
}
