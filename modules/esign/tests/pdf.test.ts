// esign built-in signing: the PDF layer. A real PDF is read, given its signature page, stamped and given an audit page.
import test from "node:test";
import assert from "node:assert/strict";
import { PDFDocument } from "@cantoo/pdf-lib";
import { drawable, finalize, pngSize, prepare, PdfError } from "../handlers/pdf.ts";
import type { Audit } from "../handlers/pdf.ts";
import { samplePdf, samplePng, textOf } from "../fixtures/pdf.ts";

const audit = (over: Partial<Audit> = {}): Audit => ({
  title: "Northwind services agreement",
  envelopeId: "env_1",
  senderName: "Imran Ibarra",
  sentAt: 1_760_000_000_000,
  zone: "Asia/Karachi",
  originalSha256: "a".repeat(64),
  sentSha256: "b".repeat(64),
  signers: [
    {
      name: "Andrea Lindahl",
      email: "andrea@northwind.example",
      openedAt: 1_760_000_100_000,
      openedIp: "203.0.113.9",
      openedUa: "Mozilla/5.0 (test)",
      signedAt: 1_760_000_200_000,
      signedIp: "203.0.113.9",
      signedUa: "Mozilla/5.0 (test)",
      kind: "typed",
    },
  ],
  ...over,
});

test("no place given: a new last page titled Signature page with a box and a date for every signer", async () => {
  const p = await prepare(
    await samplePdf(2),
    [{ name: "Andrea Lindahl" }, { name: "Imran Ibarra" }],
    undefined,
    "Agreement",
  );
  assert.equal(p.pages.length, 3);
  assert.deepEqual(
    p.places.map((x) => [x.signer, x.kind, x.page]),
    [
      [0, "signature", 3],
      [0, "date", 3],
      [1, "signature", 3],
      [1, "date", 3],
    ],
  );
  assert.match(textOf(p.pdf), /Signature page/);
  assert.match(textOf(p.pdf), /Andrea Lindahl/);
  const back = await PDFDocument.load(p.pdf);
  assert.equal(back.getPageCount(), 3);
});

test("five signers need a second signature page", async () => {
  const names = Array.from({ length: 5 }, (_, i) => ({ name: `Signer ${i + 1}` }));
  const p = await prepare(await samplePdf(1), names, undefined, "Agreement");
  assert.equal(p.pages.length, 3);
  assert.equal(p.places.filter((x) => x.kind === "signature").at(-1)?.page, 3);
});

test("given places are kept; a signer with no signature place, a bad page and a place off the page are refused in plain words", async () => {
  const pdf = await samplePdf(2);
  const ok = await prepare(
    pdf,
    [{ name: "A" }],
    [{ signer: 0, kind: "signature", page: 2, x: 10, y: 80, w: 30, h: 8 }],
    "T",
  );
  assert.equal(ok.pages.length, 2);
  await assert.rejects(
    prepare(
      pdf,
      [{ name: "A" }, { name: "B" }],
      [{ signer: 0, kind: "signature", page: 1, x: 1, y: 1, w: 10, h: 5 }],
      "T",
    ),
    /B has no place to sign/,
  );
  await assert.rejects(
    prepare(pdf, [{ name: "A" }], [{ signer: 0, kind: "signature", page: 9, x: 1, y: 1, w: 10, h: 5 }], "T"),
    /page 9/,
  );
  await assert.rejects(
    prepare(pdf, [{ name: "A" }], [{ signer: 0, kind: "signature", page: 1, x: 95, y: 1, w: 10, h: 5 }], "T"),
    /outside the page/,
  );
  await assert.rejects(
    prepare(pdf, [{ name: "A" }], [{ signer: 3, kind: "signature", page: 1, x: 1, y: 1, w: 10, h: 5 }], "T"),
    /not on the list/,
  );
});

test("a file that is not a PDF is refused in plain words", async () => {
  await assert.rejects(
    prepare(new TextEncoder().encode("hello"), [{ name: "A" }], undefined, "T"),
    (e: unknown) => e instanceof PdfError,
  );
});

test("finalize stamps a typed signature and the date, then appends the audit page with both hashes", async () => {
  const p = await prepare(await samplePdf(2), [{ name: "Andrea Lindahl" }], undefined, "Agreement");
  const out = await finalize(
    p.pdf,
    p.places,
    [
      {
        signer: 0,
        name: "Andrea Lindahl",
        email: null,
        mark: { kind: "typed", text: "Andrea Lindahl" },
        signedAt: 1_760_000_200_000,
      },
    ],
    audit(),
  );
  const text = textOf(out);
  assert.match(text, /Signed by Andrea Lindahl/);
  assert.match(text, /Audit page/);
  assert.ok(text.includes("a".repeat(64)) && text.includes("b".repeat(64)));
  assert.match(text, /andrea@northwind\.example/);
  assert.match(text, /Envelope: env_1/);
  assert.match(text, /\b2025|\b2026|Oct|Nov/); // a date was drawn
  const back = await PDFDocument.load(out);
  assert.equal(back.getPageCount(), p.pages.length + 1);
});

test("a drawn signature is a PNG on the page, a PNG that is not one is refused", async () => {
  const p = await prepare(await samplePdf(1), [{ name: "Andrea Lindahl" }], undefined, "Agreement");
  const png = samplePng();
  assert.deepEqual(pngSize(png), { w: 120, h: 40 });
  const out = await finalize(
    p.pdf,
    p.places,
    [{ signer: 0, name: "Andrea Lindahl", email: null, mark: { kind: "drawn", png }, signedAt: 1_760_000_200_000 }],
    audit({ signers: [{ ...audit().signers[0]!, kind: "drawn" }] }),
  );
  assert.match(Buffer.from(out).toString("latin1"), /\/Subtype\s*\/Image/);
  assert.equal(pngSize(new TextEncoder().encode("not a png at all, just some text bytes....")), null);
  await assert.rejects(
    finalize(
      p.pdf,
      p.places,
      [{ signer: 0, name: "A", email: null, mark: { kind: "drawn", png: new Uint8Array(40) }, signedAt: 1 }],
      audit(),
    ),
    PdfError,
  );
});

test("letters the standard font cannot draw are caught before they reach the file", () => {
  assert.equal(drawable("Andrea Lindahl"), true);
  assert.equal(drawable("José Núñez"), true);
  assert.equal(drawable("山田太郎"), false);
});

test("a long audit trail runs onto more pages instead of off the page", async () => {
  const p = await prepare(await samplePdf(1), [{ name: "A" }], undefined, "Agreement");
  const many = Array.from({ length: 20 }, (_, i) => ({ ...audit().signers[0]!, name: `Signer ${i}` }));
  const out = await finalize(
    p.pdf,
    p.places,
    [{ signer: 0, name: "A", email: null, mark: { kind: "typed", text: "A" }, signedAt: 1 }],
    audit({ signers: many }),
  );
  assert.ok((await PDFDocument.load(out)).getPageCount() >= p.pages.length + 2);
});
