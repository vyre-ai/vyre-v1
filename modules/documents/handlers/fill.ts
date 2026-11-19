// from vyre 0.6.9 core/documents/fill.js, core/documents/pdf.js (typed, the engine behind the five documents.* capabilities)
// documents: fill the firm's real Word template with values, deterministically (spec 2.16 and 2.12; ARCH 7.5).
// A filled document is made only by filling a template. Nothing here writes or rewrites document text with a model: a wrong result is fixed by the data or the template.
//
// Placeholders: {client.name} reads client -> name; {#items}{label}{/items} repeats; {#flag}...{/flag} shows its text when flag is true; {^flag}...{/flag} when it is false.
// A value is missing when it is undefined, null or an empty string (0 and false are values). A missing value STOPS the document and names itself; nothing is guessed, defaulted or left blank.
// Formats come from the tag name, never from a model: a tag ending in date shows an ISO date as "October 24, 2026"; a tag ending in fee, amount, price, total, balance, retainer, cost,
// payment or deposit shows a number as $1,234.50. The signing date is an explicit input in ISO form; from it the engine sets signing_date, signing_date_iso, signing_day,
// signing_day_ordinal, signing_month, signing_month_number and signing_year, unless the caller gave that value itself.
// Records: when recordId is given the record's fields feed the tags (mapping names which record field feeds which tag; without a mapping a field feeds the tag of the same name).
// The record type comes from values.recordType when present; otherwise it is looked up from the id (records.get reads a record by type and id).
// Linked records: a tag that reads through a link field ({contact.name}, or a repeat {#contacts}{name}{/contacts}) is fed from the linked record, one step away and no further, read with the
// caller's own access. A link the caller cannot read stops the document and names the field; several records behind a plain tag feed it from the first, in the order the record holds them.
// Record type: a template can be marked for one record type (documents.mark_template recordType); the list filters on it. A template with none is for any record.
// Names: a given name keeps its own spelling; the default is the template name and "(filled)"; a taken name gets " 2", " 3" and so on, an existing file is never replaced.
// PDF: format "pdf" converts the filled Word file through the converter the host gave to configureDocuments; without one the request is refused and the Word file works anywhere.

import { createRequire } from "node:module";
import { ERROR_CODES, VyreErr } from "../../../packages/contracts/src/errors.ts";
import type { Ctx } from "../../../packages/contracts/src/ctx.ts";
import { findRecord } from "../../../lib/record-type.ts";
import { isRawId } from "../../../lib/id-shapes.ts";
import type { ErrorCode, NextStep, VyreError } from "../../../packages/contracts/src/types.ts";

type Row = Record<string, unknown>;

const NEXT: Record<NextStep["kind"], string> = {
  retry: "Try again",
  switch_model: "Switch model",
  use_backup_key: "Use the backup key",
  ask_access: "Ask for access",
  open_settings: "Open settings",
  reconnect: "Reconnect",
  edit_input: "Fix the input",
  wait: "Wait a moment",
  contact_admin: "Contact an admin",
  report: "Report a problem",
};

export function fail(ctx: Ctx, code: ErrorCode, message?: string, details?: Record<string, unknown>): never {
  const def = ERROR_CODES.find((e) => e.code === code) ?? ERROR_CODES.find((e) => e.code === "internal.unexpected");
  if (!def) throw new Error("error catalogue is empty");
  const error: VyreError = {
    code: def.code,
    message: message ?? def.what,
    retryable: def.retryable,
    traceId: ctx.trace.traceId,
    next: def.next.map((kind) => ({ kind, label: NEXT[kind] })),
  };
  if (details) error.details = details;
  throw new VyreErr(error);
}

/**
 * An error a call into another module threw. Matched by its shape, not by class: across the host the error that arrives is not always an instance of this file's VyreErr (a duplicate name
 * made saving a second fill fail on a booted Space while the unit tests, which share the class, passed).
 */
function isVyreError(e: unknown): e is { error: { code: string } } {
  return (
    typeof e === "object" &&
    e !== null &&
    typeof (e as { error?: { code?: unknown } }).error === "object" &&
    typeof (e as { error: { code?: unknown } }).error.code === "string"
  );
}

/** The key of what a call asks, SHA-256 of the ask in full (a short hash could make two different documents share a key, and the second would be answered with the first). Used when the caller gave no key. */
export async function askKey(parts: unknown): Promise<string> {
  return sha256Of(new TextEncoder().encode(JSON.stringify(parts)));
}

/** SHA-256 of some bytes, in hex. */
export async function sha256Of(bytes: Uint8Array): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", bytes as unknown as ArrayBuffer);
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, "0")).join("");
}

// ---- drivers ----

export interface DocumentsDrivers {
  /** A filled .docx to a PDF (Gotenberg beside the host). Absent: PDF is refused in plain words. */
  pdf?(docx: Uint8Array): Promise<Uint8Array>;
  /** how the exact converter stands, for the words when a copy is set in the plain look: ready | pulling | failed | none */
  state?(): string;
}

let configured: DocumentsDrivers | null = null;

/** The host calls this with its drivers. Null clears. */
export function configureDocuments(drivers: DocumentsDrivers | null): void {
  configured = drivers;
}

// ---- the Word libraries, loaded on the first fill or read of a template (idle heap budget) ----

interface ZipEntry {
  asText(): string;
  date: Date;
  _data?: { uncompressedSize?: number };
}
interface Zip {
  files: Record<string, ZipEntry>;
  file(name: string): ZipEntry | null;
  generate(o: { type: "nodebuffer"; compression?: string; compressionOptions?: { level: number } }): Buffer;
}
type ZipCtor = new (data?: Uint8Array) => Zip;
interface TagTree {
  [name: string]: TagTree;
}
interface Templater {
  render(values: unknown): void;
  getZip(): Zip;
  getTags(): Record<string, { tags?: TagTree } | undefined>;
}
type TemplaterCtor = new (zip: Zip, options: Record<string, unknown>) => Templater;

const need = createRequire(import.meta.url);
let pizzip: ZipCtor | null = null;
let docxtemplater: TemplaterCtor | null = null;
const zipLib = (): ZipCtor => (pizzip ??= need("pizzip") as ZipCtor);
const templaterLib = (): TemplaterCtor => (docxtemplater ??= need("docxtemplater") as TemplaterCtor);

/** One date for every entry, so the same input is the same bytes. */
const FIXED = new Date(Date.UTC(2000, 0, 1, 0, 0, 0));
/** The most a template may weigh and the most entries it may hold (a bomb is refused before it is read). */
export const MAX_BYTES = 10 * 1024 * 1024;
const MAX_ENTRIES = 2000;
const MAX_UNPACKED = 80 * 1024 * 1024;

export type FillCode = "bad_input" | "bad_date" | "too_big" | "bad_template" | "missing_values" | "unprintable";

export class FillError extends Error {
  readonly code: FillCode;
  readonly missing: string[];
  constructor(code: FillCode, message: string, missing: string[] = []) {
    super(message);
    this.code = code;
    this.missing = missing;
  }
}

// ---- reading a template ----

/** The value of a path like "client.name" or "items.0.label" in the scope stack, innermost first; undefined when any step is not there. */
export function lookup(scopes: unknown[], path: string): unknown {
  const parts = path.split(".");
  for (let i = scopes.length - 1; i >= 0; i--) {
    const s = scopes[i];
    if (
      s === null ||
      s === undefined ||
      typeof s !== "object" ||
      !Object.prototype.hasOwnProperty.call(s, parts[0] as string)
    )
      continue;
    let v: unknown = s;
    for (const p of parts) {
      if (v === null || v === undefined || typeof v !== "object" || !Object.prototype.hasOwnProperty.call(v, p))
        return undefined;
      v = (v as Record<string, unknown>)[p];
    }
    return v;
  }
  return undefined;
}

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

export type TagKind = "text" | "date" | "money";

/** What a tag is, from its name alone. */
export function kindOf(name: string): TagKind {
  const leaf = (name.split(".").pop() ?? name).toLowerCase();
  if (/(^|_)date$/.test(leaf) || leaf === "dob") return "date";
  if (/(^|_)(fee|fees|amount|price|total|balance|retainer|cost|payment|deposit)$/.test(leaf)) return "money";
  return "text";
}

function money(n: number): string {
  const fixed = Math.abs(n).toFixed(2);
  const [whole = "0", cents = "00"] = fixed.split(".");
  return `${n < 0 ? "-" : ""}$${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${cents}`;
}

function show(kind: TagKind, v: string | number): string | number {
  if (kind === "date" && typeof v === "string") {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
    if (m) return `${MONTHS[Number(m[2]) - 1] ?? m[2]} ${Number(m[3])}, ${m[1]}`;
  }
  if (kind === "money" && typeof v === "number" && Number.isFinite(v)) return money(v);
  return v;
}

const OPEN = "";
const MID = "";
const CLOSE = "";

/** Why a value could not be printed, by tag. The fill is refused with these in plain words. */
export type Problems = Map<string, string>;
const SEALED_WORDS = "is a sealed value, and a sealed value is never printed in a document";
const ID_WORDS = "points to something that cannot be named here (it may be gone, or not yours to open)";

const CURRENCY_SIGN: Record<string, string> = { USD: "$", EUR: "€", GBP: "£", JPY: "¥", INR: "₹" };

/** A money value ({ amount, currency }) as an amount in its currency: $1,250.00. */
function moneyIn(amount: number, currency: string): string {
  const sign = CURRENCY_SIGN[currency];
  const body = money(amount);
  if (sign === undefined) return `${body.replace("$", "")} ${currency}`;
  return body.replace("$", sign);
}

/** A span in milliseconds as a person says it: "2 hours 30 minutes", "3 days". */
function spanIn(ms: number): string {
  const min = Math.floor(Math.max(0, ms) / 60_000);
  if (min < 1) return "less than a minute";
  const days = Math.floor(min / 1440);
  const hours = Math.floor((min % 1440) / 60);
  const mins = min % 60;
  const unit = (n: number, w: string): string => `${n} ${w}${n === 1 ? "" : "s"}`;
  return [days > 0 ? unit(days, "day") : "", hours > 0 ? unit(hours, "hour") : "", mins > 0 ? unit(mins, "minute") : ""]
    .filter(Boolean)
    .join(" ");
}

function stampIn(iso: string): string {
  const d = new Date(iso);
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}, ${hh}:${mm} UTC`;
}

const durationTag = (tag: string): boolean =>
  /(^|_)(duration|effort)$/.test((tag.split(".").pop() ?? tag).toLowerCase());

/** One value as the text a document prints. A value that has no honest printed form is noted in `problems` (the fill is then refused) and prints as nothing. */
export function printed(raw: unknown, tag: string, problems: Problems): string | number {
  if (typeof raw === "string") {
    if (isRawId(raw)) {
      problems.set(tag, ID_WORDS);
      return "";
    }
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(raw) && !Number.isNaN(Date.parse(raw))) return stampIn(raw);
    return show(kindOf(tag), raw);
  }
  if (typeof raw === "number") {
    if (durationTag(tag) && Number.isFinite(raw)) return spanIn(raw);
    return show(kindOf(tag), raw);
  }
  if (typeof raw === "boolean") return raw ? "Yes" : "No";
  if (Array.isArray(raw))
    return raw
      .map((x) => String(printed(x, tag, problems)))
      .filter((x) => x !== "")
      .join(", ");
  if (isPlain(raw)) {
    if (raw.sealed !== undefined) {
      problems.set(tag, SEALED_WORDS);
      return "";
    }
    if (typeof raw.amount === "number" && typeof raw.currency === "string") return moneyIn(raw.amount, raw.currency);
    if (typeof raw.line1 === "string") {
      const part = (k: string): string => (typeof raw[k] === "string" ? String(raw[k]).trim() : "");
      const regionPostal = [part("region"), part("postal")].filter(Boolean).join(" ");
      return [part("line1"), part("line2"), part("city"), regionPostal, part("country")].filter(Boolean).join(", ");
    }
  }
  problems.set(tag, `is a group of values; name one part of it, such as {${tag}.name}`);
  return "";
}

/** The parser docxtemplater asks for: dotted paths, `.` for the current item of a loop, formats from the tag name; with `marks` every shown value is wrapped so a preview can find it. */
function parserFor(
  marks: string[] | null,
  problems: Problems = new Map(),
): (
  tag: string,
  options?: { tag?: { module?: unknown } },
) => { get(scope: unknown, ctx?: { scopeList?: unknown[] }): unknown } {
  return (tag: string, options?: { tag?: { module?: unknown } }) => {
    const t = tag.trim();
    const section = Boolean(options?.tag?.module);
    return {
      get: (scope: unknown, ctx?: { scopeList?: unknown[] }): unknown => {
        const raw = t === "." ? scope : lookup(ctx?.scopeList ?? [scope], t);
        if (raw === undefined || raw === null) return raw;
        if (section) return raw;
        const shown = printed(raw, t, problems);
        if (marks === null || shown === "") return shown;
        marks.push(t);
        return `${OPEN}${marks.length - 1}${MID}${String(shown)}${CLOSE}`;
      },
    };
  };
}

/** Open a .docx safely. */
function open(buf: Buffer): Zip {
  if (!Buffer.isBuffer(buf) || buf.length === 0) throw new FillError("bad_input", "the template is empty");
  if (buf.length > MAX_BYTES)
    throw new FillError("too_big", `the template is ${buf.length} bytes; the most is ${MAX_BYTES}`);
  let zip: Zip;
  try {
    zip = new (zipLib())(buf);
  } catch {
    throw new FillError("bad_input", "that is not a Word (.docx) file");
  }
  const names = Object.keys(zip.files);
  if (names.length > MAX_ENTRIES) throw new FillError("bad_template", "that .docx holds too many parts");
  if (!zip.file("word/document.xml"))
    throw new FillError("bad_input", "that is not a Word (.docx) file: it has no word/document.xml");
  // a Word file with macros (a .docm renamed, or macros put in a .docx) is never a template: nothing in a template may run
  const types = String(zip.file("[Content_Types].xml")?.asText() ?? "");
  if (
    names.some(
      (n) => /(^|\/)vbaProject\.bin$|(^|\/)vbaData\.xml$/i.test(n) || /^word\/(activeX|embeddings)\//i.test(n),
    ) ||
    /macroEnabled|vbaProject/i.test(types)
  )
    throw new FillError(
      "bad_template",
      "that Word file has macros or embedded programs; save it as a plain .docx without them",
    );
  let total = 0;
  for (const n of names) total += zip.files[n]?._data?.uncompressedSize ?? 0;
  if (total > MAX_UNPACKED) throw new FillError("too_big", "that .docx unpacks to more than it may");
  return zip;
}

/** The text of every part that can hold a placeholder, tags stripped so a placeholder Word split across runs reads whole. */
function plainText(zip: Zip): string {
  return Object.keys(zip.files)
    .filter((n) => /^word\/(document|header\d*|footer\d*|footnotes|endnotes)\.xml$/.test(n))
    .map((n) =>
      String(zip.file(n)?.asText() ?? "")
        .replace(/<w:p[ >]/g, "\n<w:p ")
        .replace(/<[^>]+>/g, ""),
    )
    .join("\n");
}

/** A template that will not compile, said in plain words: where Word split a tag, the tag. */
function templateError(e: unknown): FillError {
  const errs = (e as { properties?: { errors?: unknown } } | null)?.properties?.errors;
  const list = Array.isArray(errs)
    ? (errs as { message?: unknown; properties?: { explanation?: unknown; id?: unknown } }[])
    : [];
  const said = list
    .map((x) => String(x.properties?.explanation ?? x.properties?.id ?? x.message ?? "").slice(0, 200))
    .filter(Boolean)
    .slice(0, 4);
  return new FillError(
    "bad_template",
    `the template has a placeholder that cannot be read${said.length > 0 ? `: ${said.join("; ")}` : ""}`,
  );
}

function compile(zip: Zip, options: Record<string, unknown>): Templater {
  try {
    return new (templaterLib())(zip, {
      paragraphLoop: true,
      linebreaks: true,
      delimiters: { start: "{", end: "}" },
      ...options,
    });
  } catch (e) {
    throw templateError(e);
  }
}

export interface Placeholders {
  /** Plain value tags in the order they first appear. */
  names: string[];
  /** Repeating or conditional sections that hold tags of their own (each needs a list or a true/false). */
  loops: string[];
  /** Sections that hold no tag, and inverted sections: a missing one reads as false. */
  conditions: string[];
  loopFields: Record<string, string[]>;
  loopLeaves: Record<string, string[]>;
}

/** The names a template asks for. The fields of a loop belong to the loop (loopLeaves has them in full, "spouse.name" for a field read through a link). */
export function placeholders(buf: Buffer): Placeholders {
  const zip = open(buf);
  const doc = compile(zip, { parser: parserFor(null) });
  const text = plainText(zip);
  const sections = [...text.matchAll(/\{([#^])\s*([A-Za-z0-9_.]+)\s*\}/g)];
  const inverted = new Set(sections.filter((m) => m[1] === "^").map((m) => m[2] as string));
  const sectionNames = [...new Set(sections.map((m) => m[2] as string))];
  const names = new Set<string>();
  const loopFields: Record<string, string[]> = {};
  const loopLeaves: Record<string, string[]> = {};
  const leaves = (node: TagTree, prefix: string, acc: string[]): string[] => {
    for (const [k, v] of Object.entries(node)) {
      const full = prefix ? `${prefix}.${k}` : k;
      if (Object.keys(v).length > 0) leaves(v, full, acc);
      else acc.push(full);
    }
    return acc;
  };
  const walk = (node: TagTree, prefix: string): void => {
    for (const [k, v] of Object.entries(node)) {
      const full = prefix ? `${prefix}.${k}` : k;
      if (Object.keys(v).length > 0) {
        // A section's own fields belong to the section (listed under it), not to the document.
        if (sectionNames.includes(full)) {
          loopFields[full] = Object.keys(v);
          loopLeaves[full] = leaves(v, "", []);
        } else walk(v, full);
      } else if (!sectionNames.includes(full)) names.add(full);
    }
  };
  // getTags() answers per part of the file: { document: { tags, target }, header1: { ... } }.
  for (const part of Object.values(doc.getTags())) walk(part?.tags ?? {}, "");
  const loops = sectionNames.filter((n) => n in loopFields && !inverted.has(n));
  const conditions = sectionNames.filter((n) => !loops.includes(n));
  return { names: [...names], loops, conditions, loopFields, loopLeaves };
}

// ---- values ----

function isPlain(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function merge(base: Record<string, unknown>, over: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(over)) {
    const cur = out[k];
    out[k] = isPlain(cur) && isPlain(v) ? merge(cur, v) : v;
  }
  return out;
}

function setPath(target: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split(".");
  let at = target;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i] as string;
    const cur = at[p];
    if (isPlain(cur)) at = cur;
    else {
      const next: Record<string, unknown> = {};
      at[p] = next;
      at = next;
    }
  }
  at[parts[parts.length - 1] as string] = value;
}

function leafKeys(node: Record<string, unknown>, prefix = ""): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(node)) {
    const full = prefix ? `${prefix}.${k}` : k;
    if (isPlain(v)) out.push(...leafKeys(v, full));
    else out.push(full);
  }
  return out;
}

const isEmptyList = (v: unknown): boolean => Array.isArray(v) && v.length === 0;
const blank = (v: unknown): boolean => v === undefined || v === null || v === "";

function ordinal(n: number): string {
  const tail = n % 100;
  if (tail >= 11 && tail <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
}

/** signing_date and its parts from one ISO date. */
export function signingValues(iso: string): Record<string, unknown> {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) throw new FillError("bad_date", "the signing date is an ISO date: 2026-10-24");
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const check = new Date(Date.UTC(y, mo - 1, d));
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d)
    throw new FillError("bad_date", "the signing date is not a real date");
  return {
    signing_date: iso,
    signing_date_iso: iso,
    signing_day: String(d),
    signing_day_ordinal: ordinal(d),
    signing_month: MONTHS[mo - 1],
    signing_month_number: String(mo),
    signing_year: String(y),
  };
}

// ---- rendering ----

interface Rendered {
  zip: Zip;
  used: string[];
  missing: string[];
  marks: string[];
}

/** Render with the values. Never throws for a missing value: the caller decides (fill refuses, preview lists). */
function render(buf: Buffer, values: Record<string, unknown>, mark: boolean): Rendered {
  const zip = open(buf);
  const missing = new Set<string>();
  const marks: string[] = [];
  const problems: Problems = new Map();
  const doc = compile(zip, {
    parser: parserFor(mark ? marks : null, problems),
    // Called for any placeholder whose value is undefined or null; the document is refused by fill, whatever this returns.
    // A section tag ({#x}, {^x}) is asked too (part.module is set): an absent section reads as false, and one that holds tags is checked below.
    nullGetter: (part: { value?: unknown; module?: unknown } | undefined) => {
      if (part?.module) return null;
      missing.add(String(part?.value ?? "?"));
      return "";
    },
  });
  try {
    doc.render(values);
  } catch (e) {
    if (missing.size === 0) throw templateError(e);
  }
  if (problems.size > 0) {
    const fields = [...problems.keys()].sort();
    throw new FillError(
      "unprintable",
      `the document was not made: ${fields.map((f) => `${f} ${problems.get(f)}`).join("; ")}`,
      fields,
    );
  }
  // A blank is missing too (an empty string in a legal paper is a mistake), and so is a section with no list or no true/false: docxtemplater renders nothing for either without asking.
  const info = placeholders(buf);
  for (const n of info.names) {
    if (
      !info.loops.some((l) => n.startsWith(`${l}.`)) &&
      (lookup([values], n) === "" || isEmptyList(lookup([values], n)))
    )
      missing.add(n);
  }
  for (const l of info.loops) if (blank(lookup([values], l))) missing.add(l);
  const out = doc.getZip();
  for (const n of Object.keys(out.files)) {
    const entry = out.files[n];
    if (entry) entry.date = FIXED;
  }
  return { zip: out, used: [...info.names, ...info.loops, ...info.conditions], missing: [...missing].sort(), marks };
}

/** Fill a template. Every placeholder must have a value: otherwise nothing is made and the error names each missing one. */
export function fill(buf: Buffer, values: Record<string, unknown>): { buffer: Buffer; used: string[] } {
  const r = render(buf, values, false);
  if (r.missing.length > 0) {
    throw new FillError(
      "missing_values",
      `the document was not made: ${r.missing.length === 1 ? "this value is" : "these values are"} missing: ${r.missing.join(", ")}`,
      r.missing,
    );
  }
  return {
    buffer: r.zip.generate({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 6 } }),
    used: r.used,
  };
}

export interface Excerpt {
  text: string;
  filled: { from: number; to: number; field: string }[];
}

const unescapeXml = (s: string): string =>
  s
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");

const MAX_EXCERPT = 200;

/** The filled paragraphs as plain text, each filled value located by offsets into that paragraph's text. */
function excerptOf(zip: Zip, marks: string[]): Excerpt[] {
  const xml = String(zip.file("word/document.xml")?.asText() ?? "");
  const out: Excerpt[] = [];
  for (const p of xml.matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)) {
    if (out.length >= MAX_EXCERPT) break;
    const stripped = p[0]
      .replace(/<w:tab\s*\/>/g, "\t")
      .replace(/<w:br\s*\/>/g, "\n")
      .replace(/<[^>]+>/g, "");
    let text = "";
    const filled: Excerpt["filled"] = [];
    let last = 0;
    for (const m of stripped.matchAll(new RegExp(`${OPEN}(\\d+)${MID}([\\s\\S]*?)${CLOSE}`, "g"))) {
      text += unescapeXml(stripped.slice(last, m.index));
      const value = unescapeXml(m[2] as string);
      filled.push({ from: text.length, to: text.length + value.length, field: marks[Number(m[1])] ?? "?" });
      text += value;
      last = (m.index ?? 0) + m[0].length;
    }
    text += unescapeXml(stripped.slice(last));
    if (text.trim() !== "") out.push({ text, filled });
  }
  return out;
}

export function preview(
  buf: Buffer,
  values: Record<string, unknown>,
  given: string[],
): { excerpt: Excerpt[]; missing: string[]; unused: string[] } {
  const r = render(buf, values, true);
  return { excerpt: excerptOf(r.zip, r.marks), missing: r.missing, unused: unusedOf(buf, given) };
}

/** Keys the caller gave that no tag reads. */
function unusedOf(buf: Buffer, given: string[]): string[] {
  return unusedFor(placeholders(buf), given);
}

/** Keys the caller gave that nothing the template asks for reads. */
export function unusedFor(info: Placeholders, given: string[]): string[] {
  const read = (k: string): boolean =>
    info.names.includes(k) ||
    info.loops.includes(k) ||
    info.conditions.includes(k) ||
    info.loops.some((l) => k.startsWith(`${l}.`)) ||
    info.names.some((n) => n.startsWith(`${k}.`));
  return [...new Set(given)].filter((k) => !read(k)).sort();
}

// ---- the capabilities ----

export const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const PAGE_MAX = 500;

export function rec(ctx: Ctx, input: unknown): Record<string, unknown> {
  if (!isPlain(input)) fail(ctx, "validation.bad_input", "The input is not valid.");
  return input;
}

export function reqStr(ctx: Ctx, o: Record<string, unknown>, key: string): string {
  const v = o[key];
  if (typeof v !== "string" || v.length === 0)
    fail(ctx, "validation.bad_input", "The input is not valid.", { field: key });
  return v;
}

export function optStr(ctx: Ctx, o: Record<string, unknown>, key: string): string | undefined {
  const v = o[key];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "string" || v.length === 0)
    fail(ctx, "validation.bad_input", "The input is not valid.", { field: key });
  return v;
}

function optRec(ctx: Ctx, o: Record<string, unknown>, key: string): Record<string, unknown> | undefined {
  const v = o[key];
  if (v === undefined || v === null) return undefined;
  if (!isPlain(v)) fail(ctx, "validation.bad_input", "The input is not valid.", { field: key });
  return v;
}

/** The fill engine's refusals as the catalogue's codes. */
export function refuse(ctx: Ctx, e: unknown): never {
  if (!(e instanceof FillError)) throw e;
  switch (e.code) {
    case "bad_input":
      return fail(ctx, "validation.unsupported", `${e.message}.`);
    case "bad_date":
      return fail(ctx, "validation.bad_input", `${e.message}.`, { field: "signingDate" });
    case "too_big":
      return fail(ctx, "validation.too_large", `${e.message}.`);
    case "bad_template":
      return fail(ctx, "validation.precondition_failed", `${e.message}.`);
    case "missing_values":
      return fail(ctx, "validation.precondition_failed", `${e.message}.`, { missing: e.missing });
    case "unprintable":
      return fail(ctx, "validation.precondition_failed", `${e.message}.`, { fields: e.missing });
  }
}

export function mayView(ctx: Ctx, fileId: string): void {
  const d = ctx.authorize({ perm: null, level: "view" }, { type: "file", id: fileId });
  if (d.effect !== "allow") fail(ctx, "permission.no_grant", "You cannot open that template.", { fileId });
}

export async function templateBytes(ctx: Ctx, fileId: string): Promise<Buffer> {
  mayView(ctx, fileId);
  const got = (await ctx.call("files.read", { fileId, as: "base64" })) as { base64?: unknown; truncated?: unknown };
  if (typeof got.base64 !== "string" || got.truncated === true)
    fail(ctx, "internal.unexpected", "The template could not be read whole.", { fileId });
  return Buffer.from(got.base64, "base64");
}

/** A kind of template other than Word: which files it is, and how it reads what a template asks for. The Vyre document registers itself (native.ts). */
export interface TemplateReader {
  test(name: string): boolean;
  asked(bytes: Buffer): Placeholders;
}
const readers: TemplateReader[] = [];
export function addTemplateReader(r: TemplateReader): void {
  if (!readers.includes(r)) readers.push(r);
}
const readerFor = (name: string): TemplateReader | undefined => readers.find((r) => r.test(name));

const cache = new Map<string, number>();

async function fieldCount(ctx: Ctx, fileId: string, version: number, name: string): Promise<number> {
  const key = `${ctx.space}:${fileId}:${version}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  let n = 0;
  try {
    const bytes = await templateBytes(ctx, fileId);
    const info = (readerFor(name)?.asked ?? placeholders)(bytes);
    n = info.names.length + info.loops.length;
  } catch {
    n = 0;
  }
  if (cache.size > 2000) cache.clear();
  cache.set(key, n);
  return n;
}

export async function fieldsOf(
  ctx: Ctx,
  input: unknown,
): Promise<{
  fields: { name: string; kind: string; required: boolean; loop?: string }[];
  loops: string[];
  problems: { message: string; tag?: string }[];
}> {
  const o = rec(ctx, input);
  const bytes = await templateBytes(ctx, reqStr(ctx, o, "templateFileId"));
  let info: Placeholders;
  try {
    info = placeholders(bytes);
  } catch (e) {
    if (e instanceof FillError && e.code === "bad_template")
      return { fields: [], loops: [], problems: [{ message: `${e.message}.` }] };
    return refuse(ctx, e);
  }
  const fields: { name: string; kind: string; required: boolean; loop?: string }[] = [];
  for (const name of info.names) fields.push({ name, kind: kindOf(name), required: true });
  for (const loop of info.loops) {
    fields.push({ name: loop, kind: "loop", required: true });
    for (const leaf of info.loopLeaves[loop] ?? [])
      fields.push({ name: leaf, kind: kindOf(leaf), required: true, loop });
  }
  for (const c of info.conditions) fields.push({ name: c, kind: "condition", required: false });
  return { fields, loops: info.loops, problems: [] };
}

/** A link to a file or a record is printed as its name, never as its id. What cannot be named (gone, or not the caller's to open) stays an id, and the fill is refused naming the field. */
async function nameIds(ctx: Ctx, value: unknown, seen: Map<string, string | undefined> = new Map()): Promise<unknown> {
  if (Array.isArray(value)) return Promise.all(value.map((x) => nameIds(ctx, x, seen)));
  if (isPlain(value)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = await nameIds(ctx, v, seen);
    return out;
  }
  if (typeof value !== "string" || !isRawId(value)) return value;
  const id = value.trim();
  if (!seen.has(id)) {
    let name: string | undefined;
    try {
      if (id.startsWith("fil_")) {
        const got = (await ctx.call("files.get", { fileId: id })) as { file?: { name?: unknown } };
        if (typeof got.file?.name === "string") name = got.file.name;
      } else if (id.startsWith("rec_")) {
        const call = (cap: string, input: unknown): Promise<unknown> => ctx.call(cap as never, input as never);
        const found = await findRecord(call, id);
        const fields = isPlain(found?.record.fields) ? found.record.fields : {};
        const pick = [fields.name, fields.title, fields.label, ...Object.values(fields)].find(
          (x) => typeof x === "string" && x.trim() !== "" && !isRawId(x),
        );
        if (typeof pick === "string") name = pick;
      }
    } catch (e) {
      if (!isVyreError(e)) throw e;
    }
    seen.set(id, name);
  }
  return seen.get(id) ?? value;
}

const recIds = (v: unknown): string[] | null => {
  if (typeof v === "string") return isRawId(v) && v.trim().startsWith("rec_") ? [v.trim()] : null;
  if (
    Array.isArray(v) &&
    v.length > 0 &&
    v.every((x) => typeof x === "string" && isRawId(x) && x.trim().startsWith("rec_"))
  )
    return (v as string[]).map((x) => x.trim());
  return null;
};

/** The first step of every dotted name: the fields a template (or a mapping) reads through. */
const headsOf = (names: readonly string[]): Set<string> =>
  new Set(names.filter((n) => n.includes(".")).map((n) => n.slice(0, n.indexOf("."))));

/**
 * The record's fields with each link the template reads through replaced by the linked record's own fields: one record for a plain tag ({contact.name}), a list for a repeat ({#contacts}).
 * One step only: a link inside a linked record stays what it was. A linked record the caller cannot read stops the document and names the field.
 */
async function withLinks(
  ctx: Ctx,
  fields: Record<string, unknown>,
  heads: Set<string>,
  loops: readonly string[],
): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = { ...fields };
  const call = (cap: string, input: unknown): Promise<unknown> => ctx.call(cap as never, input as never);
  const seen = new Map<string, Record<string, unknown> | undefined>();
  for (const head of new Set([...heads, ...loops])) {
    const ids = recIds(fields[head]);
    if (ids === null) continue;
    const linked: Record<string, unknown>[] = [];
    for (const id of loops.includes(head) ? ids : ids.slice(0, 1)) {
      if (!seen.has(id)) {
        let found: { record: { fields?: unknown } } | undefined;
        try {
          found = await findRecord(call, id);
        } catch (e) {
          if (!isVyreError(e)) throw e;
        }
        seen.set(id, found && isPlain(found.record.fields) ? found.record.fields : undefined);
      }
      const got = seen.get(id);
      if (got === undefined)
        fail(
          ctx,
          "validation.precondition_failed",
          `The document was not made: ${head} links to a record that cannot be read here (it may be gone, or not yours to open).`,
          { fields: [head] },
        );
      linked.push(got);
    }
    out[head] = loops.includes(head) ? linked : linked[0];
  }
  return out;
}

/** The values to render with, the keys the caller gave itself, and the record they came from. `info` is what the template asks for: it decides which links are followed. */
export async function valuesOf(
  ctx: Ctx,
  o: Record<string, unknown>,
  info: Placeholders | null,
): Promise<{ values: Record<string, unknown>; given: string[] }> {
  const explicit = optRec(ctx, o, "values") ?? {};
  const mapping = optRec(ctx, o, "mapping");
  const recordId = optStr(ctx, o, "recordId");
  let values: Record<string, unknown> = {};
  const given = leafKeys(explicit);
  if (recordId !== undefined) {
    // records.get reads a record by type and id: the type comes from values.recordType, or is looked up from the id (the read that finds it is the read)
    const typeGiven = typeof explicit.recordType === "string" ? explicit.recordType : undefined;
    const call = (cap: string, input: unknown): Promise<unknown> => ctx.call(cap as never, input as never);
    const got =
      typeGiven !== undefined
        ? ((await call("records.get", { type: typeGiven, recordId })) as { record?: { fields?: unknown } })
        : { record: (await findRecord(call, recordId))?.record };
    if (!got.record) fail(ctx, "validation.not_found", "That record does not exist.");
    const rawFields = got.record?.fields;
    const own = isPlain(rawFields) ? rawFields : {};
    if (mapping) {
      const keys: string[] = [];
      for (const key of Object.values(mapping)) {
        if (typeof key !== "string") fail(ctx, "validation.bad_input", "The input is not valid.", { field: "mapping" });
        keys.push(key);
      }
      // a mapping may read through a link ("contact.email"); a key the record holds under that very name wins
      const fields = await withLinks(ctx, own, headsOf(keys.filter((k) => !(k in own))), []);
      for (const [tag, key] of Object.entries(mapping) as [string, string][]) {
        setPath(values, tag, key in own ? own[key] : lookup([fields], key));
        given.push(tag);
      }
    } else {
      values = info
        ? await withLinks(
            ctx,
            own,
            headsOf([...info.names, ...Object.values(info.loopLeaves).flat()]),
            info.loops.filter((l) => !l.includes(".")),
          )
        : { ...own };
    }
  }
  values = merge(values, explicit);
  delete values.recordType;
  values = (await nameIds(ctx, values)) as Record<string, unknown>;
  const date = optStr(ctx, o, "signingDate");
  if (date !== undefined) {
    try {
      values = merge(signingValues(date), values);
    } catch (e) {
      refuse(ctx, e);
    }
  }
  return { values, given: given.filter((k) => k !== "recordType") };
}

/** What a template asks for, or null when it cannot be read (the fill then says why, in its own words). */
function asked(bytes: Buffer): Placeholders | null {
  try {
    return placeholders(bytes);
  } catch (e) {
    if (e instanceof FillError) return null;
    throw e;
  }
}

export async function previewFill(
  ctx: Ctx,
  input: unknown,
): Promise<{ excerpt: Excerpt[]; missing: string[]; unused: string[] }> {
  const o = rec(ctx, input);
  const bytes = await templateBytes(ctx, reqStr(ctx, o, "templateFileId"));
  const { values, given } = await valuesOf(ctx, o, asked(bytes));
  try {
    return preview(bytes, values, given);
  } catch (e) {
    return refuse(ctx, e);
  }
}

export const baseName = (name: string): string => {
  const i = name.lastIndexOf(".");
  return i > 0 ? name.slice(0, i) : name;
};

/** Write a new file under the first free name: "<stem>.<ext>", then "<stem> 2.<ext>" and so on. An existing file is never replaced; a retry with the same key makes the same file once. */
export async function saveNamed(
  ctx: Ctx,
  f: { folderId: string; stem: string; ext: string; bytes: Uint8Array; mime: string; kind: string; key: string },
): Promise<{ fileId: string; name: string; versionId: string }> {
  let created: { file?: { fileId?: unknown; name?: unknown } } | undefined;
  let name = "";
  for (let n = 1; n <= 50 && created === undefined; n++) {
    name = `${n === 1 ? f.stem : `${f.stem} ${n}`}.${f.ext}`;
    try {
      created = (await ctx.call("files.create", {
        folderId: f.folderId,
        name,
        content: { base64: Buffer.from(f.bytes).toString("base64") },
        mime: f.mime,
        kind: f.kind,
        // the caller's own key and the name tried, so a retry of this fill creates the same file once
        idempotencyKey: `${f.key}:${name}`,
      })) as { file?: { fileId?: unknown; name?: unknown } };
    } catch (e) {
      if (isVyreError(e) && e.error.code === "validation.duplicate") continue;
      throw e;
    }
  }
  const fileId = created?.file?.fileId;
  if (typeof fileId !== "string")
    return fail(ctx, "validation.duplicate", "Too many files with that name are already in the folder.", { name });
  const versions = (await ctx.call("files.versions", { fileId })) as {
    versions?: { versionId?: unknown; n?: unknown }[];
  };
  const newest = [...(versions.versions ?? [])].sort((a, b) => Number(b.n) - Number(a.n))[0];
  return {
    fileId,
    name: typeof created?.file?.name === "string" ? created.file.name : name,
    versionId: typeof newest?.versionId === "string" ? newest.versionId : "",
  };
}

export async function documentsFill(
  ctx: Ctx,
  input: unknown,
): Promise<{
  file: { fileId: string; name: string; versionId: string };
  missing: string[];
  unused: string[];
  layout?: "word" | "simple";
  converter?: "pulling" | "failed" | "none";
}> {
  const o = rec(ctx, input);
  const templateFileId = reqStr(ctx, o, "templateFileId");
  const intoFolderId = reqStr(ctx, o, "intoFolderId");
  const format = optStr(ctx, o, "format") ?? "docx";
  if (format !== "docx" && format !== "pdf")
    fail(ctx, "validation.bad_input", "The format is docx or pdf.", { field: "format" });
  const template = (await ctx.call("files.get", { fileId: templateFileId })) as {
    file?: { name?: unknown; version?: unknown };
  };
  const templateName = typeof template.file?.name === "string" ? template.file.name : "document.docx";
  const bytes = await templateBytes(ctx, templateFileId);
  const { values, given } = await valuesOf(ctx, o, asked(bytes));
  let made: { buffer: Buffer; used: string[] };
  let unused: string[];
  try {
    made = fill(bytes, values);
    unused = unusedOf(bytes, given);
  } catch (e) {
    return refuse(ctx, e);
  }
  let out: Uint8Array = made.buffer;
  let layout: "word" | "simple" | undefined;
  let converter: "pulling" | "failed" | "none" | undefined;
  if (format === "pdf") {
    const got = await wordToPdf(ctx, made.buffer, baseName(templateName));
    out = got.pdf;
    layout = got.layout;
    converter = got.converter;
  }
  const ext = format === "pdf" ? "pdf" : "docx";
  const wanted = optStr(ctx, o, "name");
  const stem =
    wanted !== undefined ? wanted.replace(new RegExp(`\\.${ext}$`, "i"), "") : `${baseName(templateName)} (filled)`;
  const saved = await saveNamed(ctx, {
    folderId: intoFolderId,
    stem,
    ext,
    bytes: out,
    mime: format === "pdf" ? "application/pdf" : DOCX_MIME,
    kind: format === "pdf" ? "pdf" : "document",
    key: `docfill:${optStr(ctx, o, "idempotencyKey") ?? `${templateFileId}:${await askKey([values, o.signingDate, o.name, format, (template.file as { version?: unknown } | undefined)?.version])}`}`,
  });
  const { fileId, versionId } = saved;
  // a PDF set in the plain page look is a preview of the Word file: its bytes are marked, so signing holds it (and any copy of it) until the sender chooses (documents.signing says plain)
  if (layout === "simple")
    ctx.db.run("INSERT OR IGNORE INTO documents_plain (sha256, made_at) VALUES (?, ?)", await sha256Of(out), ctx.now());
  const payload: Record<string, unknown> = { fileId, templateFileId, fields: made.used.length, missing: 0 };
  const recordId = optStr(ctx, o, "recordId");
  if (recordId !== undefined) payload.recordId = recordId;
  ctx.emit("document.filled", `file/${fileId}`, payload);
  ctx.log.info("documents.fill", { fileId, templateFileId, fields: made.used.length, format });
  return {
    file: { fileId, name: saved.name, versionId },
    missing: [],
    unused,
    ...(layout ? { layout } : {}),
    ...(converter ? { converter } : {}),
  };
}

/**
 * A filled Word file as a PDF. The host's converter (LibreOffice) keeps the page exactly; where the host has none, or it fails, the words are set in the plain Vyre page look
 * (docx.ts and typeset.ts) so a Space with nothing installed still gets a PDF to sign. The answer says which one it was; a person is never told a plain layout is the Word page.
 */
async function wordToPdf(
  ctx: Ctx,
  docx: Uint8Array,
  title: string,
): Promise<{ pdf: Uint8Array; layout: "word" | "simple"; converter?: "pulling" | "failed" | "none" }> {
  if (configured?.pdf) {
    try {
      return { pdf: await configured.pdf(docx), layout: "word" };
    } catch (e) {
      ctx.log.warn("documents.pdf_converter_failed", { error: e instanceof Error ? e.message : String(e) });
    }
  }
  const { docxBlocks } = await import("./docx.ts");
  const { TypesetError, typeset } = await import("./typeset.ts");
  try {
    const set = await typeset(docxBlocks(docx), { title });
    const st = configured?.state?.();
    return {
      pdf: set.pdf,
      layout: "simple",
      ...(st === "pulling" || st === "failed" || st === "none" ? { converter: st } : {}),
    };
  } catch (e) {
    if (e instanceof TypesetError)
      return fail(
        ctx,
        "validation.unsupported",
        `The PDF was not made: the document has ${e.letters.length === 1 ? "a letter" : "letters"} the plain PDF cannot draw (${e.letters.join(" ")}). Ask for the Word file instead.`,
        { letters: e.letters },
      );
    return fail(
      ctx,
      "validation.unsupported",
      `The PDF was not made: ${e instanceof Error ? e.message : "the Word file could not be read"}.`,
    );
  }
}

async function templatesList(
  ctx: Ctx,
  input: unknown,
): Promise<{
  templates: {
    fileId: string;
    name: string;
    folderId: string;
    fields: number;
    updatedAt: number;
    recordType?: string;
  }[];
  next?: string;
  total: number;
}> {
  const o = rec(ctx, input);
  const folder = optStr(ctx, o, "folder");
  const recordType = optStr(ctx, o, "recordType");
  // a name is matched whole, whatever its case and with or without ".docx": "service agreement" finds "Service agreement.docx"
  const wanted = optStr(ctx, o, "name")?.trim().toLowerCase();
  const limit = typeof o.limit === "number" ? o.limit : 100;
  if (!Number.isInteger(limit) || limit < 1 || limit > PAGE_MAX)
    fail(ctx, "validation.bad_input", "The input is not valid.", { field: "limit" });
  // A cursor is the offset the previous page named; one that is not a number starts again from the top.
  const cursor = optStr(ctx, o, "cursor");
  const offset = cursor !== undefined && /^[0-9]+$/.test(cursor) ? Number(cursor) : 0;
  const marked = ctx.db.all("SELECT * FROM documents_template") as Row[];
  const rows: {
    fileId: string;
    name: string;
    folderId: string;
    version: number;
    updatedAt: number;
    recordType?: string;
  }[] = [];
  for (const m of marked) {
    const fileId = String(m.file_id);
    const type = typeof m.record_type === "string" && m.record_type !== "" ? m.record_type : undefined;
    if (recordType !== undefined && type !== recordType) continue;
    try {
      const got = (await ctx.call("files.get", { fileId })) as {
        file?: { name?: unknown; folderId?: unknown; version?: unknown; updatedAt?: unknown; deletedAt?: unknown };
      };
      const f = got.file;
      if (!f || (f.deletedAt !== undefined && f.deletedAt !== null)) continue;
      if (folder !== undefined && f.folderId !== folder) continue;
      const name = String(f.name);
      if (wanted !== undefined && name.toLowerCase() !== wanted && baseName(name).toLowerCase() !== wanted) continue;
      rows.push({
        fileId,
        name,
        folderId: String(f.folderId),
        version: Number(f.version) || 1,
        updatedAt: Number(f.updatedAt) || 0,
        ...(type !== undefined ? { recordType: type } : {}),
      });
    } catch (e) {
      // not visible to the caller or gone: not in their list
      if (!isVyreError(e)) throw e;
    }
  }
  rows.sort((a, b) => a.name.localeCompare(b.name) || a.fileId.localeCompare(b.fileId));
  const page = rows.slice(offset, offset + limit);
  const templates = [];
  for (const r of page)
    templates.push({
      fileId: r.fileId,
      name: r.name,
      folderId: r.folderId,
      fields: await fieldCount(ctx, r.fileId, r.version, r.name),
      updatedAt: r.updatedAt,
      ...(r.recordType !== undefined ? { recordType: r.recordType } : {}),
    });
  const out: { templates: typeof templates; next?: string; total: number } = { templates, total: rows.length };
  if (offset + limit < rows.length) out.next = String(offset + limit);
  return out;
}

async function markTemplate(ctx: Ctx, input: unknown): Promise<{ ok: boolean }> {
  const o = rec(ctx, input);
  const fileId = reqStr(ctx, o, "fileId");
  if (typeof o.isTemplate !== "boolean")
    fail(ctx, "validation.bad_input", "The input is not valid.", { field: "isTemplate" });
  const isTemplate = o.isTemplate;
  const recordType = optStr(ctx, o, "recordType");
  const got = (await ctx.call("files.get", { fileId })) as { file?: { name?: unknown; size?: unknown } };
  const name = typeof got.file?.name === "string" ? got.file.name : "";
  if (isTemplate && typeof got.file?.size === "number" && got.file.size > MAX_BYTES && /\.docx$/i.test(name))
    fail(
      ctx,
      "validation.too_large",
      `That Word file is ${Math.ceil(got.file.size / 1048576)} MB; a template may be at most ${MAX_BYTES / 1048576} MB.`,
      { fileId },
    );
  if (isTemplate && /\.docm$/i.test(name))
    fail(
      ctx,
      "validation.unsupported",
      "A Word file with macros (.docm) cannot be a template. Save it as a plain .docx.",
      { fileId },
    );
  if (isTemplate && !/\.docx$/i.test(name) && !readerFor(name))
    fail(ctx, "validation.unsupported", "Only a Word (.docx) file or a Vyre document (.md) can be a template.", {
      fileId,
    });
  // a Word template is checked when it is marked, not only when it is first used: a file that is not a real .docx, is too big, or carries macros is refused here in plain words
  if (isTemplate && /\.docx$/i.test(name)) {
    const bytes = await templateBytes(ctx, fileId);
    try {
      open(bytes);
    } catch (e) {
      return refuse(ctx, e);
    }
  }
  if (isTemplate && recordType !== undefined) {
    // the type must be one this Space has: a template for a type that does not exist would never show on any record
    let known = false;
    let cursor: string | undefined;
    do {
      const page = (await ctx.call("schema.types.list", cursor !== undefined ? { cursor } : {})) as {
        types?: { key?: unknown }[];
        next?: unknown;
      };
      known = (page.types ?? []).some((t) => t.key === recordType);
      cursor = typeof page.next === "string" ? page.next : undefined;
    } while (!known && cursor !== undefined);
    if (!known)
      fail(ctx, "validation.not_found", `There is no record type called ${recordType}.`, { field: "recordType" });
  }
  const row = (ctx.db.all("SELECT * FROM documents_template WHERE file_id = ?", fileId) as Row[])[0];
  if (isTemplate && !row)
    ctx.db.run(
      "INSERT INTO documents_template (file_id, marked_by, marked_at, record_type) VALUES (?, ?, ?, ?)",
      fileId,
      ctx.principal.id,
      ctx.now(),
      recordType ?? null,
    );
  else if (isTemplate && row && recordType !== undefined && row.record_type !== recordType)
    ctx.db.run("UPDATE documents_template SET record_type = ? WHERE file_id = ?", recordType, fileId);
  else if (!isTemplate && row) ctx.db.run("DELETE FROM documents_template WHERE file_id = ?", fileId);
  else return { ok: true };
  ctx.emit("document.template_marked", `file/${fileId}`, {
    fileId,
    isTemplate,
    ...(isTemplate && recordType !== undefined ? { recordType } : {}),
  });
  ctx.log.info("documents.mark_template", { fileId, isTemplate, recordType: recordType ?? null });
  return { ok: true };
}

export { markTemplate, templatesList };

export const fillHandlers = {
  "documents.fields": fieldsOf,
  "documents.preview_fill": previewFill,
  "documents.fill": documentsFill,
  "documents.templates.list": templatesList,
  "documents.mark_template": markTemplate,
};
