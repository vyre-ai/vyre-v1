// @reads /modules/previews/handlers/render.ts
// @reads /modules/previews/projections.ts
// @reads /modules/previews/migrations/0001_previews_core.sql
// Previews: the readers (pictures, zip, Office, PDF) on files built in the test, then the capabilities over a fake files module and fake converters: png, jpeg, pdf, docx, xlsx, pptx, text, failures, versions.
import test from "node:test";
import assert from "node:assert/strict";
import { VyreErr } from "../../../packages/contracts/src/errors.ts";
import type { Ctx } from "../../../packages/contracts/src/ctx.ts";
import { handlers } from "../impl.ts";
import { versionConsumer } from "../projections.ts";
import {
  MAX_TEXT, classify, decodePng, encodePng, officeExtract, pdfPageCount, pdfTextPure, probeImage, readZip, scaleRaster,
} from "../handlers/render.ts";
import { bmpHeader, docx, gifHeader, gradient, jpegHeader, odt, pdf, png, pptx, rawPng, solid, webp, xlsx, zip } from "../fixtures/make.ts";
import { dimsOf, harness } from "../fixtures/world.ts";
import type { World } from "../fixtures/world.ts";

type Row = Record<string, unknown>;

async function expectCode(code: string, run: () => Promise<unknown>): Promise<void> {
  try {
    await run();
  } catch (e) {
    assert.ok(e instanceof VyreErr, e instanceof Error ? e.stack : "throw");
    assert.equal(e.error.code, code, e.error.message);
    return;
  }
  assert.fail(`expected ${code}`);
}

const call = (w: World, cap: keyof typeof handlers, input: Row, ctx?: Ctx): Promise<Row> => (handlers[cap] as (c: Ctx, i: unknown) => Promise<Row>)(ctx ?? w.ctx, input);
const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
const dataOf = (bytes: Uint8Array): string => `data:image/png;base64,${Buffer.from(bytes).toString("base64")}`;

async function with_(run: (w: World) => Promise<void>): Promise<void> {
  const w = harness();
  try {
    await run(w);
  } finally {
    w.cleanup();
  }
}

// ---- readers ------------------------------------------------------------------------------------------------

test("classify: what each name and type is previewed as", () => {
  const k = (name: string, mime = ""): string => { const c = classify(name, mime); return c.office ? `${c.kind}:${c.office}` : c.kind; };
  assert.deepEqual(
    [k("a.PNG", "application/octet-stream"), k("x.jpg"), k("scan.pdf", "application/pdf"), k("r.docx"), k("deck.pptx"), k("book.xlsx"), k("n.odt"), k("t.ods"), k("old.doc", "application/msword"), k("a.md", "text/markdown"), k("d.json", "application/json"), k("logo.svg", "image/svg+xml"), k("movie.mp4", "video/mp4"), k("noext"), k("x.zip", "application/zip"), k("x", "image/webp"), k("main.rs"), k("w", "application/vnd.openxmlformats-officedocument.wordprocessingml.document")],
    ["image", "image", "pdf", "office:docx", "office:pptx", "office:xlsx", "office:odf", "office:odf", "office:legacy", "text", "text", "text", "other", "other", "other", "image", "text", "office:docx"],
  );
});

test("probeImage reads the size from the header of png, jpeg, gif, webp (three kinds) and bmp; anything else is null", () => {
  assert.deepEqual(probeImage(png(30, 20)), { width: 30, height: 20, mime: "image/png" });
  assert.deepEqual(probeImage(jpegHeader(640, 480)), { width: 640, height: 480, mime: "image/jpeg" });
  assert.deepEqual(probeImage(gifHeader(33, 22)), { width: 33, height: 22, mime: "image/gif" });
  assert.deepEqual(probeImage(webp("VP8 ", 100, 50)), { width: 100, height: 50, mime: "image/webp" });
  assert.deepEqual(probeImage(webp("VP8L", 300, 200)), { width: 300, height: 200, mime: "image/webp" });
  assert.deepEqual(probeImage(webp("VP8X", 1920, 1080)), { width: 1920, height: 1080, mime: "image/webp" });
  assert.deepEqual(probeImage(bmpHeader(64, 48)), { width: 64, height: 48, mime: "image/bmp" });
  assert.equal(probeImage(enc("hello world, not a picture at all")), null);
  assert.equal(probeImage(new Uint8Array(0)), null);
  assert.equal(probeImage(png(3, 3).subarray(0, 12)), null);
  assert.equal(probeImage(Uint8Array.from([0xff, 0xd8, 0xff, 0xd9])), null);
});

test("PNG: written and read back exactly, with every filter type, palettes, gray, 16 bit; interlaced and damaged files are refused", () => {
  const g = gradient(7, 5);
  assert.deepEqual(decodePng(encodePng(g))?.data, g.data);
  const clear = solid(4, 3, [10, 20, 30, 128]);
  const back = decodePng(encodePng(clear));
  assert.deepEqual([back?.width, back?.height, Array.from(back?.data.subarray(0, 4) ?? [])], [4, 3, [10, 20, 30, 128]]);

  // RGB rows written with filter 0 to 4 in turn
  const rows: Uint8Array[] = [];
  const expected: number[] = [];
  for (let y = 0; y < 5; y++) {
    const row: number[] = [];
    for (let x = 0; x < 6; x++) {
      const px = [(x * 40 + y * 3) & 255, (y * 50 + x) & 255, (x * y * 9) & 255];
      row.push(...px);
      expected.push(...px, 255);
    }
    rows.push(Uint8Array.from(row));
  }
  const filtered = decodePng(rawPng({ width: 6, height: 5, depth: 8, colorType: 2, rows, filter: (y) => y }));
  assert.deepEqual(Array.from(filtered?.data ?? []), expected, "sub, up, average and paeth rows decode to the same pixels");
  const again = decodePng(rawPng({ width: 6, height: 5, depth: 8, colorType: 2, rows, filter: (y) => 4 - y }));
  assert.deepEqual(Array.from(again?.data ?? []), expected);

  const palette = decodePng(rawPng({ width: 4, height: 1, depth: 8, colorType: 3, rows: [Uint8Array.from([0, 1, 2, 1])], palette: [[255, 0, 0], [0, 255, 0], [0, 0, 255]], trns: [128] }));
  assert.deepEqual(Array.from(palette?.data ?? []), [255, 0, 0, 128, 0, 255, 0, 255, 0, 0, 255, 255, 0, 255, 0, 255]);
  const packed = decodePng(rawPng({ width: 4, height: 1, depth: 2, colorType: 3, rows: [Uint8Array.from([0b00011011])], palette: [[1, 1, 1], [2, 2, 2], [3, 3, 3], [4, 4, 4]] }));
  assert.deepEqual(Array.from(packed?.data ?? []).filter((_v, i) => i % 4 === 0), [1, 2, 3, 4]);
  const gray = decodePng(rawPng({ width: 8, height: 1, depth: 1, colorType: 0, rows: [Uint8Array.from([0b10110000])] }));
  assert.deepEqual(Array.from(gray?.data ?? []).filter((_v, i) => i % 4 === 0), [255, 0, 255, 255, 0, 0, 0, 0]);
  const grayAlpha = decodePng(rawPng({ width: 2, height: 1, depth: 8, colorType: 4, rows: [Uint8Array.from([100, 255, 200, 64])] }));
  assert.deepEqual(Array.from(grayAlpha?.data ?? []), [100, 100, 100, 255, 200, 200, 200, 64]);
  const deep = decodePng(rawPng({ width: 1, height: 1, depth: 16, colorType: 2, rows: [Uint8Array.from([0xab, 0xcd, 0x12, 0x34, 0x56, 0x78])] }));
  assert.deepEqual(Array.from(deep?.data ?? []), [0xab, 0x12, 0x56, 255]);

  assert.equal(decodePng(rawPng({ width: 2, height: 2, depth: 8, colorType: 2, rows: [new Uint8Array(6), new Uint8Array(6)], interlace: 1 })), null, "interlaced files go to the converter");
  assert.equal(decodePng(rawPng({ width: 2, height: 1, depth: 4, colorType: 2, rows: [new Uint8Array(3)] })), null, "a colour type that cannot have that depth");
  const good = png(5, 5);
  assert.equal(decodePng(good.subarray(0, good.length - 40)), null);
  assert.equal(decodePng(enc("not a png at all, nothing to see here, move along")), null);
});

test("scaleRaster: area average, aspect kept, never larger, transparent pixels do not tint the result", () => {
  const checker = { width: 4, height: 4, data: new Uint8Array(64) };
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) checker.data.set((x + y) % 2 === 0 ? [255, 255, 255, 255] : [0, 0, 0, 255], (y * 4 + x) * 4);
  const half = scaleRaster(checker, 2);
  assert.deepEqual([half.width, half.height, Array.from(half.data.subarray(0, 4))], [2, 2, [128, 128, 128, 255]]);
  assert.equal(scaleRaster(checker, 40), checker, "no upscaling");
  const wide = scaleRaster(solid(100, 50), 10);
  assert.deepEqual([wide.width, wide.height], [10, 5]);
  const mixed = scaleRaster({ width: 2, height: 1, data: Uint8Array.from([255, 0, 0, 255, 0, 0, 255, 0]) }, 1);
  assert.deepEqual(Array.from(mixed.data), [255, 0, 0, 128]);
  const tiny = scaleRaster(solid(1000, 1), 10);
  assert.deepEqual([tiny.width, tiny.height], [10, 1], "never below one pixel high");
});

test("zip: stored and deflated entries are read when asked for; a file that is not a zip is null", () => {
  const files = { "a.txt": "alpha", "dir/b.txt": "beta ".repeat(200), "c.bin": Uint8Array.from([0, 1, 2, 255]) };
  for (const deflate of [true, false]) {
    const z = readZip(zip(files, deflate));
    assert.ok(z);
    assert.deepEqual([...z.keys()].sort(), ["a.txt", "c.bin", "dir/b.txt"]);
    assert.equal(Buffer.from(z.get("a.txt")?.() ?? []).toString(), "alpha");
    assert.equal(Buffer.from(z.get("dir/b.txt")?.() ?? []).toString(), "beta ".repeat(200));
    assert.deepEqual(Array.from(z.get("c.bin")?.() ?? []), [0, 1, 2, 255]);
  }
  assert.equal(readZip(enc("this is not a zip file")), null);
  assert.equal(readZip(new Uint8Array(0)), null);
  assert.equal(readZip(zip(files).subarray(0, 30)), null);
});

test("Office text: docx paragraphs, tabs and breaks; entities; pptx slides in numeric order; xlsx sheets with shared, inline and sparse cells; OpenDocument", () => {
  const d = officeExtract(docx(["Hello & <World>", "Col A\tCol B", "line1\nline2", ""]), "docx");
  assert.deepEqual(d, { text: "Hello & <World>\nCol A\tCol B\nline1\nline2" });
  const ent = officeExtract(zip({ "word/document.xml": `<w:document><w:body><w:p><w:r><w:t>&#x41;&#66;&quot;&apos;</w:t></w:r></w:p></w:body></w:document>` }), "docx");
  assert.equal(ent?.text, `AB"'`);
  assert.equal(officeExtract(zip({ "other.xml": "<x/>" }), "docx"), null, "no document part");

  const slides = Array.from({ length: 11 }, (_v, i) => [`Slide ${i + 1}`, `Notes ${i + 1}`]);
  const p = officeExtract(pptx(slides), "pptx");
  assert.equal(p?.pages, 11);
  const parts = (p?.text ?? "").split("\f");
  assert.deepEqual([parts.length, parts[0], parts[1], parts[9], parts[10]], [11, "Slide 1\nNotes 1", "Slide 2\nNotes 2", "Slide 10\nNotes 10", "Slide 11\nNotes 11"]);

  const x = officeExtract(xlsx([
    { name: "Budget", rows: [["Item", "Cost"], ["Rent", 1200], ["inline:Tax & fees", true]] },
    { name: "Empty", rows: [] },
    { name: "Sparse", rows: [[null, null, "C1"], ["A2"]] },
  ]), "xlsx");
  assert.equal(x?.pages, 3);
  assert.deepEqual((x?.text ?? "").split("\f"), ["# Budget\nItem\tCost\nRent\t1200\nTax & fees\tTRUE", "# Empty", "# Sparse\n\t\tC1\nA2"]);

  assert.equal(officeExtract(odt(["Para one", "Tab\there", "Two  spaces"]), "odf")?.text, "Para one\nTab\there\nTwo  spaces");
  assert.throws(() => officeExtract(png(2, 2), "docx"), /could not be opened/, "a file that is not a zip is corrupt");
  assert.equal(officeExtract(enc("legacy"), "legacy"), null, "old formats need the converter");
});

test("PDF reader: page count, the text layer of plain and Flate streams, text operators, no text layer, damaged files", () => {
  const plain = pdf([["Line A", "Line B"], ["Page two"], ["Page three"]]);
  assert.equal(pdfPageCount(plain), 3);
  assert.deepEqual(pdfTextPure(plain), { text: "Line A\nLine B\fPage two\fPage three", pages: 3 });
  assert.deepEqual(pdfTextPure(pdf([["Line A", "Line B"], ["Page two"]], { flate: true })), { text: "Line A\nLine B\fPage two", pages: 2 });
  assert.equal(pdfTextPure(pdf([["see (this) and \\ that"]])).text, "see (this) and \\ that");

  const raw = (op: string): string => pdfTextPure(pdf([[`RAW:${op}`]])).text;
  assert.equal(raw("BT /F1 12 Tf 72 700 Td [(Hel) -20 (lo) -300 (World)] TJ ET"), "Hello World");
  assert.equal(raw("BT 72 700 Td (A) Tj 50 0 Td (B) Tj ET"), "A B");
  assert.equal(raw("BT 1 0 0 1 72 700 Tm (First) Tj 1 0 0 1 72 680 Tm (Second) Tj 1 0 0 1 90 680 Tm (Same) Tj ET"), "First\nSecond Same");
  assert.equal(raw("BT 72 700 Td (A) Tj T* (B) Tj (C) ' ET"), "A\nB\nC");
  assert.equal(raw("BT 72 700 Td <48656c6c6f> Tj ET"), "Hello");
  assert.equal(raw("BT 72 700 Td (Tab\\there \\101\\102) Tj ET"), "Tab\there AB");
  assert.equal(raw("% a comment\nBT 72 700 Td (Kept) Tj ET"), "Kept");
  assert.deepEqual(pdfTextPure(pdf([["RAW:0 0 100 100 re f"]])), { text: "", pages: 1 }, "graphics only: no text layer");
  assert.deepEqual(pdfTextPure(enc("garbage that is not a pdf")), { text: "", pages: 0 });
  assert.equal(pdfPageCount(enc("%PDF-1.5\n1 0 obj\n<< /Type /Pages /Count 7 /Kids [] >>\nendobj")), 7, "a page tree count when the pages are not visible");
  assert.equal(pdfPageCount(enc("nothing")), 0);
});

// ---- pictures through the capabilities ----------------------------------------------------------------------

test("a png: thumbnails at every size are scaled here and never enlarged; the second read costs no file read", () => with_(async (w) => {
  const f = w.files.add("photo.png", "image/png", encodePng(gradient(1000, 500)));
  const m = await call(w, "previews.get", { fileId: f.fileId });
  const readsAfterFirst = w.files.reads.length;
  assert.deepEqual([m["ready"], m["width"], m["height"]], [true, 256, 128]);
  assert.deepEqual(dimsOf(String(m["url"])), { width: 256, height: 128 });
  assert.equal(m["pages"], undefined);
  const dims = async (size: string): Promise<[number, number]> => { const r = await call(w, "previews.get", { fileId: f.fileId, size }); return [Number(r["width"]), Number(r["height"])]; };
  assert.deepEqual([await dims("s"), await dims("l"), await dims("xl")], [[96, 48], [640, 320], [1000, 500]]);
  assert.equal(w.files.reads.length, readsAfterFirst, "the first read of the file made all four sizes");
  assert.deepEqual(w.named("preview.ready"), [{ fileId: f.fileId, versionId: "ver_p1v1", kinds: ["thumbnail"] }]);
  assert.equal(w.execCalls.length, 0, "a png needs no converter");

  // a small picture is kept as it is
  const small = png(50, 40, [1, 2, 3, 255]);
  const s = w.files.add("icon.png", "image/png", small);
  const xl = await call(w, "previews.get", { fileId: s.fileId, size: "xl" });
  assert.equal(xl["url"], dataOf(small));
  assert.deepEqual([xl["width"], xl["height"]], [50, 40]);
}));

test("thumbnails for a grid: ready ones with their size, the rest not ready, an unknown file does not spoil the others", () => with_(async (w) => {
  const a = w.files.add("a.png", "image/png", png(400, 300));
  const t = w.files.add("t.txt", "text/plain", enc("hello"));
  const b = w.files.add("b.png", "image/png", png(10, 10));
  const r = await call(w, "previews.thumbnails", { fileIds: [a.fileId, "fil_missing", t.fileId, b.fileId], size: "s" });
  const items = r["items"] as Row[];
  assert.deepEqual(items.map((i) => [i["fileId"], i["ready"], i["width"], i["height"]]), [[a.fileId, true, 96, 72], ["fil_missing", false, undefined, undefined], [t.fileId, false, undefined, undefined], [b.fileId, true, 10, 10]]);
  assert.match(String(items[0]?.["url"]), /^data:image\/png;base64,/);
  await expectCode("validation.bad_input", () => call(w, "previews.thumbnails", { fileIds: [] }));
  await expectCode("validation.bad_input", () => call(w, "previews.thumbnails", { fileIds: Array.from({ length: 201 }, (_v, i) => `fil_${i}`) }));
  await expectCode("validation.bad_input", () => call(w, "previews.thumbnails", { fileIds: [a.fileId], size: "huge" }));
}));

test("a jpeg goes through vipsthumbnail; without it the failure is converter_down and is tried again when the program is back; a corrupt picture is final", () => with_(async (w) => {
  const f = w.files.add("photo.jpg", "image/jpeg", jpegHeader(2000, 1000));
  const m = await call(w, "previews.get", { fileId: f.fileId });
  assert.deepEqual([m["ready"], m["width"], m["height"]], [true, 256, 128]);
  const vips = w.ran("vipsthumbnail");
  assert.equal(vips.length, 4);
  assert.deepEqual(vips[0]?.argv.slice(2, 4), ["-s", "96x960>"]);
  assert.equal((await call(w, "previews.get", { fileId: f.fileId, size: "xl" }))["width"], 1280);

  w.tools.vips = false;
  const g = w.files.add("photo2.jpg", "image/jpeg", jpegHeader(800, 600));
  const down = await call(w, "previews.get", { fileId: g.fileId });
  assert.deepEqual(down, { ready: false, reason: "converter_down" });
  assert.deepEqual(w.named("preview.failed"), [{ fileId: g.fileId, versionId: "ver_p2v1", reason: "converter_down" }]);
  assert.equal(w.rows("previews_file").find((r) => r["file_id"] === g.fileId)?.["state"], "failed");
  w.tools.vips = true;
  const up = await call(w, "previews.get", { fileId: g.fileId });
  assert.deepEqual([up["ready"], up["width"]], [true, 256]);
  assert.equal(w.rows("previews_file").find((r) => r["file_id"] === g.fileId)?.["state"], "ready");

  const bad = w.files.add("broken.png", "image/png", enc("this is not a picture"));
  assert.deepEqual(await call(w, "previews.get", { fileId: bad.fileId }), { ready: false, reason: "corrupt" });
  const reads = w.files.reads.length;
  assert.deepEqual(await call(w, "previews.get", { fileId: bad.fileId }), { ready: false, reason: "corrupt" });
  assert.equal(w.files.reads.length, reads, "a corrupt file is not read again");
}));

// ---- PDF -----------------------------------------------------------------------------------------------------

test("a PDF: page one as the thumbnail, page images made when asked for, text from the file itself, page counts", () => with_(async (w) => {
  const f = w.files.add("doc.pdf", "application/pdf", pdf([["Hello PDF", "second line"], ["Page two"], ["Page three"]], { flate: true }));
  const m = await call(w, "previews.get", { fileId: f.fileId });
  assert.deepEqual([m["ready"], m["width"], m["height"], m["pages"]], [true, 256, 362, 3]);
  assert.equal(w.ran("pdftoppm").filter((c) => c.argv.includes("-singlefile")).length, 1);
  assert.deepEqual(w.named("preview.ready"), [{ fileId: f.fileId, versionId: "ver_p1v1", kinds: ["thumbnail", "pages", "text"], pages: 3 }]);

  const pages = await call(w, "previews.pages", { fileId: f.fileId, from: 1, count: 2 });
  assert.equal(pages["total"], 3);
  assert.deepEqual((pages["pages"] as Row[]).map((p) => [p["n"], p["width"], p["height"]]), [[1, 256, 362], [2, 256, 362]]);
  assert.equal(w.ran("pdftoppm").length, 2, "page 1 was already made; page 2 was converted now");
  const argv = w.ran("pdftoppm").at(-1)?.argv ?? [];
  assert.deepEqual([argv[argv.indexOf("-f") + 1], argv[argv.indexOf("-l") + 1], argv[argv.indexOf("-scale-to-x") + 1]], ["2", "2", "256"]);
  const last = await call(w, "previews.pages", { fileId: f.fileId, from: 3, count: 50 });
  assert.deepEqual([last["total"], (last["pages"] as Row[]).map((p) => p["n"])], [3, [3]]);
  assert.deepEqual((await call(w, "previews.pages", { fileId: f.fileId, from: 4 }))["pages"], []);
  const small = await call(w, "previews.get", { fileId: f.fileId, page: 2, size: "s" });
  assert.deepEqual([small["width"], small["height"]], [96, 136]);
  assert.deepEqual(await call(w, "previews.get", { fileId: f.fileId, page: 9 }), { ready: false, reason: "no_such_page", pages: 3 });
  const thumbS = await call(w, "previews.get", { fileId: f.fileId, size: "l" });
  assert.deepEqual([thumbS["width"], thumbS["height"]], [640, 905]);
  await expectCode("validation.bad_input", () => call(w, "previews.get", { fileId: f.fileId, page: 0 }));
  await expectCode("validation.bad_input", () => call(w, "previews.pages", { fileId: f.fileId, count: 51 }));

  const t = await call(w, "previews.text", { fileId: f.fileId });
  assert.deepEqual(t, { text: "Hello PDF\nsecond line\n\nPage two\n\nPage three", truncated: false, source: "pdf", pages: 3 });
  assert.equal((await call(w, "previews.text", { fileId: f.fileId, page: 2 }))["text"], "Page two");
  assert.equal((await call(w, "previews.text", { fileId: f.fileId, page: 3 }))["text"], "Page three");
  assert.equal((await call(w, "previews.text", { fileId: f.fileId, page: 4 }))["text"], "");
}));

test("a PDF with pdftotext on the server uses it, page by page; a scan has no text and says so; a PDF that is not one is corrupt; no pdftoppm still gives the text", () => with_(async (w) => {
  w.tools.pdftotext = true;
  w.text.pdf = "Alpha\fBeta\fGamma\f";
  const f = w.files.add("tool.pdf", "application/pdf", pdf([["x"], ["y"], ["z"]]));
  const t = await call(w, "previews.text", { fileId: f.fileId });
  assert.deepEqual(t, { text: "Alpha\n\nBeta\n\nGamma", truncated: false, source: "pdf", pages: 3 });
  assert.equal((await call(w, "previews.text", { fileId: f.fileId, page: 2 }))["text"], "Beta");

  w.tools.pdftotext = false;
  const scan = w.files.add("scan.pdf", "application/pdf", pdf([["RAW:0 0 10 10 re f"], ["RAW:0 0 10 10 re f"]]));
  assert.deepEqual(await call(w, "previews.text", { fileId: scan.fileId }), { text: "", truncated: false, source: "none", pages: 2 });
  assert.equal((await call(w, "previews.get", { fileId: scan.fileId }))["ready"], true);

  const notPdf = w.files.add("fake.pdf", "application/pdf", enc("hello, this is plain text"));
  assert.deepEqual(await call(w, "previews.get", { fileId: notPdf.fileId }), { ready: false, reason: "corrupt" });
  assert.deepEqual(await call(w, "previews.text", { fileId: notPdf.fileId }), { text: "", truncated: false, source: "none" });

  w.tools.pdftoppm = false;
  const g = w.files.add("noimg.pdf", "application/pdf", pdf([["Only text here"]]));
  assert.deepEqual(await call(w, "previews.get", { fileId: g.fileId }), { ready: false, reason: "converter_down", pages: 1 });
  assert.equal((await call(w, "previews.text", { fileId: g.fileId }))["text"], "Only text here");
  assert.deepEqual((await call(w, "previews.pages", { fileId: g.fileId }))["pages"], []);
  assert.deepEqual(w.named("preview.ready").at(-1), { fileId: g.fileId, versionId: "ver_p4v1", kinds: ["text"], pages: 1 });
}));

// ---- Office --------------------------------------------------------------------------------------------------

test("docx: text from the file, page images through soffice then pdftoppm; without soffice the text still works and the image says converter_down", () => with_(async (w) => {
  const f = w.files.add("report.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", docx(["Title", "Body text"]));
  const m = await call(w, "previews.get", { fileId: f.fileId });
  assert.deepEqual([m["ready"], m["width"], m["pages"]], [true, 256, 3], "page count comes from the converted PDF");
  assert.equal(w.ran("soffice").length, 1);
  assert.equal((w.ran("soffice")[0]?.argv ?? []).includes("--headless"), true);
  assert.deepEqual(await call(w, "previews.text", { fileId: f.fileId }), { text: "Title\nBody text", truncated: false, source: "office", pages: 3 });
  const pages = await call(w, "previews.pages", { fileId: f.fileId, from: 2, count: 2 });
  assert.deepEqual([pages["total"], (pages["pages"] as Row[]).map((p) => p["n"])], [3, [2, 3]]);

  w.tools.soffice = false;
  const g = w.files.add("memo.docx", "", docx(["No converter"]));
  assert.deepEqual(await call(w, "previews.get", { fileId: g.fileId }), { ready: false, reason: "converter_down" });
  assert.deepEqual(await call(w, "previews.text", { fileId: g.fileId }), { text: "No converter", truncated: false, source: "office" });
  assert.deepEqual(w.named("preview.ready").at(-1), { fileId: g.fileId, versionId: "ver_p2v1", kinds: ["text"] });
}));

test("xlsx and pptx without soffice: one page per sheet or slide, text per page; old Office files need soffice", () => with_(async (w) => {
  w.tools.soffice = false;
  const x = w.files.add("book.xlsx", "", xlsx([{ name: "One", rows: [["a", 1]] }, { name: "Two", rows: [["b", 2]] }]));
  assert.deepEqual(await call(w, "previews.text", { fileId: x.fileId, page: 2 }), { text: "# Two\nb\t2", truncated: false, source: "office", pages: 2 });
  assert.equal((await call(w, "previews.text", { fileId: x.fileId }))["text"], "# One\na\t1\n\n# Two\nb\t2");
  const p = w.files.add("deck.pptx", "", pptx([["First"], ["Second"], ["Third"]]));
  assert.equal((await call(w, "previews.text", { fileId: p.fileId, page: 3 }))["text"], "Third");
  assert.equal((await call(w, "previews.pages", { fileId: p.fileId }))["total"], 3);
  const o = w.files.add("old.doc", "application/msword", enc("legacy bytes"));
  assert.deepEqual(await call(w, "previews.get", { fileId: o.fileId }), { ready: false, reason: "converter_down" });

  w.tools.soffice = true;
  const again = await call(w, "previews.get", { fileId: o.fileId });
  assert.deepEqual([again["ready"], again["pages"]], [true, 3]);
  assert.deepEqual(await call(w, "previews.text", { fileId: o.fileId }), { text: "Converted page one\n\nConverted page two\n\nConverted page three", truncated: false, source: "office", pages: 3 });
  const broken = w.files.add("broken.docx", "", enc("not a zip"));
  assert.deepEqual(await call(w, "previews.get", { fileId: broken.fileId }), { ready: false, reason: "corrupt" });
}));

// ---- text, unsupported, large ---------------------------------------------------------------------------------

test("text files are the text; a long one is cut; a file with NUL bytes is not text; there is no image for any of them", () => with_(async (w) => {
  const f = w.files.add("notes.md", "text/markdown", enc("# Title\n\nSome notes\n"));
  assert.deepEqual(await call(w, "previews.text", { fileId: f.fileId }), { text: "# Title\n\nSome notes\n", truncated: false, source: "native" });
  assert.deepEqual(await call(w, "previews.get", { fileId: f.fileId }), { ready: false, reason: "no_image" });
  assert.deepEqual(w.named("preview.ready"), [{ fileId: f.fileId, versionId: "ver_p1v1", kinds: ["text"] }]);
  assert.equal(w.execCalls.length, 0);

  const big = w.files.add("big.txt", "text/plain", enc("x".repeat(MAX_TEXT + 100_000)));
  const t = await call(w, "previews.text", { fileId: big.fileId });
  assert.deepEqual([String(t["text"]).length, t["truncated"], t["source"]], [MAX_TEXT, true, "native"]);
  assert.ok(w.files.reads.filter((r) => r.fileId === big.fileId).length >= 2, "a file over one chunk is read in pieces");

  const bin = w.files.add("data.txt", "text/plain", Uint8Array.from([97, 0, 98]));
  assert.deepEqual(await call(w, "previews.text", { fileId: bin.fileId }), { text: "", truncated: false, source: "none" });
}));

test("unsupported types and files over the size limit fail once and are not read again", () => with_(async (w) => {
  const v = w.files.add("clip.mp4", "video/mp4", Uint8Array.from([0, 0, 0, 24]));
  assert.deepEqual(await call(w, "previews.get", { fileId: v.fileId }), { ready: false, reason: "unsupported" });
  assert.deepEqual(w.named("preview.failed"), [{ fileId: v.fileId, versionId: "ver_p1v1", reason: "unsupported" }]);
  const reads = w.files.reads.length;
  assert.deepEqual(await call(w, "previews.get", { fileId: v.fileId }), { ready: false, reason: "unsupported" });
  assert.deepEqual(await call(w, "previews.pages", { fileId: v.fileId }), { total: 0, pages: [] });
  assert.equal(w.files.reads.length, reads);
  assert.equal(w.named("preview.failed").length, 1, "the failure is announced once");

  const huge = w.files.add("huge.pdf", "application/pdf", pdf([["x"]]));
  huge.size = 40_000_000;
  assert.deepEqual(await call(w, "previews.get", { fileId: huge.fileId }), { ready: false, reason: "too_large" });
  assert.equal(w.files.reads.filter((r) => r.fileId === huge.fileId).length, 0, "refused before reading a byte");
  await expectCode("validation.bad_input", () => call(w, "previews.get", { fileId: v.fileId, size: "tiny" }));
  await expectCode("validation.not_found", () => call(w, "previews.get", { fileId: "fil_nope" }));
}));

// ---- versions, render, queue, health -----------------------------------------------------------------------------

test("each version has its own preview; the latest two are kept; an older one can be asked for by id", () => with_(async (w) => {
  const f = w.files.add("pic.png", "image/png", png(100, 50, [1, 1, 1, 255]));
  const v1 = f.versions[0]?.versionId ?? "";
  assert.equal((await call(w, "previews.get", { fileId: f.fileId }))["width"], 100);
  const v2 = w.files.edit(f.fileId, png(400, 200, [2, 2, 2, 255]));
  const second = await call(w, "previews.get", { fileId: f.fileId });
  assert.deepEqual([second["width"], second["height"]], [256, 128]);
  assert.deepEqual(w.rows("previews_file").map((r) => r["version"]).sort(), [1, 2]);
  const v3 = w.files.edit(f.fileId, png(1000, 500, [3, 3, 3, 255]));
  assert.equal((await call(w, "previews.get", { fileId: f.fileId }))["width"], 256);
  assert.deepEqual(w.rows("previews_file").map((r) => r["version"]).sort(), [2, 3], "version one's preview is dropped");
  assert.ok(!w.rows("previews_image").some((r) => r["version"] === 1));
  const old = await call(w, "previews.get", { fileId: f.fileId, versionId: v2.versionId, size: "l" });
  assert.deepEqual([old["width"], old["height"]], [400, 200]);
  assert.deepEqual(w.named("preview.ready").map((e) => (e as Row)["versionId"]), [v1, v2.versionId, v3.versionId]);
  await expectCode("validation.not_found", () => call(w, "previews.get", { fileId: f.fileId, versionId: "ver_nope" }));
}));

test("previews.render makes a preview now, force makes it again, and the queue from file.version_added empties as versions are made", () => with_(async (w) => {
  const f = w.files.add("a.png", "image/png", png(300, 100));
  const feed = (name: string, payload: Row): void => {
    const fn = versionConsumer.on[name];
    assert.ok(fn);
    fn(w.db, { at: w.ctx.now(), actor: "usr_owner", payload: new TextEncoder().encode(JSON.stringify(payload)) });
  };
  feed("file.version_added", { fileId: f.fileId, versionId: "ver_p1v1", n: 1 });
  feed("file.version_added", { fileId: f.fileId, versionId: "ver_p1v1", n: 1 });
  feed("file.version_added", { fileId: "", n: 1 });
  feed("file.version_added", { fileId: f.fileId, n: 0 });
  assert.deepEqual(w.rows("previews_queue").map((r) => [r["file_id"], r["version"]]), [[f.fileId, 1]], "queued once");
  assert.equal((await call(w, "previews.health", {}))["queued"], 1);

  assert.deepEqual(await call(w, "previews.render", { fileId: f.fileId }), { queued: true });
  assert.equal(w.rows("previews_queue").length, 0);
  assert.equal(w.named("preview.ready").length, 1);
  feed("file.version_added", { fileId: f.fileId, n: 1 });
  assert.equal(w.rows("previews_queue").length, 0, "a version that has its preview is not queued");
  const before = w.rows("previews_image").length;
  w.advance(5000);
  await call(w, "previews.render", { fileId: f.fileId });
  assert.equal(w.named("preview.ready").length, 1, "without force a made preview is left alone");
  await call(w, "previews.render", { fileId: f.fileId, force: true });
  assert.equal(w.named("preview.ready").length, 2);
  assert.equal(w.rows("previews_image").length, before);
  assert.ok(w.rows("previews_image").every((r) => r["created_at"] === w.ctx.now()), "the images were made again");

  feed("file.purged", { fileId: f.fileId });
  assert.deepEqual([w.rows("previews_file").length, w.rows("previews_image").length], [0, 0]);
}));

test("health: healthy with every converter, degraded and named when one is missing or the queue is long", () => with_(async (w) => {
  const ok = await call(w, "previews.health", {});
  assert.deepEqual([ok["state"], ok["queued"], typeof ok["latencyMs"]], ["healthy", 0, "number"]);
  w.tools.pdftoppm = false;
  const d1 = await call(w, "previews.health", {});
  assert.equal(d1["state"], "degraded");
  assert.match(String(d1["detail"]), /pdftoppm/);
  assert.doesNotMatch(String(d1["detail"]), /soffice/);
  w.tools.soffice = false;
  w.tools.vips = false;
  const d3 = await call(w, "previews.health", {});
  assert.match(String(d3["detail"]), /pdftoppm.*soffice.*vipsthumbnail/);
  w.tools.pdftoppm = true; w.tools.soffice = true; w.tools.vips = true;
  for (let i = 0; i < 501; i++) w.db.run("INSERT INTO previews_queue (file_id, version, queued_at) VALUES (?, ?, ?)", `fil_q${i}`, 1, 1);
  const long = await call(w, "previews.health", {});
  assert.deepEqual([long["state"], long["queued"]], ["degraded", 501]);
  assert.match(String(long["detail"]), /501 versions are waiting/);
}));

test("a converter that hangs or crashes is a timeout or a corrupt file, not a crash of the module", () => with_(async (w) => {
  w.failures.set("pdftoppm", { code: 124, stdout: "", stderr: "timed out" });
  const f = w.files.add("slow.pdf", "application/pdf", pdf([["Text survives"]]));
  assert.deepEqual(await call(w, "previews.get", { fileId: f.fileId }), { ready: false, reason: "timeout", pages: 1 });
  assert.equal((await call(w, "previews.text", { fileId: f.fileId }))["text"], "Text survives");
  w.failures.set("pdftoppm", { code: 1, stdout: "", stderr: "Syntax Error" });
  const g = w.files.add("odd.pdf", "application/pdf", pdf([["Other"]]));
  assert.deepEqual(await call(w, "previews.get", { fileId: g.fileId }), { ready: false, reason: "corrupt", pages: 1 });
}));
