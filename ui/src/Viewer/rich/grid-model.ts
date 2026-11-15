// The workbook the grid edits: sheets of cells (value, formula, number format), column widths, frozen rows, merges. Plain data, no page and no spreadsheet library, so every rule is a unit test:
// typing a cell, pasting a block, adding and deleting rows and columns (formulas that point at moved cells move with them), undo and redo, and recalculating the formulas that depend on a change.
import { FormulaError, Unsupported, addr, colName, evaluate, shiftFormula } from "./formula.ts";
import type { Val } from "./formula.ts";

export type Scalar = number | string | boolean | null;
export interface GCell {
  v: Scalar;
  /** The formula without its "=", when the cell holds one. */
  f?: string;
  /** Excel's number format ("0.00", "#,##0", "0%", "yyyy-mm-dd"), when the cell has one. */
  fmt?: string;
  /** Bold, for the header look; the file's own styles stay in the file. */
  b?: boolean;
  /** The formula could not be recomputed here (a function this grid does not read): the value is the file's last one. */
  stale?: boolean;
  /** The formula's error, such as #DIV/0!. */
  err?: string;
}
export interface GSheet {
  name: string;
  rows: number;
  cols: number;
  cells: Map<string, GCell>;
  /** Column widths in pixels; a missing one is the default. */
  widths: (number | undefined)[];
  frozen: { rows: number; cols: number };
  merges: { r: number; c: number; r2: number; c2: number }[];
}
export interface Book {
  sheets: GSheet[];
}

export const DEFAULT_COL_W = 96;
export const ROW_H = 28;
export const key = (r: number, c: number): string => `${r},${c}`;
export const unkey = (k: string): [number, number] => {
  const i = k.indexOf(",");
  return [Number(k.slice(0, i)), Number(k.slice(i + 1))];
};

/* ---------- number formats ---------- */

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
/** Excel's day 0 is 30 Dec 1899. */
export const fromSerial = (n: number): Date => new Date(Math.round((n - 25569) * 86_400_000));
export const toSerial = (d: Date): number => d.getTime() / 86_400_000 + 25569;
export const isDateFormat = (fmt: string | undefined): boolean => {
  if (fmt === undefined) return false;
  const bare = fmt.replace(/"[^"]*"|\[[^\]]*\]|\\./g, "");
  return /[ymdhs]/i.test(bare) && !/^[#0.,%\s$€£()-]*$/.test(bare);
};
const p2 = (n: number): string => String(n).padStart(2, "0");

function formatDate(serial: number, fmt: string): string {
  const d = fromSerial(serial);
  const y = d.getUTCFullYear();
  const mo = d.getUTCMonth();
  const da = d.getUTCDate();
  const h = d.getUTCHours();
  const mi = d.getUTCMinutes();
  const se = d.getUTCSeconds();
  const ampm = /am\/pm|a\/p/i.test(fmt);
  let out = "";
  const f = fmt.replace(/\[[^\]]*\]/g, "");
  for (let i = 0; i < f.length; ) {
    const rest = f.slice(i);
    let m: RegExpExecArray | null;
    if (f[i] === '"') {
      const j = f.indexOf('"', i + 1);
      out += f.slice(i + 1, j < 0 ? f.length : j);
      i = j < 0 ? f.length : j + 1;
    } else if (f[i] === "\\") {
      out += f[i + 1] ?? "";
      i += 2;
    } else if ((m = /^(yyyy|yy)/i.exec(rest))) {
      out += m[0].length === 4 ? String(y) : p2(y % 100);
      i += m[0].length;
    } else if ((m = /^(mmmm|mmm|mm|m)/i.exec(rest))) {
      // m after h or before s is minutes
      const prev = out.trimEnd().slice(-1);
      const afterH = /h/i.test(f.slice(Math.max(0, i - 3), i)) || /^:?s/i.test(f.slice(i + m[0].length, i + m[0].length + 2));
      void prev;
      if (afterH && m[0].length <= 2) out += m[0].length === 2 ? p2(mi) : String(mi);
      else out += m[0].length === 4 ? MONTHS[mo]! : m[0].length === 3 ? MONTHS[mo]!.slice(0, 3) : m[0].length === 2 ? p2(mo + 1) : String(mo + 1);
      i += m[0].length;
    } else if ((m = /^(dddd|ddd|dd|d)/i.exec(rest))) {
      out += m[0].length === 4 ? DAYS[d.getUTCDay()]! : m[0].length === 3 ? DAYS[d.getUTCDay()]!.slice(0, 3) : m[0].length === 2 ? p2(da) : String(da);
      i += m[0].length;
    } else if ((m = /^(hh|h)/i.exec(rest))) {
      const hh = ampm ? h % 12 || 12 : h;
      out += m[0].length === 2 ? p2(hh) : String(hh);
      i += m[0].length;
    } else if ((m = /^(ss|s)/i.exec(rest))) {
      out += m[0].length === 2 ? p2(se) : String(se);
      i += m[0].length;
    } else if ((m = /^(am\/pm|a\/p)/i.exec(rest))) {
      out += h < 12 ? "AM" : "PM";
      i += m[0].length;
    } else {
      out += f[i];
      i++;
    }
  }
  return out;
}

function formatNumber(n: number, fmt: string): string {
  // the first section is for positive numbers, a second for negative ones
  const sections = fmt.split(/;(?=(?:[^"]*"[^"]*")*[^"]*$)/);
  const sec = n < 0 && sections[1] !== undefined ? sections[1] : (sections[0] ?? "General");
  const neg = n < 0 && sections[1] === undefined;
  let v = Math.abs(n);
  if (/^General$/i.test(sec)) return String(n);
  const percent = /%/.test(sec.replace(/"[^"]*"/g, ""));
  if (percent) v *= 100;
  const lit = sec.replace(/\[\$([^\]-]*)[^\]]*\]/g, (_m, s: string) => `"${s}"`).replace(/\[[^\]]*\]/g, "").replace(/_.|\*./g, "");
  const dec = /\.([0#?]+)/.exec(lit.replace(/"[^"]*"/g, ""))?.[1]?.length ?? 0;
  const grouped = /[#0],[#0]/.test(lit.replace(/"[^"]*"/g, ""));
  const fixed = v.toFixed(dec);
  let [ip = "0", fp = ""] = fixed.split(".");
  // trailing optional decimals (#) are dropped when zero
  const optional = /\.([0#?]+)/.exec(lit.replace(/"[^"]*"/g, ""))?.[1]?.replace(/0/g, "") ?? "";
  if (optional.length > 0) fp = fp.replace(new RegExp(`0{0,${optional.length}}$`), "");
  const minInt = /([0#?]+)(?=\.|[^0#?,.]|$)/.exec(lit.replace(/"[^"]*"/g, "").replace(/[$€£]/g, ""))?.[1] ?? "";
  const need = (minInt.match(/0/g) ?? []).length;
  ip = ip.padStart(need, "0");
  if (ip === "" || (ip === "0" && need === 0 && dec === 0 && !/0/.test(minInt))) ip = ip === "" ? "0" : ip;
  if (grouped) ip = ip.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const body = fp !== "" ? `${ip}.${fp}` : ip;
  // put the digits where the pattern's number part is, keeping its literal text ("$", "kg", parentheses)
  const out = lit.replace(/"([^"]*)"/g, "$1").replace(/[#0?,.]+/, "\u0000").replace(/%/g, percent ? "%" : "%");
  const done = out.includes("\u0000") ? out.replace("\u0000", body) : body;
  return neg ? `-${done}` : done;
}

/** The text a cell shows: its value in its number format. A text cell is its text; an error is its code. */
export function display(cell: GCell | undefined): string {
  if (cell === undefined) return "";
  if (cell.err !== undefined) return cell.err;
  const v = cell.v;
  if (v === null) return "";
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  if (typeof v === "string") return v;
  if (cell.fmt !== undefined && cell.fmt !== "General") {
    if (isDateFormat(cell.fmt)) return formatDate(v, cell.fmt);
    return formatNumber(v, cell.fmt);
  }
  return Number.isInteger(v) ? String(v) : String(Math.round(v * 1e10) / 1e10);
}

/** What a person typed, as a cell: "=B2+1" is a formula, a number is a number, TRUE and FALSE are booleans, empty is nothing, the rest is text. A format the cell had stays. */
export function parseInput(input: string, prev?: GCell): GCell | undefined {
  const fmt = prev?.fmt !== undefined ? { fmt: prev.fmt } : {};
  const b = prev?.b === true ? { b: true } : {};
  if (input === "") return prev?.fmt !== undefined || prev?.b ? { v: null, ...fmt, ...b } : undefined;
  if (input.startsWith("=") && input.length > 1) return { v: null, f: input.slice(1), ...fmt, ...b };
  const t = input.trim();
  if (/^TRUE$/i.test(t)) return { v: true, ...fmt, ...b };
  if (/^FALSE$/i.test(t)) return { v: false, ...fmt, ...b };
  if (/^-?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(t)) return { v: Number(t), ...fmt, ...b };
  const pct = /^(-?\d+\.?\d*)%$/.exec(t);
  if (pct) return { v: Number(pct[1]) / 100, fmt: "0%", ...b };
  return { v: input, ...fmt, ...b };
}

/** What the formula bar shows for a cell: the formula with its "=", or the value as typed. */
export const inputOf = (cell: GCell | undefined): string =>
  cell === undefined ? "" : cell.f !== undefined ? `=${cell.f}` : cell.v === null ? "" : typeof cell.v === "boolean" ? (cell.v ? "TRUE" : "FALSE") : String(cell.v);

/* ---------- the workbook ---------- */

export interface Edit {
  undo(): void;
  redo(): void;
}

export class Grid {
  book: Book;
  private undoStack: Edit[] = [];
  private redoStack: Edit[] = [];
  /** The structural edits made (row and column inserts and deletes), in order, for the file writer. An undone one is taken off. */
  structure: { sheet: string; axis: "row" | "col"; at: number; delta: number }[] = [];
  constructor(book: Book) {
    this.book = book;
    this.recalc();
  }
  sheet(name: string): GSheet | undefined {
    return this.book.sheets.find((s) => s.name === name);
  }
  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }
  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }
  /** Why rows and columns of this sheet cannot be added or removed here, or null when they can: a merge would be left where it was. */
  structureBlock(s: GSheet): string | null {
    return s.merges.length > 0 ? "This sheet has merged cells. Open it in its own app to add or remove rows and columns." : null;
  }

  private push(e: Edit): void {
    this.undoStack.push(e);
    this.redoStack = [];
  }

  /** A person types into a cell. */
  setCell(s: GSheet, r: number, c: number, input: string): void {
    this.setMany(s, [{ r, c, input }]);
  }

  /** Several cells at once (typing is one; a paste is a block): one undo step. */
  setMany(s: GSheet, changes: readonly { r: number; c: number; input: string }[]): void {
    const before: [string, GCell | undefined][] = [];
    const after: [string, GCell | undefined][] = [];
    for (const ch of changes) {
      const k = key(ch.r, ch.c);
      const prev = s.cells.get(k);
      const next = parseInput(ch.input, prev);
      if (inputOf(prev) === inputOf(next) && prev?.fmt === next?.fmt) continue;
      before.push([k, prev ? { ...prev } : undefined]);
      after.push([k, next]);
    }
    if (after.length === 0) return;
    const grow = (): void => {
      for (const [k] of after) {
        const [r, c] = unkey(k);
        s.rows = Math.max(s.rows, r + 1);
        s.cols = Math.max(s.cols, c + 1);
      }
    };
    const put = (list: [string, GCell | undefined][]): void => {
      for (const [k, v] of list) v === undefined ? s.cells.delete(k) : s.cells.set(k, { ...v });
      this.recalc();
    };
    put(after);
    grow();
    this.push({ undo: () => put(before), redo: () => put(after) });
  }

  private applyStructure(s: GSheet, axis: "row" | "col", at: number, delta: number): void {
    const next = new Map<string, GCell>();
    for (const [k, cell] of s.cells) {
      const [r, c] = unkey(k);
      const v = axis === "row" ? r : c;
      let nv = v;
      if (delta > 0) nv = v >= at ? v + delta : v;
      else if (v >= at && v < at - delta) continue;
      else if (v >= at - delta) nv = v + delta;
      next.set(axis === "row" ? key(nv, c) : key(r, nv), cell);
    }
    s.cells = next;
    if (axis === "row") s.rows = Math.max(1, s.rows + delta);
    else {
      s.cols = Math.max(1, s.cols + delta);
      if (delta > 0) s.widths.splice(at, 0, ...Array.from({ length: delta }, () => undefined));
      else s.widths.splice(at, -delta);
    }
    // formulas anywhere that point at the moved cells move with them
    for (const sh of this.book.sheets)
      for (const cell of sh.cells.values()) if (cell.f !== undefined) cell.f = shiftFormula(cell.f, sh.name, s.name, axis, at, delta);
  }

  /** Insert `count` rows (or columns) before `at`. */
  insert(s: GSheet, axis: "row" | "col", at: number, count = 1): void {
    this.structural(s, axis, at, count);
  }
  /** Delete `count` rows (or columns) from `at`. */
  remove(s: GSheet, axis: "row" | "col", at: number, count = 1): void {
    this.structural(s, axis, at, -count);
  }
  private structural(s: GSheet, axis: "row" | "col", at: number, delta: number): void {
    if (this.structureBlock(s) !== null) return;
    // what a delete takes away, kept so undo puts it back, with the formulas as they were
    const snap = snapshot(this.book);
    const apply = (): void => {
      this.applyStructure(s, axis, at, delta);
      this.structure.push({ sheet: s.name, axis, at, delta });
      this.recalc();
    };
    apply();
    const after = snapshot(this.book);
    this.push({
      undo: () => {
        restore(this.book, snap);
        this.structure.pop();
        this.recalc();
      },
      redo: () => {
        restore(this.book, after);
        this.structure.push({ sheet: s.name, axis, at, delta });
        this.recalc();
      },
    });
  }

  undo(): boolean {
    const e = this.undoStack.pop();
    if (!e) return false;
    e.undo();
    this.redoStack.push(e);
    return true;
  }
  redo(): boolean {
    const e = this.redoStack.pop();
    if (!e) return false;
    e.redo();
    this.undoStack.push(e);
    return true;
  }

  /** Recompute every formula. A cell whose formula cannot be read keeps its last value and is marked; a cycle is an error, never a guess. */
  recalc(): void {
    const state = new Map<GCell, "busy" | "done">();
    const lookup = (sh: GSheet, r: number, c: number): Val | FormulaError => {
      const cell = sh.cells.get(key(r, c));
      if (cell === undefined) return null;
      if (cell.f !== undefined) settle(sh, cell);
      if (cell.err !== undefined) return new FormulaError(cell.err as FormulaError["code"]);
      return cell.v;
    };
    const settle = (sh: GSheet, cell: GCell): void => {
      const st = state.get(cell);
      if (st === "done") return;
      if (st === "busy") {
        cell.err = "#CYCLE!";
        return;
      }
      state.set(cell, "busy");
      try {
        const out = evaluate(cell.f!, (sheet, r, c) => {
          const target = sheet === null ? sh : this.sheet(sheet);
          return target === undefined ? new FormulaError("#REF!") : lookup(target, r, c);
        });
        delete cell.stale;
        if (out instanceof FormulaError) cell.err = out.code;
        else {
          delete cell.err;
          cell.v = out;
        }
      } catch (e) {
        if (e instanceof Unsupported) {
          // keep the file's last value, marked
          cell.stale = true;
          delete cell.err;
        } else throw e;
      }
      if (cell.err === "#CYCLE!" && state.get(cell) === "busy") state.set(cell, "done");
      state.set(cell, "done");
    };
    for (const sh of this.book.sheets) for (const cell of sh.cells.values()) if (cell.f !== undefined) settle(sh, cell);
  }
}

type Snap = { name: string; rows: number; cols: number; cells: [string, GCell][]; widths: (number | undefined)[] }[];
const snapshot = (b: Book): Snap =>
  b.sheets.map((s) => ({ name: s.name, rows: s.rows, cols: s.cols, cells: [...s.cells].map(([k, v]) => [k, { ...v }]), widths: s.widths.slice() }));
function restore(b: Book, snap: Snap): void {
  for (const sn of snap) {
    const s = b.sheets.find((x) => x.name === sn.name);
    if (!s) continue;
    s.rows = sn.rows;
    s.cols = sn.cols;
    s.cells = new Map(sn.cells.map(([k, v]) => [k, { ...v }]));
    s.widths = sn.widths.slice();
  }
}

/** The text of a clipboard block (rows by tabs, cells by newlines) as cell inputs placed from a cell. */
export function pasteBlock(text: string, r0: number, c0: number): { r: number; c: number; input: string }[] {
  const rows = text.replace(/\r\n?/g, "\n").replace(/\n$/, "").split("\n");
  const out: { r: number; c: number; input: string }[] = [];
  rows.forEach((line, i) => line.split("\t").forEach((input, j) => out.push({ r: r0 + i, c: c0 + j, input })));
  return out;
}

/** The text of a block of cells for the clipboard: formulas as formulas (so a paste keeps them). */
export function copyBlock(s: GSheet, r0: number, c0: number, r1: number, c1: number): string {
  const rows: string[] = [];
  for (let r = r0; r <= r1; r++) {
    const cells: string[] = [];
    for (let c = c0; c <= c1; c++) cells.push(inputOf(s.cells.get(key(r, c))));
    rows.push(cells.join("\t"));
  }
  return rows.join("\n");
}

/** The words Find reads for a sheet: each non-empty cell's shown text on a line of its own, so a match never spans two cells, in row order. */
export function sheetFindText(s: GSheet): { text: string; cells: [number, number][] } {
  const keys = [...s.cells.keys()].map(unkey).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cells: [number, number][] = [];
  const lines: string[] = [];
  for (const [r, c] of keys) {
    const t = display(s.cells.get(key(r, c)));
    if (t === "") continue;
    lines.push(t);
    cells.push([r, c]);
  }
  return { text: lines.join("\n"), cells };
}

export const cellName = (r: number, c: number): string => addr(r, c);
export { colName };
