// What a Flow's `{{ }}` text reads (r40 audit, gap 4). One scanner for both sides: the save check names an unknown variable before the Flow runs, and a Run that meets one fails the step with the same line
// instead of sending an empty value. It does not evaluate anything; it finds the dotted names (`trigger.record.email`, `steps.send.out.messageId`) an expression reads and checks them against a shape.
// DECISION: a name is a root followed by plain `.word` and `[0]` parts. A part that is computed (`a[b]`) ends the name there; what it reaches is not checked. A word followed by `(` is a function, not a variable.

/** One name an expression reads, as written. */
export interface Read {
  /** the whole name as written, `trigger.record.email` */
  text: string;
  root: string;
  /** the plain parts after the root, in order */
  segs: string[];
  /** the expression says what to use when the name has nothing (`a ?? "none"`, `a || "none"`, `exists(a)`): a missing name is then no mistake */
  fallback: boolean;
}

/** What a place in the scope holds: named parts, or anything (a record, a body, a list of rows). */
export interface Shape {
  props?: Record<string, Shape>;
  /** names a Run always has there; absent means the part may be missing and is read as empty */
  required?: string[];
}

const MAX_TEXT = 1_000_000;
const WORDS = new Set(["true", "false", "null", "in", "contains"]);
/** The roots a `{{ }}` can start with (the same list the expression language reads). */
export const ROOTS: readonly string[] = ["trigger", "input", "steps", "vars", "item", "index", "run"];

/** The texts between `{{` and `}}`. One pass over the text, so a text of nothing but `{{` costs no more than its length. */
export function bodiesOf(text: string): string[] {
  // a node's text is never this long in earnest: what is past the cap is not read
  const s = text.length > MAX_TEXT ? text.slice(0, MAX_TEXT) : text;
  const out: string[] = [];
  let at = 0;
  for (;;) {
    const open = s.indexOf("{{", at);
    if (open < 0) break;
    const close = s.indexOf("}}", open + 2);
    if (close < 0) break; // no `}}` anywhere after this: nothing later can close either
    out.push(s.slice(open + 2, close));
    at = close + 2;
  }
  return out;
}

/** Every name one expression reads. */
export function readsOfExpr(src: string): Read[] {
  const out: Read[] = [];
  const fallback = /\|\||\?\?|\b(?:exists|isEmpty)\s*\(/.test(src);
  let i = 0;
  const n = src.length;
  let prev = "";
  while (i < n) {
    const c = src[i]!;
    if (c === "'" || c === '"') {
      let j = i + 1;
      while (j < n && src[j] !== c) j += src[j] === "\\" ? 2 : 1;
      i = j + 1;
      prev = c;
      continue;
    }
    if (/[0-9]/.test(c)) {
      while (i < n && /[0-9.eE]/.test(src[i]!)) i++;
      prev = "0";
      continue;
    }
    if (/[A-Za-z_]/.test(c) && prev !== ".") {
      let j = i;
      while (j < n && /[A-Za-z0-9_]/.test(src[j]!)) j++;
      const root = src.slice(i, j);
      const segs: string[] = [];
      let end = j;
      for (;;) {
        const dot = /^\.([A-Za-z_][A-Za-z0-9_]*|\d+)/.exec(src.slice(end));
        if (dot) {
          segs.push(dot[1]!);
          end += dot[0].length;
          continue;
        }
        const idx = /^\[(\d+)\]/.exec(src.slice(end));
        if (idx) {
          segs.push(idx[1]!);
          end += idx[0].length;
          continue;
        }
        break;
      }
      const call = segs.length === 0 && /^\s*\(/.test(src.slice(j));
      if (!call && !WORDS.has(root)) out.push({ text: src.slice(i, end), root, segs, fallback });
      i = end;
      prev = "a";
      continue;
    }
    if (!/\s/.test(c)) prev = c;
    i++;
  }
  return out;
}

/** Every name in the `{{ }}` of one text. */
export function readsOf(s: string): Read[] {
  return bodiesOf(s).flatMap(readsOfExpr);
}

/** Every text in a value, to any depth. */
export function textsIn(v: unknown, out: string[] = []): string[] {
  if (typeof v === "string") {
    if (v.includes("{{")) out.push(v);
  } else if (Array.isArray(v)) for (const x of v) textsIn(x, out);
  else if (v && typeof v === "object") for (const x of Object.values(v as Record<string, unknown>)) textsIn(x, out);
  return out;
}

// ---- the nearest valid name ----

function distance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, k) => k);
  for (let x = 1; x <= a.length; x++) {
    let diag = row[0]!;
    row[0] = x;
    for (let y = 1; y <= b.length; y++) {
      const up = row[y]!;
      row[y] = Math.min(row[y]! + 1, row[y - 1]! + 1, diag + (a[x - 1] === b[y - 1] ? 0 : 1));
      diag = up;
    }
  }
  return row[b.length]!;
}

/** The option that looks most like what was typed (`recordType` for `type`, `field` for `fields`), or nothing when none does. */
export function nearest(word: string, options: readonly string[]): string | undefined {
  const w = word.toLowerCase();
  let best: { o: string; score: number } | undefined;
  for (const o of options) {
    const l = o.toLowerCase();
    let score = distance(w, l);
    if (l.length >= 3 && w.includes(l)) score = Math.min(score, 1 + Math.abs(w.length - l.length) / 10);
    // `recordType` is `type` with a word in front of it
    if (l.length >= 3 && w.length > l.length && w.endsWith(l)) score = Math.min(score, 0.5);
    if (w.length >= 2 && l.includes(w)) score = Math.min(score, 1 + Math.abs(w.length - l.length) / 10);
    if (!best || score < best.score) best = { o, score };
  }
  if (!best) return undefined;
  const limit = Math.max(2, Math.ceil(Math.max(w.length, best.o.length) * 0.45));
  return best.score <= limit ? best.o : undefined;
}

const some = (names: readonly string[]): string => {
  const shown = names.slice(0, 8).join(", ");
  return names.length > 8 ? `${shown}, and more` : shown;
};

/** The line for a name that is not there: what was typed, the closest valid name, or what is valid at that place. */
export function unknownLine(read: Read, at: number, options: readonly string[]): string {
  const bad = at === 0 ? read.root : read.segs[at - 1]!;
  const head = at === 0 ? [] : [read.root, ...read.segs.slice(0, at - 1)];
  const tail = at === 0 ? read.segs : read.segs.slice(at);
  const near = nearest(bad, options);
  if (near) return `{{${read.text}}} is not a variable. Did you mean ${[...head, near, ...tail].join(".")}?`;
  if (at === 0) return `{{${read.text}}} is not a variable. A variable starts with ${some(options)}.`;
  if (options.length === 0) return `{{${read.text}}} is not a variable: ${head.join(".")} has nothing under it.`;
  return `{{${read.text}}} is not a variable. After ${head.join(".")} you can use ${some(options)}.`;
}

/** Walk a name down a shape. Answers the line for the first part that is not there, or nothing when the name is valid or runs into a part whose contents are free. */
export function checkAgainst(read: Read, from: Shape, at = 0): string | undefined {
  let here: Shape | undefined = from;
  for (let i = at; i < read.segs.length; i++) {
    if (!here?.props) return undefined; // free contents: a record, a body, a list
    const seg = read.segs[i]!;
    const next: Shape | undefined = Object.hasOwn(here.props, seg) ? here.props[seg] : undefined;
    if (!next) return unknownLine(read, i + 1, Object.keys(here.props));
    here = next;
  }
  return undefined;
}

/** A JSON-schema object as a Shape: named parts where the schema names them, free anywhere else. `defs` is the catalogue's `$defs` table, for the `$ref`s the generator folds shared shapes into. */
export function shapeOf(schema: unknown, defs: Record<string, unknown> = {}, depth = 0): Shape {
  let s = schema as { $ref?: unknown; properties?: Record<string, unknown>; required?: unknown } | null;
  for (let i = 0; i < 4 && s && typeof s === "object" && typeof s.$ref === "string"; i++)
    s = defs[s.$ref.replace("#/$defs/", "")] as typeof s;
  if (depth > 5 || !s || typeof s !== "object" || !s.properties || typeof s.properties !== "object") return {};
  const props: Record<string, Shape> = {};
  for (const [k, v] of Object.entries(s.properties)) props[k] = shapeOf(v, defs, depth + 1);
  const required = Array.isArray(s.required) ? s.required.filter((x): x is string => typeof x === "string") : [];
  return { props, ...(required.length ? { required } : {}) };
}

// ---- at run time ----

/** What a Run holds while one step renders its text. */
export interface Held {
  trigger?: unknown;
  steps?: Record<string, unknown> | undefined;
  /** the shape of what this kind of trigger carries; absent when the kind is not known */
  declared?: Shape;
  /** false for a single step tried by itself, which has no earlier steps to read */
  checkSteps: boolean;
}

/**
 * The line for the first name in these texts that the Run cannot have, or nothing. Only what is wrong beyond doubt fails a step: a name that starts nowhere, a step with no result, and a part of the trigger that its kind
 * does not carry or always carries and did not. A part that is optional and absent (a record field with no value yet, a header) is empty, as before.
 */
export function unresolvedLine(texts: readonly string[], held: Held): string | undefined {
  for (const text of texts)
    for (const r of readsOf(text)) {
      if (!ROOTS.includes(r.root)) return unknownLine(r, 0, ROOTS);
      // a name with a fallback written beside it renders the fallback when it has nothing, as it always did
      if (r.fallback) continue;
      if (r.root === "steps" && held.checkSteps && r.segs[0] !== undefined) {
        const have = held.steps ?? {};
        if (!Object.hasOwn(have, r.segs[0]))
          return `{{${r.text}}} reads the step "${r.segs[0]}", which has no result in this run: it did not run, or there is no step with that id.`;
      }
      if ((r.root === "trigger" || r.root === "input") && r.segs[0] !== undefined) {
        const payload = held.trigger;
        if (typeof payload !== "object" || payload === null || Array.isArray(payload)) continue;
        const key = r.segs[0];
        if (Object.hasOwn(payload, key) || !held.declared?.props) continue;
        const props = held.declared.props;
        if (!Object.hasOwn(props, key)) return unknownLine(r, 1, Object.keys(props));
        if (held.declared.required?.includes(key))
          return `{{${r.text}}} has nothing to read: this trigger should carry "${key}" and did not.`;
      }
    }
  return undefined;
}

const isRec = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
/** A sealed field is held as a reference, never as its value. A Run's `trigger.record` leaves those fields out entirely: a Flow cannot template a secret into an email. */
export function withoutSealed(fields: unknown): Record<string, unknown> {
  if (!isRec(fields)) return {};
  return Object.fromEntries(Object.entries(fields).filter(([, v]) => !(isRec(v) && typeof v["sealed"] === "string")));
}
