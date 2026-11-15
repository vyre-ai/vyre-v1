// The Word round trip the owner asked for: a document with a table, a picture, a header, a footer, a footnote, styles and a tracked change; change one word; every other part of the file and every
// other paragraph is the same, and a paragraph the editor cannot change safely is left exactly as it was.
import test from "node:test";
import assert from "node:assert/strict";
import { makeDocx, unzip } from "../../../../apps/app/tests/viewer-fixtures.ts";
import { parseXml, writeXml } from "./ooxml.ts";
import { applyRunTexts, docAsText, readDocx, setHeading, textRuns, toggleFormat, writeDocx } from "./docx.ts";

const sample = (): { entries: Record<string, Uint8Array>; bytes: Buffer } => {
  const bytes = makeDocx();
  return { entries: unzip(bytes), bytes };
};
const txt = (b: Uint8Array): string => new TextDecoder().decode(b);

test("the XML reader and writer give back the same document", () => {
  const { entries } = sample();
  for (const name of ["word/document.xml", "word/styles.xml", "word/footnotes.xml", "word/numbering.xml"]) {
    const x = txt(entries[name]!);
    assert.equal(writeXml(parseXml(x)), x, name);
  }
  assert.equal(
    writeXml(parseXml('<?xml version="1.0"?>\n<a x="1&amp;2"><b/><!-- c --><![CDATA[<z>]]>t &lt; u</a>\n')),
    '<?xml version="1.0"?>\n<a x="1&amp;2"><b/><!-- c --><![CDATA[<z>]]>t &lt; u</a>\n',
  );
});

test("a Word file is read as its structure", () => {
  const m = readDocx(sample().entries);
  assert.equal(m.page.w, 612);
  assert.equal(m.page.ml, 72);
  assert.deepEqual(
    m.paras.slice(0, 3).map((p) => [p.text, p.heading]),
    [
      ["Quarterly plan", 1],
      ["This plan covers the next quarter and links to the sample site.", undefined],
      ["Goals", 2],
    ],
  );
  assert.equal(m.paras[3]!.list?.marker, "•");
  assert.equal(m.blocks.filter((b) => b.t === "tbl").length, 1);
  const tbl = m.blocks.find((b) => b.t === "tbl")! as {
    t: "tbl";
    tbl: { rows: { blocks: unknown[]; fill?: string }[][] };
  };
  assert.equal(tbl.tbl.rows.length, 2);
  assert.equal(tbl.tbl.rows[0]![0]!.fill, "#DDEEFF");
  const link = m.paras[1]!.runs.find((r) => r.link)!;
  assert.equal(link.link, "https://example.com/sample");
  assert.equal(m.paras[1]!.runs.find((r) => r.footnote !== undefined)!.footnote, "1");
  assert.equal(m.footnotes[0]!.paras[0]!.text, "Figures are estimates.");
  assert.equal(m.header[0]!.text, "Sample company report");
  assert.equal(m.footer[0]!.text, "Confidential sample");
  const img = m.paras.flatMap((p) => p.runs).find((r) => r.image)!.image!;
  assert.deepEqual([img.w, img.h, img.alt], [100, 50, "A small sample picture"]);
  assert.equal(m.media[img.rid], "word/media/image1.png");
  assert.equal(m.paras.find((p) => p.text === "An inserted sentence.")!.why?.startsWith("Tracked changes"), true);
  assert.match(docAsText(m), /^# Quarterly plan\n/);
});

test("change one word: every other part of the file is identical and only that run's text differs", () => {
  const { entries } = sample();
  const m = readDocx(entries);
  const p = m.paras[1]!;
  const runs = textRuns(p);
  applyRunTexts(
    m,
    p,
    runs.map((r) => (r.text === "next quarter" ? "coming quarter" : r.text)),
  );
  const out = writeDocx(m);
  for (const k of Object.keys(entries))
    if (k !== "word/document.xml") assert.deepEqual(out[k], entries[k], `${k} is carried over byte for byte`);
  const before = txt(entries["word/document.xml"]!);
  const after = txt(out["word/document.xml"]!);
  assert.equal(after, before.replace("<w:t>next quarter</w:t>", '<w:t xml:space="preserve">coming quarter</w:t>'));
  const re = readDocx(out);
  assert.deepEqual(
    re.paras.map((q) => q.text).filter((_, i) => i !== 1),
    m.paras.map((q) => q.text).filter((_, i) => i !== 1),
  );
  assert.match(re.paras[1]!.text, /coming quarter/);
  assert.deepEqual(re.footnotes, m.footnotes);
  assert.equal(re.blocks.length, m.blocks.length);
});

test("bold over part of a run splits it and writes real run properties; toggling again turns it off", () => {
  const m = readDocx(sample().entries);
  const p = m.paras[1]!;
  const from = p.text.indexOf("plan");
  toggleFormat(m, p, from, from + 4, "i");
  const x = txt(writeDocx(m)["word/document.xml"]!);
  assert.match(x, /<w:r><w:rPr><w:i\/><\/w:rPr><w:t[^>]*>plan<\/w:t><\/w:r>/);
  assert.equal(p.runs.map((r) => r.text).join(""), p.runs.map((r) => r.text).join(""));
  assert.equal(readDocx(writeDocx(m)).paras[1]!.text, p.text);
  toggleFormat(m, p, from, from + 4, "i");
  assert.match(txt(writeDocx(m)["word/document.xml"]!), /<w:i w:val="0"\/>/);
});

test("a heading level is a real style; a paragraph with a tracked change is never rewritten", () => {
  const m = readDocx(sample().entries);
  assert.equal(setHeading(m, m.paras[1]!, 2), true);
  assert.match(
    txt(writeDocx(m)["word/document.xml"]!),
    /<w:pPr><w:pStyle w:val="Heading2"\/><\/w:pPr><w:r><w:t xml:space="preserve">This plan/,
  );
  const tracked = m.paras.find((p) => p.why)!;
  const before = JSON.stringify(tracked.node);
  applyRunTexts(m, tracked, ["something else"]);
  assert.equal(JSON.stringify(tracked.node), before);
  assert.equal(setHeading(m, tracked, 1), false);
});
