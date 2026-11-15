// The PDF body's pure rules: layout of 500 pages, which pages are drawn, Find by item, the failure words, and the redacted copy as a file with no text in it.
import test from "node:test";
import assert from "node:assert/strict";
import {
  currentPage,
  fitScale,
  imagePdf,
  itemHits,
  noTextLayer,
  pageOffsets,
  pageText,
  pagesToDraw,
  pdfFailureWords,
  unitBox,
} from "./pdf-model.ts";

const heights = Array.from({ length: 500 }, () => 800);

test("a 500 page file is laid out and the pages near the screen are the only ones drawn", () => {
  const { tops, total } = pageOffsets(heights);
  assert.equal(tops.length, 500);
  assert.equal(total, 12 + 500 * 812);
  const top = pagesToDraw(tops, heights, 0, 900);
  assert.equal(top.from, 0);
  assert.ok(top.to <= 4, `drew ${top.to + 1} pages at the top`);
  const mid = pagesToDraw(tops, heights, 250 * 812, 900);
  assert.ok(mid.from >= 248 && mid.to <= 254, `${mid.from}..${mid.to}`);
  assert.ok(mid.to - mid.from <= 6);
  const t0 = performance.now();
  for (let i = 0; i < 10_000; i++) pagesToDraw(tops, heights, i * 40, 900);
  assert.ok(performance.now() - t0 < 100, "10,000 scroll steps plan in under 100 ms");
});

test("the page number follows the scroll", () => {
  const { tops } = pageOffsets(heights);
  assert.equal(currentPage(tops, heights, 0, 900), 1);
  assert.equal(currentPage(tops, heights, 11 * 812, 900), 12);
});

test("fit width scales a page to the column", () => {
  assert.equal(fitScale(612, 612), 1);
  assert.equal(fitScale(306, 612), 0.5);
  assert.equal(fitScale(900, 0), 1);
});

test("Find counts per text item, case-insensitively, and never across two items", () => {
  const items = ["Quarterly report", "the report is due", "re", "port"];
  assert.deepEqual(itemHits(items, "REPORT"), [
    { item: 0, at: 10 },
    { item: 1, at: 4 },
  ]);
  assert.deepEqual(itemHits(items, "  "), []);
  assert.equal(pageText(items), "Quarterly report\nthe report is due\nre\nport");
});

test("a scan with no text layer says so; a file with words does not", () => {
  assert.equal(noTextLayer(["", " ", ""], true), true);
  assert.equal(noTextLayer(["", "a"], true), false);
  assert.equal(noTextLayer(["", ""], false), false);
});

test("a password-protected or broken PDF is one plain sentence", () => {
  assert.equal(
    pdfFailureWords({ name: "PasswordException" }),
    "This PDF is protected by a password, so it cannot be shown here.",
  );
  assert.equal(pdfFailureWords(new Error("Invalid PDF structure")), "This PDF is damaged and cannot be shown here.");
});

test("a box is clamped to the page and a click without a drag is no box", () => {
  assert.deepEqual(unitBox([0.5, 0.5], [0.2, 0.9]), { x: 0.2, y: 0.5, w: 0.3, h: 0.4 });
  assert.deepEqual(unitBox([-1, 0], [2, 0.5]), { x: 0, y: 0, w: 1, h: 0.5 });
  assert.equal(unitBox([0.3, 0.3], [0.3, 0.3]), null);
});

test("the redacted copy is a picture-only PDF: valid frame, page count, no text operators and no fonts", () => {
  const jpeg = Uint8Array.from([
    0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xd9,
  ]);
  const pdf = imagePdf([
    { w: 612, h: 792, jpeg, iw: 8, ih: 8 },
    { w: 300, h: 400, jpeg, iw: 8, ih: 8 },
  ]);
  const s = Buffer.from(pdf).toString("latin1");
  assert.ok(s.startsWith("%PDF-1.4"));
  assert.ok(s.trimEnd().endsWith("%%EOF"));
  assert.match(s, /\/Count 2/);
  assert.doesNotMatch(s, /\/Font|\bBT\b|\bTj\b|\bTJ\b/);
  const xref = Number(/startxref\n(\d+)/.exec(s)![1]);
  assert.equal(s.slice(xref, xref + 4), "xref");
  // every object the table names starts where it says
  const rows = [...s.slice(xref).matchAll(/(\d{10}) 00000 n/g)].map((m) => Number(m[1]));
  rows.forEach((off, i) => assert.equal(s.slice(off, off + `${i + 1} 0 obj`.length), `${i + 1} 0 obj`));
});
