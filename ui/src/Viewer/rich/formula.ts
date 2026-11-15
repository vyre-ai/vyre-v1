// The formulas a viewer grid recomputes when a cell changes. Supported, exactly: + - * / ^ & unary minus, % after a number, comparisons (= <> < > <= >=), parentheses, numbers, text in double quotes, TRUE and FALSE,
// cell references (B2, $B$2), ranges (B2:B9), references to another sheet (Sheet2!B2 or 'My sheet'!B2), and the functions SUM AVERAGE MIN MAX COUNT COUNTA PRODUCT ROUND ABS SQRT MOD POWER IF AND OR NOT
// LEN UPPER LOWER CONCAT CONCATENATE. Any other function, or a syntax this does not read, is "unsupported": the cell keeps its text and its last value and is marked, never shown as a guess.

export type Val = number | string | boolean | null;
export interface Ref {
  sheet: string | null;
  r: number;
  c: number;
}
/** Reads one cell's value (the sheet is null for the formula's own sheet). Returns the cell's current value after any recalculation it needs. */
export type Reader = (sheet: string | null, r: number, c: number) => Val | FormulaError;

export class FormulaError {
  code: "#DIV/0!" | "#VALUE!" | "#REF!" | "#NAME?" | "#NUM!" | "#N/A" | "#CYCLE!";
  constructor(code: "#DIV/0!" | "#VALUE!" | "#REF!" | "#NAME?" | "#NUM!" | "#N/A" | "#CYCLE!") {
    this.code = code;
  }
}
/** A formula this module will not guess at. */
export class Unsupported extends Error {}

export const colName = (c: number): string => {
  let n = c + 1;
  let s = "";
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
};
export const colIndex = (s: string): number => {
  let n = 0;
  for (const ch of s.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
};
export const addr = (r: number, c: number): string => `${colName(c)}${r + 1}`;

type Tok =
  | { t: "num"; v: number }
  | { t: "str"; v: string }
  | { t: "ref"; sheet: string | null; a: string; b: string | null }
  | { t: "id"; v: string }
  | { t: "op"; v: string };

const REF = /^(?:(?:'((?:[^']|'')+)'|([A-Za-z_][A-Za-z0-9_.]*))!)?\$?([A-Za-z]{1,3})\$?(\d+)(?::\$?([A-Za-z]{1,3})\$?(\d+))?/;

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i]!;
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (ch === '"') {
      let j = i + 1;
      let v = "";
      while (j < src.length && !(src[j] === '"' && src[j + 1] !== '"')) {
        if (src[j] === '"') j++;
        v += src[j++];
      }
      if (j >= src.length) throw new Unsupported("open quote");
      out.push({ t: "str", v });
      i = j + 1;
      continue;
    }
    const rest = src.slice(i);
    const m = REF.exec(rest);
    // a reference is a name of letters then digits (A1, $B$2, Sheet2!C3); a function name is followed by "("
    if (m && !/^[A-Za-z]+\d+\s*\(/.test(rest) && !/^[A-Za-z0-9_.]/.test(rest.slice(m[0].length))) {
      const sheet = m[1] !== undefined ? m[1].replace(/''/g, "'") : (m[2] ?? null);
      out.push({ t: "ref", sheet, a: `${m[3]}${m[4]}`, b: m[5] !== undefined ? `${m[5]}${m[6]}` : null });
      i += m[0].length;
      continue;
    }
    const num = /^(\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(rest);
    if (num) {
      out.push({ t: "num", v: Number(num[0]) });
      i += num[0].length;
      continue;
    }
    const id = /^[A-Za-z_][A-Za-z0-9_.]*/.exec(rest);
    if (id) {
      out.push({ t: "id", v: id[0].toUpperCase() });
      i += id[0].length;
      continue;
    }
    const op = /^(<>|<=|>=|[-+*/^&=<>(),%:])/.exec(rest);
    if (op) {
      out.push({ t: "op", v: op[0] });
      i += op[0].length;
      continue;
    }
    throw new Unsupported(`character ${ch}`);
  }
  return out;
}

const parseA1 = (a: string): { r: number; c: number } => {
  const m = /^([A-Za-z]+)(\d+)$/.exec(a)!;
  return { r: Number(m[2]) - 1, c: colIndex(m[1]!) };
};

type Arg = Val | FormulaError | Val[];
const isErr = (v: unknown): v is FormulaError => v instanceof FormulaError;
const flat = (a: Arg[]): (Val | FormulaError)[] => a.flatMap((x) => (Array.isArray(x) ? x : [x]));
const num = (v: Val | FormulaError): number | FormulaError => {
  if (isErr(v)) return v;
  if (v === null || v === "") return 0;
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : new FormulaError("#VALUE!");
};
const text = (v: Val | FormulaError): string => (isErr(v) ? v.code : v === null ? "" : typeof v === "boolean" ? (v ? "TRUE" : "FALSE") : String(v));
const truthy = (v: Val | FormulaError): boolean | FormulaError =>
  isErr(v) ? v : typeof v === "boolean" ? v : typeof v === "number" ? v !== 0 : v === null || v === "" ? false : new FormulaError("#VALUE!");

export const FUNCTIONS = [
  "SUM", "AVERAGE", "MIN", "MAX", "COUNT", "COUNTA", "PRODUCT", "ROUND", "ABS", "SQRT", "MOD", "POWER", "IF", "AND", "OR", "NOT", "LEN", "UPPER", "LOWER", "CONCAT", "CONCATENATE",
] as const;

/** The numbers among the arguments (cells that hold text or nothing are skipped when they come from a range, as a spreadsheet does). */
function nums(a: Arg[]): number[] | FormulaError {
  const out: number[] = [];
  for (const x of a) {
    if (Array.isArray(x)) {
      for (const v of x) {
        if (isErr(v)) return v;
        if (typeof v === "number") out.push(v);
        else if (typeof v === "boolean") continue;
      }
    } else {
      const n = num(x);
      if (isErr(n)) return n;
      out.push(n);
    }
  }
  return out;
}

function call(name: string, a: Arg[]): Val | FormulaError {
  const first = (): Val | FormulaError => (Array.isArray(a[0]) ? (a[0][0] ?? null) : (a[0] as Val | FormulaError) ?? null);
  switch (name) {
    case "SUM": {
      const n = nums(a);
      return isErr(n) ? n : n.reduce((x, y) => x + y, 0);
    }
    case "PRODUCT": {
      const n = nums(a);
      return isErr(n) ? n : n.reduce((x, y) => x * y, 1);
    }
    case "AVERAGE": {
      const n = nums(a);
      return isErr(n) ? n : n.length === 0 ? new FormulaError("#DIV/0!") : n.reduce((x, y) => x + y, 0) / n.length;
    }
    case "MIN": {
      const n = nums(a);
      return isErr(n) ? n : n.length === 0 ? 0 : Math.min(...n);
    }
    case "MAX": {
      const n = nums(a);
      return isErr(n) ? n : n.length === 0 ? 0 : Math.max(...n);
    }
    case "COUNT":
      return flat(a).filter((v) => typeof v === "number").length;
    case "COUNTA":
      return flat(a).filter((v) => v !== null && v !== "").length;
    case "ROUND": {
      const x = num(first());
      const d = num((a[1] as Val) ?? 0);
      if (isErr(x)) return x;
      if (isErr(d)) return d;
      const k = 10 ** Math.trunc(d);
      return Math.sign(x) * Math.round(Math.abs(x) * k + Number.EPSILON) / k;
    }
    case "ABS": {
      const x = num(first());
      return isErr(x) ? x : Math.abs(x);
    }
    case "SQRT": {
      const x = num(first());
      return isErr(x) ? x : x < 0 ? new FormulaError("#NUM!") : Math.sqrt(x);
    }
    case "MOD": {
      const x = num(first());
      const y = num((a[1] as Val) ?? 0);
      if (isErr(x)) return x;
      if (isErr(y)) return y;
      return y === 0 ? new FormulaError("#DIV/0!") : x - y * Math.floor(x / y);
    }
    case "POWER": {
      const x = num(first());
      const y = num((a[1] as Val) ?? 0);
      if (isErr(x)) return x;
      if (isErr(y)) return y;
      const r = x ** y;
      return Number.isFinite(r) ? r : new FormulaError("#NUM!");
    }
    case "IF": {
      const c = truthy(first());
      if (isErr(c)) return c;
      const pick = c ? a[1] : a[2];
      return pick === undefined ? (c ? true : false) : Array.isArray(pick) ? (pick[0] ?? null) : pick;
    }
    case "AND": {
      for (const v of flat(a)) {
        const t = truthy(v);
        if (isErr(t)) return t;
        if (!t) return false;
      }
      return true;
    }
    case "OR": {
      for (const v of flat(a)) {
        const t = truthy(v);
        if (isErr(t)) return t;
        if (t) return true;
      }
      return false;
    }
    case "NOT": {
      const t = truthy(first());
      return isErr(t) ? t : !t;
    }
    case "LEN":
      return text(first()).length;
    case "UPPER":
      return text(first()).toUpperCase();
    case "LOWER":
      return text(first()).toLowerCase();
    case "CONCAT":
    case "CONCATENATE":
      return flat(a).map(text).join("");
    default:
      throw new Unsupported(name);
  }
}

/** The names of the cells a formula reads, for a dependency check; null when the formula is not one this reads. */
export function parse(src: string): Tok[] | null {
  try {
    const t = tokenize(src);
    return t;
  } catch {
    return null;
  }
}

/** Evaluates a formula (without its leading "="). Throws Unsupported for a function or syntax outside the list above. */
export function evaluate(src: string, read: Reader): Val | FormulaError {
  const toks = tokenize(src);
  let p = 0;
  const peek = (): Tok | undefined => toks[p];
  const isOp = (v: string): boolean => peek()?.t === "op" && (peek() as { v: string }).v === v;
  const arith = (l: Val | FormulaError, r: Val | FormulaError, f: (a: number, b: number) => number | FormulaError): Val | FormulaError => {
    const a = num(l);
    const b = num(r);
    if (isErr(a)) return a;
    if (isErr(b)) return b;
    const out = f(a, b);
    return typeof out === "number" && !Number.isFinite(out) ? new FormulaError("#NUM!") : out;
  };
  function cmp(l: Val | FormulaError, r: Val | FormulaError, op: string): Val | FormulaError {
    if (isErr(l)) return l;
    if (isErr(r)) return r;
    const both = typeof l === "number" && typeof r === "number";
    const a = both ? l : text(l).toLowerCase();
    const b = both ? r : text(r).toLowerCase();
    switch (op) {
      case "=": return a === b;
      case "<>": return a !== b;
      case "<": return a < b;
      case ">": return a > b;
      case "<=": return a <= b;
      default: return a >= b;
    }
  }
  const one = (v: Arg): Val | FormulaError => (Array.isArray(v) ? (v[0] ?? null) : v);
  function expr(): Arg {
    let l = concat();
    while (peek()?.t === "op" && ["=", "<>", "<", ">", "<=", ">="].includes((peek() as { v: string }).v)) {
      const op = (toks[p++] as { v: string }).v;
      l = cmp(one(l), one(concat()), op);
    }
    return l;
  }
  function concat(): Arg {
    let l = add();
    while (isOp("&")) {
      p++;
      const r = add();
      const a = one(l);
      const b = one(r);
      l = isErr(a) ? a : isErr(b) ? b : text(a) + text(b);
    }
    return l;
  }
  function add(): Arg {
    let l = mul();
    while (isOp("+") || isOp("-")) {
      const op = (toks[p++] as { v: string }).v;
      const r = one(mul());
      l = arith(one(l), r, op === "+" ? (a, b) => a + b : (a, b) => a - b);
    }
    return l;
  }
  function mul(): Arg {
    let l = pow();
    while (isOp("*") || isOp("/")) {
      const op = (toks[p++] as { v: string }).v;
      const r = one(pow());
      l = arith(one(l), r, op === "*" ? (a, b) => a * b : (a, b) => (b === 0 ? new FormulaError("#DIV/0!") : a / b));
    }
    return l;
  }
  function pow(): Arg {
    const l = unary();
    if (isOp("^")) {
      p++;
      const r = one(pow());
      return arith(one(l), r, (a, b) => a ** b);
    }
    return l;
  }
  function unary(): Arg {
    if (isOp("-")) {
      p++;
      const v = one(unary());
      const n = num(v);
      return isErr(n) ? n : -n;
    }
    if (isOp("+")) {
      p++;
      return unary();
    }
    let v = primary();
    while (isOp("%")) {
      p++;
      const n = num(one(v));
      v = isErr(n) ? n : n / 100;
    }
    return v;
  }
  function primary(): Arg {
    const t = toks[p++];
    if (!t) throw new Unsupported("end");
    if (t.t === "num") return t.v;
    if (t.t === "str") return t.v;
    if (t.t === "ref") {
      const a = parseA1(t.a);
      if (t.b === null) return read(t.sheet, a.r, a.c);
      const b = parseA1(t.b);
      const out: Val[] = [];
      for (let r = Math.min(a.r, b.r); r <= Math.max(a.r, b.r); r++)
        for (let c = Math.min(a.c, b.c); c <= Math.max(a.c, b.c); c++) {
          const v = read(t.sheet, r, c);
          if (isErr(v)) return v;
          out.push(v);
        }
      return out;
    }
    if (t.t === "id") {
      if (t.v === "TRUE") return true;
      if (t.v === "FALSE") return false;
      if (!isOp("(")) throw new Unsupported(t.v);
      p++;
      const args: Arg[] = [];
      if (!isOp(")")) {
        for (;;) {
          args.push(expr());
          if (isOp(",")) {
            p++;
            continue;
          }
          break;
        }
      }
      if (!isOp(")")) throw new Unsupported("close");
      p++;
      if (!(FUNCTIONS as readonly string[]).includes(t.v)) throw new Unsupported(t.v);
      return call(t.v, args);
    }
    if (t.v === "(") {
      const v = expr();
      if (!isOp(")")) throw new Unsupported("close");
      p++;
      return v;
    }
    throw new Unsupported(t.v);
  }
  const v = expr();
  if (p < toks.length) throw new Unsupported("trailing");
  return one(v);
}

/** Moves the references of a formula when rows or columns are inserted (delta > 0) or deleted (delta < 0) at `at` on the formula's own sheet (or on `sheet` when the reference names it). A reference to a deleted cell becomes #REF!. */
export function shiftFormula(src: string, own: string, target: string, axis: "row" | "col", at: number, delta: number): string {
  return src.replace(/(?:(?:'((?:[^']|'')+)'|([A-Za-z_][A-Za-z0-9_.]*))!)?(\$?)([A-Za-z]{1,3})(\$?)(\d+)(?::(\$?)([A-Za-z]{1,3})(\$?)(\d+))?/g, (m, q, plain, d1, c1, d2, r1, e1, c2, e2, r2, off: number, whole: string) => {
    // not inside a string and not the tail of a longer name
    if (off > 0 && /[A-Za-z0-9_.$]/.test(whole[off - 1]!) && q === undefined && plain === undefined) return m;
    const sheet = q !== undefined ? q.replace(/''/g, "'") : (plain ?? own);
    if (sheet !== target) return m;
    const move = (r: number, c: number): { r: number; c: number } | null => {
      const v = axis === "row" ? r : c;
      if (delta > 0) return v >= at ? (axis === "row" ? { r: r + delta, c } : { r, c: c + delta }) : { r, c };
      if (v >= at && v < at - delta) return null;
      return v >= at - delta ? (axis === "row" ? { r: r + delta, c } : { r, c: c + delta }) : { r, c };
    };
    const prefix = m.slice(0, m.length - `${d1}${c1}${d2}${r1}${r2 !== undefined ? `:${e1}${c2}${e2}${r2}` : ""}`.length);
    const a = move(Number(r1) - 1, colIndex(c1));
    if (r2 === undefined) return a === null ? "#REF!" : `${prefix}${d1}${colName(a.c)}${d2}${a.r + 1}`;
    const b = move(Number(r2) - 1, colIndex(c2));
    if (a === null && b === null) return "#REF!";
    const aa = a ?? { r: Number(r1) - 1, c: colIndex(c1) };
    const bb = b ?? (axis === "row" ? { r: at - 1, c: colIndex(c2) } : { r: Number(r2) - 1, c: at - 1 });
    return `${prefix}${d1}${colName(aa.c)}${d2}${aa.r + 1}:${e1}${colName(bb.c)}${e2}${bb.r + 1}`;
  });
}
