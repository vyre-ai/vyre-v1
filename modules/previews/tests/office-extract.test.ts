// @reads /modules/previews/handlers/render.ts
// What an agent reads from an Excel or PowerPoint file (live folders L3): a date cell reads as a date and not as a serial number, a formula nothing calculated reads as the formula, a deck reads in the
// order it shows its slides with each slide's speaker notes. Files are built in the test; no converter is needed.
import test from "node:test";
import assert from "node:assert/strict";
import { excelDate, officeExtract } from "../handlers/render.ts";
import { zip } from "../fixtures/make.ts";

const WORKBOOK = `<workbook xmlns:r="x"><sheets><sheet name="Invoices" sheetId="1" r:id="rId1"/></sheets></workbook>`;
const RELS = `<Relationships><Relationship Id="rId1" Type="x" Target="worksheets/sheet1.xml"/></Relationships>`;
const STYLES = `<styleSheet>
  <numFmts count="3"><numFmt numFmtId="164" formatCode="yyyy\\-mm\\-dd hh:mm"/><numFmt numFmtId="165" formatCode="&quot;Due: &quot;0.00"/><numFmt numFmtId="166" formatCode="[$-409]d\\ mmm\\ yyyy"/></numFmts>
  <cellXfs count="6"><xf numFmtId="0"/><xf numFmtId="14"/><xf numFmtId="164"/><xf numFmtId="165"/><xf numFmtId="166"/><xf numFmtId="21"/></cellXfs>
</styleSheet>`;

function book(cells: string, opts: { styles?: string; workbook?: string } = {}): Uint8Array {
  return zip({
    "xl/workbook.xml": opts.workbook ?? WORKBOOK, "xl/_rels/workbook.xml.rels": RELS, "xl/styles.xml": opts.styles ?? STYLES,
    "xl/worksheets/sheet1.xml": `<worksheet><sheetData><row r="1">${cells}</row></sheetData></worksheet>`,
  });
}

test("excelDate: 1900 serials, the missing 29 February 1900, times of day, a fraction of a day, and the 1904 system", () => {
  assert.equal(excelDate(1, false), "1900-01-01");
  assert.equal(excelDate(59, false), "1900-02-28");
  assert.equal(excelDate(61, false), "1900-03-01", "Excel counts a 29 February 1900 that never was");
  assert.equal(excelDate(45_961, false), "2025-10-31");
  assert.equal(excelDate(46_326, false), "2026-10-31");
  assert.equal(excelDate(46_326.5, false), "2026-10-31 12:00");
  assert.equal(excelDate(46_326.604166666664, false), "2026-10-31 14:30");
  assert.equal(excelDate(0.75, false), "18:00", "a time of day alone");
  assert.equal(excelDate(0.5000579, false), "12:00:05");
  assert.equal(excelDate(0, true), "00:00");
  assert.equal(excelDate(1461, true), "1908-01-01", "1904 workbooks count from 1904-01-01 (serial 0)");
  for (const bad of [-1, Number.NaN, 3_000_000]) assert.equal(excelDate(bad, false), undefined);
});

test("a cell with a date or time number format reads as a date; other numbers, and text formats that happen to contain letters, stay as they are", () => {
  const x = officeExtract(book(
    `<c r="A1" s="1"><v>46326</v></c><c r="B1" s="2"><v>46326.604166666664</v></c><c r="C1" s="3"><v>46326</v></c><c r="D1" s="4"><v>46326</v></c><c r="E1" s="5"><v>0.75</v></c><c r="F1"><v>46326</v></c><c r="G1" s="0"><v>1200.5</v></c>`,
  ), "xlsx");
  assert.equal(x?.text, "# Invoices\n2026-10-31\t2026-10-31 14:30\t46326\t2026-10-31\t18:00\t46326\t1200.5");
});

test("a 1904 workbook is read from 1904", () => {
  const x = officeExtract(book(`<c r="A1" s="1"><v>1461</v></c>`, { workbook: `<workbook xmlns:r="x"><workbookPr date1904="1"/><sheets><sheet name="Invoices" sheetId="1" r:id="rId1"/></sheets></workbook>` }), "xlsx");
  assert.equal(x?.text, "# Invoices\n1908-01-01");
});

test("a workbook with no styles part reads numbers as numbers", () => {
  const files = { "xl/workbook.xml": WORKBOOK, "xl/_rels/workbook.xml.rels": RELS, "xl/worksheets/sheet1.xml": `<worksheet><sheetData><row r="1"><c r="A1" s="1"><v>46326</v></c></row></sheetData></worksheet>` };
  assert.equal(officeExtract(zip(files), "xlsx")?.text, "# Invoices\n46326");
});

test("a formula nobody has calculated reads as the formula; one with a value reads as the value", () => {
  const x = officeExtract(book(`<c r="A1"><f>SUM(B1:B9)</f></c><c r="B1"><f>1+1</f><v>2</v></c><c r="C1"><f t="shared" si="0"/></c><c r="D1" t="str"><f>A1&amp;"x"</f><v>ab</v></c>`), "xlsx");
  assert.equal(x?.text, "# Invoices\n=SUM(B1:B9)\t2\t\tab");
});

// ---- decks

const slide = (...paras: string[]): string => `<p:sld><p:cSld><p:spTree><p:sp><p:nvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:txBody>${paras.map((p) => `<a:p><a:r><a:t>${p}</a:t></a:r></a:p>`).join("")}</p:txBody></p:sp></p:spTree></p:cSld></p:sld>`;
const notes = (...paras: string[]): string =>
  `<p:notes><p:cSld><p:spTree><p:sp><p:nvSpPr><p:nvPr><p:ph type="sldImg"/></p:nvPr></p:nvSpPr></p:sp>` +
  `<p:sp><p:nvSpPr><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:txBody>${paras.map((p) => `<a:p><a:r><a:t>${p}</a:t></a:r></a:p>`).join("")}</p:txBody></p:sp>` +
  `<p:sp><p:nvSpPr><p:nvPr><p:ph type="sldNum" idx="5"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:fld type="slidenum"><a:t>3</a:t></a:fld></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:notes>`;
const rel = (type: string, target: string, id = "rId1"): string => `<Relationships><Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${type}" Target="${target}"/></Relationships>`;

test("a deck reads in the order it shows its slides, not the order of its file names, with each slide's speaker notes", () => {
  const files: Record<string, string> = {
    "ppt/presentation.xml": `<p:presentation xmlns:r="x"><p:sldIdLst><p:sldId id="258" r:id="rId12"/><p:sldId id="256" r:id="rId10"/><p:sldId id="257" r:id="rId11"/></p:sldIdLst></p:presentation>`,
    "ppt/_rels/presentation.xml.rels": `<Relationships><Relationship Id="rId10" Type="x" Target="slides/slide1.xml"/><Relationship Id="rId11" Type="x" Target="slides/slide2.xml"/><Relationship Id="rId12" Type="x" Target="slides/slide3.xml"/></Relationships>`,
    "ppt/slides/slide1.xml": slide("Pricing"), "ppt/slides/slide2.xml": slide("Roadmap"), "ppt/slides/slide3.xml": slide("Title"),
    "ppt/slides/_rels/slide1.xml.rels": rel("notesSlide", "../notesSlides/notesSlide1.xml"),
    "ppt/notesSlides/notesSlide1.xml": notes("Say the number first.", "Then the discount."),
  };
  const p = officeExtract(zip(files), "pptx");
  assert.equal(p?.pages, 3);
  assert.deepEqual((p?.text ?? "").split("\f"), ["Title", "Pricing\n\nNotes: Say the number first.\nThen the discount.", "Roadmap"], "the speaker notes are the body placeholder only: no slide image, no slide number");
});

test("a deck without a slide list, or with a list that misses slides, reads by file number", () => {
  const base = { "ppt/slides/slide2.xml": slide("Two"), "ppt/slides/slide1.xml": slide("One") };
  assert.deepEqual((officeExtract(zip(base), "pptx")?.text ?? "").split("\f"), ["One", "Two"]);
  const partial = { ...base, "ppt/presentation.xml": `<p:presentation xmlns:r="x"><p:sldIdLst><p:sldId id="1" r:id="rId2"/></p:sldIdLst></p:presentation>`, "ppt/_rels/presentation.xml.rels": `<Relationships><Relationship Id="rId2" Type="x" Target="slides/slide2.xml"/></Relationships>` };
  assert.deepEqual((officeExtract(zip(partial), "pptx")?.text ?? "").split("\f"), ["One", "Two"], "a list that would lose a slide is not trusted");
});

test("a notes page that is missing, empty, or points nowhere adds nothing", () => {
  const files = { "ppt/slides/slide1.xml": slide("One"), "ppt/slides/_rels/slide1.xml.rels": rel("notesSlide", "../notesSlides/notesSlide9.xml") };
  assert.equal(officeExtract(zip(files), "pptx")?.text, "One");
  const empty = { ...files, "ppt/notesSlides/notesSlide9.xml": notes() };
  assert.equal(officeExtract(zip(empty), "pptx")?.text, "One");
  assert.equal(officeExtract(zip({ "ppt/slides/slide1.xml": slide("One"), "ppt/slides/_rels/slide1.xml.rels": rel("image", "../media/a.png") }), "pptx")?.text, "One");
});
