// A condition as controls, and back (AUTOMATIONS-BUILD-RC29 round five, item 3): "lead.score > 80" is a field, an operator said in words, and a value; several are joined by "and" or "or". What is stored is the engine's own
// expression, written back exactly: a condition the controls cannot rebuild character for character is kept whole and shown as one read-only "Advanced condition", never rewritten.
export type Op = "==" | "!=" | ">" | "<" | ">=" | "<=" | "is empty" | "is not empty" | "contains";
export interface Clause {
  left: string;
  op: Op;
  /** The value as a template string: text, a number, or one {{ reference }}; "" for the two empty tests. */
  value: string;
}
export interface Parsed {
  join: "&&" | "||";
  clauses: Clause[];
}

export const OP_WORDS: Readonly<Record<Op, string>> = {
  "==": "is",
  "!=": "is not",
  ">": "is more than",
  "<": "is less than",
  ">=": "is at least",
  "<=": "is at most",
  contains: "contains",
  "is empty": "is empty",
  "is not empty": "is not empty",
};
export const OPS = Object.keys(OP_WORDS) as Op[];

const REF = "[A-Za-z_][A-Za-z0-9_]*(?:\\.[A-Za-z0-9_]+|\\[\\d+\\])*";
const EMPTY = new RegExp(`^(${REF}) (is not empty|is empty)$`);
const CMP = new RegExp(`^(${REF}) (==|!=|>=|<=|>|<|contains) (.+)$`);

/** The right-hand side as a template value: a number or a reference stay as they are, a quoted text loses its quotes. */
const valueIn = (raw: string): string | null => {
  if (/^-?\d+(?:\.\d+)?$/.test(raw)) return raw;
  if (new RegExp(`^${REF}$`).test(raw)) return `{{ ${raw} }}`;
  const q = /^"((?:[^"\\]|\\.)*)"$/.exec(raw);
  return q ? q[1]!.replace(/\\"/g, '"') : null;
};
/** The template value as the engine's right-hand side. */
export const valueOut = (v: string): string => {
  if (/^-?\d+(?:\.\d+)?$/.test(v)) return v;
  const one = new RegExp(`^\\{\\{ (${REF}) \\}\\}$`).exec(v);
  return one ? one[1]! : `"${v.replace(/"/g, '\\"')}"`;
};

function clauseOf(text: string): Clause | null {
  const e = EMPTY.exec(text);
  if (e) return { left: e[1]!, op: e[2] as Op, value: "" };
  const c = CMP.exec(text);
  if (!c) return null;
  const value = valueIn(c[3]!);
  return value === null ? null : { left: c[1]!, op: c[2] as Op, value };
}

export const clauseText = (c: Clause): string =>
  c.op === "is empty" || c.op === "is not empty" ? `${c.left} ${c.op}` : `${c.left} ${c.op} ${valueOut(c.value)}`;
export const build = (p: Parsed): string => p.clauses.map(clauseText).join(` ${p.join} `);

/** The condition as rows, or null when the controls cannot write it back exactly (then it is shown whole, read-only). An empty condition is no rows. */
export function parse(text: string): Parsed | null {
  if (text.trim() === "") return { join: "&&", clauses: [] };
  for (const join of ["&&", "||"] as const) {
    const parts = text.split(` ${join} `);
    const clauses = parts.map(clauseOf);
    if (clauses.some((c) => c === null)) continue;
    const out: Parsed = { join, clauses: clauses as Clause[] };
    if (build(out) === text) return out;
  }
  return null;
}
