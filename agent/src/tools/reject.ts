// What a model reads when a call's input is not accepted (13 Nov 2026): the exact input that is wrong, the rule it broke, and a minimal call that would be accepted. The server's list of problems names a path and a rule,
// never a value, so nothing a person wrote can come back through here. A model that is told only "input failed validation" guesses and tries again; this names what to change.
import type { ToolDef } from "./types.ts";

type Prop = {
  type?: string | string[];
  enum?: unknown[];
  examples?: unknown[];
  pattern?: string;
  items?: Prop;
  properties?: Record<string, Prop>;
  required?: string[];
  description?: string;
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  minItems?: number;
  maxItems?: number;
};
type Schema = Prop;

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

/** The part of a schema a problem's path points at ("/content/text", "/rows/0/name"). */
function propAt(s: Prop, path: string): Prop | undefined {
  let cur: Prop | undefined = s;
  for (const seg of path.split("/").filter((x) => x !== "")) {
    if (cur === undefined) return undefined;
    cur = /^\d+$/.test(seg) ? cur.items : cur.properties?.[seg];
  }
  return cur;
}

/** A value a call could carry for this input, so a model that reads the sentence can copy its shape. Never a value from the person's own call. */
export function exampleValue(key: string, p: Prop | undefined): unknown {
  if (p === undefined) return "text";
  if (p.enum && p.enum.length > 0) return p.enum[0];
  const ex = p.examples?.[0];
  if (ex !== undefined) return ex;
  const type = Array.isArray(p.type) ? p.type[0] : p.type;
  if (type === "integer" || type === "number") {
    const lo = p.minimum ?? 0;
    const v = Math.max(lo, 1);
    return p.maximum !== undefined ? Math.min(v, p.maximum) : v;
  }
  if (type === "boolean") return true;
  if (type === "array") return p.items ? [exampleValue(key, p.items)] : [];
  if (type === "object") {
    const o: Record<string, unknown> = {};
    for (const r of p.required ?? []) o[r] = exampleValue(r, p.properties?.[r]);
    return o;
  }
  if (p.pattern !== undefined && /^\^https\?:\/\//.test(p.pattern)) return "https://acme.test/plan";
  if (/(?:url|link|href)$/i.test(key)) return "https://acme.test/plan";
  if (/emails?$/i.test(key)) return "dana@acme.test";
  if (/(?:^|[a-z])(?:at|date|day)$/i.test(key)) return "2026-11-20T15:00:00Z";
  if (/^(?:text|body|message|content|note|description|summary|prompt|question|answer|comment)$/i.test(key))
    return "The words to save.";
  return "Quarterly planning";
}

const asJson = (v: unknown): string => JSON.stringify(v);

function ruleWords(name: string, rule: string, prop: Prop | undefined, key: string): string {
  const eg = (): string => ` (for example ${asJson(exampleValue(key, prop))})`;
  if (rule === "required") return `${name} is missing${eg()}`;
  const typed = /^expected (.+) got (.+)$/.exec(rule);
  if (typed) return `${name} must be ${(typed[1] ?? "").replace(/\|/g, " or ")}, not ${typed[2]}${eg()}`;
  if (rule === "not in enum")
    return prop?.enum
      ? `${name} must be one of ${prop.enum.map((e) => JSON.stringify(e)).join(", ")}`
      : `${name} is not one of the allowed choices`;
  if (rule === "pattern" || rule.startsWith("pattern ")) {
    const pat = prop?.pattern ?? "";
    const ex = prop?.examples?.[0];
    if (/^\^https\?:\/\//.test(pat)) return `${name} must start with http:// or https://${eg()}`;
    if (/^\^[a-z]{2,6}_/.test(pat))
      return `${name} is not an id of its kind${typeof ex === "string" ? ` (like ${ex})` : ""}; use the id exactly as a tool returned it`;
    return `${name} is not in the format this tool asks for${eg()}`;
  }
  if (rule === "too short")
    return prop?.minLength !== undefined && prop.minLength > 1
      ? `${name} is too short: at least ${prop.minLength} characters`
      : `${name} is empty: give it some text${eg()}`;
  if (rule === "too long")
    return prop?.maxLength !== undefined
      ? `${name} is too long: at most ${prop.maxLength} characters`
      : `${name} is too long`;
  if (rule === "below minimum")
    return prop?.minimum !== undefined ? `${name} must be at least ${prop.minimum}` : `${name} is below its smallest value`;
  if (rule === "above maximum")
    return prop?.maximum !== undefined ? `${name} must be at most ${prop.maximum}` : `${name} is above its largest value`;
  if (rule === "too few items")
    return `${name} needs at least ${prop?.minItems ?? 1} item${(prop?.minItems ?? 1) === 1 ? "" : "s"}${eg()}`;
  if (rule === "too many items")
    return prop?.maxItems !== undefined
      ? `${name} holds too many items: at most ${prop.maxItems}; send the rest in a second call`
      : `${name} holds too many items`;
  if (rule === "matches none of anyOf")
    return `${name} is not in a shape this tool takes; read its description and use one of the shapes it lists${eg()}`;
  if (rule === "not the constant") return `${name} has a fixed value; read the tool's description for it`;
  return `${name} is not accepted (${rule})`;
}

/** The names of the inputs an object takes, for a sentence about a name it does not have. */
const inputNames = (p: Prop | undefined): string =>
  Object.keys(p?.properties ?? {})
    .filter((n) => n !== "idempotencyKey")
    .slice(0, 24)
    .join(", ");

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
  _given: readonly string[] = [],
): string {
  const s = (t.inputSchema ?? {}) as Schema;
  const said = new Set<string>();
  const strangers = new Map<string, { bad: string[]; list: string }>();
  for (const raw of problems) {
    const { path, rule } = parseProblem(raw);
    const first = path.split("/").filter((x) => x !== "")[0] ?? "";
    // a key the tool layer owns is never the model's to fix
    if (
      first === "idempotencyKey" ||
      (first === "threadId" && rule === "required" && !(s.required ?? []).includes("threadId"))
    )
      continue;
    if (rule === "unknown property") {
      // a name the tool does not have: say the names it takes (a model that wrote `path` for `folderId` is told which)
      const segs = path.split("/").filter((x) => x !== "");
      const bad = segs.pop() ?? "";
      const parent = propAt(s, `/${segs.join("/")}`);
      const where = segs.length === 0 ? t.name : leaf(`/${segs.join("/")}`);
      const list = inputNames(parent);
      if (list !== "") {
        const x = strangers.get(where) ?? { bad: [], list };
        x.bad.push(bad);
        strangers.set(where, x);
      }
      continue;
    }
    said.add(ruleWords(leaf(path), rule, propAt(s, path), path.split("/").filter((x) => x !== "").pop() ?? ""));
    if (said.size === 4) break;
  }
  const strangerWords = [...strangers.entries()]
    .slice(0, 2)
    .map(([where, x]) => `${where} has no input named ${x.bad.slice(0, 4).join(" or ")}. Its inputs are ${x.list}.`)
    .join(" ");
  if (said.size === 0 && strangers.size > 0)
    return `${t.name} was not run. ${strangerWords} ${example === undefined ? "The shape of a call (replace each <...> with the real value)" : "A call that works"}: ${minimalCall(t, example)}`;
  if (said.size === 0) return "This call was not accepted. Check it against the tool's description and try once more.";
  const more = strangers.size > 0 ? ` ${strangerWords}` : "";
  return `${t.name} was not run: ${[...said].join("; ")}.${more} ${example === undefined ? "The shape of a call (replace each <...> with the real value)" : "A call that works"}: ${minimalCall(t, example)}`;
}

/**
 * The inputs a call carries that the tool does not have, as validator-style problems ("/text: unknown property"). The server's validators let an extra input through, and a handler never reads it: a model that wrote
 * `text` for `content.text` got a file with nothing in it and was told it worked (F93). Only an object whose inputs are all named is held to its names; an open object (records' fields, a free-form body) is not.
 * `owned` are the top-level names the tool layer itself adds and the model is not shown.
 */
export function unknownInputs(schema: unknown, input: unknown, owned: readonly string[] = [], path = ""): string[] {
  const s = schema as Prop | null;
  if (s === null || typeof s !== "object" || input === null || typeof input !== "object") return [];
  if (Array.isArray(input)) {
    if (!s.items) return [];
    return input.flatMap((x, i) => unknownInputs(s.items, x, [], `${path}/${i}`)).slice(0, 8);
  }
  const props = s.properties;
  if (props === undefined || Object.keys(props).length === 0) return [];
  const out: string[] = [];
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    const sub = props[k];
    if (sub === undefined) {
      if (!owned.includes(k)) out.push(`${path}/${k}: unknown property`);
      continue;
    }
    out.push(...unknownInputs(sub, v, [], `${path}/${k}`));
  }
  return out;
}
