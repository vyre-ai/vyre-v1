// A workbook file to the grid's model and back. The file is read and written by ExcelJS (the library the Files module already uses on the server), here given in as a plain object so this
// module stays free of the library. Saving writes only what a person changed into the file that was opened, so every sheet, style, format, formula, merge, width and frozen row the grid did not
// touch is the file's own, byte for meaning.
import { Grid, DEFAULT_COL_W, display, inputOf, isDateFormat, key, parseInput, toSerial, unkey } from "./grid-model.ts";
import type { Book, GCell, GSheet } from "./grid-model.ts";
import { colIndex } from "./formula.ts";
import { safeUnzip } from "./limits.ts";
import type { UnzipApi } from "./limits.ts";

/** The slice of ExcelJS the reader and writer use. */
export interface XCell {
  value: unknown;
  numFmt?: string;
  font?: { bold?: boolean };
  formula?: string;
  result?: unknown;
  type: number;
}
export interface XRow {
  eachCell(o: { includeEmpty: boolean }, f: (c: XCell, n: number) => void): void;
}
export interface XSheet {
  name: string;
  rowCount: number;
  columnCount: number;
  views?: { state?: string; xSplit?: number; ySplit?: number }[];
  model: { merges?: string[] };
  eachRow(o: { includeEmpty: boolean }, f: (r: XRow, n: number) => void): void;
  getColumn(n: number): { width?: number };
  getCell(r: number, c: number): XCell;
  spliceRows(start: number, del: number, ...rows: unknown[][]): void;
  spliceColumns(start: number, del: number, ...cols: unknown[][]): void;
}
export interface XBook {
  worksheets: XSheet[];
}

const FORMULA_TYPE = 6;
const ERROR_TYPE = 10;
const CHAR_PX = 7;

const scalarOf = (v: unknown): { v: GCell["v"]; err?: string; date?: boolean } => {
  if (v === null || v === undefined) return { v: null };
  if (v instanceof Date) return { v: toSerial(v), date: true };
  if (typeof v === "number" || typeof v === "string" || typeof v === "boolean") return { v };
  const o = v as {
    richText?: { text: string }[];
    text?: unknown;
    hyperlink?: string;
    error?: string;
    result?: unknown;
  };
  if (o.richText) return { v: o.richText.map((t) => t.text).join("") };
  if (o.error) return { v: null, err: o.error };
  if (o.text !== undefined) return { v: String(typeof o.text === "object" ? (scalarOf(o.text).v ?? "") : o.text) };
  return { v: String(v) };
};

/** Reads every sheet of an opened workbook. */
export function readBook(wb: XBook): Book {
  const sheets: GSheet[] = [];
  for (const ws of wb.worksheets) {
    const cells = new Map<string, GCell>();
    let rows = 0;
    let cols = 0;
    ws.eachRow({ includeEmpty: false }, (row, rn) => {
      row.eachCell({ includeEmpty: false }, (cell, cn) => {
        const out: GCell = { v: null };
        if (cell.type === FORMULA_TYPE && cell.formula !== undefined) {
          out.f = cell.formula;
          const r = scalarOf(cell.result);
          out.v = r.v;
          if (r.err) out.err = r.err;
          if (r.date) out.fmt = cell.numFmt ?? "yyyy-mm-dd";
        } else if (cell.type === ERROR_TYPE) {
          out.err = (cell.value as { error?: string }).error ?? "#VALUE!";
        } else {
          const s = scalarOf(cell.value);
          out.v = s.v;
          if (s.date) out.fmt = cell.numFmt ?? "yyyy-mm-dd";
        }
        if (cell.numFmt !== undefined && out.fmt === undefined && cell.numFmt !== "General") out.fmt = cell.numFmt;
        if (cell.font?.bold === true) out.b = true;
        if (out.v === null && out.f === undefined && out.err === undefined && out.fmt === undefined && out.b !== true)
          return;
        cells.set(key(rn - 1, cn - 1), out);
        rows = Math.max(rows, rn);
        cols = Math.max(cols, cn);
      });
    });
    const widths: (number | undefined)[] = [];
    const nCols = Math.max(cols, ws.columnCount || 0);
    for (let c = 1; c <= nCols; c++) {
      const w = ws.getColumn(c).width;
      widths.push(typeof w === "number" && w > 0 ? Math.round(w * CHAR_PX + 5) : undefined);
    }
    const v = ws.views?.[0];
    const frozen = v?.state === "frozen" ? { rows: v.ySplit ?? 0, cols: v.xSplit ?? 0 } : { rows: 0, cols: 0 };
    const merges = (ws.model.merges ?? []).flatMap((m) => {
      const x = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(m);
      return x ? [{ r: Number(x[2]) - 1, c: colIndex(x[1]!), r2: Number(x[4]) - 1, c2: colIndex(x[3]!) }] : [];
    });
    sheets.push({ name: ws.name, rows: Math.max(rows, 1), cols: Math.max(nCols, 1), cells, widths, frozen, merges });
  }
  return { sheets };
}

/** A copy of what was opened, to compare the saved model with: only cells that differ are written. */
export function baseline(book: Book): Map<string, Map<string, string>> {
  const out = new Map<string, Map<string, string>>();
  for (const s of book.sheets) {
    const m = new Map<string, string>();
    for (const [k, c] of s.cells) m.set(k, sig(c));
    out.set(s.name, m);
  }
  return out;
}
const sig = (c: GCell): string => `${inputOf(c)}|${c.fmt ?? ""}|${c.v === null ? "" : String(c.v)}`;

/** Writes the model's changes into the opened workbook: row and column inserts and deletes first (the file moves its own cells and styles), then every cell whose value or formula is not what was opened. */
export function writeChanges(grid: Grid, wb: XBook, opened: Map<string, Map<string, string>>): void {
  for (const op of grid.structure) {
    const ws = wb.worksheets.find((w) => w.name === op.sheet);
    if (!ws) continue;
    const spliceN = (n: number): unknown[][] => Array.from({ length: n }, () => []);
    if (op.axis === "row")
      op.delta > 0 ? ws.spliceRows(op.at + 1, 0, ...spliceN(op.delta)) : ws.spliceRows(op.at + 1, -op.delta);
    else op.delta > 0 ? ws.spliceColumns(op.at + 1, 0, ...spliceN(op.delta)) : ws.spliceColumns(op.at + 1, -op.delta);
  }
  const moved = new Set(grid.structure.map((o) => o.sheet));
  for (const s of grid.book.sheets) {
    const ws = wb.worksheets.find((w) => w.name === s.name);
    if (!ws) continue;
    const was = opened.get(s.name) ?? new Map<string, string>();
    const write = (r: number, c: number, cell: GCell | undefined): void => {
      const x = ws.getCell(r + 1, c + 1);
      if (cell === undefined || (cell.v === null && cell.f === undefined)) {
        x.value = null;
        return;
      }
      if (cell.f !== undefined) x.value = { formula: cell.f, result: cell.v ?? undefined } as never;
      else if (typeof cell.v === "number" && isDateFormat(cell.fmt))
        x.value = new Date(Math.round((cell.v - 25569) * 86_400_000));
      else x.value = cell.v as never;
      if (cell.fmt !== undefined && x.numFmt !== cell.fmt) x.numFmt = cell.fmt;
    };
    if (moved.has(s.name)) {
      for (const [k, c] of s.cells) {
        const [r, cc] = unkey(k);
        write(r, cc, c);
      }
      continue;
    }
    for (const [k, c] of s.cells) if (was.get(k) !== sig(c)) write(...unkey(k), c);
    for (const k of was.keys()) if (!s.cells.has(k)) write(...unkey(k), undefined);
  }
}

/** Every sheet as rows of shown text, for an agent that reads the grid as structured text (a sheet's name, then its rows). */
export function bookAsText(book: Book, maxRows = 200): string {
  return book.sheets
    .map((s) => {
      const lines: string[] = [`## ${s.name}`];
      for (let r = 0; r < Math.min(s.rows, maxRows); r++) {
        const row: string[] = [];
        for (let c = 0; c < s.cols; c++) row.push(display(s.cells.get(key(r, c))));
        lines.push(row.join("\t"));
      }
      return lines.join("\n");
    })
    .join("\n\n");
}
export { DEFAULT_COL_W };

/** A sheet of values (a Google Sheet's export, a CSV) as a one-sheet book: each cell is read as a person would have typed it. */
export function bookFromRows(
  rows: readonly (readonly string[])[],
  name = "Sheet1",
  opts: { plain?: boolean; header?: boolean } = {},
): Book {
  const cells = new Map<string, GCell>();
  let cols = 1;
  rows.forEach((row, r) =>
    row.forEach((v, c) => {
      const cell = parseInput(v);
      if (cell) cells.set(key(r, c), cell);
      if (cell && opts.plain && cell.f !== undefined) cells.set(key(r, c), { v });
      cols = Math.max(cols, c + 1);
    }),
  );
  if (opts.header)
    for (let c = 0; c < cols; c++) {
      const h = cells.get(key(0, c));
      if (h) h.b = true;
    }
  return {
    sheets: [
      {
        name,
        rows: Math.max(rows.length, 1),
        cols,
        cells,
        widths: [],
        frozen: { rows: opts.header ? 1 : 0, cols: 0 },
        merges: [],
      },
    ],
  };
}

/** The cells (of every sheet) that differ from what was opened, as what to write at the provider: the sheet, the cell's row and column, and what a person would type into it ("" clears it). */
export function cellWrites(grid: Grid, opened: Map<string, Map<string, string>>): { sheet: string; r: number; c: number; value: string }[] {
  const out: { sheet: string; r: number; c: number; value: string }[] = [];
  for (const s of grid.book.sheets) {
    const was = opened.get(s.name) ?? new Map<string, string>();
    for (const [k, c] of s.cells) if (was.get(k) !== sig(c)) out.push({ sheet: s.name, r: unkey(k)[0], c: unkey(k)[1], value: inputOf(c) });
    for (const k of was.keys()) if (!s.cells.has(k)) out.push({ sheet: s.name, r: unkey(k)[0], c: unkey(k)[1], value: "" });
  }
  return out;
}

/** A sheet of a delimited file as CSV text: a cell with a comma, a quote or a line break is quoted; a formula is written as its value (a CSV has no formulas). */
export function sheetCsv(grid: Grid): string {
  const s = grid.book.sheets[0];
  if (!s) return "";
  let last = 0;
  for (const k of s.cells.keys()) last = Math.max(last, unkey(k)[0] + 1);
  const q = (v: string): string => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const lines: string[] = [];
  for (let r = 0; r < last; r++) {
    const row: string[] = [];
    for (let c = 0; c < s.cols; c++) {
      const cell = s.cells.get(key(r, c));
      row.push(q(cell === undefined || cell.v === null ? "" : cell.f !== undefined ? String(cell.v) : inputOf(cell)));
    }
    while (row.length > 1 && row[row.length - 1] === "") row.pop();
    lines.push(row.join(","));
  }
  return `${lines.join("\n")}\n`;
}

/** The entries of a workbook that ExcelJS writes back as they mean: every other entry would be dropped or changed by a save, so a workbook that has one is read and never saved here. */
const ROUND_TRIPS = [
  /^\[Content_Types\]\.xml$/,
  /^_rels\/\.rels$/,
  /^docProps\/(app|core)\.xml$/,
  /^xl\/workbook\.xml$/,
  /^xl\/_rels\/workbook\.xml\.rels$/,
  /^xl\/styles\.xml$/,
  /^xl\/sharedStrings\.xml$/,
  /^xl\/theme\/theme\d+\.xml$/,
  /^xl\/worksheets\/sheet\d+\.xml$/,
  /^xl\/worksheets\/_rels\/sheet\d+\.xml\.rels$/,
  // Excel rebuilds its calculation chain when it opens the file
  /^xl\/calcChain\.xml$/,
];
const ENTRY_WORDS: [RegExp, string][] = [
  [/^xl\/externalLinks\//, "links to other workbooks"],
  [/^xl\/(threadedComments|persons)\//, "threaded comments"],
  [/^xl\/comments/, "comments"],
  [/^customXml\//, "custom data"],
  [/^docProps\/custom\.xml$/, "custom properties"],
  [/^xl\/printerSettings\//, "printer settings"],
  [/^xl\/(charts|chartsheets|drawings|diagrams)\//, "charts or drawings"],
  [/^xl\/media\//, "pictures"],
  [/^xl\/(pivotTables|pivotCache|slicers|slicerCaches|timelines|timelineCaches)\//, "pivot tables or slicers"],
  [/^xl\/(embeddings|activeX|ctrlProps)\//, "embedded objects"],
  [/vbaProject\.bin$|^xl\/macrosheets\//, "macros"],
  [/^xl\/tables\//, "tables"],
  [/^xl\/(queryTables|connections\.xml|model\/)/, "data connections"],
  [/^xl\/(metadata\.xml|richData\/)/, "dynamic arrays or rich data"],
];
const SHEET_MARKS: [RegExp, string][] = [
  [/<extLst[\s>]/, "extensions such as sparklines or conditional formats"],
  [/<f\b[^>]*\bt="array"/, "array formulas"],
  [/<f\b[^>]*\bt="dataTable"/, "data tables"],
  [/<mc:AlternateContent/, "extensions such as sparklines or conditional formats"],
  [/<(legacyDrawing|oleObjects|controls|picture|drawing)\b/, "charts, pictures or comments"],
  [/<(ignoredErrors|cellWatches|smartTags|customProperties|webPublishItems)\b/, "settings a save here would drop"],
];
const BOOK_MARKS: [RegExp, string][] = [
  [/<externalReferences[\s>]/, "links to other workbooks"],
  [/<pivotCaches[\s>]/, "pivot tables"],
  [/<(functionGroups|oleSize|customWorkbookViews|fileSharing|webPublishing|smartTagPr)\b/, "settings a save here would drop"],
];

/**
 * Why a workbook is not edited here, or null when it can be. ExcelJS writes back what it reads and no more: external links, threaded comments, custom data, printer settings, charts, pictures, pivot tables,
 * sparklines and other extensions, and array or data-table formulas are dropped or changed by a save. A workbook that has any of them (every entry of the zip is checked against the list of what ExcelJS
 * writes back as it was, and the sheets are read for the marks above) is drawn and read, and is changed in its own app. A macro-enabled workbook (.xlsm) is read only on purpose.
 */
export function editUnsafe(zipBytes: Uint8Array, ff: UnzipApi, fileName = ""): string | null {
  const say = (what: string): string => `This workbook has ${what} that a save here would drop or change. Open it in its own app to change it.`;
  if (/\.xlsm$/i.test(fileName)) return "A macro-enabled workbook is shown here and never changed. Open it in Excel to change it.";
  const names: string[] = [];
  const dec = new TextDecoder();
  const found = safeUnzip(ff, zipBytes, (n) => /^xl\/(workbook|worksheets\/sheet\d+)\.xml$/.test(n), names);
  for (const n of names) {
    const word = ENTRY_WORDS.find(([re]) => re.test(n))?.[1];
    if (word !== undefined) return say(word);
    if (!ROUND_TRIPS.some((re) => re.test(n)) && !/\/$/.test(n)) return say("parts it does not read");
  }
  for (const [n, bytes] of Object.entries(found)) {
    const xml = dec.decode(bytes);
    for (const [re, word] of n === "xl/workbook.xml" ? BOOK_MARKS : SHEET_MARKS) if (re.test(xml)) return say(word);
  }
  return null;
}
