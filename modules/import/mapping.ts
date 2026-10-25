// Import: what a cell is and what a field takes (spec 2.9). Pure: type inference for a column, the small transforms a mapping may name, and the conversion of a cell into the value of a field.
// DECISION: a transform is a pipe of steps over the cell text: trim, lower, upper, title, digits, split:<sep>, default:<text>, prefix:<text>, suffix:<text>, replace:<from>=><to>.
// DECISION: dates without a zone are read as UTC midnight; a slash date is month first (US) unless its first number is over 12, then it is day first.
// DECISION: a field of a type that cannot come from text (relation, lookup, rollup, formula, files, signature, sealed, button, ai, autonumber, created_by, modified_by) is not importable.

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const EMAIL = /^[^@\s,;]+@[^@\s,;]+\.[^@\s,;]+$/;
const URL_RE = /^(https?:\/\/)[^\s]+\.[^\s]+$/i;
const NUMBER = /^[-+]?\$?\(?[-+]?\d{1,3}(,\d{3})+(\.\d+)?\)?%?$|^[-+]?\$?\(?[-+]?\d+(\.\d+)?\)?%?$|^[-+]?\.\d+$/;
const TRUE_WORDS = new Set(["true", "yes", "y", "1", "x", "checked", "on"]);
const FALSE_WORDS = new Set(["false", "no", "n", "0", "unchecked", "off"]);

/** Field types an import can fill from text. */
export const IMPORTABLE = new Set(["text", "longtext", "number", "money", "datetime", "duration", "choice", "multichoice", "status", "checkbox", "rating", "person", "email", "phone", "url", "address"]);

export const slug = (s: string): string => {
  const base = s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);
  return /^[a-z]/.test(base) ? base : `f_${base || "column"}`;
};
const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, "");

// ---- cells ----

/** A date or date and time as milliseconds since the epoch (UTC), or undefined when the text is not one. */
export function parseDate(text: string): number | undefined {
  const s = text.trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?\s*(Z|[+-]\d{2}:?\d{2})?)?$/i.exec(s);
  if (m) {
    const [, y, mo, d, h, mi, sec, zone] = m;
    let ms = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h ?? 0), Number(mi ?? 0), Number(sec ?? 0));
    if (zone && zone.toUpperCase() !== "Z") { const sign = zone.startsWith("-") ? -1 : 1; const digits = zone.slice(1).replace(":", ""); ms -= sign * (Number(digits.slice(0, 2)) * 60 + Number(digits.slice(2))) * 60_000; }
    return real(Number(y), Number(mo), Number(d)) ? ms : undefined;
  }
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?)?$/i.exec(s);
  if (m) {
    const a = Number(m[1]), b = Number(m[2]);
    let y = Number(m[3]);
    if (m[3]!.length === 2) y += y < 70 ? 2000 : 1900;
    const [mo, d] = a > 12 ? [b, a] : [a, b];
    let h = Number(m[4] ?? 0);
    if (m[7]) { const pm = m[7].toLowerCase() === "pm"; h = (h % 12) + (pm ? 12 : 0); }
    return real(y, mo, d) ? Date.UTC(y, mo - 1, d, h, Number(m[5] ?? 0), Number(m[6] ?? 0)) : undefined;
  }
  m = /^(\d{1,2})\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})$/.exec(s);
  if (m) { const mo = MONTHS.indexOf(m[2]!.slice(0, 3).toLowerCase()) + 1; return mo && real(Number(m[3]), mo, Number(m[1])) ? Date.UTC(Number(m[3]), mo - 1, Number(m[1])) : undefined; }
  m = /^([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})$/.exec(s);
  if (m) { const mo = MONTHS.indexOf(m[1]!.slice(0, 3).toLowerCase()) + 1; return mo && real(Number(m[3]), mo, Number(m[2])) ? Date.UTC(Number(m[3]), mo - 1, Number(m[2])) : undefined; }
  return undefined;
}
/** True when the year, month and day name a real day (Date rolls 31 February into March, which is not what the cell said). */
function real(y: number, mo: number, d: number): boolean {
  const t = new Date(Date.UTC(y, mo - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d;
}

/** A number from text such as 1,200.50, $40, (12) or 15%; undefined when it is not one. */
export function parseNumber(text: string): number | undefined {
  const s = text.trim();
  if (!NUMBER.test(s)) return undefined;
  const negative = s.startsWith("-") || s.startsWith("$-") || s.includes("(");
  const n = Number(s.replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? (negative ? -n : n) : undefined;
}

/** The kind of field a column looks like, from its non-empty cells. */
export function inferType(cells: readonly string[]): string {
  const vals = cells.map((c) => c.trim()).filter((c) => c !== "");
  if (vals.length === 0) return "text";
  const all = (f: (v: string) => boolean): boolean => vals.every(f);
  if (all((v) => /^(true|false|yes|no)$/i.test(v))) return "checkbox";
  if (all((v) => EMAIL.test(v))) return "email";
  if (all((v) => URL_RE.test(v))) return "url";
  if (all((v) => /[-/\s]/.test(v) && parseDate(v) !== undefined)) return "datetime";
  if (all((v) => /^\+?[\d\s().-]{7,20}$/.test(v) && (v.match(/\d/g)?.length ?? 0) >= 7 && (/[\s().+-]/.test(v) || (v.length >= 10 && v.length <= 15)))) return "phone";
  // ids with leading zeros (zip codes, case numbers) are text, not numbers
  if (all((v) => parseNumber(v) !== undefined && !/^[-+]?0\d/.test(v))) return "number";
  if (vals.some((v) => v.length > 200 || v.includes("\n"))) return "longtext";
  const distinct = new Set(vals.map((v) => v.toLowerCase())).size;
  if (vals.length >= 10 && distinct <= 8 && all((v) => v.length <= 40)) return "choice";
  return "text";
}

// ---- transforms ----

export interface Transform { ok: true; run(value: string): string | string[] }
export type TransformCheck = Transform | { ok: false; message: string };
const STEPS = new Set(["trim", "lower", "upper", "title", "digits", "split", "default", "prefix", "suffix", "replace"]);
/** Check a transform and make it runnable. The text is a pipe of steps; an unknown step or a malformed one is refused before any row is read. */
export function compileTransform(text: string): TransformCheck {
  const steps = text.split("|").map((s) => s.trim()).filter((s) => s !== "");
  if (steps.length === 0) return { ok: false, message: "A transform names at least one step." };
  const parsed: Array<(v: string | string[]) => string | string[]> = [];
  for (const step of steps) {
    const i = step.indexOf(":");
    const name = (i < 0 ? step : step.slice(0, i)).trim();
    const arg = i < 0 ? undefined : step.slice(i + 1);
    if (!STEPS.has(name)) return { ok: false, message: `${name} is not a transform step.` };
    if (["split", "default", "prefix", "suffix", "replace"].includes(name) && (arg === undefined || arg === "")) return { ok: false, message: `${name} needs a value, as ${name}:<text>.` };
    if (name === "replace" && !arg!.includes("=>")) return { ok: false, message: "replace takes replace:<from>=><to>." };
    const text1 = (v: string | string[]): string => (Array.isArray(v) ? v.join(", ") : v);
    switch (name) {
      case "trim": parsed.push((v) => (Array.isArray(v) ? v.map((x) => x.trim()) : v.trim())); break;
      case "lower": parsed.push((v) => (Array.isArray(v) ? v.map((x) => x.toLowerCase()) : v.toLowerCase())); break;
      case "upper": parsed.push((v) => (Array.isArray(v) ? v.map((x) => x.toUpperCase()) : v.toUpperCase())); break;
      case "title": parsed.push((v) => { const t = (x: string): string => x.toLowerCase().replace(/(^|[\s'-])([a-z])/g, (_m, a: string, b: string) => a + b.toUpperCase()); return Array.isArray(v) ? v.map(t) : t(v); }); break;
      case "digits": parsed.push((v) => text1(v).replace(/\D+/g, "")); break;
      case "split": parsed.push((v) => text1(v).split(arg!).map((x) => x.trim()).filter((x) => x !== "")); break;
      case "default": parsed.push((v) => (text1(v).trim() === "" ? arg! : v)); break;
      case "prefix": parsed.push((v) => (text1(v) === "" ? v : arg! + text1(v))); break;
      case "suffix": parsed.push((v) => (text1(v) === "" ? v : text1(v) + arg!)); break;
      case "replace": { const [from, to] = arg!.split("=>"); parsed.push((v) => text1(v).split(from!).join(to ?? "")); break; }
    }
  }
  return { ok: true, run: (value) => parsed.reduce<string | string[]>((v, f) => f(v), value) };
}

// ---- cell to field value ----

export interface FieldInfo { key: string; type: string; title?: string; required?: boolean; hasDefault?: boolean; options?: Record<string, unknown> }
export type Converted = { ok: true; value: unknown } | { ok: true; empty: true } | { ok: false; message: string };

const choicesOf = (f: FieldInfo): Array<{ key: string; title: string }> => {
  const raw = (f.options?.["choices"] ?? f.options?.["stages"]) as unknown;
  return Array.isArray(raw) ? raw.filter((c): c is { key: string; title: string } => !!c && typeof (c as { key?: unknown }).key === "string").map((c) => ({ key: c.key, title: String(c.title ?? c.key) })) : [];
};
function pick(f: FieldInfo, text: string): string | undefined {
  const choices = choicesOf(f);
  if (choices.length === 0) return text;
  const want = norm(text);
  return choices.find((c) => norm(c.key) === want || norm(c.title) === want)?.key;
}

/** Turn what a cell holds (after any transform) into the value of a field, or say why it cannot be. Empty cells give no value. */
export function convert(f: FieldInfo, cell: string | string[]): Converted {
  const parts = Array.isArray(cell) ? cell : undefined;
  const text = (parts ? parts.join(", ") : cell as string).trim();
  if (text === "" && (!parts || parts.length === 0)) return { ok: true, empty: true };
  switch (f.type) {
    case "text": case "longtext": case "person": case "address": return { ok: true, value: text };
    case "number": { const n = parseNumber(text); return n === undefined ? { ok: false, message: `${text} is not a number.` } : { ok: true, value: n }; }
    case "duration": { const n = parseNumber(text); return n === undefined || n < 0 ? { ok: false, message: `${text} is not a length of time in minutes.` } : { ok: true, value: Math.round(n) }; }
    case "rating": { const n = parseNumber(text); return n === undefined || n < 0 || n > 10 ? { ok: false, message: `${text} is not a rating from 0 to 10.` } : { ok: true, value: Math.round(n) }; }
    case "money": {
      const code = /\b([A-Z]{3})\b/.exec(text)?.[1] ?? (text.includes("€") ? "EUR" : text.includes("£") ? "GBP" : "USD");
      const n = parseNumber(text.replace(/\b[A-Z]{3}\b/g, "").replace(/[€£]/g, "").trim());
      return n === undefined ? { ok: false, message: `${text} is not an amount of money.` } : { ok: true, value: { amount: Math.round(n * 100), currency: code } };
    }
    case "datetime": { const d = parseDate(text); return d === undefined ? { ok: false, message: `${text} is not a date.` } : { ok: true, value: d }; }
    case "checkbox": {
      const w = text.toLowerCase();
      return TRUE_WORDS.has(w) ? { ok: true, value: true } : FALSE_WORDS.has(w) ? { ok: true, value: false } : { ok: false, message: `${text} is not yes or no.` };
    }
    case "email": return EMAIL.test(text) ? { ok: true, value: text.toLowerCase() } : { ok: false, message: `${text} is not an email address.` };
    case "phone": { const d = text.replace(/\D+/g, ""); return d.length >= 7 && d.length <= 15 ? { ok: true, value: (text.trim().startsWith("+") ? "+" : "") + d } : { ok: false, message: `${text} is not a phone number.` }; }
    case "url": { const u = URL_RE.test(text) ? text : /^[^\s/]+\.[a-z]{2,}(\/\S*)?$/i.test(text) ? `https://${text}` : undefined; return u ? { ok: true, value: u } : { ok: false, message: `${text} is not a web address.` }; }
    case "choice": case "status": { const k = pick(f, text); return k === undefined ? { ok: false, message: `${text} is not one of the choices.` } : { ok: true, value: k }; }
    case "multichoice": {
      const items = (parts ?? text.split(/[;,]/)).map((x) => x.trim()).filter((x) => x !== "");
      const keys = items.map((x) => pick(f, x));
      const bad = items.find((_x, i) => keys[i] === undefined);
      return bad !== undefined ? { ok: false, message: `${bad} is not one of the choices.` } : { ok: true, value: keys as string[] };
    }
    default: return { ok: false, message: `${f.type} fields cannot be imported.` };
  }
}

// ---- suggestions ----

const SYNONYMS: Record<string, string[]> = {
  email: ["emailaddress", "mail", "email"], phone: ["phonenumber", "tel", "telephone", "mobile", "cell", "phone"], name: ["fullname", "contactname", "name"],
  title: ["name", "subject", "title"], company: ["organization", "organisation", "employer", "company"], notes: ["note", "comments", "comment", "description", "notes"],
  website: ["url", "site", "web", "website"], due: ["duedate", "deadline", "due"], start: ["startdate", "begin", "start"], status: ["state", "stage", "status"],
};
export interface Suggestion { column: string; field?: string | undefined; confidence: number }
/** For each column, the field it most likely feeds: exact key or title 1, a known synonym 0.9, one name inside the other 0.7. A field is offered to one column only. */
export function suggest(columns: readonly string[], fields: readonly FieldInfo[]): Suggestion[] {
  const usable = fields.filter((f) => IMPORTABLE.has(f.type));
  const taken = new Set<string>();
  const scored = columns.map((c) => {
    const n = norm(c);
    let best: { field: string; score: number } | undefined;
    for (const f of usable) {
      const k = norm(f.key), t = norm(f.title ?? f.key);
      let score = 0;
      if (n === k || n === t) score = 1;
      else if ((SYNONYMS[f.key] ?? []).includes(n) || (SYNONYMS[k] ?? []).includes(n)) score = 0.9;
      else if (n.length >= 3 && (n.includes(k) || k.includes(n) || (t.length >= 3 && (n.includes(t) || t.includes(n))))) score = 0.7;
      if (score > (best?.score ?? 0)) best = { field: f.key, score };
    }
    return { column: c, best };
  });
  // the strongest claim on a field wins it
  const order = scored.map((s, i) => ({ i, s })).sort((a, b) => (b.s.best?.score ?? 0) - (a.s.best?.score ?? 0) || a.i - b.i);
  const result = new Map<number, Suggestion>();
  for (const { i, s } of order) {
    if (s.best && !taken.has(s.best.field)) { taken.add(s.best.field); result.set(i, { column: s.column, field: s.best.field, confidence: s.best.score }); } else result.set(i, { column: s.column, confidence: 0 });
  }
  return scored.map((_s, i) => result.get(i) as Suggestion);
}
