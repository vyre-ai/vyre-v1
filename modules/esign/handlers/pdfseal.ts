// esign: the PDF side of the seal. A signature field with a reserved /Contents and a /ByteRange to fill in, written by the one final save of the document (no rewrite after signing), then the signature dropped
// into the reserved hole. `inspect` reads a file back the way a validator does: the byte ranges, the signature, and whether the ranges cover the whole file.

import type { PDFDocument } from "@cantoo/pdf-lib";
import { lib } from "./pdflib.ts";
import { signDetached, verifyDetached } from "./seal.ts";
import type { CmsCheck, SealMaterial } from "./seal.ts";

/** Room for the signature in bytes: a 3072-bit RSA signature, its certificate and a chain fit well inside. */
export const SIG_BYTES = 16 * 1024;
const PLACE = "A".repeat(10);
const ZEROS = "0".repeat(SIG_BYTES * 2);

/** Adds the signature field to the document, on its first page. Call before the one final save. */
export function addSealField(doc: PDFDocument, spaceName: string, signedAt: Date): void {
  const { PDFArray, PDFDict, PDFHexString, PDFName, PDFNumber, PDFString } = lib(); // loaded by the caller (pdf.ts finalize reads the PDF first)
  const ctx = doc.context;
  const sig = ctx.register(
    ctx.obj({
      Type: "Sig",
      Filter: "Adobe.PPKLite",
      SubFilter: "adbe.pkcs7.detached",
      ByteRange: [0, PDFName.of(PLACE), PDFName.of(PLACE), PDFName.of(PLACE)],
      Contents: PDFHexString.of(ZEROS),
      Reason: PDFString.of("Sealed after the last signature"),
      Name: PDFString.of(spaceName.replace(/[^\x20-\x7e]/g, "?").slice(0, 64)),
      M: PDFString.fromDate(signedAt),
    }),
  );
  const page = doc.getPage(0);
  const field = ctx.register(
    ctx.obj({
      Type: "Annot",
      Subtype: "Widget",
      FT: "Sig",
      Rect: [0, 0, 0, 0],
      V: sig,
      T: PDFString.of("VyreDocumentSeal"),
      F: 132,
      P: page.ref,
    }),
  );
  page.node.addAnnot(field);
  const existing = doc.catalog.lookup(PDFName.of("AcroForm"));
  if (existing instanceof PDFDict) {
    const fields = existing.lookup(PDFName.of("Fields"));
    if (fields instanceof PDFArray) fields.push(field);
    else existing.set(PDFName.of("Fields"), ctx.obj([field]));
    existing.set(PDFName.of("SigFlags"), PDFNumber.of(3));
  } else doc.catalog.set(PDFName.of("AcroForm"), ctx.obj({ Fields: [field], SigFlags: 3 }));
}

const latin = (b: Uint8Array): string => Buffer.from(b).toString("latin1");

function hole(bytes: Uint8Array): { from: number; to: number } | null {
  const text = latin(bytes);
  const at = text.indexOf(`<${ZEROS}>`);
  return at < 0 ? null : { from: at, to: at + ZEROS.length + 2 };
}

const ranged = (bytes: Uint8Array, r: number[]): Uint8Array => {
  const [a, b, c, d] = r as [number, number, number, number];
  const out = new Uint8Array(b - a + d);
  out.set(bytes.subarray(a, a + b), 0);
  out.set(bytes.subarray(c, c + d), b - a);
  return out;
};

/** Fills in the byte ranges and the signature. `bytes` is a file that came from the one save with the field in it. */
export async function sealBytes(
  bytes: Uint8Array,
  m: SealMaterial,
  timestamp?: (signature: Uint8Array) => Promise<Uint8Array | null>,
): Promise<Uint8Array> {
  const h = hole(bytes);
  if (!h) throw new Error("the signature field is not in the file");
  const out = new Uint8Array(bytes);
  const text = latin(out);
  const found = /\/ByteRange\s*\[([^\]]*\/A{10}[^\]]*)\]/.exec(text); // the one still holding its placeholders (a file sent for signing may carry an older seal)
  if (!found || (found[1] as string).split(`/${PLACE}`).length !== 4)
    throw new Error("the byte range is not in the file");
  const range = [0, h.from, h.to, bytes.length - h.to];
  // each placeholder name is 11 characters and each number goes in as 10 digits and a space, so nothing moves
  const numbers = range.slice(1);
  let n = 0;
  const filled = (found[1] as string).replace(/\/A{10}/g, () => `${String(numbers[n++]).padStart(10, "0")} `);
  const at = found.index + found[0].indexOf("[") + 1;
  out.set(Buffer.from(filled, "latin1"), at);
  const cms = await signDetached(ranged(out, range), m, timestamp);
  if (cms.length > SIG_BYTES) throw new Error("the signature does not fit its place");
  const hexSig = Buffer.from(cms)
    .toString("hex")
    .padEnd(SIG_BYTES * 2, "0");
  out.set(Buffer.from(hexSig, "latin1"), h.from + 1);
  return out;
}

export interface Inspection {
  /** a signature field with a byte range and a signature was found */
  sealed: boolean;
  /** the byte ranges cover the whole file but the signature itself, and the signature's place is where the range says */
  covers: boolean;
  cms: CmsCheck | null;
}

/** Reads a file the way a validator does. The last byte range in the file is the seal (a file is sealed once). */
export async function inspect(bytes: Uint8Array): Promise<Inspection> {
  const text = latin(bytes);
  let last: RegExpExecArray | null = null;
  for (const m of text.matchAll(/\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/g)) last = m;
  if (!last) return { sealed: false, covers: false, cms: null };
  const [a, b, c, d] = [1, 2, 3, 4].map((i) => Number(last![i]));
  const covers =
    a === 0 &&
    (b as number) > 0 &&
    (c as number) > (b as number) &&
    (c as number) + (d as number) === bytes.length &&
    text[b as number] === "<" &&
    text[(c as number) - 1] === ">";
  if (!covers) return { sealed: true, covers: false, cms: null };
  const hexSig = text.slice((b as number) + 1, (c as number) - 1).replace(/\s+/g, "");
  if (!/^[0-9a-fA-F]+$/.test(hexSig) || hexSig.length % 2 !== 0) return { sealed: true, covers, cms: null };
  const cms = new Uint8Array(Buffer.from(hexSig, "hex"));
  return {
    sealed: true,
    covers,
    cms: await verifyDetached(cms, ranged(bytes, [a as number, b as number, c as number, d as number])),
  };
}
