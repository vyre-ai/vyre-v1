// Import: reading the sources (spec 2.9, 2.10). Pure readers for CSV text and for .xlsx and .zip files (a zip is read with the platform inflate, so no spreadsheet library is needed),
// and the table a reader hands back: a name, its columns with what they look like, and the rows as text.
// DECISION: an .xlsx cell that is a date (by its number format) is turned into ISO text, so a preview and a mapping see the same thing a person sees; .xls (the old binary format) is refused with
// a message that says to save it as .xlsx or CSV.
import { inflateRawSync } from "node:zlib";
import { inferType } from "./mapping.ts";
import type { Column, Table } from "./projections.ts";

// ---- CSV ----

/** The delimiter a text uses most outside quotes in its first lines: comma, semicolon, tab or pipe. */
export function detectDelimiter(text: string): string {
  const lines = text.replace(/^﻿/, "").split(/\r\n|\n|\r/).slice(0, 10).filter((l) => l !== "");
  let best = ",", bestScore = -1;
  for (const d of [",", ";", "\t", "|"]) {
    const counts = lines.map((l) => { let n = 0, q = false; for (const ch of l) { if (ch === '"') q = !q; else if (ch === d && !q) n++; } return n; });
    if (counts.length === 0 || counts[0] === 0) continue;
    // a delimiter that gives every line the same number of cells is the one
    const same = counts.every((c) => c === counts[0]);
    const score = (same ? 1000 : 0) + (counts[0] ?? 0);
    if (score > bestScore) { best = d; bestScore = score; }
  }
  return best;
}

/** Rows of cells from CSV text (RFC 4180): quoted cells, doubled quotes, newlines inside quotes, any line ending, a leading byte order mark. */
export function parseCsvText(text: string, delimiter: string): string[][] {
  const src = text.replace(/^﻿/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  let started = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i] as string;
    if (quoted) {
      if (ch === '"') { if (src[i + 1] === '"') { cell += '"'; i++; } else quoted = false; } else cell += ch;
      continue;
    }
    if (ch === '"' && cell === "") { quoted = true; started = true; }
    else if (ch === delimiter) { row.push(cell); cell = ""; started = true; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      if (started || cell !== "") { row.push(cell); rows.push(row); }
      row = []; cell = ""; started = false;
    } else { cell += ch; started = true; }
  }
  if (started || cell !== "") { row.push(cell); rows.push(row); }
  return rows;
}

const STAMP = 5;
/** A table from rows of cells: the first row names the columns (or they are called Column 1, Column 2 ...), short rows are padded, blank rows dropped. */
export function tableFrom(name: string, grid: readonly (readonly string[])[], hasHeader = true): Table {
  const rows = grid.filter((r) => r.some((c) => c.trim() !== ""));
  const width = rows.reduce((n, r) => Math.max(n, r.length), 0);
  const head = hasHeader && rows.length > 0 ? rows[0]! : [];
  const body = hasHeader ? rows.slice(1) : rows;
  const names: string[] = [];
  for (let i = 0; i < width; i++) {
    const raw = (head[i] ?? "").trim() || `Column ${i + 1}`;
    let n = raw, k = 2;
    while (names.includes(n)) n = `${raw} ${k++}`;
    names.push(n);
  }
  const data = body.map((r) => names.map((_n, i) => (r[i] ?? "").trim()));
  const columns: Column[] = names.map((n, i) => {
    const cells = data.map((r) => r[i] as string);
    const filled = cells.filter((c) => c !== "");
    return { name: n, inferred: inferType(filled), sample: [...new Set(filled)].slice(0, STAMP), distinct: new Set(filled).size, empty: cells.length - filled.length };
  });
  return { name, columns, rows: data };
}

// ---- zip ----

const u16 = (b: Uint8Array, o: number): number => (b[o] as number) | ((b[o + 1] as number) << 8);
const u32 = (b: Uint8Array, o: number): number => (u16(b, o) | (u16(b, o + 2) << 16)) >>> 0;
const utf8 = (b: Uint8Array): string => new TextDecoder("utf-8").decode(b);

/** The files of a zip, by name. Stored and deflated entries are read; anything else (encrypted, other methods) is skipped. */
export function unzip(bytes: Uint8Array): Map<string, Uint8Array> {
  const out = new Map<string, Uint8Array>();
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65_535); i--) if (u32(bytes, i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error("not a zip file");
  const count = u16(bytes, eocd + 10);
  let p = u32(bytes, eocd + 16);
  for (let n = 0; n < count; n++) {
    if (u32(bytes, p) !== 0x02014b50) break;
    const flags = u16(bytes, p + 8), method = u16(bytes, p + 10), csize = u32(bytes, p + 20);
    const nlen = u16(bytes, p + 28), xlen = u16(bytes, p + 30), clen = u16(bytes, p + 32), local = u32(bytes, p + 42);
    const name = utf8(bytes.subarray(p + 46, p + 46 + nlen));
    p += 46 + nlen + xlen + clen;
    if ((flags & 1) !== 0 || name.endsWith("/")) continue;
    if (u32(bytes, local) !== 0x04034b50) continue;
    const start = local + 30 + u16(bytes, local + 26) + u16(bytes, local + 28);
    const raw = bytes.subarray(start, start + csize);
    if (method === 0) out.set(name, raw);
    else if (method === 8) out.set(name, new Uint8Array(inflateRawSync(raw)));
  }
  return out;
}
export const isZip = (b: Uint8Array): boolean => b.length > 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04;

// ---- xlsx ----

const decode = (s: string): string => s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_m, e: string) => {
  if (e[0] === "#") return String.fromCodePoint(e[1]?.toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
  return ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" } as Record<string, string>)[e.toLowerCase()] ?? "";
});
const attr = (tag: string, name: string): string | undefined => new RegExp(`\\b${name}="([^"]*)"`).exec(tag)?.[1];
const BUILTIN_DATE = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 45, 46, 47, 50, 51, 52, 53, 54, 55, 56, 57, 58]);
const colIndex = (ref: string): number => { let n = 0; for (const ch of /^[A-Z]+/i.exec(ref)?.[0] ?? "A") n = n * 26 + (ch.toUpperCase().charCodeAt(0) - 64); return n - 1; };
const pad = (n: number): string => String(n).padStart(2, "0");
/** An Excel serial date as ISO text: a whole number of days is a date, a fraction adds the time. */
export function serialToIso(serial: number): string {
  const ms = Math.round((serial - 25569) * 86_400_000);
  const d = new Date(ms);
  const day = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  return Number.isInteger(serial) ? day : `${day}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}Z`;
}

export interface Sheet { name: string; rows: string[][] }
/** The sheets of an .xlsx file, in workbook order, as rows of text. */
export function readXlsx(bytes: Uint8Array): Sheet[] {
  if (!isZip(bytes)) throw new Error("This is not an .xlsx file. Save it as .xlsx or CSV and try again.");
  const files = unzip(bytes);
  const text = (name: string): string | undefined => { const f = files.get(name); return f ? utf8(f) : undefined; };
  const workbook = text("xl/workbook.xml");
  if (!workbook) throw new Error("This is not an .xlsx file: it has no workbook.");
  const rels = new Map<string, string>();
  for (const m of (text("xl/_rels/workbook.xml.rels") ?? "").matchAll(/<Relationship\b[^>]*>/g)) {
    const id = attr(m[0], "Id"), target = attr(m[0], "Target");
    if (id && target) rels.set(id, target.startsWith("/") ? target.slice(1) : `xl/${target}`);
  }
  const shared: string[] = [];
  for (const m of (text("xl/sharedStrings.xml") ?? "").matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)) {
    shared.push(decode([...(m[1] ?? "").matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1] ?? "").join("")));
  }
  // which cell styles are dates
  const styles = text("xl/styles.xml") ?? "";
  const custom = new Map<number, string>();
  for (const m of styles.matchAll(/<numFmt\b[^>]*>/g)) { const id = attr(m[0], "numFmtId"), code = attr(m[0], "formatCode"); if (id && code) custom.set(Number(id), decode(code)); }
  const dateStyle: boolean[] = [];
  const cellXfs = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(styles)?.[1] ?? "";
  for (const m of cellXfs.matchAll(/<xf\b[^>]*>/g)) {
    const id = Number(attr(m[0], "numFmtId") ?? 0);
    const code = custom.get(id);
    dateStyle.push(BUILTIN_DATE.has(id) || (code !== undefined && /[dmyhs]/i.test(code.replace(/"[^"]*"|\[[^\]]*\]|\\./g, "")) && !/^[#0.,%\s]+$/.test(code)));
  }
  const sheets: Sheet[] = [];
  for (const m of workbook.matchAll(/<sheet\b[^>]*>/g)) {
    const name = decode(attr(m[0], "name") ?? "Sheet");
    const rid = attr(m[0], "r:id") ?? attr(m[0], "id");
    const path = rid ? rels.get(rid) : undefined;
    const xml = path ? text(path) : undefined;
    if (xml === undefined) continue;
    const grid: string[][] = [];
    for (const rm of xml.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
      const rowNo = Number(attr(rm[1] ?? "", "r") ?? grid.length + 1) - 1;
      const cells: string[] = [];
      for (const cm of (rm[2] ?? "").matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const a = cm[1] ?? "", body = cm[2] ?? "";
        const col = colIndex(attr(a, "r") ?? "A");
        const kind = attr(a, "t") ?? "n";
        const v = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(body)?.[1];
        let value = "";
        if (kind === "s") value = shared[Number(v)] ?? "";
        else if (kind === "inlineStr") value = decode([...body.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1] ?? "").join(""));
        else if (kind === "str") value = decode(v ?? "");
        else if (kind === "b") value = v === "1" ? "TRUE" : "FALSE";
        else if (kind === "e") value = "";
        else if (v !== undefined && v !== "") {
          const n = Number(v);
          value = Number.isFinite(n) && dateStyle[Number(attr(a, "s") ?? 0)] === true ? serialToIso(n) : Number.isFinite(n) ? String(n) : v;
        }
        while (cells.length < col) cells.push("");
        cells[col] = value;
      }
      while (grid.length < rowNo) grid.push([]);
      grid[rowNo] = cells;
    }
    sheets.push({ name, rows: grid });
  }
  return sheets;
}

/** Tables from the CSV files inside a zip (a Notion export): one per file, named for the file without its folder, extension or trailing id. */
export function csvTablesFromZip(bytes: Uint8Array): Table[] {
  const out: Table[] = [];
  for (const [name, data] of unzip(bytes)) {
    if (!/\.csv$/i.test(name) || name.includes("__MACOSX")) continue;
    const base = (name.split("/").pop() ?? name).replace(/\.csv$/i, "").replace(/(_all)?\s+[0-9a-f]{32}$/i, "").trim() || "Table";
    const text = utf8(data);
    out.push(tableFrom(base, parseCsvText(text, detectDelimiter(text))));
  }
  return out;
}
