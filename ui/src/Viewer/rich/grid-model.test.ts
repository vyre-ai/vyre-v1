// The grid's rules: formulas recompute for the supported functions and say so for the others, rows and columns move their formulas, undo and redo, number formats, and a workbook round trip through the
// real ExcelJS: open, change one cell, save, reopen, and everything else is the same.
import test from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { Grid, copyBlock, display, key, pasteBlock, sheetFindText } from "./grid-model.ts";
import type { Book, GSheet } from "./grid-model.ts";
import { evaluate, shiftFormula, FormulaError } from "./formula.ts";
import { baseline, readBook, writeChanges } from "./workbook-io.ts";
import type { XBook } from "./workbook-io.ts";

const sheet = (name: string, rows: (string | number | null)[][]): GSheet => {
  const cells = new Map<string, any>();
  rows.forEach((r, i) =>
    r.forEach(
      (v, j) =>
        v !== null &&
        cells.set(key(i, j), typeof v === "string" && v.startsWith("=") ? { v: null, f: v.slice(1) } : { v }),
    ),
  );
  return {
    name,
    rows: rows.length,
    cols: Math.max(...rows.map((r) => r.length)),
    cells,
    widths: [],
    frozen: { rows: 0, cols: 0 },
    merges: [],
  };
};

test("formulas: arithmetic, ranges, functions and text", () => {
  const g = new Grid({
    sheets: [
      sheet("A", [
        [1, 2, "=A1+B1*2"],
        [10, 20, "=SUM(A1:B2)"],
        [5, null, '=IF(A3>3,"big","small")'],
        [null, null, '=AVERAGE(A1:A3)&"!"'],
      ]),
    ],
  });
  const s = g.book.sheets[0]!;
  assert.equal(s.cells.get(key(0, 2))!.v, 5);
  assert.equal(s.cells.get(key(1, 2))!.v, 33);
  assert.equal(s.cells.get(key(2, 2))!.v, "big");
  assert.equal(s.cells.get(key(3, 2))!.v, "5.333333333333333!");
});

test("a change recomputes the formulas that depend on it, across sheets", () => {
  const g = new Grid({ sheets: [sheet("Budget", [[100, 50, "=A1+B1"]]), sheet("Tax", [["=Budget!C1*10%"]])] });
  assert.equal(g.book.sheets[1]!.cells.get(key(0, 0))!.v, 15);
  g.setCell(g.book.sheets[0]!, 0, 0, "200");
  assert.equal(g.book.sheets[0]!.cells.get(key(0, 2))!.v, 250);
  assert.equal(g.book.sheets[1]!.cells.get(key(0, 0))!.v, 25);
});

test("a formula this grid does not read keeps its text and its last value, marked; errors and cycles are shown, not guessed", () => {
  const b: Book = { sheets: [sheet("A", [[1, "=VLOOKUP(A1,A1:B2,2)", "=A1/0", "=D1", "=C1+1"]])] };
  b.sheets[0]!.cells.get(key(0, 1))!.v = 7;
  const g = new Grid(b);
  const s = g.book.sheets[0]!;
  assert.equal(s.cells.get(key(0, 1))!.v, 7);
  assert.equal(s.cells.get(key(0, 1))!.stale, true);
  assert.equal(s.cells.get(key(0, 1))!.f, "VLOOKUP(A1,A1:B2,2)");
  assert.equal(display(s.cells.get(key(0, 2))), "#DIV/0!");
  assert.equal(display(s.cells.get(key(0, 3))), "#CYCLE!");
});

test("evaluate: the supported list and a function outside it", () => {
  const read = (): number => 4;
  assert.equal(evaluate("ROUND(2.567,2)+MOD(10,3)+POWER(2,3)+SQRT(16)+ABS(-1)", read), 2.57 + 1 + 8 + 4 + 1);
  assert.equal(evaluate("AND(1<2,OR(1=2,NOT(FALSE)))", read), true);
  assert.equal(evaluate('UPPER("a")&LEN("abc")&CONCAT("x","y")', read), "A3xy");
  assert.ok(evaluate("1/0", read) instanceof FormulaError);
  assert.throws(() => evaluate("XLOOKUP(1,2,3)", read), /XLOOKUP/);
});

test("rows and columns: inserting and deleting moves the cells and the formulas that point at them; undo puts them back", () => {
  const g = new Grid({ sheets: [sheet("A", [[1], [2], [3], ["=SUM(A1:A3)"]])] });
  const s = g.book.sheets[0]!;
  g.insert(s, "row", 1);
  assert.equal(s.cells.get(key(4, 0))!.f, "SUM(A1:A4)");
  assert.equal(s.cells.get(key(4, 0))!.v, 6);
  g.setCell(s, 1, 0, "10");
  assert.equal(s.cells.get(key(4, 0))!.v, 16);
  g.undo();
  g.undo();
  assert.equal(s.cells.get(key(3, 0))!.f, "SUM(A1:A3)");
  assert.equal(s.rows, 4);
  g.redo();
  g.redo();
  assert.equal(s.cells.get(key(4, 0))!.v, 16);
  g.remove(s, "row", 0);
  assert.equal(s.cells.get(key(3, 0))!.f, "SUM(A1:A3)");
  g.insert(s, "col", 0);
  assert.equal(s.cells.get(key(3, 1))!.f, "SUM(B1:B3)");
  assert.equal(shiftFormula("A1+B2", "S", "S", "row", 0, -1), "#REF!+B1");
});

test("a sheet with merged cells refuses row and column changes in one sentence instead of leaving merges behind", () => {
  const s = sheet("A", [[1, 2]]);
  s.merges.push({ r: 0, c: 0, r2: 0, c2: 1 });
  const g = new Grid({ sheets: [s] });
  g.insert(s, "row", 0);
  assert.equal(s.rows, 1);
  assert.match(g.structureBlock(s)!, /merged cells/);
});

test("paste a block, copy a block", () => {
  const g = new Grid({ sheets: [sheet("A", [[null, null, null]])] });
  const s = g.book.sheets[0]!;
  g.setMany(s, pasteBlock("1\t2\n3\t=A1+B1", 0, 0));
  assert.equal(s.cells.get(key(1, 1))!.v, 3);
  assert.equal(s.rows, 2);
  assert.equal(copyBlock(s, 0, 0, 1, 1), "1\t2\n3\t=A1+B1");
  g.undo();
  assert.equal(s.cells.size, 0);
});

test("number formats show numbers, currency, percent and dates", () => {
  const c = (v: number, fmt: string) => display({ v, fmt });
  assert.equal(c(1234.5, "#,##0.00"), "1,234.50");
  assert.equal(c(0.256, "0%"), "26%");
  assert.equal(c(0.256, "0.0%"), "25.6%");
  assert.equal(c(1234.5, '"$"#,##0.00'), "$1,234.50");
  assert.equal(c(1234.5, "$#,##0"), "$1,235");
  assert.equal(c(-5, "0.00"), "-5.00");
  assert.equal(c(45000, "yyyy-mm-dd"), "2023-03-15");
  assert.equal(c(45000, "mmm d, yyyy"), "Mar 15, 2023");
  assert.equal(c(45000.5, "m/d/yy h:mm"), "3/15/23 12:00");
  assert.equal(display({ v: 3 }), "3");
  assert.equal(display({ v: "x", f: "A1" }), "x");
});

test("Find reads each cell on a line of its own", () => {
  const s = sheet("A", [
    ["alpha", 2],
    [null, "alpha beta"],
  ]);
  const f = sheetFindText(s);
  assert.equal(f.text, "alpha\n2\nalpha beta");
  assert.deepEqual(f.cells[2], [1, 1]);
});

async function makeBook(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const b = wb.addWorksheet("Budget");
  b.views = [{ state: "frozen", ySplit: 1 }];
  b.columns = [{ width: 24 }, { width: 14 }, { width: 14 }, { width: 14 }];
  b.addRow(["Item", "Cost", "Qty", "Total"]).font = { bold: true };
  b.addRow(["Paper", 12.5, 4, { formula: "B2*C2", result: 50 }]);
  b.addRow(["Ink", 30, 2, { formula: "B3*C3", result: 60 }]);
  b.addRow(["Sum", null, null, { formula: "SUM(D2:D3)", result: 110 }]);
  b.getCell("B2").numFmt = "$#,##0.00";
  b.getCell("B3").numFmt = "$#,##0.00";
  b.getCell("D2").numFmt = "#,##0.00";
  b.addRow(["Due", new Date(Date.UTC(2026, 10, 30))]).getCell(2).numFmt = "yyyy-mm-dd";
  b.getCell("B6").value = 0.25;
  b.getCell("B6").numFmt = "0%";
  b.mergeCells("A8:B8");
  b.getCell("A8").value = "Merged note";
  const n = wb.addWorksheet("Notes");
  n.addRow(["Plain text", "second"]);
  n.getCell("A1").font = { bold: true, italic: true, size: 14, color: { argb: "FF336699" } };
  const t = wb.addWorksheet("Tax");
  t.addRow([{ formula: "Budget!D4*10%", result: 11 }]);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

test("round trip: open a real workbook, change one cell, save, reopen: the other sheets, formats, formulas, merges, widths and frozen row are the same", async () => {
  const bytes = await makeBook();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(bytes as never);
  const grid = new Grid(readBook(wb as unknown as XBook));
  const opened = baseline(grid.book);
  const budget = grid.book.sheets[0]!;
  assert.deepEqual(budget.frozen, { rows: 1, cols: 0 });
  assert.equal(budget.widths[0], 24 * 7 + 5);
  assert.equal(display(budget.cells.get(key(1, 1))), "$12.50");
  assert.equal(display(budget.cells.get(key(4, 1))), "2026-11-30");
  assert.equal(display(budget.cells.get(key(5, 1))), "25%");
  assert.equal(budget.cells.get(key(1, 3))!.f, "B2*C2");
  assert.equal(budget.merges.length, 1);
  // the change: 4 packs of paper become 5; the dependent formulas recompute
  grid.setCell(budget, 1, 2, "5");
  assert.equal(budget.cells.get(key(1, 3))!.v, 62.5);
  assert.equal(budget.cells.get(key(3, 3))!.v, 122.5);
  assert.equal(grid.book.sheets[2]!.cells.get(key(0, 0))!.v, 12.25);
  const wb2 = new ExcelJS.Workbook();
  await wb2.xlsx.load(bytes as never);
  writeChanges(grid, wb2 as unknown as XBook, opened);
  const saved = Buffer.from(await wb2.xlsx.writeBuffer());
  const re = new ExcelJS.Workbook();
  await re.xlsx.load(saved as never);
  const before = new ExcelJS.Workbook();
  await before.xlsx.load(bytes as never);
  const dump = (w: ExcelJS.Workbook): Record<string, unknown> =>
    Object.fromEntries(
      w.worksheets.map((s) => {
        const cells: Record<string, unknown> = {};
        s.eachRow({ includeEmpty: false }, (r) =>
          r.eachCell({ includeEmpty: false }, (c) => {
            cells[c.address] = { v: c.type === 6 ? { f: c.formula } : c.value, fmt: c.numFmt, font: c.font };
          }),
        );
        return [s.name, { cells, merges: s.model.merges, views: s.views, widths: s.columns.map((c) => c.width) }];
      }),
    );
  const a = dump(before) as Record<string, { cells: Record<string, any> }>;
  const z = dump(re) as Record<string, { cells: Record<string, any> }>;
  assert.deepEqual(Object.keys(z), ["Budget", "Notes", "Tax"]);
  // the one cell that was changed, and nothing else in cells, in any other sheet, or in layout
  assert.equal(z["Budget"]!.cells["C2"].v, 5);
  assert.equal(re.getWorksheet("Budget")!.getCell("D2").result as number, 62.5);
  assert.equal(re.getWorksheet("Tax")!.getCell("A1").result as number, 12.25);
  const strip = (o: Record<string, { cells: Record<string, any> }>): unknown =>
    JSON.parse(
      JSON.stringify(o, (_k, v) => v),
      (k, v) => v,
    );
  delete (a["Budget"]!.cells as any)["C2"];
  delete (z["Budget"]!.cells as any)["C2"];
  assert.deepEqual(strip(z), strip(a));
  assert.equal(re.getWorksheet("Budget")!.getCell("B2").numFmt, "$#,##0.00");
  assert.equal(re.getWorksheet("Notes")!.getCell("A1").font?.italic, true);
});

test("round trip with an inserted row: the sheet's cells move in the file and formulas follow", async () => {
  const wb = new ExcelJS.Workbook();
  const w = wb.addWorksheet("S");
  w.addRow([1]);
  w.addRow([2]);
  w.addRow([{ formula: "SUM(A1:A2)", result: 3 }]);
  const bytes = Buffer.from(await wb.xlsx.writeBuffer());
  const open = new ExcelJS.Workbook();
  await open.xlsx.load(bytes as never);
  const grid = new Grid(readBook(open as unknown as XBook));
  const was = baseline(grid.book);
  grid.insert(grid.book.sheets[0]!, "row", 1);
  grid.setCell(grid.book.sheets[0]!, 1, 0, "10");
  const out = new ExcelJS.Workbook();
  await out.xlsx.load(bytes as never);
  writeChanges(grid, out as unknown as XBook, was);
  const re = new ExcelJS.Workbook();
  await re.xlsx.load(Buffer.from(await out.xlsx.writeBuffer()) as never);
  const s = re.getWorksheet("S")!;
  assert.deepEqual(
    [1, 2, 3, 4].map((r) => (s.getCell(r, 1).type === 6 ? s.getCell(r, 1).formula : s.getCell(r, 1).value)),
    [1, 10, 2, "SUM(A1:A3)"],
  );
  assert.equal(s.getCell(4, 1).result, 13);
});

import { bookFromRows, cellWrites, sheetCsv } from "./workbook-io.ts";

test("a Google Sheet's first tab: only the cells a person changed are written, each as what they typed", () => {
  const g = new Grid(
    bookFromRows(
      [
        ["Item", "Cost"],
        ["Paper", "12"],
        ["Ink", "30"],
      ],
      "Sheet",
    ),
  );
  const was = baseline(g.book);
  assert.deepEqual(cellWrites(g, was), []);
  g.setCell(g.book.sheets[0]!, 1, 1, "20");
  g.setCell(g.book.sheets[0]!, 3, 0, "Total");
  g.setCell(g.book.sheets[0]!, 3, 1, "=SUM(B2:B3)");
  assert.deepEqual(cellWrites(g, was), [
    { r: 1, c: 1, value: "20" },
    { r: 3, c: 0, value: "Total" },
    { r: 3, c: 1, value: "=SUM(B2:B3)" },
  ]);
  assert.equal(g.book.sheets[0]!.cells.get(key(3, 1))!.v, 50);
});

test("a CSV round trips: quoting, a plain formula-looking cell stays text, and the saved text is the grid", () => {
  const g = new Grid(
    bookFromRows(
      [
        ["name", "note"],
        ["Ada", 'says "hi", twice'],
        ["=x", "7"],
      ],
      "Sheet",
      { plain: true, header: true },
    ),
  );
  assert.equal(g.book.sheets[0]!.cells.get(key(2, 0))!.f, undefined);
  assert.equal(sheetCsv(g), 'name,note\nAda,"says ""hi"", twice"\n=x,7\n');
  g.setCell(g.book.sheets[0]!, 1, 0, "Grace");
  assert.match(sheetCsv(g), /^name,note\nGrace,/);
});
