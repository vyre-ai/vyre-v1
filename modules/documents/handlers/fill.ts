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
// The record type comes from the recordType input (or values.recordType); a recordId without one is refused, because records.get reads a record by type and id.
// Names: a given name keeps its own spelling; the default is the template name and "(filled)"; a taken name gets " 2", " 3" and so on, an existing file is never replaced.
// PDF: format "pdf" converts the filled Word file through the converter the host gave to configureDocuments; without one the request is refused and the Word file works anywhere.

import { createRequire } from "node:module";
import { ERROR_CODES, VyreErr } from "../../../packages/contracts/src/errors.ts";
import type { Ctx } from "../../../packages/contracts/src/ctx.ts";
import type { ErrorCode, NextStep, VyreError } from "../../../packages/contracts/src/types.ts";

type Row = Record<string, unknown>;

const NEXT: Record<NextStep["kind"], string> = {
  retry: "Try again", switch_model: "Switch model", use_backup_key: "Use the backup key", ask_access: "Ask for access", open_settings: "Open settings",
  reconnect: "Reconnect", edit_input: "Fix the input", wait: "Wait a moment", contact_admin: "Contact an admin", report: "Report a problem",
};

function fail(ctx: Ctx, code: ErrorCode, message?: string, details?: Record<string, unknown>): never {
  const def = ERROR_CODES.find((e) => e.code === code) ?? ERROR_CODES.find((e) => e.code === "internal.unexpected");
  if (!def) throw new Error("error catalogue is empty");
  const error: VyreError = {
    code: def.code, message: message ?? def.what, retryable: def.retryable, traceId: ctx.trace.traceId,
    next: def.next.map((kind) => ({ kind, label: NEXT[kind] })),
  };
  if (details) error.details = details;
  throw new VyreErr(error);
}

// ---- drivers ----

export interface DocumentsDrivers {
  /** A filled .docx to a PDF (Gotenberg beside the host). Absent: PDF is refused in plain words. */
  pdf?(docx: Uint8Array): Promise<Uint8Array>;
}

let configured: DocumentsDrivers | null = null;

/** The host calls this with its drivers. Null clears. */
export function configureDocuments(drivers: DocumentsDrivers | null): void {
  configured = drivers;
}

// ---- the Word libraries, loaded on the first fill or read of a template (idle heap budget) ----

interface ZipEntry { asText(): string; date: Date; _data?: { uncompressedSize?: number } }
interface Zip {
  files: Record<string, ZipEntry>;
  file(name: string): ZipEntry | null;
  generate(o: { type: "nodebuffer"; compression?: string; compressionOptions?: { level: number } }): Buffer;
}
type ZipCtor = new (data?: Uint8Array) => Zip;
interface TagTree { [name: string]: TagTree }
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

export type FillCode = "bad_input" | "bad_date" | "too_big" | "bad_template" | "missing_values";

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
function lookup(scopes: unknown[], path: string): unknown {
  const parts = path.split(".");
  for (let i = scopes.length - 1; i >= 0; i--) {
    const s = scopes[i];
    if (s === null || s === undefined || typeof s !== "object" || !Object.prototype.hasOwnProperty.call(s, parts[0] as string)) continue;
    let v: unknown = s;
    for (const p of parts) {
      if (v === null || v === undefined || typeof v !== "object" || !Object.prototype.hasOwnProperty.call(v, p)) return undefined;
      v = (v as Record<string, unknown>)[p];
    }
    return v;
  }
  return undefined;
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

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

/** The parser docxtemplater asks for: dotted paths, `.` for the current item of a loop, formats from the tag name; with `marks` every shown value is wrapped so a preview can find it. */
function parserFor(marks: string[] | null): (tag: string) => { get(scope: unknown, ctx?: { scopeList?: unknown[] }): unknown } {
  return (tag: string) => {
    const t = tag.trim();
    return {
      get: (scope: unknown, ctx?: { scopeList?: unknown[] }): unknown => {
        const raw = t === "." ? scope : lookup(ctx?.scopeList ?? [scope], t);
        if (raw === undefined || raw === null) return raw;
        if (typeof raw !== "string" && typeof raw !== "number") return raw;
        const shown = show(kindOf(t), raw);
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
  if (buf.length > MAX_BYTES) throw new FillError("too_big", `the template is ${buf.length} bytes; the most is ${MAX_BYTES}`);
  let zip: Zip;
  try {
    zip = new (zipLib())(buf);
  } catch {
    throw new FillError("bad_input", "that is not a Word (.docx) file");
  }
  const names = Object.keys(zip.files);
  if (names.length > MAX_ENTRIES) throw new FillError("bad_template", "that .docx holds too many parts");
  if (!zip.file("word/document.xml")) throw new FillError("bad_input", "that is not a Word (.docx) file: it has no word/document.xml");
  let total = 0;
  for (const n of names) total += zip.files[n]?._data?.uncompressedSize ?? 0;
  if (total > MAX_UNPACKED) throw new FillError("too_big", "that .docx unpacks to more than it may");
  return zip;
}

/** The text of every part that can hold a placeholder, tags stripped so a placeholder Word split across runs reads whole. */
function plainText(zip: Zip): string {
  return Object.keys(zip.files)
    .filter((n) => /^word\/(document|header\d*|footer\d*|footnotes|endnotes)\.xml$/.test(n))
    .map((n) => String(zip.file(n)?.asText() ?? "").replace(/<w:p[ >]/g, "\n<w:p ").replace(/<[^>]+>/g, ""))
    .join("\n");
}

/** A template that will not compile, said in plain words: where Word split a tag, the tag. */
function templateError(e: unknown): FillError {
  const errs = (e as { properties?: { errors?: unknown } } | null)?.properties?.errors;
  const list = Array.isArray(errs) ? (errs as { message?: unknown; properties?: { explanation?: unknown; id?: unknown } }[]) : [];
  const said = list.map((x) => String(x.properties?.explanation ?? x.properties?.id ?? x.message ?? "").slice(0, 200)).filter(Boolean).slice(0, 4);
  return new FillError("bad_template", `the template has a placeholder that cannot be read${said.length > 0 ? `: ${said.join("; ")}` : ""}`);
}

function compile(zip: Zip, options: Record<string, unknown>): Templater {
  try {
    return new (templaterLib())(zip, { paragraphLoop: true, linebreaks: true, delimiters: { start: "{", end: "}" }, ...options });
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
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) throw new FillError("bad_date", "the signing date is not a real date");
  return {
    signing_date: iso, signing_date_iso: iso, signing_day: String(d), signing_day_ordinal: ordinal(d),
    signing_month: MONTHS[mo - 1], signing_month_number: String(mo), signing_year: String(y),
  };
}

// ---- rendering ----

interface Rendered { zip: Zip; used: string[]; missing: string[]; marks: string[] }

/** Render with the values. Never throws for a missing value: the caller decides (fill refuses, preview lists). */
function render(buf: Buffer, values: Record<string, unknown>, mark: boolean): Rendered {
  const zip = open(buf);
  const missing = new Set<string>();
  const marks: string[] = [];
  const doc = compile(zip, {
    parser: parserFor(mark ? marks : null),
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
  // A blank is missing too (an empty string in a legal paper is a mistake), and so is a section with no list or no true/false: docxtemplater renders nothing for either without asking.
  const info = placeholders(buf);
  for (const n of info.names) {
    if (!info.loops.some((l) => n.startsWith(`${l}.`)) && lookup([values], n) === "") missing.add(n);
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
    throw new FillError("missing_values", `the document was not made: ${r.missing.length === 1 ? "this value is" : "these values are"} missing: ${r.missing.join(", ")}`, r.missing);
  }
  return { buffer: r.zip.generate({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 6 } }), used: r.used };
}

export interface Excerpt { text: string; filled: { from: number; to: number; field: string }[] }

const unescapeXml = (s: string): string =>
  s.replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

const MAX_EXCERPT = 200;

/** The filled paragraphs as plain text, each filled value located by offsets into that paragraph's text. */
function excerptOf(zip: Zip, marks: string[]): Excerpt[] {
  const xml = String(zip.file("word/document.xml")?.asText() ?? "");
  const out: Excerpt[] = [];
  for (const p of xml.matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)) {
    if (out.length >= MAX_EXCERPT) break;
    const stripped = p[0].replace(/<w:tab\s*\/>/g, "\t").replace(/<w:br\s*\/>/g, "\n").replace(/<[^>]+>/g, "");
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

export function preview(buf: Buffer, values: Record<string, unknown>, given: string[]): { excerpt: Excerpt[]; missing: string[]; unused: string[] } {
  const r = render(buf, values, true);
  return { excerpt: excerptOf(r.zip, r.marks), missing: r.missing, unused: unusedOf(buf, given) };
}

/** Keys the caller gave that no tag reads. */
function unusedOf(buf: Buffer, given: string[]): string[] {
  const info = placeholders(buf);
  const read = (k: string): boolean =>
    info.names.includes(k) || info.loops.includes(k) || info.conditions.includes(k)
    || info.loops.some((l) => k.startsWith(`${l}.`)) || info.names.some((n) => n.startsWith(`${k}.`));
  return [...new Set(given)].filter((k) => !read(k)).sort();
}

// ---- the capabilities ----

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const PAGE_MAX = 500;

function rec(ctx: Ctx, input: unknown): Record<string, unknown> {
  if (!isPlain(input)) fail(ctx, "validation.bad_input", "The input is not valid.");
  return input;
}

function reqStr(ctx: Ctx, o: Record<string, unknown>, key: string): string {
  const v = o[key];
  if (typeof v !== "string" || v.length === 0) fail(ctx, "validation.bad_input", "The input is not valid.", { field: key });
  return v;
}

function optStr(ctx: Ctx, o: Record<string, unknown>, key: string): string | undefined {
  const v = o[key];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "string" || v.length === 0) fail(ctx, "validation.bad_input", "The input is not valid.", { field: key });
  return v;
}

function optRec(ctx: Ctx, o: Record<string, unknown>, key: string): Record<string, unknown> | undefined {
  const v = o[key];
  if (v === undefined || v === null) return undefined;
  if (!isPlain(v)) fail(ctx, "validation.bad_input", "The input is not valid.", { field: key });
  return v;
}

/** The fill engine's refusals as the catalogue's codes. */
function refuse(ctx: Ctx, e: unknown): never {
  if (!(e instanceof FillError)) throw e;
  switch (e.code) {
    case "bad_input": return fail(ctx, "validation.unsupported", `${e.message}.`);
    case "bad_date": return fail(ctx, "validation.bad_input", `${e.message}.`, { field: "signingDate" });
    case "too_big": return fail(ctx, "validation.too_large", `${e.message}.`);
    case "bad_template": return fail(ctx, "validation.precondition_failed", `${e.message}.`);
    case "missing_values": return fail(ctx, "validation.precondition_failed", `${e.message}.`, { missing: e.missing });
  }
}

function mayView(ctx: Ctx, fileId: string): void {
  const d = ctx.authorize({ perm: null, level: "view" }, { type: "file", id: fileId });
  if (d.effect !== "allow") fail(ctx, "permission.no_grant", "You cannot open that template.", { fileId });
}

async function templateBytes(ctx: Ctx, fileId: string): Promise<Buffer> {
  mayView(ctx, fileId);
  const got = (await ctx.call("files.read", { fileId, as: "base64" })) as { base64?: unknown; truncated?: unknown };
  if (typeof got.base64 !== "string" || got.truncated === true) fail(ctx, "internal.unexpected", "The template could not be read whole.", { fileId });
  return Buffer.from(got.base64, "base64");
}

const cache = new Map<string, number>();

async function fieldCount(ctx: Ctx, fileId: string, version: number): Promise<number> {
  const key = `${ctx.space}:${fileId}:${version}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  let n = 0;
  try {
    const info = placeholders(await templateBytes(ctx, fileId));
    n = info.names.length + info.loops.length;
  } catch {
    n = 0;
  }
  if (cache.size > 2000) cache.clear();
  cache.set(key, n);
  return n;
}

async function fieldsOf(ctx: Ctx, input: unknown): Promise<{ fields: { name: string; kind: string; required: boolean; loop?: string }[]; loops: string[]; problems: { message: string; tag?: string }[] }> {
  const o = rec(ctx, input);
  const bytes = await templateBytes(ctx, reqStr(ctx, o, "templateFileId"));
  let info: Placeholders;
  try {
    info = placeholders(bytes);
  } catch (e) {
    if (e instanceof FillError && e.code === "bad_template") return { fields: [], loops: [], problems: [{ message: `${e.message}.` }] };
    return refuse(ctx, e);
  }
  const fields: { name: string; kind: string; required: boolean; loop?: string }[] = [];
  for (const name of info.names) fields.push({ name, kind: kindOf(name), required: true });
  for (const loop of info.loops) {
    fields.push({ name: loop, kind: "loop", required: true });
    for (const leaf of info.loopLeaves[loop] ?? []) fields.push({ name: leaf, kind: kindOf(leaf), required: true, loop });
  }
  for (const c of info.conditions) fields.push({ name: c, kind: "condition", required: false });
  return { fields, loops: info.loops, problems: [] };
}

/** The values to render with, the keys the caller gave itself, and the record they came from. */
async function valuesOf(ctx: Ctx, o: Record<string, unknown>): Promise<{ values: Record<string, unknown>; given: string[] }> {
  const explicit = optRec(ctx, o, "values") ?? {};
  const mapping = optRec(ctx, o, "mapping");
  const recordId = optStr(ctx, o, "recordId");
  let values: Record<string, unknown> = {};
  const given = leafKeys(explicit);
  if (recordId !== undefined) {
    const type = optStr(ctx, o, "recordType") ?? (typeof explicit.recordType === "string" ? explicit.recordType : undefined);
    if (type === undefined) fail(ctx, "validation.bad_input", "recordType is required with recordId", { field: "recordType" });
    const got = (await ctx.call("records.get", { type, recordId })) as { record?: { fields?: unknown } };
    const rawFields = got.record?.fields;
    const fields = isPlain(rawFields) ? rawFields : {};
    if (mapping) {
      for (const [tag, key] of Object.entries(mapping)) {
        if (typeof key !== "string") fail(ctx, "validation.bad_input", "The input is not valid.", { field: "mapping" });
        setPath(values, tag, fields[key]);
        given.push(tag);
      }
    } else {
      values = { ...fields };
    }
  }
  values = merge(values, explicit);
  delete values.recordType;
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

async function previewFill(ctx: Ctx, input: unknown): Promise<{ excerpt: Excerpt[]; missing: string[]; unused: string[] }> {
  const o = rec(ctx, input);
  const bytes = await templateBytes(ctx, reqStr(ctx, o, "templateFileId"));
  const { values, given } = await valuesOf(ctx, o);
  try {
    return preview(bytes, values, given);
  } catch (e) {
    return refuse(ctx, e);
  }
}

const baseName = (name: string): string => {
  const i = name.lastIndexOf(".");
  return i > 0 ? name.slice(0, i) : name;
};

async function documentsFill(ctx: Ctx, input: unknown): Promise<{ file: { fileId: string; name: string; versionId: string }; missing: string[]; unused: string[] }> {
  const o = rec(ctx, input);
  const templateFileId = reqStr(ctx, o, "templateFileId");
  const intoFolderId = reqStr(ctx, o, "intoFolderId");
  const format = optStr(ctx, o, "format") ?? "docx";
  if (format !== "docx" && format !== "pdf") fail(ctx, "validation.bad_input", "The format is docx or pdf.", { field: "format" });
  if (format === "pdf" && !configured?.pdf) {
    fail(ctx, "validation.unsupported", "PDF needs a converter: install the PDF converter app from Apps. The Word file works anywhere: ask for that instead.");
  }
  const template = (await ctx.call("files.get", { fileId: templateFileId })) as { file?: { name?: unknown } };
  const templateName = typeof template.file?.name === "string" ? template.file.name : "document.docx";
  const bytes = await templateBytes(ctx, templateFileId);
  const { values, given } = await valuesOf(ctx, o);
  let made: { buffer: Buffer; used: string[] };
  let unused: string[];
  try {
    made = fill(bytes, values);
    unused = unusedOf(bytes, given);
  } catch (e) {
    return refuse(ctx, e);
  }
  let out: Uint8Array = made.buffer;
  if (format === "pdf" && configured?.pdf) out = await configured.pdf(made.buffer);
  const ext = format === "pdf" ? "pdf" : "docx";
  const wanted = optStr(ctx, o, "name");
  const stem = wanted !== undefined ? wanted.replace(new RegExp(`\\.${ext}$`, "i"), "") : `${baseName(templateName)} (filled)`;
  let created: { file?: { fileId?: unknown; name?: unknown } } | undefined;
  let name = "";
  for (let n = 1; n <= 50 && created === undefined; n++) {
    name = `${n === 1 ? stem : `${stem} ${n}`}.${ext}`;
    try {
      created = (await ctx.call("files.create", {
        folderId: intoFolderId, name, content: { base64: Buffer.from(out).toString("base64") }, mime: format === "pdf" ? "application/pdf" : DOCX_MIME, kind: format === "pdf" ? "pdf" : "document",
        // the caller's own key and the name tried, so a retry of this fill creates the same file once
        idempotencyKey: `docfill:${optStr(ctx, o, "idempotencyKey") ?? templateFileId}:${name}`,
      })) as { file?: { fileId?: unknown; name?: unknown } };
    } catch (e) {
      if (e instanceof VyreErr && e.error.code === "validation.duplicate") continue;
      throw e;
    }
  }
  const fileId = created?.file?.fileId;
  if (typeof fileId !== "string") return fail(ctx, "validation.duplicate", "Too many files with that name are already in the folder.", { name });
  const versions = (await ctx.call("files.versions", { fileId })) as { versions?: { versionId?: unknown; n?: unknown }[] };
  const newest = [...(versions.versions ?? [])].sort((a, b) => Number(b.n) - Number(a.n))[0];
  const versionId = typeof newest?.versionId === "string" ? newest.versionId : "";
  const payload: Record<string, unknown> = { fileId, templateFileId, fields: made.used.length, missing: 0 };
  const recordId = optStr(ctx, o, "recordId");
  if (recordId !== undefined) payload.recordId = recordId;
  ctx.emit("document.filled", `file/${fileId}`, payload);
  ctx.log.info("documents.fill", { fileId, templateFileId, fields: made.used.length, format });
  return { file: { fileId, name: typeof created?.file?.name === "string" ? created.file.name : name, versionId }, missing: [], unused };
}

async function templatesList(ctx: Ctx, input: unknown): Promise<{ templates: { fileId: string; name: string; folderId: string; fields: number; updatedAt: number }[]; next?: string; total: number }> {
  const o = rec(ctx, input);
  const folder = optStr(ctx, o, "folder");
  const limit = typeof o.limit === "number" ? o.limit : 100;
  if (!Number.isInteger(limit) || limit < 1 || limit > PAGE_MAX) fail(ctx, "validation.bad_input", "The input is not valid.", { field: "limit" });
  // A cursor is the offset the previous page named; one that is not a number starts again from the top.
  const cursor = optStr(ctx, o, "cursor");
  const offset = cursor !== undefined && /^[0-9]+$/.test(cursor) ? Number(cursor) : 0;
  const marked = ctx.db.all("SELECT * FROM documents_template") as Row[];
  const rows: { fileId: string; name: string; folderId: string; version: number; updatedAt: number }[] = [];
  for (const m of marked) {
    const fileId = String(m.file_id);
    try {
      const got = (await ctx.call("files.get", { fileId })) as { file?: { name?: unknown; folderId?: unknown; version?: unknown; updatedAt?: unknown; deletedAt?: unknown } };
      const f = got.file;
      if (!f || (f.deletedAt !== undefined && f.deletedAt !== null)) continue;
      if (folder !== undefined && f.folderId !== folder) continue;
      rows.push({ fileId, name: String(f.name), folderId: String(f.folderId), version: Number(f.version) || 1, updatedAt: Number(f.updatedAt) || 0 });
    } catch (e) {
      // not visible to the caller or gone: not in their list
      if (!(e instanceof VyreErr)) throw e;
    }
  }
  rows.sort((a, b) => a.name.localeCompare(b.name) || a.fileId.localeCompare(b.fileId));
  const page = rows.slice(offset, offset + limit);
  const templates = [];
  for (const r of page) templates.push({ fileId: r.fileId, name: r.name, folderId: r.folderId, fields: await fieldCount(ctx, r.fileId, r.version), updatedAt: r.updatedAt });
  const out: { templates: typeof templates; next?: string; total: number } = { templates, total: rows.length };
  if (offset + limit < rows.length) out.next = String(offset + limit);
  return out;
}

async function markTemplate(ctx: Ctx, input: unknown): Promise<{ ok: boolean }> {
  const o = rec(ctx, input);
  const fileId = reqStr(ctx, o, "fileId");
  if (typeof o.isTemplate !== "boolean") fail(ctx, "validation.bad_input", "The input is not valid.", { field: "isTemplate" });
  const isTemplate = o.isTemplate;
  const got = (await ctx.call("files.get", { fileId })) as { file?: { name?: unknown } };
  const name = typeof got.file?.name === "string" ? got.file.name : "";
  if (isTemplate && !/\.docx$/i.test(name)) fail(ctx, "validation.unsupported", "Only a Word (.docx) file can be a template.", { fileId });
  const row = (ctx.db.all("SELECT * FROM documents_template WHERE file_id = ?", fileId) as Row[])[0];
  if (isTemplate && !row) ctx.db.run("INSERT INTO documents_template (file_id, marked_by, marked_at) VALUES (?, ?, ?)", fileId, ctx.principal.id, ctx.now());
  else if (!isTemplate && row) ctx.db.run("DELETE FROM documents_template WHERE file_id = ?", fileId);
  else return { ok: true };
  ctx.emit("document.template_marked", `file/${fileId}`, { fileId, isTemplate });
  ctx.log.info("documents.mark_template", { fileId, isTemplate });
  return { ok: true };
}

export const fillHandlers = {
  "documents.fields": fieldsOf,
  "documents.preview_fill": previewFill,
  "documents.fill": documentsFill,
  "documents.templates.list": templatesList,
  "documents.mark_template": markTemplate,
};
