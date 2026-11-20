// Real mail is Windows-1252 text all the time (Outlook, older Gmail clients): the bytes 0x80 to 0x9F are curly quotes, dashes, the euro sign.
// A Node build that reads the label "windows-1252" as ISO-8859-1 turned them into control characters ("Reunión \u0096"), so the decoder does not
// depend on the runtime's TextDecoder for these labels.
import test from "node:test";
import assert from "node:assert/strict";
import { decodeBytes, decodePart, decodeWindows1252 } from "../mail-parse.ts";

const HIGH = [
  "\u20ac",
  "\u0081",
  "\u201a",
  "\u0192",
  "\u201e",
  "\u2026",
  "\u2020",
  "\u2021",
  "\u02c6",
  "\u2030",
  "\u0160",
  "\u2039",
  "\u0152",
  "\u008d",
  "\u017d",
  "\u008f",
  "\u0090",
  "\u2018",
  "\u2019",
  "\u201c",
  "\u201d",
  "\u2022",
  "\u2013",
  "\u2014",
  "\u02dc",
  "\u2122",
  "\u0161",
  "\u203a",
  "\u0153",
  "\u009d",
  "\u017e",
  "\u0178",
];

test("bytes 0x80 to 0x9F are the Windows-1252 punctuation, the rest of the byte range is Latin-1", () => {
  for (let b = 0x80; b <= 0x9f; b += 1)
    assert.equal(decodeWindows1252(Uint8Array.of(b)), HIGH[b - 0x80], b.toString(16));
  assert.equal(decodeWindows1252(Uint8Array.of(0x41, 0xa0, 0xe9, 0xff)), "A\u00a0\u00e9\u00ff");
  assert.equal(decodeBytes(Uint8Array.of(0x52, 0xf3, 0x20, 0x96), "windows-1252"), "R\u00f3 \u2013");
  for (const label of ["Windows-1252", "cp1252", "ISO-8859-1", "latin1", " windows-1252 "])
    assert.equal(decodeBytes(Uint8Array.of(0x93, 0x94), label), "\u201c\u201d", label);
  assert.equal(
    decodePart(Buffer.from([0x80, 0x92]).toString("base64"), { encoding: "base64", charset: "windows-1252" }),
    "\u20ac\u2019",
  );
});

test("a runtime that reads windows-1252 as ISO-8859-1 does not corrupt the text", () => {
  const Real = globalThis.TextDecoder;
  class Latin1Bug {
    private readonly inner: InstanceType<typeof Real>;
    constructor(label: string, o?: ConstructorParameters<typeof Real>[1]) {
      this.inner = new Real(/^(windows-1252|cp1252|iso-8859-1|latin1)$/i.test(label) ? "utf-8" : label, o);
      this.latin = /^(windows-1252|cp1252|iso-8859-1|latin1)$/i.test(label);
    }
    private readonly latin: boolean;
    decode(b: Uint8Array): string {
      return this.latin ? Buffer.from(b).toString("latin1") : this.inner.decode(b);
    }
  }
  globalThis.TextDecoder = Latin1Bug as unknown as typeof TextDecoder;
  try {
    assert.equal(
      new TextDecoder("windows-1252").decode(Uint8Array.of(0x96)),
      "\u0096",
      "the stand-in really has the bug",
    );
    assert.equal(
      decodeBytes(Uint8Array.of(0x52, 0x65, 0x75, 0x6e, 0x69, 0xf3, 0x6e, 0x20, 0x96), "windows-1252"),
      "Reuni\u00f3n \u2013",
    );
    assert.equal(decodeBytes(Buffer.from("Reuni\u00f3n \u2013", "utf8"), "utf-8"), "Reuni\u00f3n \u2013");
  } finally {
    globalThis.TextDecoder = Real;
  }
});

test("a long Windows-1252 body decodes in one pass", () => {
  const bytes = new Uint8Array(2_000_000).fill(0x61);
  for (let i = 0; i < bytes.length; i += 50) bytes[i] = 0x96;
  const t0 = performance.now();
  const out = decodeWindows1252(bytes);
  assert.equal(out.length, 2_000_000);
  assert.equal(out[0], "\u2013");
  assert.equal(out[1_999_950], "\u2013");
  assert.equal(out[1], "a");
  assert.ok(performance.now() - t0 < 1000);
  // all high bytes is the worst case: still linear
  const worst = decodeWindows1252(new Uint8Array(200_000).fill(0x92));
  assert.equal(worst.length, 200_000);
});
