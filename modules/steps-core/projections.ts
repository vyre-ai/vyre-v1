// Steps-core projections (spec 2.12, 3.7; ARCH 7.7): what a step runs against (the scope), the small safe expression language behind If, Paths and Loop, `{{ }}` templating,
// durations, and the error shape the Run engine reads. Steps keep no tables: a step is a function of its input, the Run's scope and the capabilities it may call.
import { fail } from "../../host/src/routes/errors.ts";

// ---- ctx and scope ----

export interface StepsCtx {
  space: string;
  principal: { kind: string; id: string };
  actingFor?: string;
  trace: { traceId: string };
  now(): number;
  call?(cap: string, input: unknown): Promise<unknown>;
}

/** What `{{ }}` and conditions can read: the trigger payload, the results of earlier steps, the loop item and a few Run facts. */
export interface Scope {
  trigger?: unknown;
  steps?: Record<string, unknown>;
  item?: unknown;
  index?: number;
  vars?: Record<string, unknown>;
  run?: { id: string };
  now?: number;
}

type Code = Parameters<typeof fail>[0];
export function raise(ctx: { trace: { traceId: string } }, code: Code, message?: string, details?: Record<string, unknown>): never {
  throw fail(code, ctx.trace.traceId, { ...(message ? { message } : {}), ...(details ? { details } : {}) });
}
/** A failure a step reports to the Run engine: a code, words for a person, and whether trying again could help. The engine reads `.error` the way it reads a HostError. */
export function stepError(code: string, message: string, retryable = false): Error {
  return Object.assign(new Error(message), { error: { code, message, retryable } });
}

export function clean<T extends Record<string, unknown>>(o: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) if (v !== undefined) out[k] = v;
  return out as T;
}

// ---- durations ----

const DURATION = /^(\d+)\s*(s|m|h|d|w)$/;
const UNIT: Record<string, number> = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000, w: 7 * 86_400_000 };
/** 90m, 6h, 30d. Anything else is a mistake in the Automation, not something to guess. */
export function durationMs(s: string): number {
  const m = DURATION.exec(s.trim().toLowerCase());
  if (!m) throw stepError("validation.bad_input", `"${s}" is not a duration. Use 90m, 6h or 30d.`);
  return Number(m[1]) * UNIT[m[2]!]!;
}
/** A moment: a number of milliseconds, an ISO time, or a duration from now. */
export function momentMs(v: unknown, now: number): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    if (DURATION.test(v.trim().toLowerCase())) return now + durationMs(v);
    const t = Date.parse(v);
    if (Number.isFinite(t)) return t;
  }
  throw stepError("validation.bad_input", "That is not a time. Use a date, a timestamp or a duration such as 2d.");
}

// ---- the expression language ----
// Literals (numbers, 'text', "text", true, false, null), paths (trigger.name, steps.find.out.rows[0].id), operators (! - * / % + - < <= > >= == != in contains && ||), parentheses,
// and a short list of functions. No assignment, no calls on values, no access to anything outside the scope: it is parsed, never evaluated as code.

type Tok = { t: "num" | "str" | "id" | "op" | "p"; v: string | number };
const TWO = new Set(["==", "!=", "<=", ">=", "&&", "||"]);
const ONE = new Set(["<", ">", "+", "-", "*", "/", "%", "!"]);
const MAX_EXPR = 2000;

function lex(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (/\s/.test(c)) { i++; continue; }
    if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(src[i + 1] ?? ""))) {
      const m = /^[0-9]*\.?[0-9]+(?:[eE][+-]?[0-9]+)?/.exec(src.slice(i))!;
      out.push({ t: "num", v: Number(m[0]) }); i += m[0].length; continue;
    }
    if (c === "'" || c === "\"") {
      let j = i + 1, s = "";
      while (j < src.length && src[j] !== c) { if (src[j] === "\\" && j + 1 < src.length) { s += src[j + 1]; j += 2; } else { s += src[j]; j++; } }
      if (j >= src.length) throw stepError("validation.bad_input", "A quoted text is not closed.");
      out.push({ t: "str", v: s }); i = j + 1; continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i))!;
      out.push({ t: "id", v: m[0] }); i += m[0].length; continue;
    }
    const two = src.slice(i, i + 2);
    if (TWO.has(two)) { out.push({ t: "op", v: two }); i += 2; continue; }
    if (ONE.has(c)) { out.push({ t: "op", v: c }); i++; continue; }
    if ("()[].,".includes(c)) { out.push({ t: "p", v: c }); i++; continue; }
    throw stepError("validation.bad_input", `Unexpected "${c}" in the expression.`);
  }
  return out;
}

type Ast =
  | { k: "lit"; v: unknown }
  | { k: "path"; root: string; segs: (string | number | Ast)[] }
  | { k: "un"; op: string; x: Ast }
  | { k: "bin"; op: string; l: Ast; r: Ast }
  | { k: "call"; name: string; args: Ast[] };

function parse(src: string): Ast {
  if (src.length > MAX_EXPR) throw stepError("validation.bad_input", "That expression is too long.");
  const toks = lex(src);
  let pos = 0;
  const peek = (): Tok | undefined => toks[pos];
  const isOp = (v: string): boolean => { const t = peek(); return !!t && t.t === "op" && t.v === v; };
  const isP = (v: string): boolean => { const t = peek(); return !!t && t.t === "p" && t.v === v; };
  const bad = (m: string): never => { throw stepError("validation.bad_input", m); };

  const primary = (): Ast => {
    const t = toks[pos++];
    if (!t) return bad("The expression ends too soon.");
    if (t.t === "num" || t.t === "str") return { k: "lit", v: t.v };
    if (t.t === "p" && t.v === "(") { const e = or(); if (!isP(")")) bad("A bracket is not closed."); pos++; return e; }
    if (t.t === "id") {
      const name = String(t.v);
      if (name === "true") return { k: "lit", v: true };
      if (name === "false") return { k: "lit", v: false };
      if (name === "null") return { k: "lit", v: null };
      if (isP("(")) {
        pos++;
        const args: Ast[] = [];
        if (!isP(")")) { do { args.push(or()); if (isP(",")) pos++; else break; } while (true); }
        if (!isP(")")) bad("A bracket is not closed.");
        pos++;
        return { k: "call", name, args };
      }
      const segs: (string | number | Ast)[] = [];
      while (true) {
        if (isP(".")) { pos++; const n = toks[pos++]; if (!n || n.t !== "id") return bad("A name must follow a dot."); segs.push(String(n.v)); }
        else if (isP("[")) { pos++; const e = or(); if (!isP("]")) bad("A square bracket is not closed."); pos++; segs.push(e.k === "lit" && (typeof e.v === "string" || typeof e.v === "number") ? (e.v as string | number) : e); }
        else break;
      }
      return { k: "path", root: name, segs };
    }
    return bad(`Unexpected "${String(t.v)}" in the expression.`);
  };
  const unary = (): Ast => {
    if (isOp("!") || isOp("-")) { const op = String(toks[pos++]!.v); return { k: "un", op, x: unary() }; }
    return primary();
  };
  const level = (ops: string[], next: () => Ast, words: string[] = []): Ast => {
    let l = next();
    while (true) {
      const t = peek();
      const hit = t && ((t.t === "op" && ops.includes(String(t.v))) || (t.t === "id" && words.includes(String(t.v))));
      if (!hit) return l;
      pos++;
      l = { k: "bin", op: String(t!.v), l, r: next() };
    }
  };
  const mul = (): Ast => level(["*", "/", "%"], unary);
  const add = (): Ast => level(["+", "-"], mul);
  const cmp = (): Ast => level(["<", "<=", ">", ">="], add, ["in", "contains"]);
  const eq = (): Ast => level(["==", "!="], cmp);
  const and = (): Ast => level(["&&"], eq);
  const or = (): Ast => level(["||"], and);
  const ast = or();
  if (pos < toks.length) bad(`Unexpected "${String(toks[pos]!.v)}" in the expression.`);
  return ast;
}

const FORBIDDEN = new Set(["__proto__", "constructor", "prototype"]);
function readPath(root: unknown, segs: readonly (string | number)[]): unknown {
  let cur: unknown = root;
  for (const s of segs) {
    if (cur === null || cur === undefined) return undefined;
    if (typeof s === "string" && FORBIDDEN.has(s)) return undefined;
    if (Array.isArray(cur)) { if (typeof s === "number") cur = cur[s]; else if (s === "length") cur = cur.length; else return undefined; }
    else if (typeof cur === "object") { if (!Object.hasOwn(cur as object, String(s))) return undefined; cur = (cur as Record<string, unknown>)[String(s)]; }
    else if (typeof cur === "string" && s === "length") cur = cur.length;
    else return undefined;
  }
  return cur;
}

/** Empty lists, empty text, 0, false, null and a missing value are false; everything else is true. */
export function truthy(v: unknown): boolean {
  if (Array.isArray(v)) return v.length > 0;
  return !!v;
}
const num = (v: unknown): number => (typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : typeof v === "boolean" ? Number(v) : NaN);
const same = (a: unknown, b: unknown): boolean => {
  if (a === b) return true;
  if ((a === null || a === undefined) && (b === null || b === undefined)) return true;
  if (typeof a === "object" && a !== null && typeof b === "object" && b !== null) return JSON.stringify(a) === JSON.stringify(b);
  return false;
};
const text = (v: unknown): string => (v === null || v === undefined ? "" : typeof v === "string" ? v : typeof v === "object" ? JSON.stringify(v) : String(v));

const FUNCS: Record<string, (args: unknown[], scope: Scope) => unknown> = {
  len: ([v]) => (typeof v === "string" || Array.isArray(v) ? v.length : v && typeof v === "object" ? Object.keys(v).length : 0),
  lower: ([v]) => text(v).toLowerCase(),
  upper: ([v]) => text(v).toUpperCase(),
  trim: ([v]) => text(v).trim(),
  contains: ([a, b]) => (Array.isArray(a) ? a.some((x) => same(x, b)) : text(a).includes(text(b))),
  startsWith: ([a, b]) => text(a).startsWith(text(b)),
  endsWith: ([a, b]) => text(a).endsWith(text(b)),
  exists: ([v]) => v !== undefined && v !== null,
  isEmpty: ([v]) => !truthy(v) && v !== 0 && v !== false,
  number: ([v]) => num(v),
  string: ([v]) => text(v),
  round: ([v]) => Math.round(num(v)),
  floor: ([v]) => Math.floor(num(v)),
  ceil: ([v]) => Math.ceil(num(v)),
  abs: ([v]) => Math.abs(num(v)),
  min: (a) => Math.min(...a.map(num)),
  max: (a) => Math.max(...a.map(num)),
  now: (_a, s) => s.now ?? Date.now(),
};

function ev(a: Ast, scope: Scope): unknown {
  switch (a.k) {
    case "lit": return a.v;
    case "path": {
      const segs = a.segs.map((s) => (typeof s === "object" ? (ev(s, scope) as string | number) : s));
      const base: Record<string, unknown> = { trigger: scope.trigger, steps: scope.steps ?? {}, item: scope.item, index: scope.index, vars: scope.vars ?? {}, run: scope.run, input: scope.trigger };
      if (!Object.hasOwn(base, a.root) || FORBIDDEN.has(a.root)) return undefined;
      return readPath(base[a.root], segs);
    }
    case "un": {
      const x = ev(a.x, scope);
      return a.op === "!" ? !truthy(x) : -num(x);
    }
    case "call": {
      const f = Object.hasOwn(FUNCS, a.name) ? FUNCS[a.name] : undefined;
      if (!f) throw stepError("validation.bad_input", `There is no function called ${a.name}.`);
      return f(a.args.map((x) => ev(x, scope)), scope);
    }
    case "bin": {
      if (a.op === "&&") { const l = ev(a.l, scope); return truthy(l) ? ev(a.r, scope) : l; }
      if (a.op === "||") { const l = ev(a.l, scope); return truthy(l) ? l : ev(a.r, scope); }
      const l = ev(a.l, scope), r = ev(a.r, scope);
      switch (a.op) {
        case "==": return same(l, r);
        case "!=": return !same(l, r);
        case "<": case "<=": case ">": case ">=": {
          // text compares as text, anything that reads as a number compares as numbers; a value that is neither is never less or more
          const asText = typeof l === "string" && typeof r === "string" && Number.isNaN(num(l)) && Number.isNaN(num(r));
          if (asText) { const x = l as string, y = r as string; return a.op === "<" ? x < y : a.op === "<=" ? x <= y : a.op === ">" ? x > y : x >= y; }
          const x = num(l), y = num(r);
          if (Number.isNaN(x) || Number.isNaN(y)) return false;
          return a.op === "<" ? x < y : a.op === "<=" ? x <= y : a.op === ">" ? x > y : x >= y;
        }
        case "in": return Array.isArray(r) ? r.some((x) => same(x, l)) : typeof r === "string" ? r.includes(text(l)) : r && typeof r === "object" ? Object.hasOwn(r, text(l)) : false;
        case "contains": return Array.isArray(l) ? l.some((x) => same(x, r)) : typeof l === "string" ? l.includes(text(r)) : false;
        case "+": return typeof l === "string" || typeof r === "string" ? text(l) + text(r) : num(l) + num(r);
        case "-": return num(l) - num(r);
        case "*": return num(l) * num(r);
        case "/": { const d = num(r); if (d === 0) throw stepError("validation.bad_input", "The expression divides by zero."); return num(l) / d; }
        case "%": { const d = num(r); if (d === 0) throw stepError("validation.bad_input", "The expression divides by zero."); return num(l) % d; }
        default: throw stepError("validation.bad_input", `Unknown operator ${a.op}.`);
      }
    }
  }
}

/** Evaluate one expression over the scope. */
export function evalExpr(src: string, scope: Scope): unknown { return ev(parse(src), scope); }

const TEMPLATE = /\{\{([\s\S]*?)\}\}/g;
/** Fill `{{ expr }}` in a text. A text that is only one `{{ }}` keeps the type of the value; otherwise the values are written into the text. */
export function renderText(s: string, scope: Scope): unknown {
  const whole = /^\s*\{\{([\s\S]*?)\}\}\s*$/.exec(s);
  if (whole && !whole[1]!.includes("}}")) return evalExpr(whole[1]!, scope);
  return s.replace(TEMPLATE, (_m, e: string) => text(evalExpr(e, scope)));
}
/** Fill templates in every text of a value, to any depth. */
export function render(v: unknown, scope: Scope): unknown {
  if (typeof v === "string") return v.includes("{{") ? renderText(v, scope) : v;
  if (Array.isArray(v)) return v.map((x) => render(x, scope));
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, render(x, scope)]));
  return v;
}
