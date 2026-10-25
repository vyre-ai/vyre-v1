// Kit step checks before an install (P-L10_12). A step is an ordinary capability call, and some capabilities refuse without a container: a task lives in a record (tasks.create answers
// "/recordId: the container to create in is missing"). Found at install time that is a half-applied Kit; found here it is a problem the install sheet can show, and install refuses before it runs
// any step. The table names the capabilities whose handler needs an input the registry marks optional; add a row when another one is found. The checks read only the Kit's own manifest.
import type { KitManifest } from "./install.ts";

/** capability -> input pointers its handler cannot do without, with the sentence that says what is missing */
export const NEEDS_INPUT: Readonly<Record<string, readonly { pointer: string; what: string }[]>> = Object.freeze({
  "tasks.create": [{ pointer: "/recordId", what: "the record the task lives in" }],
});

export interface StepProblem {
  /** the Kit item the step belongs to */
  item: string;
  step: "apply" | "undo";
  cap: string;
  /** the missing input, as a JSON pointer into the step's input */
  input: string;
  message: string;
}

function present(doc: unknown, pointer: string): boolean {
  let cur: unknown = doc;
  for (const key of pointer.split("/").slice(1)) {
    if (typeof cur !== "object" || cur === null || Array.isArray(cur) || !(key in cur)) return false;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur !== undefined && cur !== null && cur !== "";
}

/** Every step input a Kit leaves out that its capability cannot do without, in item order. Empty when the Kit is ready to install. */
export function stepProblems(kit: KitManifest): StepProblem[] {
  const out: StepProblem[] = [];
  for (const it of kit.items) {
    for (const step of ["apply", "undo"] as const) {
      const s = it[step];
      if (!s) continue;
      for (const need of NEEDS_INPUT[s.cap] ?? []) {
        if (present(s.input, need.pointer)) continue;
        out.push({ item: it.key, step, cap: s.cap, input: need.pointer, message: `"${it.title}" ${step === "apply" ? "installs" : "undoes"} with ${s.cap}, which needs ${need.what} (${need.pointer}); the step gives none.` });
      }
    }
  }
  return out;
}

const toSnake = (s: string): string => s.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
const META = ["title", "plural", "icon", "group", "label", "titleField", "statusField", "ownerField"] as const;

/**
 * How a record type the Space has differs from the one the Kit's manifest declares, as a sentence; null when they are the same. Both are compared by their name, look, label, the fields that
 * title, status and own a row, and their fields' keys and kinds (keys in lower snake case, which is what the schema stores).
 */
export function typeDifference(declared: Record<string, unknown>, have: Record<string, unknown>): string | null {
  const norm = (v: unknown, key: string): unknown => (typeof v === "string" && key.endsWith("Field") ? toSnake(v) : v ?? null);
  for (const k of META) if (norm(declared[k], k) !== norm(have[k], k)) return `its ${k} is ${JSON.stringify(norm(have[k], k))}, the Kit declares ${JSON.stringify(norm(declared[k], k))}`;
  const fields = (v: unknown): string[] => (Array.isArray(v) ? (v as { key?: unknown; type?: unknown }[]).map((f) => `${toSnake(String(f.key))}:${String(f.type)}`).sort() : []);
  const a = fields(declared["fields"]), b = fields(have["fields"]);
  if (a.join() !== b.join()) return `its fields are ${b.join(", ")}, the Kit declares ${a.join(", ")}`;
  return null;
}
