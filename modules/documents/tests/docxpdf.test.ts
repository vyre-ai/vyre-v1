// documents: a filled Word file becomes a PDF on a Space with no converter (lane r42-docs). The plain page look keeps the words, headings, bold, lists, tables and page breaks; the same input
// is the same bytes; a Word file that is not a Word file, or has no text, or has a letter the fonts cannot draw, is refused in plain words and makes no file.
// @reads /modules/documents/migrations/0001_documents.sql

import test from "node:test";
import assert from "node:assert/strict";
import { VyreErr } from "../../../packages/contracts/src/errors.ts";
import { handlers } from "../impl.ts";
import { configureDocuments } from "../handlers/fill.ts";
import { docxBlocks } from "../handlers/docx.ts";
import { docx, para, world, FOLDER } from "../fixtures/world.ts";

async function expectCode(code: string, run: () => Promise<unknown>): Promise<VyreErr> {
  try {
    await run();
  } catch (e) {
    assert.ok(e instanceof VyreErr, e instanceof Error ? e.stack : "throw");
    assert.equal(e.error.code, code, e.error.message);
    return e;
  }
  return assert.fail(`expected ${code}`);
}

const styled = (style: string, text: string): string =>
  `<w:p><w:pPr><w:pStyle w:val="${style}"/></w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;
const bold = (text: string): string =>
  `<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>${text}</w:t></w:r><w:r><w:t xml:space="preserve"> and plain</w:t></w:r></w:p>`;
const bullet = (text: string): string =>
  `<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;
const cell = (t: string): string => `<w:tc>${para(t)}</w:tc>`;
const table = (rows: string[][]): string =>
  `<w:tbl><w:tblPr/>${rows.map((r) => `<w:tr>${r.map(cell).join("")}</w:tr>`).join("")}</w:tbl>`;
const pageBreak = `<w:p><w:r><w:br w:type="page"/></w:r></w:p>`;
const numbering = `<?xml version="1.0"?><w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>`;

const DOC = (): Buffer =>
  docx(
    styled("Heading1", "Service agreement") +
      bold("Dear {client.name}") +
      bullet("First term") +
      bullet("Second term") +
      table([
        ["Item", "Fee"],
        ["Retainer", "{fee}"],
      ]) +
      pageBreak +
      para("Signed: {client.name}"),
    { "word/numbering.xml": numbering },
  );

test("a Word file reads as blocks: heading, bold run, bullets, a table with its header row, a page break", () => {
  const blocks = docxBlocks(DOC());
  assert.deepEqual(
    blocks.map((b) => b.t),
    ["h", "p", "li", "li", "table", "break", "p"],
  );
  const p = blocks[1];
  assert.ok(p && p.t === "p" && p.runs[0]?.b === true && p.runs[1]?.b === undefined);
  const li = blocks[2];
  assert.ok(li && li.t === "li" && li.ordered === false && li.marker === "•");
  const tb = blocks[4];
  assert.ok(tb && tb.t === "table" && tb.head.length === 2 && tb.rows.length === 1);
});

test("a filled Word template becomes a PDF with no converter, the same bytes twice, and says the layout is plain", async () => {
  configureDocuments(null);
  const bytes: Buffer[] = [];
  for (let n = 0; n < 2; n++) {
    const w = world();
    const id = w.add("Agreement.docx", DOC());
    const out = await handlers["documents.fill"](w.ctx, {
      templateFileId: id,
      intoFolderId: FOLDER,
      values: { client: { name: "Imran Ibarra" }, fee: "1,500" },
      format: "pdf",
    });
    assert.equal(out.layout, "simple");
    assert.equal(out.file.name, "Agreement (filled).pdf");
    bytes.push(w.files.get(out.file.fileId)!.bytes);
  }
  assert.ok(bytes[0]!.equals(bytes[1]!));
  assert.equal(bytes[0]!.subarray(0, 5).toString("latin1"), "%PDF-");
});

test("a value with Markdown marks in it is printed as typed, not read as Markdown", () => {
  const blocks = docxBlocks(docx(para("Fee **1,500** | paid *monthly*")));
  const p = blocks[0];
  assert.ok(p && p.t === "p");
  assert.equal(p.runs.map((r) => r.text).join(""), "Fee **1,500** | paid *monthly*");
  assert.ok(p.runs.every((r) => r.b === undefined && r.i === undefined));
});

test("a letter the plain PDF cannot draw refuses the PDF and names it; no file is made", async () => {
  configureDocuments(null);
  const w = world();
  const id = w.add("Greek.docx", docx(para("Hello {name}")));
  const before = w.files.size;
  const e = await expectCode("validation.unsupported", () =>
    handlers["documents.fill"](w.ctx, {
      templateFileId: id,
      intoFolderId: FOLDER,
      values: { name: "Ωmega" },
      format: "pdf",
    }),
  );
  assert.match(e.error.message, /Ω/);
  assert.equal(w.files.size, before);
  // the Word file is still available
  const word = await handlers["documents.fill"](w.ctx, {
    templateFileId: id,
    intoFolderId: FOLDER,
    values: { name: "Ωmega" },
  });
  assert.match(word.file.name, /\.docx$/);
});

test("a Word file with no text is refused in plain words", async () => {
  configureDocuments(null);
  const w = world();
  const id = w.add("Empty.docx", docx(`<w:p/>`));
  await expectCode("validation.unsupported", () =>
    handlers["documents.fill"](w.ctx, { templateFileId: id, intoFolderId: FOLDER, values: {}, format: "pdf" }),
  );
});
