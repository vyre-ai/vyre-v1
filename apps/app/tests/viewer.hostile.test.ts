// Hostile files, proved entry by entry: what the editors would drop or change is caught before a save; links drawn from a file are only web, mail and in-document; a zip that unpacks to a gigabyte is
// refused from its directory in one sentence, before anything is unpacked; a file that declares entities of its own is refused.
import test from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { fflate } from "./fflate-node.ts";
import { makeDocx, makePptx, zipOfZeros } from "./viewer-fixtures.ts";
import { LimitError, MAX_ENTRIES, safeHref, safeUnzip, tooLargeWords } from "../../../ui/src/Viewer/rich/limits.ts";
import { Grid } from "../../../ui/src/Viewer/rich/grid-model.ts";
import { baseline, editUnsafe, readBook, writeChanges } from "../../../ui/src/Viewer/rich/workbook-io.ts";
import type { XBook } from "../../../ui/src/Viewer/rich/workbook-io.ts";
import { applyRunTexts, readDocx, textRuns, writeDocx } from "../../../ui/src/Viewer/rich/docx.ts";
import { readPptx, setParaRuns, writePptx } from "../../../ui/src/Viewer/rich/pptx.ts";
import { parseXml, writeXml } from "../../../ui/src/Viewer/rich/ooxml.ts";

const dec = new TextDecoder();
const enc = new TextEncoder();
const un = (b: Uint8Array): Record<string, Uint8Array> => fflate.unzipSync(b);
const pack = (e: Record<string, Uint8Array>): Uint8Array => fflate.zipSync(e);

async function baseBook(): Promise<Record<string, Uint8Array>> {
  const wb = new ExcelJS.Workbook();
  const a = wb.addWorksheet("A");
  a.addRow(["x", 1, 2, { formula: "B1*C1", result: 2 }]);
  a.addRow(["y", 3, 4, { formula: "B2*C2", result: 12 }]);
  wb.addWorksheet("B").addRow(["y"]);
  return un(new Uint8Array(await wb.xlsx.writeBuffer()));
}
const sheetXml = (e: Record<string, Uint8Array>): string => dec.decode(e["xl/worksheets/sheet1.xml"]!);
const withSheet = (e: Record<string, Uint8Array>, f: (x: string) => string): Record<string, Uint8Array> => ({
  ...e,
  "xl/worksheets/sheet1.xml": enc.encode(f(sheetXml(e))),
});
const marks = (x: string): string => (x.match(/<(?:\w+:)?(?:f\b[^>]*>|extLst|legacyDrawing)/g) ?? []).join("|");

test("a workbook the editor would change is read only, for every entry and mark ExcelJS does not write back (proved by round-tripping each one)", async () => {
  const base = await baseBook();
  const part = (name: string, body = "<x/>"): Record<string, Uint8Array> => ({ ...base, [name]: enc.encode(body) });
  const hostile: Record<string, Record<string, Uint8Array>> = {
    "external links": part("xl/externalLinks/externalLink1.xml"),
    "threaded comments": part("xl/threadedComments/threadedComment1.xml"),
    persons: part("xl/persons/person.xml"),
    "custom data": part("customXml/item1.xml"),
    "custom properties": part("docProps/custom.xml"),
    "printer settings": part("xl/printerSettings/printerSettings1.bin", "BIN"),
    "charts or drawings": part("xl/drawings/drawing1.xml"),
    pictures: part("xl/media/image1.png", "PNG"),
    "pivot tables": part("xl/pivotTables/pivotTable1.xml"),
    macros: part("xl/vbaProject.bin", "BIN"),
    tables: part("xl/tables/table1.xml"),
    "data connections": part("xl/connections.xml"),
    "an entry nobody listed": part("xl/somethingNew/x.xml"),
    "sparklines (extLst)": withSheet(base, (x) =>
      x.replace(
        "</worksheet>",
        '<extLst><ext uri="{05C60535-1F16-4fd2-B633-F4F36F0B64E0}"><x14:sparklineGroups xmlns:x14="http://schemas.microsoft.com/office/spreadsheetml/2009/9/main"/></ext></extLst></worksheet>',
      ),
    ),
    "an array formula": withSheet(base, (x) =>
      x.replace("<f>B1*C1</f>", '<f t="array" ref="D1:D2">B1:B2*C1:C2</f>').replace("<f>B2*C2</f>", ""),
    ),
    "an array formula with single quotes": withSheet(base, (x) => x.replace("<f>B1*C1</f>", "<f t='array' ref='D1:D2'>B1:B2*C1:C2</f>").replace("<f>B2*C2</f>", "")),
    "a prefixed worksheet with an array formula": withSheet(base, (x) => x.replace(/<(\/?)(?!\?)/g, "<$1x:").replace("<x:worksheet ", '<x:worksheet xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ').replace("<x:f>B1*C1</x:f>", '<x:f t="array" ref="D1:D2">B1:B2*C1:C2</x:f>').replace("<x:f>B2*C2</x:f>", "")),
    "a prefixed extLst": withSheet(base, (x) => x.replace("</worksheet>", '<x:extLst xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><x:ext uri="{x}"/></x:extLst></worksheet>')),
    "a data table": withSheet(base, (x) => x.replace("<f>B1*C1</f>", '<f t="dataTable" ref="D1" dt2D="1" r1="A1"/>')),
    "a comment drawing": withSheet(base, (x) => x.replace("</worksheet>", '<legacyDrawing r:id="rId1"/></worksheet>')),
  };
  for (const [what, entries] of Object.entries(hostile)) {
    const bytes = pack(entries);
    // what a save here really does: open the file, change a cell (B1) in the grid's model, write the change into the opened workbook and save it (and the bare ExcelJS round trip for comparison)
    const roundTrip = async (edit: boolean): Promise<Record<string, Uint8Array>> => {
      try {
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(bytes as never);
        if (edit) {
          const grid = new Grid(readBook(wb as unknown as XBook));
          const was = baseline(grid.book);
          grid.setCell(grid.book.sheets[0]!, 0, 1, "5");
          writeChanges(grid, wb as unknown as XBook, was);
        }
        return un(new Uint8Array(await wb.xlsx.writeBuffer()));
      } catch {
        return {}; // ExcelJS cannot even open it: a save loses everything, and the guard still must say so
      }
    };
    const after = await roundTrip(true);
    const bare = await roundTrip(false);
    const lost = Object.keys(entries).filter((n) => !(n in after) || !(n in bare));
    const sheetChanged =
      marks(sheetXml(entries)) !== marks(sheetXml(after)) || marks(sheetXml(entries)) !== marks(sheetXml(bare));
    // the proof that the file really would be damaged by a save: an entry is gone, or the sheet lost the mark
    // ExcelJS keeps a bare picture file; its anchor, crop and size are what a save does not keep, which a bare entry cannot show: those cases are guarded on purpose and named here
    const guardedOnPurpose = new Set(["pictures"]);
    assert.ok(
      lost.length > 0 || sheetChanged || guardedOnPurpose.has(what),
      `${what}: a round trip through ExcelJS drops or changes something`,
    );
    const why = editUnsafe(bytes, fflate, "book.xlsx");
    assert.ok(why !== null, `${what}: the guard fires`);
    assert.match(
      why!,
      /^This workbook has .+ that a save here would drop or change\. Open it in its own app to change it\.$/,
      what,
    );
  }
  // a plain workbook is editable, and a save loses nothing but the calculation chain Excel rebuilds
  const plain = pack(base);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(plain as never);
  const after = un(new Uint8Array(await wb.xlsx.writeBuffer()));
  assert.deepEqual(
    Object.keys(base).filter((n) => !(n in after) && n !== "xl/calcChain.xml"),
    [],
  );
  assert.equal(editUnsafe(plain, fflate, "book.xlsx"), null);
  assert.match(
    editUnsafe(plain, fflate, "book.xlsm") ?? "",
    /^A macro-enabled workbook is shown here and never changed\./,
  );
});

test("Word and slide editors keep hostile constructs exactly: one edit changes one run's words and nothing else in the file", () => {
  // Word: a comment, a processing instruction, CDATA, a character reference, an alternate-content block, a content control, a field, tracked changes, odd whitespace and attributes
  const files = un(makeDocx());
  const hostile = dec
    .decode(files["word/document.xml"]!)
    .replace(
      "<w:body>",
      '<w:body><!-- a comment --><?vyre keep?><w:p><w:r><w:t xml:space="preserve">Keep &#13; this &amp; that <![CDATA[<raw>]]></w:t></w:r></w:p><mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"><mc:Choice Requires="x"><w:p/></mc:Choice></mc:AlternateContent><w:sdt><w:sdtContent><w:p><w:r><w:t>control</w:t></w:r></w:p></w:sdtContent></w:sdt><w:p><w:fldSimple w:instr="PAGE"><w:r><w:t>1</w:t></w:r></w:fldSimple></w:p><w:p><w:r a="1&#10;2&#9;3"><w:t>tab</w:t></w:r></w:p>',
    );
  const entries = { ...files, "word/document.xml": enc.encode(hostile) };
  const m = readDocx(entries);
  const p = m.paras.find((q) => q.text === "tab")!;
  applyRunTexts(
    m,
    p,
    textRuns(p).map(() => "tabbed"),
  );
  const out = writeDocx(m);
  for (const k of Object.keys(entries))
    if (k !== "word/document.xml") assert.deepEqual(out[k], entries[k], `${k} is the file's own bytes`);
  assert.equal(
    dec.decode(out["word/document.xml"]!),
    hostile.replace("<w:t>tab</w:t>", '<w:t xml:space="preserve">tabbed</w:t>'),
  );
  // a paragraph the editor cannot change safely is not rewritten
  const ro = m.paras.find((q) => q.why !== undefined)!;
  const before = JSON.stringify(ro.node);
  applyRunTexts(m, ro, ["changed"]);
  assert.equal(JSON.stringify(ro.node), before);
  // slides: extensions, timing, grouped shapes, alternate content
  const deck = un(makePptx());
  const slide = dec
    .decode(deck["ppt/slides/slide2.xml"]!)
    .replace("</p:cSld>", '</p:cSld><p:timing><p:tnLst/></p:timing><p:extLst><p:ext uri="{x}"/></p:extLst>')
    .replace(
      "<p:grpSpPr/>",
      '<p:grpSpPr/><!-- keep --><p:grpSp><p:nvGrpSpPr><p:cNvPr id="9" name="g"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:grpSp>',
    );
  const dentries = { ...deck, "ppt/slides/slide2.xml": enc.encode(slide) };
  const dm = readPptx(dentries);
  const s = dm.slides[1]!;
  setParaRuns(s, s.shapes[1]!.paras.find((q) => q.text === "Costs stayed flat")!, ["Costs fell"]);
  const dout = writePptx(dm);
  for (const k of Object.keys(dentries)) if (k !== "ppt/slides/slide2.xml") assert.deepEqual(dout[k], dentries[k], k);
  assert.equal(dec.decode(dout["ppt/slides/slide2.xml"]!), slide.replace("Costs stayed flat", "Costs fell"));
  // a character reference for a carriage return survives a round trip as a reference, not as a raw line break that would read back as a newline
  assert.equal(writeXml(parseXml('<a x="1&#13;2">t&#13;u</a>')), '<a x="1&#13;2">t&#13;u</a>');
});

test("a DOCTYPE is refused cleanly", () => {
  const files = un(makeDocx());
  const evil =
    `<?xml version="1.0"?><!DOCTYPE w:document [<!ENTITY a "aaaa"><!ENTITY b "&a;&a;&a;&a;">]>` +
    dec.decode(files["word/document.xml"]!).replace(/^<\?xml[^>]*\?>\s*/, "");
  assert.throws(() => readDocx({ ...files, "word/document.xml": enc.encode(evil) }), /DOCTYPE/);
});

test("only web, mail and in-document addresses become links; everything else in a file is plain text", () => {
  for (const bad of [
    "javascript:alert(1)",
    " JaVaScRiPt:alert(1)",
    "java\tscript:alert(1)",
    "data:text/html;base64,PHNjcmlwdD4=",
    "vbscript:msgbox(1)",
    "file:///etc/passwd",
    "//evil.example/x",
    "ftp://x/y",
    "blob:https://x/1",
    "/relative/path",
    "",
    "#",
  ])
    assert.equal(safeHref(bad), undefined, JSON.stringify(bad));
  for (const good of ["https://example.com/a?b=1", "http://example.com", "mailto:alex@example.com", "#section-2"])
    assert.equal(safeHref(good), good);
  const files = un(makeDocx());
  const rels = dec.decode(files["word/_rels/document.xml.rels"]!);
  const doc = dec.decode(files["word/document.xml"]!);
  const targets = [
    "javascript:alert(1)",
    "data:text/html;base64,PHNjcmlwdD4=",
    "vbscript:x",
    "file:///etc/passwd",
    "//evil.example/x",
    "https://example.com/ok",
    "mailto:a@example.com",
  ];
  const hyperlinks = targets
    .map((_, i) => `<w:hyperlink r:id="rIdH${i}"><w:r><w:t>link${i}</w:t></w:r></w:hyperlink>`)
    .join("");
  const relsMore = targets
    .map(
      (t, i) =>
        `<Relationship Id="rIdH${i}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${t}" TargetMode="External"/>`,
    )
    .join("");
  const entries = {
    ...files,
    "word/_rels/document.xml.rels": enc.encode(rels.replace("</Relationships>", `${relsMore}</Relationships>`)),
    "word/document.xml": enc.encode(
      doc.replace(
        "<w:body>",
        `<w:body><w:p>${hyperlinks}<w:hyperlink w:anchor="intro"><w:r><w:t>jump</w:t></w:r></w:hyperlink></w:p>`,
      ),
    ),
  };
  const m = readDocx(entries);
  const runs = m.paras[0]!.runs;
  assert.deepEqual(
    runs.map((r) => [r.text, r.link]),
    [
      ["link0", undefined],
      ["link1", undefined],
      ["link2", undefined],
      ["link3", undefined],
      ["link4", undefined],
      ["link5", "https://example.com/ok"],
      ["link6", "mailto:a@example.com"],
      ["jump", "#intro"],
    ],
  );
  // a picture linked from another site is never fetched
  const linked = dec.decode(files["word/document.xml"]!).replace('<a:blip r:embed="rId8"/>', '<a:blip r:link="rIdX"/>');
  const mm = readDocx({ ...files, "word/document.xml": enc.encode(linked) });
  const img = mm.paras.flatMap((q) => q.runs).find((r) => r.image)!.image!;
  assert.equal(img.external, true);
  assert.equal(img.rid, "");
});

test("a zip that unpacks to a gigabyte is refused from its directory in one sentence, and the tab does not grow", () => {
  const bomb = zipOfZeros(1 << 30);
  assert.ok(bomb.length < 2 * 1024 * 1024, `the file is small (${bomb.length} bytes)`);
  if (typeof global.gc === "function") global.gc();
  const before = process.memoryUsage().rss;
  const t0 = performance.now();
  assert.throws(
    () => safeUnzip(fflate, new Uint8Array(bomb)),
    (e: unknown) =>
      e instanceof LimitError &&
      /^This file unpacks to more than 300 MB, so it is not opened here\. Open it in its own app\.$/.test(e.words),
  );
  assert.throws(() => readDocx(safeUnzip(fflate, new Uint8Array(bomb))), LimitError);
  assert.ok(performance.now() - t0 < 1000, "refused at once");
  assert.ok(process.memoryUsage().rss - before < 200 * 1024 * 1024, "nothing was unpacked");
  // an XML part over 20 MB that would be parsed is refused too
  const bigXml = pack({ "word/document.xml": new Uint8Array(21 * 1024 * 1024) });
  assert.throws(() => safeUnzip(fflate, bigXml), /part over 20 MB/);
  // too many parts
  const many: Record<string, Uint8Array> = {};
  for (let i = 0; i <= MAX_ENTRIES; i++) many[`p${i}.xml`] = new Uint8Array(1);
  assert.throws(() => safeUnzip(fflate, pack(many)), /too many parts/);
  // a file over the size a viewer reads is refused before it is read
  assert.equal(
    tooLargeWords("docx", 41 * 1024 * 1024),
    "This file is over 40 MB, which is more than can be drawn here. Open it in its own app.",
  );
  assert.equal(tooLargeWords("pdf", 10 * 1024 * 1024), null);
  assert.match(tooLargeWords("xlsx", 1e9) ?? "", /over 40 MB/);
});

import { pdfText, samplePdfBytes } from "./pdf-text-node.ts";
test("the text extractor is real: it reads a sample PDF's words (so an empty answer on a redacted copy means something)", async () => {
  const r = await pdfText(samplePdfBytes([["Section 1 of the report"], ["Second page"]]));
  assert.equal(r.pages, 2);
  assert.match(r.text, /Section 1 of the report/);
});
