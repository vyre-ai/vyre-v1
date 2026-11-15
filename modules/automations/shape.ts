// A value whose shape is wrong for its field is refused when the Automation is saved, in one sentence in a person's words (AUTOMATIONS-BUILD-RC29 round four, item 3): the walk found a bare id saved as "assigned",
// which saved without a word and then failed at run time with "Something in what you entered is not right." Pure: it reads the step catalogue's own input schema.
import { registry } from "../../generated/registry.ts";
import { missingInput } from "../../lib/words/step-missing.ts";
import type { Definition } from "./projections.ts";

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v);
const defs = ((registry as unknown as { $defs?: Record<string, unknown> }).$defs ?? {}) as Record<string, unknown>;

const resolve = (schema: unknown): Rec => {
  let s = schema;
  for (let i = 0; i < 4 && isRec(s) && typeof s["$ref"] === "string"; i++)
    s = defs[(s["$ref"] as string).replace("#/$defs/", "")];
  return isRec(s) ? s : {};
};
const kindOf = (schema: Rec): string => {
  const t = schema["type"];
  const name = Array.isArray(t) ? t.find((x) => x !== "null") : t;
  return typeof name === "string" ? name : "";
};
const STEPS = new Map<string, { title: string; input: Rec }>(
  registry.steps.map(
    (s) =>
      [s.key, { title: s.title.replace(/^[^:·]{1,40}\s*[:·]\s+/, ""), input: isRec(s.input) ? s.input : {} }] as const,
  ),
);

/** One sentence per step whose value is the wrong shape for its field: a person's words, the field named as the form names it. */
export function shapeIssues(def: Definition): { nodeId: string; message: string }[] {
  const out: { nodeId: string; message: string }[] = [];
  for (const n of def.nodes) {
    const step = STEPS.get(n.key);
    const props = isRec(step?.input["properties"]) ? (step!.input["properties"] as Rec) : null;
    if (!step || !props) continue;
    for (const [name, value] of Object.entries(n.input ?? {})) {
      if (props[name] === undefined || value === undefined || value === null) continue;
      const want = kindOf(resolve(props[name]));
      const templated = typeof value === "string" && /\{\{[^{}]*\}\}/.test(value);
      const wrong =
        !templated && ((want === "object" && typeof value === "string") || (want === "string" && isRec(value)));
      if (wrong) out.push({ nodeId: n.id, message: `${step.title}: ${missingInput(n.key, name).do}.` });
    }
  }
  return out;
}
