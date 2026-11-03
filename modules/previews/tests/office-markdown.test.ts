// @reads /modules/previews/handlers/ooxml.ts
// @reads /modules/previews/handlers/render.ts
// Word and PowerPoint files as Markdown (rc.17, Office files in the viewer): a Word file keeps its headings, lists, bold and italic, links, tables and pictures; a deck reads one slide per page with
// its title, body, tables, pictures and speaker notes, and without its footer or slide number. An empty file reads as nothing, a large one is read whole and fast, and a password-protected one is
// refused as `corrupt` with the reason in words. Files are built in the test from their parts.
import test from "node:test";
import assert from "node:assert/strict";
import { isEncryptedOffice, officeExtract } from "../handlers/render.ts";
import { MAX_TEXT } from "../handlers/index.ts";
import { zip } from "../fixtures/make.ts";
import { harness } from "../fixtures/world.ts";
import { handlers } from "../impl.ts";
import type { Ctx } from "../../../packages/contracts/src/ctx.ts";
import type { World } from "../fixtures/world.ts";

type Row = Record<string, unknown>;
const NS = `xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="x" xmlns:a="x" xmlns:pic="x" xmlns:mc="x" xmlns:v="x" xmlns:o="x"`;
const word = (body: string, parts: Record<string, string> = {}): Uint8Array => zip({ "[Content_Types].xml": "<Types/>", "word/document.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document ${NS}><w:body>${body}<w:sectPr/></w:body></w:document>`, ...parts });
const p = (inner: string, ppr = ""): string => `<w:p>${ppr === "" ? "" : `<w:pPr>${ppr}</w:pPr>`}${inner}</w:p>`;
const r = (text: string, rpr = ""): string => `<w:r>${rpr === "" ? "" : `<w:rPr>${rpr}</w:rPr>`}<w:t xml:space="preserve">${text}</w:t></w:r>`;
const style = (id: string): string => `<w:pStyle w:val="${id}"/>`;
const num = (id: number, lvl = 0): string => `<w:numPr><w:ilvl w:val="${lvl}"/><w:numId w:val="${id}"/></w:numPr>`;
/** The previews capabilities over a fake files module, with no converter on the server: everything here is read from the file itself. */
async function with_(run: (w: World) => Promise<void>): Promise<void> {
  const w = harness();
  w.tools.soffice = false;
  try { await run(w); } finally { w.cleanup(); }
}
const md = (bytes: Uint8Array): string => officeExtract(bytes, "docx")?.text ?? "<null>";

const STYLES = `<w:styles ${NS}>
  <w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/></w:style>
  <w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:pPr><w:outlineLvl w:val="0"/></w:pPr></w:style>
  <w:style w:type="paragraph" w:styleId="berschrift2"><w:name w:val="heading 2"/></w:style>
  <w:style w:type="paragraph" w:styleId="Kapitel"><w:name w:val="Kapitel"/><w:basedOn w:val="berschrift2"/></w:style>
  <w:style w:type="paragraph" w:styleId="ListBullet"><w:name w:val="List Bullet"/><w:pPr><w:numPr><w:numId w:val="1"/></w:numPr></w:pPr></w:style>
  <w:style w:type="character" w:styleId="Strong"><w:name w:val="Strong"/><w:rPr><w:b/></w:rPr></w:style>
</w:styles>`;
const NUMBERING = `<w:numbering ${NS}>
  <w:abstractNum w:abstractNumId="10"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/></w:lvl><w:lvl w:ilvl="1"><w:numFmt w:val="bullet"/></w:lvl></w:abstractNum>
  <w:abstractNum w:abstractNumId="20"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/></w:lvl><w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="lowerLetter"/></w:lvl></w:abstractNum>
  <w:num w:numId="1"><w:abstractNumId w:val="10"/></w:num>
  <w:num w:numId="2"><w:abstractNumId w:val="20"/></w:num>
</w:numbering>`;
const RELS = `<Relationships><Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.com/terms" TargetMode="External"/><Relationship Id="rId6" Type="x/image" Target="media/image1.png"/></Relationships>`;
const PICTURE = `<w:r><w:drawing><wp:inline><wp:docPr id="1" name="Picture 1" descr="Firm logo"/><a:graphic><a:graphicData><pic:pic><pic:blipFill><a:blip r:embed="rId6"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;

test("a Word file reads as Markdown: headings by style name (Title, heading 1, a renamed heading 2 and a style based on it), paragraphs split by a blank line", () => {
  const body = [
    p(r("Engagement letter"), style("Title")),
    p(r("Scope"), style("Heading1")),
    p(r("We act for you in the sale of 12 Elm Street.")),
    p(r("Fees"), style("berschrift2")),
    p(r("Costs"), style("Kapitel")),
    p(r("Outline heading"), "<w:outlineLvl w:val=\"2\"/>"),
    p(""),
    p(r("Last line.")),
  ].join("");
  assert.equal(md(word(body, { "word/styles.xml": STYLES })), [
    "# Engagement letter", "# Scope", "We act for you in the sale of 12 Elm Street.", "## Fees", "## Costs", "Outline heading", "Last line.",
  ].join("\n\n"), "an outline level on a paragraph without a heading style is not a heading; empty paragraphs leave no gap");
  assert.equal(md(word(body)), "Engagement letter\n\nScope\n\nWe act for you in the sale of 12 Elm Street.\n\nFees\n\nCosts\n\nOutline heading\n\nLast line.", "without styles.xml every paragraph is a paragraph");
});

test("bold, italic, both, a character style, a link, tabs and line breaks; marks sit inside the spaces and runs with the same marks join", () => {
  const body = p([
    r("Pay "), r("within", "<w:b/>"), r(" 30 days", "<w:b/>"), r(" of the "), r("invoice ", "<w:i/>"), r("date", "<w:b/><w:i/>"), r(". "),
    r("Not bold", "<w:b w:val=\"0\"/>"), r(" and "), `<w:r><w:rPr><w:rStyle w:val="Strong"/></w:rPr><w:t>strong</w:t></w:r>`, r(". See "),
    `<w:hyperlink r:id="rId5">${r("the terms")}</w:hyperlink>`, r(" or "), `<w:hyperlink w:anchor="top">${r("the top")}</w:hyperlink>`, r("."),
  ].join(""));
  assert.equal(md(word(body, { "word/styles.xml": STYLES, "word/_rels/document.xml.rels": RELS })),
    "Pay **within 30 days** of the *invoice* ***date***. Not bold and **strong**. See [the terms](https://example.com/terms) or the top.");
  const tabs = p(`${r("Name")}<w:r><w:tab/></w:r>${r("Date")}<w:r><w:br/></w:r>${r("Signed", "<w:b/>")}`, `<w:tabs><w:tab w:val="left" w:pos="720"/></w:tabs>`);
  assert.equal(md(word(tabs)), "Name\tDate\n**Signed**", "a tab stop in the paragraph's settings is not a tab");
  assert.equal(md(word(p(r("Hello &amp; &lt;World&gt; &#x41;&#66;&quot;&apos;")))), `Hello & <World> AB"'`);
});

test("lists: bullets and numbers from numbering.xml, nested by level, a list style, counting that goes on across a paragraph, and numId 0 is no list", () => {
  const body = [
    p(r("Bring:")),
    p(r("ID"), num(1)), p(r("Passport"), num(1, 1)), p(r("Deed"), num(1)),
    p(r("Steps")),
    p(r("Sign"), num(2)), p(r("Witness"), num(2, 1)), p(r("Notary"), num(2, 1)), p(r("File"), num(2)),
    p(r("then")),
    p(r("Record"), num(2)),
    p(r("Styled bullet"), style("ListBullet")),
    p(r("Not a list"), num(0)),
    p(r("Unknown numbering"), num(7)),
  ].join("");
  assert.equal(md(word(body, { "word/styles.xml": STYLES, "word/numbering.xml": NUMBERING })), [
    "Bring:", "- ID\n  - Passport\n- Deed", "Steps", "1. Sign\n  1. Witness\n  2. Notary\n2. File", "then", "3. Record\n- Styled bullet", "Not a list", "- Unknown numbering",
  ].join("\n\n"));
});

test("a table is a pipe table with its first row as the header; empty rows go, short rows are filled, a pipe in a cell is escaped, a table in a cell is read into it", () => {
  const tc = (...paras: string[]): string => `<w:tc><w:tcPr/>${paras.map((x) => p(r(x))).join("")}</w:tc>`;
  const tr = (...cells: string[]): string => `<w:tr>${cells.join("")}</w:tr>`;
  const inner = `<w:tbl>${tr(tc("a"), tc("b"))}${tr(tc("c"))}</w:tbl>`;
  const body = [
    p(r("Fees")),
    `<w:tbl><w:tblPr/>${tr(tc("Item"), tc("Cost"))}${tr(tc("Search"), tc("$120"))}${tr(tc(""), tc(""))}${tr(tc("Filing | court"))}${tr(`<w:tc>${p(r("Two"))}${p(r("lines", "<w:b/>"))}</w:tc>`, `<w:tc>${inner}</w:tc>`)}</w:tbl>`,
    p(r("After")),
  ].join("");
  assert.equal(md(word(body)), ["Fees", "| Item | Cost |\n| --- | --- |\n| Search | $120 |\n| Filing \\| court |  |\n| Two **lines** | a, b; c |", "After"].join("\n\n"));
});

test("pictures are named where they stand by their alt text; a text box's words are read once (not its fallback copy); tracked deletions and field codes are not words", () => {
  const box = `<w:r><mc:AlternateContent><mc:Choice><w:drawing><wp:anchor><wp:docPr id="2" name="Text Box 2"/><a:graphic><a:graphicData><w:txbxContent>${p(r("Boxed words"))}</w:txbxContent></a:graphicData></a:graphic></wp:anchor></w:drawing></mc:Choice><mc:Fallback><w:pict><v:textbox><w:txbxContent>${p(r("Boxed words"))}</w:txbxContent></v:textbox></w:pict></mc:Fallback></mc:AlternateContent></w:r>`;
  const body = [
    p(PICTURE),
    p(`${r("Signed by ")}${PICTURE}${r(" the client")}`),
    p(`<w:r><w:pict><v:shape><v:imagedata r:id="rId6" o:title="Old seal"/></v:shape></w:pict></w:r>`),
    p(`<w:r><w:drawing><wp:inline><wp:docPr id="3" name="Picture 3"/><a:graphic><a:graphicData><pic:pic><a:blip/></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`),
    p(`${r("Before ")}${box}${r("after")}`),
    p(`${r("Kept ")}<w:del><w:r><w:delText>removed </w:delText></w:r></w:del><w:ins>${r("added")}</w:ins>`),
    p(`<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText>PAGE</w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>${r("3")}<w:r><w:fldChar w:fldCharType="end"/></w:r>`),
    p(r("Body"), `<w:pStyle w:val="Normal"/><w:pPrChange><w:pPr><w:pStyle w:val="Heading1"/></w:pPr></w:pPrChange>`),
  ].join("");
  assert.equal(md(word(body, { "word/styles.xml": STYLES })), [
    "[Image: Firm logo]", "Signed by [Image: Firm logo] the client", "[Image: Old seal]", "[Image]", "Boxed words", "Before after", "Kept added", "3", "Body",
  ].join("\n\n"));
});

test("an empty Word file reads as nothing; a large one is read whole and quickly, and over the text limit it is cut and says so", async () => {
  assert.equal(md(word("")), "");
  assert.equal(md(word(p("") + p(r("   ")))), "", "blank paragraphs are not words");
  const paras = Array.from({ length: 20_000 }, (_v, i) => p(r(`Clause ${i + 1}. The buyer pays the seller the price on completion.`), i % 50 === 0 ? style("Heading1") : ""));
  const big = word(paras.join(""), { "word/styles.xml": STYLES });
  const t0 = performance.now();
  const text = md(big);
  const ms = performance.now() - t0;
  assert.ok(ms < 5000, `20,000 paragraphs took ${Math.round(ms)} ms`);
  assert.equal(text.split("\n\n").length, 20_000);
  assert.ok(text.startsWith("# Clause 1. The buyer") && text.endsWith("Clause 20000. The buyer pays the seller the price on completion."));

  await with_(async (w) => {
    const huge = w.files.add("huge.docx", "", word(Array.from({ length: 2200 }, () => p(r("x".repeat(500)))).join("")));
    const out = await (handlers["previews.text"] as (c: Ctx, i: unknown) => Promise<Row>)(w.ctx, { fileId: huge.fileId });
    assert.deepEqual([String(out["text"]).length, out["truncated"], out["source"]], [MAX_TEXT, true, "office"]);
  });
});

/** A compound file the way Office writes a password-protected document: the CFB header, then a directory naming the EncryptedPackage stream. */
function encrypted(): Uint8Array {
  const b = new Uint8Array(2048);
  b.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
  b.set(Buffer.from("EncryptedPackage", "utf16le"), 1024);
  b.set(Buffer.from("EncryptionInfo", "utf16le"), 1152);
  return b;
}

test("a password-protected Word, PowerPoint or Excel file is refused as corrupt, saying it is password-protected; an old binary file without a password is only not a zip", async () => {
  assert.equal(isEncryptedOffice(encrypted()), true);
  for (const type of ["docx", "pptx", "xlsx"] as const) assert.throws(() => officeExtract(encrypted(), type), /password-protected/, type);
  const plainCfb = encrypted().fill(0, 1024);
  assert.equal(isEncryptedOffice(plainCfb), false);
  assert.throws(() => officeExtract(plainCfb, "docx"), /could not be opened/);
  await with_(async (w) => {
  const f = w.files.add("locked.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", encrypted());
  const get = handlers["previews.get"] as (c: Ctx, i: unknown) => Promise<Row>;
  assert.deepEqual(await get(w.ctx, { fileId: f.fileId }), { ready: false, reason: "corrupt" });
  assert.deepEqual(await (handlers["previews.text"] as (c: Ctx, i: unknown) => Promise<Row>)(w.ctx, { fileId: f.fileId }), { text: "", truncated: false, source: "none" });
  assert.equal(w.execCalls.length, 0, "no converter is asked to open it");
  });
});

// ---- decks

const sp = (ph: string | null, paras: string, extra = ""): string => `<p:sp><p:nvSpPr><p:cNvPr id="2" name="s"/><p:cNvSpPr/><p:nvPr>${ph === null ? "" : ph}</p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/>${extra}${paras}</p:txBody></p:sp>`;
const ap = (text: string, ppr = "", rpr = ""): string => `<a:p>${ppr}<a:r>${rpr === "" ? "<a:rPr lang=\"en-US\"/>" : rpr}<a:t>${text}</a:t></a:r><a:endParaRPr/></a:p>`;
const sld = (...shapes: string[]): string => `<p:sld xmlns:p="x" xmlns:a="x" xmlns:r="x"><p:cSld><p:spTree><p:nvGrpSpPr/><p:grpSpPr/>${shapes.join("")}</p:spTree></p:cSld></p:sld>`;
const deck = (slides: string[], notes: Record<number, string> = {}): Uint8Array => {
  const files: Record<string, string> = { "[Content_Types].xml": "<Types/>" };
  slides.forEach((s, i) => { files[`ppt/slides/slide${i + 1}.xml`] = s; });
  for (const [n, words] of Object.entries(notes)) {
    files[`ppt/slides/_rels/slide${n}.xml.rels`] = `<Relationships><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide" Target="../notesSlides/notesSlide${n}.xml"/></Relationships>`;
    files[`ppt/notesSlides/notesSlide${n}.xml`] = `<p:notes><p:cSld><p:spTree><p:sp><p:nvSpPr><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:txBody>${words.split("\n").map((x) => `<a:p><a:r><a:t>${x}</a:t></a:r></a:p>`).join("")}</p:txBody></p:sp></p:spTree></p:cSld></p:notes>`;
  }
  return zip(files);
};
const slidesOf = (bytes: Uint8Array): string[] => (officeExtract(bytes, "pptx")?.text ?? "").split("\f");

test("a deck reads one slide per page: '# Slide n: title', the body placeholder as bullets nested by level, a text box as lines, then the speaker notes", () => {
  const bytes = deck([
    sld(sp(`<p:ph type="ctrTitle"/>`, ap("Q4 review")), sp(`<p:ph type="subTitle" idx="1"/>`, ap("Salvo Law, October 2026"))),
    sld(
      sp(`<p:ph type="title"/>`, ap("Where the leads come from") + ap("and why")),
      sp(`<p:ph idx="1"/>`, ap("Search", "", `<a:rPr b="1"/>`) + ap("Roseville pages", `<a:pPr lvl="1"/>`) + ap("Referrals") + ap("No bullet here", `<a:pPr><a:buNone/></a:pPr>`)),
      sp(null, ap("A text box line") + ap("Marked", `<a:pPr><a:buChar char="•"/></a:pPr>`, `<a:rPr i="1"/>`)),
      sp(`<p:ph type="ftr" idx="11"/>`, ap("Confidential")), sp(`<p:ph type="sldNum" idx="12"/>`, `<a:p><a:fld type="slidenum"><a:t>2</a:t></a:fld></a:p>`), sp(`<p:ph type="dt" idx="10"/>`, ap("10/31/2026")),
    ),
    sld(sp(null, ap("Only a text box"))),
  ], { 2: "Lead with the number.\nThen the source." });
  assert.deepEqual(slidesOf(bytes), [
    "# Slide 1: Q4 review\n\nSalvo Law, October 2026",
    "# Slide 2: Where the leads come from and why\n\n- **Search**\n  - Roseville pages\n- Referrals\nNo bullet here\n\nA text box line\n- *Marked*\n\nNotes: Lead with the number.\nThen the source.",
    "# Slide 3\n\nOnly a text box",
  ]);
  assert.equal(officeExtract(bytes, "pptx")?.pages, 3);
});

test("a slide's table is a pipe table, a picture is named by its alt text, a group's shapes are read, and an empty slide is only its heading", () => {
  const table = `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="4" name="Table 3"/></p:nvGraphicFramePr><a:graphic><a:graphicData><a:tbl><a:tblGrid/>` +
    `<a:tr><a:tc><a:txBody><a:p><a:r><a:t>Channel</a:t></a:r></a:p></a:txBody></a:tc><a:tc><a:txBody><a:p><a:r><a:t>Leads</a:t></a:r></a:p></a:txBody></a:tc></a:tr>` +
    `<a:tr><a:tc><a:txBody><a:p><a:r><a:t>Search</a:t></a:r></a:p></a:txBody></a:tc><a:tc><a:txBody><a:p><a:r><a:t>48</a:t></a:r></a:p></a:txBody></a:tc></a:tr></a:tbl></a:graphicData></a:graphic></p:graphicFrame>`;
  const pic = (descr: string): string => `<p:pic><p:nvPicPr><p:cNvPr id="5" name="Picture 4"${descr === "" ? "" : ` descr="${descr}"`}/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="rId3"/></p:blipFill></p:pic>`;
  const group = `<p:grpSp><p:nvGrpSpPr/><p:grpSpPr/>${sp(null, ap("Grouped words"))}${pic("Chart of leads")}</p:grpSp>`;
  assert.deepEqual(slidesOf(deck([sld(sp(`<p:ph type="title"/>`, ap("Numbers")), table, pic(""), group), sld()])), [
    "# Slide 1: Numbers\n\n| Channel | Leads |\n| --- | --- |\n| Search | 48 |\n\n[Image]\n\nGrouped words\n\n[Image: Chart of leads]",
    "# Slide 2",
  ]);
});
