// What a model reads when a call's input is not accepted (13 Nov 2026): the exact input that is wrong, the rule it broke, and a minimal call that would be accepted. The server's list of problems names a path and a rule,
// never a value, so nothing a person wrote can come back through here. A model that is told only "input failed validation" guesses and tries again; this names what to change.
import type { ToolDef } from "./types.ts";

type Prop = {
  type?: string;
  enum?: unknown[];
  examples?: unknown[];
  pattern?: string;
  items?: unknown;
  description?: string;
};
type Schema = { properties?: Record<string, Prop>; required?: string[] };

/** One problem from the validators ("/title: required", "/port: above maximum") as a path and a rule. */
export function parseProblem(p: string): { path: string; rule: string } {
  const i = p.indexOf(": ");
  return i < 0 ? { path: p, rule: "invalid" } : { path: p.slice(0, i), rule: p.slice(i + 2) };
}

const leaf = (path: string): string =>
  path
    .split("/")
    .filter((x) => x !== "")
    .join(".") || "the input";

function ruleWords(name: string, rule: string, prop: Prop | undefined): string {
  if (rule === "required") return `${name} is missing`;
  const typed = /^expected (.+) got (.+)$/.exec(rule);
  if (typed) return `${name} must be ${(typed[1] ?? "").replace(/\|/g, " or ")}, not ${typed[2]}`;
  if (rule === "not in enum")
    return prop?.enum
      ? `${name} must be one of ${prop.enum.map((e) => JSON.stringify(e)).join(", ")}`
      : `${name} is not one of the allowed choices`;
  if (rule === "pattern") {
    const ex = prop?.examples?.[0];
    return `${name} is not the shape of an id of its kind${typeof ex === "string" ? ` (it looks like ${ex})` : ""}; use the id exactly as a tool returned it`;
  }
  if (rule === "too short") return `${name} is empty or too short`;
  if (rule === "too long") return `${name} is too long`;
  if (rule === "below minimum") return `${name} is below its smallest allowed value`;
  if (rule === "above maximum") return `${name} is above its largest allowed value`;
  if (rule === "not the constant") return `${name} has a fixed value; read the tool's description for it`;
  return `${name} is not accepted (${rule})`;
}

/** A call that would be accepted: only what the tool requires, with a plain stand-in for each value. */
export function minimalCall(t: Pick<ToolDef, "name" | "inputSchema">, example?: string): string {
  if (example !== undefined) return example;
  const s = (t.inputSchema ?? {}) as Schema;
  const args: Record<string, unknown> = {};
  for (const k of s.required ?? []) {
    const p = s.properties?.[k] ?? {};
    const ex = p.examples?.[0];
    args[k] =
      p.enum && p.enum.length > 0
        ? p.enum[0]
        : typeof ex === "string"
          ? `<${k}: an id like ${ex}>`
          : p.type === "integer" || p.type === "number"
            ? 1
            : p.type === "boolean"
              ? true
              : p.type === "array"
                ? []
                : p.type === "object"
                  ? {}
                  : `<${k}>`;
  }
  return `${t.name} ${JSON.stringify(args)}`;
}

/** The full sentence for a rejected input: what is wrong, then a minimal call. At most four problems are listed, the first ones. */
export function rejectWords(
  t: Pick<ToolDef, "name" | "inputSchema">,
  problems: readonly string[],
  example?: string,
  given: readonly string[] = [],
): string {
  const s = (t.inputSchema ?? {}) as Schema;
  const said = new Set<string>();
  for (const raw of problems) {
    const { path, rule } = parseProblem(raw);
    const first = path.split("/").filter((x) => x !== "")[0] ?? "";
    // a key the tool layer owns is never the model's to fix
    if (
      first === "idempotencyKey" ||
      (first === "threadId" && rule === "required" && !(s.required ?? []).includes("threadId"))
    )
      continue;
    said.add(ruleWords(leaf(path), rule, s.properties?.[first]));
    if (said.size === 4) break;
  }
  if (said.size === 0) return "This call was not accepted. Check it against the tool's description and try once more.";
  // a name the tool does not have, where an input it needs is missing: say the exact names it takes (a model that wrote `file` or `fileID` for `fileId` is told which)
  const names = Object.keys(s.properties ?? {});
  const unknown = given.filter((k) => k !== "idempotencyKey" && !names.includes(k)).slice(0, 4);
  const hint =
    unknown.length > 0 && problems.some((p) => p.endsWith(": required"))
      ? ` This tool has no input named ${unknown.join(" or ")}. Its inputs are ${names
          .filter((n) => n !== "idempotencyKey")
          .slice(0, 12)
          .join(", ")}.`
      : "";
  return `${t.name} was not run: ${[...said].join("; ")}.${hint} A minimal call: ${minimalCall(t, example)}`;
}
