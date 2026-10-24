// files sheets: spreadsheets as table files (spec 2.16 and 2.12; ARCH 7.5). CSV and XLSX live in the file tree as ordinary files; a Google Sheet in a mounted Drive folder is edited
// through the Sheets API; Excel in SharePoint or OneDrive is an XLSX file that the mount syncs back.
//
// PATH MAPPING: packet P-L4_08 lists modules/documents/handlers/sheets.ts, but the sheets.* capabilities belong to the files manifest (manifests/files.ts) and the host serves a
// capability only from its own module. The handlers therefore live here, in module files, beside the tree and version handlers they call.
//
// Row ids: a row id is stable for the life of the row. Ids are kept in files_sheet_ids per file and sheet, written together with every version this module commits. When the sidecar
// is missing or older than the file (the file was saved, restored or synced some other way) the ids are derived as r<version>_<position> for that version only, so an id read before
// an outside save is refused afterwards (validation.precondition_failed) instead of pointing at a different row. Ids minted here are r_<n> from a counter that never goes back.
//
// Parallel runs: every change is one row-level operation. Changes to one file run one after another (a per-file queue), each reads the newest version, applies its row operation
// and writes with baseVersion; a save from outside that lands in between makes the write fail with version_conflict and the operation is read and applied again (never a whole-file overwrite).
// Every write is a version whose reason names the automation and run.

import { createRequire } from "node:module";
import { ERROR_CODES, VyreErr } from "../../../packages/contracts/src/errors.ts";
import type { Ctx } from "../../../packages/contracts/src/ctx.ts";
import type { ErrorCode, NextStep, VyreError } from "../../../packages/contracts/src/types.ts";
import { MAX_UPLOAD, treeHandlers } from "./tree.ts";

type Row = Record<string, unknown>;
export type Cell = string | number | boolean;

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

const isNull = (v: unknown): boolean => v === null || v === undefined;
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v !== "" && Number.isFinite(Number(v)) ? Number(v) : 0);
const one = (ctx: Ctx, sql: string, ...args: unknown[]): Row | undefined => (ctx.db.all(sql, ...args) as Row[])[0];

function rec(ctx: Ctx, input: unknown): Record<string, unknown> {
  if (input === null || typeof input !== "object" || Array.isArray(input)) fail(ctx, "validation.bad_input", "The input is not valid.");
  return input as Record<string, unknown>;
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

function recordOf(ctx: Ctx, value: unknown, field: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail(ctx, "validation.bad_input", "The input is not valid.", { field });
  return value as Record<string, unknown>;
}

// ---- drivers: where a Google Sheet's spreadsheet id comes from (the mount that synced it knows) ----

export interface SheetsDrivers {
  /** The Google spreadsheet id of a mounted Google Sheet, or undefined when the file is not one. */
  googleSpreadsheetId(ctx: Ctx, file: { fileId: string; mountId: string }): string | undefined | Promise<string | undefined>;
}

let configured: SheetsDrivers | null = null;

/** The host (mounts) calls this with its drivers. Null clears. Without drivers a Google Sheet is reported as opened in the provider. */
export function configureSheets(drivers: SheetsDrivers | null): void {
  configured = drivers;
}

/** Tests set `afterRead` to run a save "from outside" between an operation's read and its write. */
export const sheetsHooks: { afterRead?: () => Promise<void> } = {};

// ---- the table model ----

interface Grid { columns: string[]; rows: Cell[][] }

interface Book {
  names(): string[];
  grid(name: string): Grid;
  /** Adds the missing column names to the end of the header and pads every row; returns the header after. */
  ensureColumns(name: string, wanted: string[]): string[];
  appendRow(name: string, cells: Cell[]): void;
  setRow(name: string, index: number, cells: Cell[]): void;
  removeRow(name: string, index: number): void;
  addSheet(name: string, columns: string[]): void;
  encode(): Promise<Uint8Array>;
}

const cellText = (v: unknown): string => (v === null || v === undefined ? "" : typeof v === "string" ? v : typeof v === "number" || typeof v === "boolean" ? String(v) : JSON.stringify(v));

// ---- CSV ----

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  for (; i < text.length; i++) {
    const ch = text[i] as string;
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i += 1; } else quoted = false;
      } else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i += 1;
      row.push(cell); cell = "";
      if (!(row.length === 1 && row[0] === "")) rows.push(row);
      row = [];
    } else cell += ch;
  }
  if (cell !== "" || row.length > 0 || quoted) {
    row.push(cell);
    if (!(row.length === 1 && row[0] === "")) rows.push(row);
  }
  return rows;
}

function csvEscape(s: string): string {
  return /[",\n\r]/.test(s) || s !== s.trim() ? `"${s.replace(/"/g, '""')}"` : s;
}

export function writeCsv(columns: string[], rows: string[][]): string {
  if (columns.length === 0) return "";
  const lines = [columns, ...rows].map((r) => r.map(csvEscape).join(","));
  return `${lines.join("\n")}\n`;
}

class CsvBook implements Book {
  readonly sheet: string;
  columns: string[];
  rows: string[][];
  constructor(sheet: string, text: string) {
    this.sheet = sheet;
    const parsed = parseCsv(text);
    const head = parsed[0] ?? [];
    const width = parsed.reduce((m, r) => Math.max(m, r.length), head.length);
    this.columns = head.map((c) => c.trim());
    for (let i = this.columns.length; i < width; i++) this.columns.push(`Column ${i + 1}`);
    this.rows = parsed.slice(1).map((r) => this.columns.map((_, i) => r[i] ?? ""));
  }
  names(): string[] { return [this.sheet]; }
  grid(): Grid { return { columns: [...this.columns], rows: this.rows.map((r) => [...r]) }; }
  ensureColumns(_name: string, wanted: string[]): string[] {
    for (const w of wanted) {
      if (this.columns.includes(w)) continue;
      this.columns.push(w);
      for (const r of this.rows) r.push("");
    }
    return [...this.columns];
  }
  appendRow(_name: string, cells: Cell[]): void { this.rows.push(this.columns.map((_, i) => cellText(cells[i]))); }
  setRow(_name: string, index: number, cells: Cell[]): void { this.rows[index] = this.columns.map((_, i) => cellText(cells[i])); }
  removeRow(_name: string, index: number): void { this.rows.splice(index, 1); }
  addSheet(): void { throw new Error("csv has one sheet"); }
  async encode(): Promise<Uint8Array> { return new TextEncoder().encode(writeCsv(this.columns, this.rows)); }
}

// ---- XLSX (exceljs, loaded when the first workbook is opened) ----

interface XCell { value: unknown }
interface XRow { getCell(col: number): XCell; cellCount: number; actualCellCount: number }
interface XSheet { name: string; rowCount: number; columnCount: number; getRow(n: number): XRow; addRow(values: unknown[]): unknown; spliceRows(start: number, count: number): void }
interface XBook {
  worksheets: XSheet[];
  addWorksheet(name: string): XSheet;
  xlsx: { load(data: Uint8Array): Promise<unknown>; writeBuffer(): Promise<ArrayBuffer | Uint8Array> };
}
type XBookCtor = new () => XBook;

const need = createRequire(import.meta.url);
let excel: { Workbook: XBookCtor } | null = null;
const exceljs = (): { Workbook: XBookCtor } => (excel ??= need("exceljs") as { Workbook: XBookCtor });

/** A cell as a plain value: dates as ISO text, formulas as their result, rich text joined. */
function plainCell(v: unknown): Cell {
  if (v === null || v === undefined) return "";
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return v;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    if ("result" in o) return plainCell(o.result);
    if (Array.isArray(o.richText)) return (o.richText as { text?: unknown }[]).map((p) => cellText(p.text)).join("");
    if (typeof o.text === "string") return o.text;
    if (typeof o.error === "string") return o.error;
  }
  return cellText(v);
}

class XlsxBook implements Book {
  private readonly wb: XBook;
  constructor(wb: XBook) {
    this.wb = wb;
  }
  static async open(bytes: Uint8Array): Promise<XlsxBook> {
    const wb = new (exceljs().Workbook)();
    await wb.xlsx.load(bytes);
    return new XlsxBook(wb);
  }
  static fresh(sheet: string, columns: string[]): XlsxBook {
    const book = new XlsxBook(new (exceljs().Workbook)());
    book.addSheet(sheet, columns);
    return book;
  }
  private sheet(name: string): XSheet {
    const ws = this.wb.worksheets.find((s) => s.name === name);
    if (!ws) throw new Error(`no sheet ${name}`);
    return ws;
  }
  private header(ws: XSheet): string[] {
    const out: string[] = [];
    const row = ws.getRow(1);
    const width = Math.max(ws.columnCount, row.cellCount);
    for (let c = 1; c <= width; c++) out.push(cellText(plainCell(row.getCell(c).value)).trim());
    while (out.length > 0 && out[out.length - 1] === "") out.pop();
    return out.map((h, i) => (h === "" ? `Column ${i + 1}` : h));
  }
  /** Worksheet row numbers of the data rows (blank rows are skipped). */
  private dataRows(ws: XSheet, width: number): number[] {
    const rows: number[] = [];
    for (let r = 2; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      let any = false;
      for (let c = 1; c <= width && !any; c++) any = cellText(plainCell(row.getCell(c).value)) !== "";
      if (any) rows.push(r);
    }
    return rows;
  }
  names(): string[] { return this.wb.worksheets.map((s) => s.name); }
  grid(name: string): Grid {
    const ws = this.sheet(name);
    const columns = this.header(ws);
    const rows = this.dataRows(ws, columns.length).map((r) => columns.map((_, i) => plainCell(ws.getRow(r).getCell(i + 1).value)));
    return { columns, rows };
  }
  ensureColumns(name: string, wanted: string[]): string[] {
    const ws = this.sheet(name);
    const columns = this.header(ws);
    for (const w of wanted) {
      if (columns.includes(w)) continue;
      columns.push(w);
      ws.getRow(1).getCell(columns.length).value = w;
    }
    return columns;
  }
  appendRow(name: string, cells: Cell[]): void { this.sheet(name).addRow(cells.map((c) => c)); }
  setRow(name: string, index: number, cells: Cell[]): void {
    const ws = this.sheet(name);
    const columns = this.header(ws);
    const at = this.dataRows(ws, columns.length)[index];
    if (at === undefined) throw new Error("row is gone");
    const row = ws.getRow(at);
    columns.forEach((_, i) => { row.getCell(i + 1).value = cells[i] ?? ""; });
  }
  removeRow(name: string, index: number): void {
    const ws = this.sheet(name);
    const at = this.dataRows(ws, this.header(ws).length)[index];
    if (at === undefined) throw new Error("row is gone");
    ws.spliceRows(at, 1);
  }
  addSheet(name: string, columns: string[]): void {
    const ws = this.wb.addWorksheet(name);
    if (columns.length > 0) ws.addRow(columns);
  }
  async encode(): Promise<Uint8Array> {
    const out = await this.wb.xlsx.writeBuffer();
    return out instanceof Uint8Array ? out : new Uint8Array(out);
  }
}

// ---- reading and writing the file ----

type Format = "csv" | "xlsx" | "google";

const GOOGLE_SHEET = "application/vnd.google-apps.spreadsheet";
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

function extOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i < 0 ? "" : name.slice(i + 1).toLowerCase();
}

function formatOf(ctx: Ctx, file: Row): Format {
  const name = String(file.name);
  const mime = String(file.mime);
  if (mime === GOOGLE_SHEET) return "google";
  const ext = extOf(name);
  if (ext === "csv") return "csv";
  if (ext === "xlsx") return "xlsx";
  return fail(ctx, "validation.unsupported", "This is not a table file. Sheets work on CSV, XLSX and Google Sheets.", { name });
}

function sheetNameOfCsv(file: Row): string {
  const name = String(file.name);
  const i = name.lastIndexOf(".");
  return i > 0 ? name.slice(0, i) : name;
}

function liveFile(ctx: Ctx, fileId: string): Row {
  const row = one(ctx, "SELECT * FROM files_file WHERE id = ?", fileId);
  if (!row || !isNull(row.deleted_at)) return fail(ctx, "validation.not_found", "That file does not exist.", { fileId });
  return row;
}

function plainBytes(ctx: Ctx, blobId: string): Uint8Array {
  const row = one(ctx, "SELECT * FROM files_blob WHERE id = ?", blobId);
  if (!row) return fail(ctx, "validation.not_found", "That blob is not in the store.", { blobId });
  try {
    return ctx.seal.unseal({ keyId: String(row.key_id), nonce: String(row.nonce), bytes: String(row.bytes) });
  } catch {
    return fail(ctx, "internal.unexpected", "The blob failed its integrity check.", { blobId });
  }
}

async function openBook(ctx: Ctx, file: Row, format: "csv" | "xlsx"): Promise<Book> {
  const bytes = plainBytes(ctx, String(file.blob));
  if (format === "csv") return new CsvBook(sheetNameOfCsv(file), new TextDecoder().decode(bytes));
  try {
    return await XlsxBook.open(bytes);
  } catch {
    return fail(ctx, "validation.unsupported", "That workbook could not be read.", { name: String(file.name) });
  }
}

function pickSheet(ctx: Ctx, book: Book, wanted: string | undefined): string {
  const names = book.names();
  if (wanted === undefined) {
    const first = names[0];
    if (first === undefined) return fail(ctx, "validation.precondition_failed", "The workbook has no sheet.");
    return first;
  }
  if (!names.includes(wanted)) return fail(ctx, "validation.precondition_failed", `There is no sheet named ${wanted}.`, { sheet: wanted, sheets: names });
  return wanted;
}

// ---- row ids ----

interface IdSet { ids: string[]; next: number }

function idsFor(ctx: Ctx, fileId: string, version: number, sheet: string, count: number): IdSet {
  const row = one(ctx, "SELECT * FROM files_sheet_ids WHERE file_id = ? AND sheet = ?", fileId, sheet);
  const next = row ? num(row.next_id) : 0;
  if (row && num(row.version) === version) {
    try {
      const parsed: unknown = JSON.parse(String(row.ids));
      if (Array.isArray(parsed) && parsed.length === count && parsed.every((x) => typeof x === "string")) return { ids: parsed as string[], next };
    } catch {
      // damaged sidecar: derive below
    }
  }
  return { ids: Array.from({ length: count }, (_, i) => `r${version}_${i + 1}`), next };
}

function saveIds(ctx: Ctx, fileId: string, sheet: string, version: number, set: IdSet): void {
  const json = JSON.stringify(set.ids);
  const row = one(ctx, "SELECT * FROM files_sheet_ids WHERE file_id = ? AND sheet = ?", fileId, sheet);
  if (row) ctx.db.run("UPDATE files_sheet_ids SET version = ?, next_id = ?, ids = ? WHERE file_id = ? AND sheet = ?", version, set.next, json, fileId, sheet);
  else ctx.db.run("INSERT INTO files_sheet_ids (file_id, sheet, version, next_id, ids) VALUES (?, ?, ?, ?, ?)", fileId, sheet, version, set.next, json);
}

/** A new row id: r_<n> from the sheet's own counter, which never goes back, so a deleted row's id is never given to another row. */
const mint = (set: IdSet): string => {
  set.next += 1;
  return `r_${set.next}`;
};

// ---- the per-file queue ----

const tails = new Map<string, Promise<unknown>>();

async function queued<T>(key: string, run: () => Promise<T>): Promise<T> {
  const prev = tails.get(key) ?? Promise.resolve();
  const next = prev.then(run);
  const tail = next.then(() => undefined, () => undefined);
  tails.set(key, tail);
  try {
    return await next;
  } finally {
    if (tails.get(key) === tail) tails.delete(key);
  }
}

// ---- version labels ----

function labelOf(ctx: Ctx, given: string | undefined): string {
  const run = ctx.run;
  if (given !== undefined && run !== undefined) return `${given} (run ${run})`;
  if (given !== undefined) return given;
  if (run !== undefined) return `Automation run ${run}`;
  return "Sheet edit";
}

const MAX_RETRIES = 6;

interface EditEnv {
  ctx: Ctx;
  file: Row;
  book: Book;
  sheet: string;
  /** ids of the edited sheet, kept in step with the book by the operation */
  ids: IdSet;
}

interface Edited<T> { out: T; events: { name: "sheet.row_appended" | "sheet.row_updated" | "sheet.row_deleted"; rowId: string; columns?: string[] }[] }

/** Read the newest version, apply one row operation, write with baseVersion; read again when a save from outside got in between. */
async function edit<T>(
  ctx: Ctx, fileId: string, sheetWanted: string | undefined, label: string | undefined, op: (env: EditEnv) => Edited<T>, forceSheet = true,
): Promise<T & { versionId?: string }> {
  return queued(`${ctx.space}:${fileId}`, async () => {
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      const file = liveFile(ctx, fileId);
      const format = formatOf(ctx, file);
      if (format === "google") return fail(ctx, "internal.unexpected", "Google sheets are edited through the provider.");
      const version = num(file.version);
      const book = await openBook(ctx, file, format);
      const sets = new Map<string, IdSet>();
      for (const name of book.names()) sets.set(name, idsFor(ctx, fileId, version, name, book.grid(name).rows.length));
      const sheet = forceSheet ? pickSheet(ctx, book, sheetWanted) : (book.names()[0] ?? "");
      const ids = sets.get(sheet) ?? { ids: [], next: 0 };
      sets.set(sheet, ids);
      const edited = op({ ctx, file, book, sheet, ids });
      if (sheetsHooks.afterRead) await sheetsHooks.afterRead();
      const bytes = await book.encode();
      if (bytes.byteLength > MAX_UPLOAD) return fail(ctx, "validation.too_large", "This table is over the size limit.");
      let wrote: Awaited<ReturnType<(typeof treeHandlers)["files.write"]>>;
      try {
        // the tree handler, not the versions one: a table is never "newest save wins", an outside save in between is a version_conflict and the row operation is read again
        wrote = await treeHandlers["files.write"](ctx, { fileId, content: { base64: Buffer.from(bytes).toString("base64") }, baseVersion: version, reason: labelOf(ctx, label) });
      } catch (e) {
        if (e instanceof VyreErr && e.error.code === "validation.version_conflict") continue;
        throw e;
      }
      if (wrote.versionId !== undefined) {
        const now = wrote.file.version;
        for (const [name, set] of sets) saveIds(ctx, fileId, name, now, set);
      }
      const subject = `file/${fileId}`;
      for (const e of edited.events) {
        const payload: Record<string, unknown> = { fileId, sheet, rowId: e.rowId };
        if (e.columns) payload.columns = e.columns;
        if (ctx.run !== undefined) payload.runId = ctx.run;
        ctx.emit(e.name, subject, payload);
      }
      const out = { ...edited.out } as T & { versionId?: string };
      if (wrote.versionId !== undefined) out.versionId = wrote.versionId;
      return out;
    }
    return fail(ctx, "validation.version_conflict", "The file kept changing while the row was written. Try again.", { fileId });
  });
}

// ---- values and filters ----

function toCell(v: unknown, format: Format): Cell {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if ((typeof v === "number" && Number.isFinite(v)) || typeof v === "boolean") return format === "csv" ? String(v) : v;
  return JSON.stringify(v);
}

function asRecord(columns: string[], cells: Cell[]): Record<string, Cell> {
  const out: Record<string, Cell> = {};
  columns.forEach((c, i) => { out[c] = cells[i] ?? ""; });
  return out;
}

function compare(a: Cell, b: unknown): number {
  const x = typeof a === "number" ? a : Number(a);
  const y = typeof b === "number" ? b : Number(b);
  if (String(a) !== "" && String(b) !== "" && Number.isFinite(x) && Number.isFinite(y)) return x - y;
  const s = String(a);
  const t = cellText(b);
  return s < t ? -1 : s > t ? 1 : 0;
}

function holds(cell: Cell, cond: unknown): boolean {
  if (cond !== null && typeof cond === "object" && !Array.isArray(cond)) {
    return Object.entries(cond as Record<string, unknown>).every(([op, arg]) => {
      switch (op) {
        case "eq": return String(cell) === cellText(arg);
        case "ne": return String(cell) !== cellText(arg);
        case "gt": return compare(cell, arg) > 0;
        case "gte": return compare(cell, arg) >= 0;
        case "lt": return compare(cell, arg) < 0;
        case "lte": return compare(cell, arg) <= 0;
        case "contains": return String(cell).toLowerCase().includes(cellText(arg).toLowerCase());
        case "in": return Array.isArray(arg) && arg.some((a) => String(cell) === cellText(a));
        case "empty": return (String(cell) === "") === (arg !== false);
        default: return false;
      }
    });
  }
  if (Array.isArray(cond)) return cond.some((a) => String(cell) === cellText(a));
  return String(cell) === cellText(cond);
}

/** `where` is {column: value | [values] | {eq, ne, gt, gte, lt, lte, contains, in, empty}}, all columns together. A column the sheet does not have never matches. */
export function matchesWhere(ctx: Ctx, where: unknown, row: Record<string, Cell>): boolean {
  if (where === undefined || where === null) return true;
  if (typeof where !== "object" || Array.isArray(where)) return fail(ctx, "validation.bad_input", "The input is not valid.", { field: "where" });
  return Object.entries(where as Record<string, unknown>).every(([col, cond]) => (col in row ? holds(row[col] as Cell, cond) : false));
}

const KEY_COLUMNS = ["id", "key", "email"];

function keyColumnOf(columns: string[]): string | undefined {
  for (const k of KEY_COLUMNS) {
    const hit = columns.find((c) => c.toLowerCase() === k);
    if (hit !== undefined) return hit;
  }
  return undefined;
}

function checkColumns(ctx: Ctx, columns: unknown, field: string): string[] {
  if (!Array.isArray(columns) || columns.length === 0) return fail(ctx, "validation.bad_input", "The input is not valid.", { field });
  const out: string[] = [];
  for (const c of columns) {
    if (typeof c !== "string" || c.trim().length === 0) return fail(ctx, "validation.bad_input", "A column name cannot be empty.", { field });
    const name = c.trim();
    if (out.includes(name)) return fail(ctx, "validation.duplicate", `The column ${name} is listed twice.`, { field });
    out.push(name);
  }
  return out;
}

function rowCells(columns: string[], values: Record<string, unknown>, format: Format, base?: Cell[]): Cell[] {
  return columns.map((c, i) => (c in values ? toCell(values[c], format) : (base?.[i] ?? "")));
}

function findRow(ctx: Ctx, grid: Grid, ids: IdSet, o: Record<string, unknown>): number {
  const rowId = optStr(ctx, o, "rowId");
  if (rowId !== undefined) {
    const at = ids.ids.indexOf(rowId);
    if (at < 0) return fail(ctx, "validation.precondition_failed", "That row is gone or the sheet changed since it was read. Read the rows again.", { rowId });
    return at;
  }
  const key = o.key;
  if (key === undefined || key === null) return fail(ctx, "validation.bad_input", "Send a rowId or a key.", { field: "rowId" });
  const k = recordOf(ctx, key, "key");
  const column = reqStr(ctx, k, "column");
  const col = grid.columns.indexOf(column);
  if (col < 0) return fail(ctx, "validation.precondition_failed", `There is no column named ${column}.`, { column });
  const hits: number[] = [];
  grid.rows.forEach((r, i) => { if (String(r[col] ?? "") === cellText(k.value)) hits.push(i); });
  if (hits.length === 0) return fail(ctx, "validation.precondition_failed", "No row has that key value.", { column });
  if (hits.length > 1) return fail(ctx, "validation.precondition_failed", "More than one row has that key value; use a row id.", { column, rows: hits.length });
  return hits[0] as number;
}

// ---- the capabilities on tree files (CSV, XLSX) ----

interface SheetInfo { name: string; rows: number; columns: string[]; keyColumn?: string }

function infoOf(book: Book): SheetInfo[] {
  return book.names().map((name) => {
    const g = book.grid(name);
    const out: SheetInfo = { name, rows: g.rows.length, columns: g.columns };
    const key = keyColumnOf(g.columns);
    if (key !== undefined) out.keyColumn = key;
    return out;
  });
}

async function tableFile(ctx: Ctx, fileId: string): Promise<{ file: Row; format: Format; book?: Book }> {
  const file = liveFile(ctx, fileId);
  const format = formatOf(ctx, file);
  if (format === "google") return { file, format };
  return { file, format, book: await openBook(ctx, file, format) };
}

async function readRowsLocal(ctx: Ctx, o: Record<string, unknown>, book: Book, file: Row): Promise<{ rows: { rowId: string; values: Record<string, unknown> }[]; next?: string; total: number }> {
  const sheet = pickSheet(ctx, book, optStr(ctx, o, "sheet"));
  const grid = book.grid(sheet);
  const { ids } = idsFor(ctx, String(file.id), num(file.version), sheet, grid.rows.length);
  const wantCols = Array.isArray(o.columns) ? (o.columns as unknown[]).filter((c): c is string => typeof c === "string") : undefined;
  const hits: { rowId: string; values: Record<string, unknown> }[] = [];
  grid.rows.forEach((cells, i) => {
    const full = asRecord(grid.columns, cells);
    if (!matchesWhere(ctx, o.where, full)) return;
    const values: Record<string, unknown> = {};
    for (const c of grid.columns) if (!wantCols || wantCols.includes(c)) values[c] = full[c];
    hits.push({ rowId: ids[i] as string, values });
  });
  const limit = typeof o.limit === "number" ? o.limit : 100;
  if (limit < 1 || limit > 500) fail(ctx, "validation.bad_input", "The input is not valid.", { field: "limit" });
  const cursor = optStr(ctx, o, "cursor");
  if (cursor !== undefined && !/^[0-9]+$/.test(cursor)) fail(ctx, "validation.bad_input", "The input is not valid.", { field: "cursor" });
  const offset = cursor === undefined ? 0 : Number(cursor);
  const out: { rows: { rowId: string; values: Record<string, unknown> }[]; next?: string; total: number } = { rows: hits.slice(offset, offset + limit), total: hits.length };
  if (offset + limit < hits.length) out.next = String(offset + limit);
  return out;
}

// ---- Google Sheets (through the Sheets API; rows are addressed g<row number>) ----

interface GoogleSheet { sheetId: number; title: string; rows?: number; columns?: number }

async function googleTarget(ctx: Ctx, file: Row): Promise<string> {
  const id = configured ? await configured.googleSpreadsheetId(ctx, { fileId: String(file.id), mountId: String(file.source_mount ?? "") }) : undefined;
  if (id === undefined) return fail(ctx, "validation.unsupported", "This Google Sheet is edited in Google Sheets. Open it there; the mount has not told Vyre which spreadsheet it is.", { fileId: String(file.id) });
  return id;
}

const quoted = (title: string): string => `'${title.replace(/'/g, "''")}'`;

async function gCall<T>(ctx: Ctx, cap: "google.sheets.get_spreadsheet" | "google.sheets.get_values" | "google.sheets.update_values" | "google.sheets.append_values" | "google.sheets.batch_update", input: Record<string, unknown>): Promise<T> {
  return (await ctx.call(cap, input)) as T;
}

async function gSheets(ctx: Ctx, spreadsheetId: string): Promise<GoogleSheet[]> {
  const out = await gCall<{ sheets?: GoogleSheet[] }>(ctx, "google.sheets.get_spreadsheet", { spreadsheetId });
  return out.sheets ?? [];
}

async function gSheet(ctx: Ctx, spreadsheetId: string, wanted: string | undefined): Promise<GoogleSheet> {
  const sheets = await gSheets(ctx, spreadsheetId);
  const hit = wanted === undefined ? sheets[0] : sheets.find((s) => s.title === wanted);
  if (!hit) return fail(ctx, "validation.precondition_failed", wanted === undefined ? "The spreadsheet has no sheet." : `There is no sheet named ${wanted}.`, { sheet: wanted });
  return hit;
}

async function gGrid(ctx: Ctx, spreadsheetId: string, title: string): Promise<Grid> {
  const out = await gCall<{ values?: string[][] }>(ctx, "google.sheets.get_values", { spreadsheetId, range: `${quoted(title)}!A1:ZZ` });
  const all = out.values ?? [];
  const columns = (all[0] ?? []).map((c, i) => (String(c).trim() === "" ? `Column ${i + 1}` : String(c).trim()));
  return { columns, rows: all.slice(1).map((r) => columns.map((_, i) => String(r[i] ?? ""))) };
}

function columnLetter(n: number): string {
  let s = "";
  for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s;
  return s;
}

function gRowNumber(ctx: Ctx, rowId: string): number {
  const m = /^g([0-9]+)$/.exec(rowId);
  const n = m ? Number(m[1]) : 0;
  if (n < 2) return fail(ctx, "validation.precondition_failed", "That is not a row of this sheet.", { rowId });
  return n;
}

function gEmit(ctx: Ctx, fileId: string, name: "sheet.row_appended" | "sheet.row_updated" | "sheet.row_deleted", sheet: string, rowId: string, columns?: string[]): void {
  const payload: Record<string, unknown> = { fileId, sheet, rowId };
  if (columns) payload.columns = columns;
  if (ctx.run !== undefined) payload.runId = ctx.run;
  ctx.emit(name, `file/${fileId}`, payload);
}

async function gEnsureHeader(ctx: Ctx, spreadsheetId: string, title: string, grid: Grid, wanted: string[]): Promise<string[]> {
  const columns = [...grid.columns];
  const before = columns.length;
  for (const w of wanted) if (!columns.includes(w)) columns.push(w);
  if (columns.length !== before) {
    await gCall(ctx, "google.sheets.update_values", { spreadsheetId, range: `${quoted(title)}!A1:${columnLetter(columns.length)}1`, values: [columns], valueInputOption: "RAW" });
  }
  return columns;
}

async function googleHandle(ctx: Ctx, cap: string, o: Record<string, unknown>, file: Row): Promise<unknown> {
  const spreadsheetId = await googleTarget(ctx, file);
  const fileId = String(file.id);
  const wanted = optStr(ctx, o, "sheet");
  if (cap === "sheets.info") {
    const sheets = await gSheets(ctx, spreadsheetId);
    const out: SheetInfo[] = [];
    for (const s of sheets) {
      const g = await gGrid(ctx, spreadsheetId, s.title);
      const info: SheetInfo = { name: s.title, rows: g.rows.length, columns: g.columns };
      const key = keyColumnOf(g.columns);
      if (key !== undefined) info.keyColumn = key;
      out.push(info);
    }
    return { sheets: out };
  }
  if (cap === "sheets.add_sheet") {
    const title = reqStr(ctx, o, "sheet");
    const sheets = await gSheets(ctx, spreadsheetId);
    if (sheets.some((s) => s.title === title)) return fail(ctx, "validation.duplicate", `There is already a sheet named ${title}.`);
    const columns = Array.isArray(o.columns) ? checkColumns(ctx, o.columns, "columns") : [];
    await gCall(ctx, "google.sheets.batch_update", { spreadsheetId, requests: [{ addSheet: { properties: { title } } }] });
    if (columns.length > 0) await gCall(ctx, "google.sheets.update_values", { spreadsheetId, range: `${quoted(title)}!A1:${columnLetter(columns.length)}1`, values: [columns], valueInputOption: "RAW" });
    return { ok: true };
  }
  const sheet = await gSheet(ctx, spreadsheetId, wanted);
  const grid = await gGrid(ctx, spreadsheetId, sheet.title);
  const asText = (v: unknown): string => cellText(toCell(v, "csv"));
  if (cap === "sheets.read_rows") {
    const ids = grid.rows.map((_, i) => `g${i + 2}`);
    const faux: Row = { id: fileId, version: 0 };
    const book: Book = {
      names: () => [sheet.title], grid: () => grid, ensureColumns: () => grid.columns, appendRow: () => undefined, setRow: () => undefined, removeRow: () => undefined,
      addSheet: () => undefined, encode: async () => new Uint8Array(),
    };
    const out = await readRowsLocal(ctx, o, book, faux);
    // readRowsLocal numbers rows r0_n; Google rows are addressed by their row number
    const idOf = (r: { rowId: string }): string => ids[Number(r.rowId.slice(r.rowId.lastIndexOf("_") + 1)) - 1] as string;
    return { ...out, rows: out.rows.map((r) => ({ rowId: idOf(r), values: r.values })) };
  }
  if (cap === "sheets.append_rows") {
    const rows = o.rows;
    if (!Array.isArray(rows) || rows.length === 0) return fail(ctx, "validation.bad_input", "The input is not valid.", { field: "rows" });
    const objs = rows.map((r) => recordOf(ctx, r, "rows"));
    const wantedCols: string[] = [];
    for (const r of objs) for (const k of Object.keys(r)) if (!wantedCols.includes(k)) wantedCols.push(k);
    const columns = await gEnsureHeader(ctx, spreadsheetId, sheet.title, grid, wantedCols);
    const values = objs.map((r) => columns.map((c) => (c in r ? asText(r[c]) : "")));
    await gCall(ctx, "google.sheets.append_values", { spreadsheetId, range: `${quoted(sheet.title)}!A:A`, values });
    // The API does not say which rows it filled; the ids follow the row count seen before the append.
    const first = grid.rows.length + 2;
    const rowIds = objs.map((_, i) => `g${first + i}`);
    for (const id of rowIds) gEmit(ctx, fileId, "sheet.row_appended", sheet.title, id);
    return { appended: objs.length, rowIds };
  }
  const find = (): number => {
    if (typeof o.rowId === "string") {
      const n = gRowNumber(ctx, o.rowId);
      if (n - 2 >= grid.rows.length) return fail(ctx, "validation.precondition_failed", "That row is gone.", { rowId: o.rowId });
      return n - 2;
    }
    return findRow(ctx, grid, { ids: grid.rows.map((_, i) => `g${i + 2}`), next: 0 }, o);
  };
  if (cap === "sheets.update_row" || cap === "sheets.upsert_row") {
    const values = recordOf(ctx, o.values, "values");
    let at = -1;
    if (cap === "sheets.update_row") at = find();
    else {
      const match = checkColumns(ctx, o.match, "match");
      const wantRow: Record<string, Cell> = {};
      for (const m of match) wantRow[m] = toCell(values[m], "csv");
      at = grid.rows.findIndex((cells) => match.every((m) => String(cells[grid.columns.indexOf(m)] ?? "") === String(wantRow[m])));
    }
    const columns = await gEnsureHeader(ctx, spreadsheetId, sheet.title, grid, Object.keys(values));
    if (at < 0) {
      const line = columns.map((c) => (c in values ? asText(values[c]) : ""));
      await gCall(ctx, "google.sheets.append_values", { spreadsheetId, range: `${quoted(sheet.title)}!A:A`, values: [line] });
      const rowId = `g${grid.rows.length + 2}`;
      gEmit(ctx, fileId, "sheet.row_appended", sheet.title, rowId);
      return { rowId, created: true };
    }
    const n = at + 2;
    const merged = columns.map((c, i) => (c in values ? asText(values[c]) : String(grid.rows[at]?.[i] ?? "")));
    await gCall(ctx, "google.sheets.update_values", { spreadsheetId, range: `${quoted(sheet.title)}!A${n}:${columnLetter(columns.length)}${n}`, values: [merged], valueInputOption: "RAW" });
    const rowId = `g${n}`;
    gEmit(ctx, fileId, "sheet.row_updated", sheet.title, rowId, Object.keys(values));
    return cap === "sheets.update_row" ? { rowId } : { rowId, created: false };
  }
  if (cap === "sheets.delete_row") {
    const n = find() + 2;
    await gCall(ctx, "google.sheets.batch_update", { spreadsheetId, requests: [{ deleteDimension: { range: { sheetId: sheet.sheetId, dimension: "ROWS", startIndex: n - 1, endIndex: n } } }] });
    gEmit(ctx, fileId, "sheet.row_deleted", sheet.title, `g${n}`);
    return { deleted: true };
  }
  return fail(ctx, "internal.unexpected", `${cap} is not a sheet capability.`);
}

// ---- handlers ----

async function sheetsInfo(ctx: Ctx, input: unknown): Promise<{ sheets: SheetInfo[] }> {
  const o = rec(ctx, input);
  const t = await tableFile(ctx, reqStr(ctx, o, "fileId"));
  if (!t.book) return (await googleHandle(ctx, "sheets.info", o, t.file)) as { sheets: SheetInfo[] };
  return { sheets: infoOf(t.book) };
}

async function sheetsReadRows(ctx: Ctx, input: unknown): Promise<{ rows: { rowId: string; values: Record<string, unknown> }[]; next?: string; total: number }> {
  const o = rec(ctx, input);
  const t = await tableFile(ctx, reqStr(ctx, o, "fileId"));
  if (!t.book) return (await googleHandle(ctx, "sheets.read_rows", o, t.file)) as { rows: { rowId: string; values: Record<string, unknown> }[]; next?: string; total: number };
  return readRowsLocal(ctx, o, t.book, t.file);
}

async function sheetsAppendRows(ctx: Ctx, input: unknown): Promise<{ appended: number; rowIds: string[]; versionId?: string }> {
  const o = rec(ctx, input);
  const fileId = reqStr(ctx, o, "fileId");
  const rows = o.rows;
  if (!Array.isArray(rows) || rows.length === 0) fail(ctx, "validation.bad_input", "The input is not valid.", { field: "rows" });
  const objs = (rows as unknown[]).map((r) => recordOf(ctx, r, "rows"));
  const file = liveFile(ctx, fileId);
  if (formatOf(ctx, file) === "google") return (await googleHandle(ctx, "sheets.append_rows", o, file)) as { appended: number; rowIds: string[] };
  const label = optStr(ctx, o, "label");
  return edit(ctx, fileId, optStr(ctx, o, "sheet"), label, ({ book, sheet, ids, file: f }) => {
    const format = formatOf(ctx, f);
    const wanted: string[] = [];
    for (const r of objs) for (const k of Object.keys(r)) if (k.trim() !== "" && !wanted.includes(k)) wanted.push(k);
    const columns = book.ensureColumns(sheet, wanted);
    const rowIds: string[] = [];
    for (const r of objs) {
      book.appendRow(sheet, rowCells(columns, r, format));
      const id = mint(ids);
      ids.ids.push(id);
      rowIds.push(id);
    }
    return { out: { appended: objs.length, rowIds }, events: rowIds.map((rowId) => ({ name: "sheet.row_appended" as const, rowId })) };
  });
}

async function sheetsUpdateRow(ctx: Ctx, input: unknown): Promise<{ rowId: string; versionId?: string }> {
  const o = rec(ctx, input);
  const fileId = reqStr(ctx, o, "fileId");
  const values = recordOf(ctx, o.values, "values");
  const file = liveFile(ctx, fileId);
  if (formatOf(ctx, file) === "google") return (await googleHandle(ctx, "sheets.update_row", o, file)) as { rowId: string };
  return edit(ctx, fileId, optStr(ctx, o, "sheet"), optStr(ctx, o, "label"), ({ book, sheet, ids, file: f }) => {
    const grid = book.grid(sheet);
    const at = findRow(ctx, grid, ids, o);
    const columns = book.ensureColumns(sheet, Object.keys(values));
    const fresh = book.grid(sheet);
    book.setRow(sheet, at, rowCells(columns, values, formatOf(ctx, f), fresh.rows[at]));
    const rowId = ids.ids[at] as string;
    return { out: { rowId }, events: [{ name: "sheet.row_updated" as const, rowId, columns: Object.keys(values) }] };
  });
}

async function sheetsUpsertRow(ctx: Ctx, input: unknown): Promise<{ rowId: string; created: boolean; versionId?: string }> {
  const o = rec(ctx, input);
  const fileId = reqStr(ctx, o, "fileId");
  const values = recordOf(ctx, o.values, "values");
  const match = checkColumns(ctx, o.match, "match");
  for (const m of match) if (!(m in values)) fail(ctx, "validation.bad_input", `values has no ${m} to match on.`, { field: "match" });
  const file = liveFile(ctx, fileId);
  if (formatOf(ctx, file) === "google") return (await googleHandle(ctx, "sheets.upsert_row", o, file)) as { rowId: string; created: boolean };
  return edit(ctx, fileId, optStr(ctx, o, "sheet"), optStr(ctx, o, "label"), ({ book, sheet, ids, file: f }) => {
    const format = formatOf(ctx, f);
    const grid = book.grid(sheet);
    const at = grid.rows.findIndex((cells) => match.every((m) => {
      const col = grid.columns.indexOf(m);
      return col >= 0 && String(cells[col] ?? "") === cellText(toCell(values[m], format));
    }));
    const columns = book.ensureColumns(sheet, Object.keys(values));
    if (at < 0) {
      book.appendRow(sheet, rowCells(columns, values, format));
      const rowId = mint(ids);
      ids.ids.push(rowId);
      return { out: { rowId, created: true }, events: [{ name: "sheet.row_appended" as const, rowId }] };
    }
    const fresh = book.grid(sheet);
    book.setRow(sheet, at, rowCells(columns, values, format, fresh.rows[at]));
    const rowId = ids.ids[at] as string;
    return { out: { rowId, created: false }, events: [{ name: "sheet.row_updated" as const, rowId, columns: Object.keys(values) }] };
  });
}

async function sheetsDeleteRow(ctx: Ctx, input: unknown): Promise<{ deleted: boolean; versionId?: string }> {
  const o = rec(ctx, input);
  const fileId = reqStr(ctx, o, "fileId");
  reqStr(ctx, o, "rowId");
  const file = liveFile(ctx, fileId);
  if (formatOf(ctx, file) === "google") return (await googleHandle(ctx, "sheets.delete_row", o, file)) as { deleted: boolean };
  return edit(ctx, fileId, optStr(ctx, o, "sheet"), optStr(ctx, o, "label"), ({ book, sheet, ids }) => {
    const at = findRow(ctx, book.grid(sheet), ids, o);
    const rowId = ids.ids[at] as string;
    book.removeRow(sheet, at);
    ids.ids.splice(at, 1);
    return { out: { deleted: true }, events: [{ name: "sheet.row_deleted" as const, rowId }] };
  });
}

async function sheetsAddSheet(ctx: Ctx, input: unknown): Promise<{ ok: boolean }> {
  const o = rec(ctx, input);
  const fileId = reqStr(ctx, o, "fileId");
  const title = reqStr(ctx, o, "sheet").trim();
  const columns = Array.isArray(o.columns) && o.columns.length > 0 ? checkColumns(ctx, o.columns, "columns") : [];
  const file = liveFile(ctx, fileId);
  const format = formatOf(ctx, file);
  if (format === "google") return (await googleHandle(ctx, "sheets.add_sheet", o, file)) as { ok: boolean };
  if (format === "csv") return fail(ctx, "validation.unsupported", "A CSV file has one sheet. Use an XLSX workbook for more.");
  if (title.length === 0 || title.length > 31 || /[\\/?*[\]:]/.test(title)) return fail(ctx, "validation.bad_input", "A sheet name is 1 to 31 characters without \\ / ? * [ ] :", { field: "sheet" });
  await edit(ctx, fileId, undefined, optStr(ctx, o, "label") ?? `Added sheet ${title}`, ({ book }) => {
    if (book.names().some((n) => n.toLowerCase() === title.toLowerCase())) return fail(ctx, "validation.duplicate", `There is already a sheet named ${title}.`);
    book.addSheet(title, columns);
    return { out: {}, events: [] };
  }, false);
  return { ok: true };
}

async function sheetsCreate(ctx: Ctx, input: unknown): Promise<{ file: unknown }> {
  const o = rec(ctx, input);
  const folderId = reqStr(ctx, o, "folderId");
  const format = reqStr(ctx, o, "format");
  if (format !== "csv" && format !== "xlsx") fail(ctx, "validation.bad_input", "The format is csv or xlsx.", { field: "format" });
  const columns = checkColumns(ctx, o.columns, "columns");
  let name = reqStr(ctx, o, "name").trim();
  if (extOf(name) !== format) name = `${name}.${format}`;
  let content: { text: string } | { base64: string };
  let mime: string;
  let sheetName = name.slice(0, name.lastIndexOf("."));
  if (format === "csv") {
    content = { text: writeCsv(columns, []) };
    mime = "text/csv";
  } else {
    sheetName = optStr(ctx, o, "sheet") ?? "Sheet1";
    const book = XlsxBook.fresh(sheetName, columns);
    content = { base64: Buffer.from(await book.encode()).toString("base64") };
    mime = XLSX_MIME;
  }
  const made = await treeHandlers["files.create"](ctx, { folderId, name, content, mime, kind: "spreadsheet" });
  saveIds(ctx, made.file.fileId, sheetName, made.file.version, { ids: [], next: 0 });
  return { file: made.file };
}

export const sheetsHandlers = {
  "sheets.info": sheetsInfo,
  "sheets.read_rows": sheetsReadRows,
  "sheets.append_rows": sheetsAppendRows,
  "sheets.update_row": sheetsUpdateRow,
  "sheets.upsert_row": sheetsUpsertRow,
  "sheets.delete_row": sheetsDeleteRow,
  "sheets.add_sheet": sheetsAddSheet,
  "sheets.create": sheetsCreate,
};
