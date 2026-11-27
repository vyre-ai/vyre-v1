// esign: the PDF work of built-in signing (contract SIGN-CONTRACT-R33, section 5). Prepare a document for signing (read its pages, add the "Signature page" when no place is given),
// stamp each signer's signature and date flat on it, and append the audit page. Pure functions over bytes; no file, no database, no network.
// Nothing a signer sends is ever drawn as anything but text in a standard font or a PNG whose header was checked; a PDF a person sent is only parsed, never run.

import type { PDFDocument, PDFFont, PDFPage } from "@cantoo/pdf-lib";
import { lib, loadPdfLib } from "./pdflib.ts";
import { addSealField } from "./pdfseal.ts";

export const MAX_PAGES = 200;
export const MAX_PNG_BYTES = 300 * 1024;
export const MAX_PNG_SIDE = 2000;

export interface Place {
  signer: number;
  kind: "signature" | "date";
  /** 1-based */
  page: number;
  /** percent of the page, origin top-left */
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface PageSize {
  w: number;
  h: number;
}
export interface Prepared {
  pdf: Uint8Array;
  places: Place[];
  pages: PageSize[];
}
export type SignatureMark = { kind: "typed"; text: string; png?: Uint8Array } | { kind: "drawn"; png: Uint8Array };
export interface Stamp {
  signer: number;
  name: string;
  email: string | null;
  mark: SignatureMark;
  signedAt: number;
}
export interface AuditSigner {
  name: string;
  email: string | null;
  openedAt: number | null;
  openedIp: string | null;
  openedUa: string | null;
  signedAt: number;
  signedIp: string | null;
  signedUa: string | null;
  kind: string;
}
export interface Audit {
  title: string;
  envelopeId: string;
  senderName: string;
  sentAt: number;
  zone: string;
  originalSha256: string;
  sentSha256: string;
  signers: AuditSigner[];
  /** set when the file is to be sealed: the statement goes on the audit page and the signature field is added before the one save */
  seal?: { spaceName: string; fingerprint: string; own: boolean };
}

/** Does the PDF library really take this picture? A PNG can pass every header check and still fail to decode (a palette image with no palette); this finds out before anyone is asked to depend on it. */
export async function embeds(png: Uint8Array): Promise<boolean> {
  await loadPdfLib();
  try {
    await (await lib().PDFDocument.create()).embedPng(png);
    return true;
  } catch {
    return false;
  }
}

/** A plain refusal a person can read; the handler turns it into validation.bad_input. */
export class PdfError extends Error {}

const LATIN = /^[\x20-\x7e\xa0-\xff]*$/;
export const drawable = (text: string): boolean => LATIN.test(text);
/** What the standard font can draw; every other letter becomes a question mark (the audit page only; a signature is refused instead). */
const safe = (text: string): string => text.replace(/[^\x20-\x7e\xa0-\xff]/g, "?");

// node:zlib through the host's own loader (the same way modules reach node:sqlite in tests): it is only used to prove a drawing is not a decompression bomb
const zlib = process.getBuiltinModule("node:zlib");

/** The size of a PNG a signer drew, or null when it is not one this page can use: magic bytes, IHDR, the sizes, and that its compressed data inflates to no more than its own width, height and depth say (a small file that inflates to hundreds of megabytes is refused before anything decodes it). */
export function pngSize(png: Uint8Array): { w: number; h: number } | null {
  const magic = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (png.length < 24 || png.length > MAX_PNG_BYTES) return null;
  for (let i = 0; i < 8; i++) if (png[i] !== magic[i]) return null;
  const v = new DataView(png.buffer, png.byteOffset, png.byteLength);
  if (v.getUint32(12) !== 0x49484452) return null; // IHDR
  const w = v.getUint32(16);
  const h = v.getUint32(20);
  if (w < 1 || h < 1 || w > MAX_PNG_SIDE || h > MAX_PNG_SIDE) return null;
  const data: Uint8Array[] = [];
  let at = 8;
  let ended = false;
  while (at + 12 <= png.length) {
    const len = v.getUint32(at);
    const type = String.fromCharCode(png[at + 4]!, png[at + 5]!, png[at + 6]!, png[at + 7]!);
    if (len > png.length || at + 12 + len > png.length) return null;
    if (type === "IDAT") data.push(png.subarray(at + 8, at + 8 + len));
    if (type === "IEND") {
      ended = true;
      break;
    }
    at += 12 + len;
  }
  if (!ended || data.length === 0) return null;
  try {
    // at most 8 bytes a pixel (16-bit RGBA) and one filter byte a row, plus room for an interlaced image's extra rows
    const room = Math.ceil((w * h * 8 + h) * 1.2) + 1024;
    zlib.inflateSync(Buffer.concat(data), { maxOutputLength: room });
  } catch {
    return null;
  }
  return { w, h };
}

async function load(pdf: Uint8Array): Promise<PDFDocument> {
  await loadPdfLib();
  try {
    return await lib().PDFDocument.load(pdf, { updateMetadata: false });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (/encrypt/i.test(msg))
      throw new PdfError("This PDF is protected with a password. Save a copy without one and send that.");
    throw new PdfError("This file could not be read as a PDF. Export it again and try once more.");
  }
}

const pct = (page: PDFPage, p: Place): { x: number; y: number; w: number; h: number } => {
  const { width, height } = page.getSize();
  const w = (p.w / 100) * width;
  const h = (p.h / 100) * height;
  return { x: (p.x / 100) * width, y: height - (p.y / 100) * height - h, w, h };
};

/** The pages' sizes, and the signature page when no place was given. Places are checked against the pages. */
export async function prepare(
  pdf: Uint8Array,
  signers: { name: string }[],
  given: Place[] | undefined,
  title: string,
): Promise<Prepared> {
  const doc = await load(pdf);
  if (doc.getPageCount() > MAX_PAGES) throw new PdfError(`This PDF has more than ${MAX_PAGES} pages.`);
  const places: Place[] = [];
  if (given && given.length > 0) {
    const n = doc.getPageCount();
    for (const p of given) {
      if (p.signer < 0 || p.signer >= signers.length)
        throw new PdfError("A signing place names a signer who is not on the list.");
      if (p.page < 1 || p.page > n)
        throw new PdfError(`A signing place is on page ${p.page}, which the PDF does not have.`);
      if (!(p.w > 0 && p.h > 0 && p.x >= 0 && p.y >= 0 && p.x + p.w <= 100.0001 && p.y + p.h <= 100.0001))
        throw new PdfError("A signing place is outside the page.");
      places.push(p);
    }
    for (let i = 0; i < signers.length; i++)
      if (!places.some((p) => p.signer === i && p.kind === "signature"))
        throw new PdfError(`${signers[i]!.name} has no place to sign.`);
  } else {
    const font = await doc.embedFont(lib().StandardFonts.Helvetica);
    const bold = await doc.embedFont(lib().StandardFonts.HelveticaBold);
    const W = 612;
    const H = 792;
    const perPage = 4;
    const block = 150;
    for (let i = 0; i < signers.length; i++) {
      let page: PDFPage;
      const slot = i % perPage;
      if (slot === 0) {
        page = doc.addPage([W, H]);
        page.drawText(safe(i === 0 ? "Signature page" : "Signature page (continued)"), {
          x: 60,
          y: H - 80,
          size: 22,
          font: bold,
        });
        page.drawText(safe(title).slice(0, 90), {
          x: 60,
          y: H - 104,
          size: 11,
          font,
          color: lib().rgb(0.35, 0.35, 0.35),
        });
      } else page = doc.getPage(doc.getPageCount() - 1);
      const top = 140 + slot * block; // from the top of the page
      page.drawText(safe(signers[i]!.name).slice(0, 80), { x: 60, y: H - top - 12, size: 12, font: bold });
      const boxY = top + 22;
      page.drawRectangle({
        x: 60,
        y: H - boxY - 70,
        width: 300,
        height: 70,
        borderColor: lib().rgb(0.6, 0.6, 0.6),
        borderWidth: 0.75,
      });
      page.drawText("Signature", { x: 60, y: H - boxY - 82, size: 8, font, color: lib().rgb(0.45, 0.45, 0.45) });
      page.drawRectangle({
        x: 390,
        y: H - boxY - 70,
        width: 160,
        height: 70,
        borderColor: lib().rgb(0.6, 0.6, 0.6),
        borderWidth: 0.75,
      });
      page.drawText("Date", { x: 390, y: H - boxY - 82, size: 8, font, color: lib().rgb(0.45, 0.45, 0.45) });
      const pageNo = doc.getPageCount();
      places.push({
        signer: i,
        kind: "signature",
        page: pageNo,
        x: (60 / W) * 100,
        y: (boxY / H) * 100,
        w: (300 / W) * 100,
        h: (70 / H) * 100,
      });
      places.push({
        signer: i,
        kind: "date",
        page: pageNo,
        x: (390 / W) * 100,
        y: (boxY / H) * 100,
        w: (160 / W) * 100,
        h: (70 / H) * 100,
      });
    }
  }
  const out = await doc.save({ useObjectStreams: false });
  const pages = doc.getPages().map((p) => ({ w: p.getSize().width, h: p.getSize().height }));
  return { pdf: out, places, pages };
}

export function formatAt(ms: number, zone: string): string {
  try {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: zone,
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZoneName: "short",
      hour12: false,
    }).format(new Date(ms));
  } catch {
    return `${new Date(ms).toISOString().replace("T", " ").slice(0, 16)} UTC`;
  }
}
const utc = (ms: number): string => `${new Date(ms).toISOString().replace("T", " ").slice(0, 19)} UTC`;

async function fit(
  doc: PDFDocument,
  font: PDFFont,
  page: PDFPage,
  mark: SignatureMark,
  box: { x: number; y: number; w: number; h: number },
) {
  if (mark.png) {
    const size = pngSize(mark.png);
    if (!size) throw new PdfError("That signature drawing is not a usable picture.");
    const img = await doc.embedPng(mark.png);
    const s = Math.min((box.w - 8) / size.w, (box.h - 8) / size.h, 1);
    page.drawImage(img, { x: box.x + 4, y: box.y + (box.h - size.h * s) / 2, width: size.w * s, height: size.h * s });
    return;
  }
  if (mark.kind === "drawn") throw new PdfError("That signature drawing is not a usable picture."); // a drawing always has its picture; this only tells the type so
  const italic = font;
  let sz = Math.min(30, box.h - 14);
  while (sz > 8 && italic.widthOfTextAtSize(mark.text, sz) > box.w - 8) sz -= 1;
  page.drawText(mark.text, {
    x: box.x + 4,
    y: box.y + (box.h - sz) / 2,
    size: sz,
    font: italic,
    color: lib().rgb(0.05, 0.1, 0.45),
  });
}

function wrap(font: PDFFont, text: string, size: number, width: number): string[] {
  const out: string[] = [];
  for (const para of text.split("\n")) {
    let line = "";
    for (const word of para.split(" ")) {
      const next = line === "" ? word : `${line} ${word}`;
      if (font.widthOfTextAtSize(next, size) <= width) line = next;
      else {
        if (line !== "") out.push(line);
        let w = word;
        while (font.widthOfTextAtSize(w, size) > width && w.length > 1) {
          let k = w.length - 1;
          while (k > 1 && font.widthOfTextAtSize(w.slice(0, k), size) > width) k--;
          out.push(w.slice(0, k));
          w = w.slice(k);
        }
        line = w;
      }
    }
    out.push(line);
  }
  return out;
}

/** The signed document: every signer's signature and date flat on the sent file, then the audit page. */
export async function finalize(sent: Uint8Array, places: Place[], stamps: Stamp[], audit: Audit): Promise<Uint8Array> {
  const doc = await load(sent);
  const italic = await doc.embedFont(lib().StandardFonts.HelveticaOblique);
  const font = await doc.embedFont(lib().StandardFonts.Helvetica);
  const bold = await doc.embedFont(lib().StandardFonts.HelveticaBold);
  const mono = await doc.embedFont(lib().StandardFonts.Courier);
  for (const s of stamps) {
    for (const p of places.filter((x) => x.signer === s.signer)) {
      const page = doc.getPage(p.page - 1);
      const b = pct(page, p);
      if (p.kind === "signature") {
        await fit(doc, italic, page, s.mark, b);
        const cap = safe(`Signed by ${s.name}`).slice(0, 60);
        page.drawText(cap, { x: b.x + 2, y: Math.max(b.y - 22, 2), size: 7, font, color: lib().rgb(0.4, 0.4, 0.4) });
      } else {
        const t = formatAt(s.signedAt, audit.zone);
        let sz = 11;
        while (sz > 6 && font.widthOfTextAtSize(t, sz) > b.w - 6) sz -= 1;
        page.drawText(t, { x: b.x + 3, y: b.y + (b.h - sz) / 2, size: sz, font });
      }
    }
  }
  // the audit page(s)
  const W = 612;
  const H = 792;
  const left = 56;
  const width = W - 2 * left;
  let page = doc.addPage([W, H]);
  let y = H - 64;
  const need = (n: number): void => {
    if (y - n < 56) {
      page = doc.addPage([W, H]);
      y = H - 64;
    }
  };
  const line = (
    text: string,
    o: { size?: number; f?: PDFFont; gap?: number; color?: ReturnType<typeof import("@cantoo/pdf-lib").rgb> } = {},
  ): void => {
    const size = o.size ?? 10;
    const f = o.f ?? font;
    for (const l of wrap(f, safe(text), size, width)) {
      need(size + 4);
      page.drawText(l, { x: left, y, size, font: f, ...(o.color ? { color: o.color } : {}) });
      y -= size + 4;
    }
    y -= o.gap ?? 0;
  };
  line("Audit page", { size: 20, f: bold, gap: 6 });
  line(`Document: ${audit.title}`, { size: 11 });
  line(`Envelope: ${audit.envelopeId}`, { f: mono, size: 9 });
  line(`Sent by ${audit.senderName} on ${formatAt(audit.sentAt, audit.zone)} (${utc(audit.sentAt)})`, {
    size: 10,
    gap: 4,
  });
  line("SHA-256 of the original file", { f: bold, size: 9 });
  line(audit.originalSha256, { f: mono, size: 8 });
  line("SHA-256 of the document as sent for signature", { f: bold, size: 9 });
  line(audit.sentSha256, { f: mono, size: 8, gap: 8 });
  line("Signers", { f: bold, size: 13, gap: 2 });
  for (const s of audit.signers) {
    need(120);
    line(`${s.name}${s.email ? ` <${s.email}>` : ""}`, { f: bold, size: 11 });
    line(`Signed as ${s.kind} on ${formatAt(s.signedAt, audit.zone)} (${utc(s.signedAt)})`, { size: 9 });
    line(
      s.openedAt
        ? `First opened ${utc(s.openedAt)} from ${s.openedIp ?? "unknown address"}`
        : "First opened: not recorded",
      { size: 9 },
    );
    line(`Signed from ${s.signedIp ?? "unknown address"}`, { size: 9 });
    if (s.signedUa) line(`Browser: ${s.signedUa.slice(0, 160)}`, { size: 8, color: lib().rgb(0.4, 0.4, 0.4) });
    y -= 6;
  }
  need(60);
  line(
    "This page records who signed and when. The signed file's own SHA-256 is kept with the envelope in the Space it was sent from.",
    {
      size: 8,
      color: lib().rgb(0.4, 0.4, 0.4),
    },
  );
  if (audit.seal) {
    y -= 6;
    line(
      `Sealed by ${audit.seal.spaceName} with ${audit.seal.own ? "a certificate it holds" : "a certificate made by this Space"}. Fingerprint SHA-256:`,
      { size: 9, f: bold },
    );
    line(audit.seal.fingerprint, { f: mono, size: 8 });
    addSealField(doc, audit.seal.spaceName, new Date());
  }
  return doc.save({ useObjectStreams: false });
}
